// Aggregates parsed combat events into fight segments + overall, and exposes Details!-style views.
import { SELF, MELEE } from './combat-log-parser.js';
import { Factions } from './factions.js';
import { PetOwners } from './pets.js';
import { ClassDetector } from './class-detect.js';
import { LocationTimeline, isInstance } from './locations.js';

const ACTIVITY_GAP_MS = 5000;
const DEATH_RECAP_MS = 12000;
const RECAP_SIZE = 20;

export const CATEGORIES = [
  { id: 'damage-done', label: 'Damage Done', group: 'Damage' },
  { id: 'dps', label: 'DPS', group: 'Damage' },
  { id: 'damage-taken', label: 'Damage Taken', group: 'Damage' },
  { id: 'damage-taken-by-spell', label: 'Damage Taken by Spell', group: 'Damage' },
  { id: 'enemies', label: 'Enemy Damage Taken', group: 'Damage' },
  { id: 'healing-done', label: 'Healing Done', group: 'Heal' },
  { id: 'hps', label: 'HPS', group: 'Heal' },
  { id: 'healing-taken', label: 'Healing Taken', group: 'Heal' },
  { id: 'deaths', label: 'Deaths', group: 'Misc' },
  { id: 'resources', label: 'Resources', group: 'Misc' },
];

const newSpell = (name) => ({ name, total: 0, hits: 0, crits: 0, critTotal: 0, misses: 0, min: Infinity, max: 0, periodic: false, school: null });
const newFlow = () => ({ total: 0, spells: new Map(), units: new Map() });

function bump(map, key, create) {
  let v = map.get(key);
  if (!v) map.set(key, (v = create(key)));
  return v;
}

function addHit(stats, event) {
  stats.total += event.amount;
  stats.hits += 1;
  if (event.crit) {
    stats.crits += 1;
    stats.critTotal += event.amount;
  }
  stats.min = Math.min(stats.min, event.amount);
  stats.max = Math.max(stats.max, event.amount);
  if (event.periodic) stats.periodic = true;
  if (event.school) stats.school = event.school;
}

function addFlow(flow, spellName, unit, event) {
  flow.total += event.amount;
  addHit(bump(flow.spells, spellName, newSpell), event);
  bump(flow.units, unit, () => ({ total: 0 })).total += event.amount;
}

class Actor {
  constructor(name) {
    this.name = name;
    this.dmgOut = newFlow();
    this.dmgIn = newFlow();
    this.healOut = newFlow();
    this.healIn = newFlow();
    this.resources = new Map(); // resource -> { total, spells: Map }
    this.activeMs = 0;
    this.lastActiveTs = null;
  }

  markActive(ts) {
    if (this.lastActiveTs !== null && ts - this.lastActiveTs <= ACTIVITY_GAP_MS) this.activeMs += ts - this.lastActiveTs;
    this.lastActiveTs = Math.max(ts, this.lastActiveTs ?? ts);
  }

  activeSeconds() {
    return Math.max(1, this.activeMs / 1000);
  }
}

export class Segment {
  constructor(id, startTs, { overall = false } = {}) {
    this.id = id;
    this.overall = overall;
    this.startTs = startTs;
    this.endTs = startTs;
    this.combatMs = 0;
    this.actors = new Map();
    this.deaths = [];
    this.events = []; // kept so instance runs can be rebuilt from their fights
  }

  actor(name) {
    return bump(this.actors, name, (n) => new Actor(n));
  }

  durationSeconds() {
    const ms = this.overall ? this.combatMs : this.endTs - this.startTs;
    return Math.max(1, ms / 1000);
  }

  apply(event) {
    if (!this.overall) this.events.push(event);
    switch (event.kind) {
      case 'damage': {
        const src = this.actor(event.source);
        const tgt = this.actor(event.target);
        addFlow(src.dmgOut, event.spell ?? MELEE, event.target, event);
        addFlow(tgt.dmgIn, event.spell ?? MELEE, event.source, event);
        src.markActive(event.ts);
        break;
      }
      case 'miss': {
        bump(this.actor(event.source).dmgOut.spells, event.spell ?? MELEE, newSpell).misses += 1;
        break;
      }
      case 'heal': {
        const src = this.actor(event.source);
        addFlow(src.healOut, event.spell, event.target, event);
        addFlow(this.actor(event.target).healIn, event.spell, event.source, event);
        src.markActive(event.ts);
        break;
      }
      case 'energize': {
        const res = bump(this.actor(event.target).resources, event.resource, () => ({ total: 0, spells: new Map() }));
        res.total += event.amount;
        addHit(bump(res.spells, event.spell, newSpell), event);
        break;
      }
      default:
    }
  }
}

export class Meter {
  constructor({ combatGapMs = 6000, maxSegments = 30 } = {}) {
    this.combatGapMs = combatGapMs;
    this.maxSegments = maxSegments;
    this.factions = new Factions();
    this.classes = new ClassDetector();
    this.locations = new LocationTimeline();
    this.pets = new PetOwners();
    this.reset();
  }

  addLocation(entry) {
    if (entry.login) this.classes.forgetBefore(SELF, entry.ts);
    this.locations.add(entry);
    this.runCache = new Map();
  }

  locationOf(seg) {
    if (!seg || seg.overall) return null;
    return this.locations.at(seg.startTs);
  }

  currentLocation() {
    return this.lastEventTs === null && !this.locations.entries.length
      ? null
      : this.locations.at(Math.max(this.lastEventTs ?? 0, this.locations.entries.at(-1)?.ts ?? 0));
  }

  // Fights grouped by instance visit (newest first), like Details! dungeon run segments.
  runs() {
    const byKey = new Map();
    for (const seg of this.segments) {
      const loc = this.locationOf(seg);
      if (!isInstance(loc)) continue;
      const id = `run:${loc.mapId}:${loc.visit}`;
      bump(byKey, id, () => ({ id, location: loc, segments: [] })).segments.push(seg);
    }
    return [...byKey.values()];
  }

  #runSegment(id) {
    const run = this.runs().find((r) => r.id === id);
    if (!run) return null;
    const stamp = run.segments.map((s) => `${s.id}:${s.endTs}:${s.events.length}`).join('|');
    const cached = this.runCache.get(id);
    if (cached?.stamp === stamp) return cached.segment;
    const merged = new Segment(id, Infinity, { overall: true });
    for (const seg of [...run.segments].reverse()) {
      merged.startTs = Math.min(merged.startTs, seg.startTs);
      merged.endTs = Math.max(merged.endTs, seg.endTs);
      merged.combatMs += seg.endTs - seg.startTs;
      for (const e of seg.events) merged.apply(e);
      merged.deaths.push(...seg.deaths);
    }
    merged.run = run;
    this.runCache.set(id, { stamp, segment: merged });
    return merged;
  }

  reset() {
    this.segments = []; // newest first
    this.overall = new Segment('overall', 0, { overall: true });
    this.recaps = new Map(); // unit -> recent incoming events (for death recap)
    this.nextId = 1;
    this.lastEventTs = null;
    this.runCache = new Map();
  }

  get current() {
    return this.segments[0] ?? null;
  }

  isInCombat(nowTs = this.lastEventTs) {
    const cur = this.current;
    return Boolean(cur && nowTs !== null && nowTs - cur.endTs <= this.combatGapMs);
  }

  ingest(event) {
    this.factions.observe(event);
    this.classes.observe(event);
    this.pets.observe(event);
    this.lastEventTs = Math.max(event.ts, this.lastEventTs ?? event.ts);

    const isCombat = event.kind === 'damage' || event.kind === 'miss';
    let seg = this.current;
    if (isCombat) {
      const stale = !seg || event.ts - seg.endTs > this.combatGapMs || event.ts < seg.endTs - 60000;
      if (stale) {
        seg = new Segment(this.nextId++, event.ts);
        this.segments.unshift(seg);
        if (this.segments.length > this.maxSegments) this.segments.pop();
        if (this.overall.startTs === 0) this.overall.startTs = event.ts;
      } else if (event.ts > seg.endTs) {
        this.overall.combatMs += event.ts - seg.endTs;
      }
      seg.endTs = Math.max(seg.endTs, event.ts);
      this.overall.endTs = Math.max(this.overall.endTs, event.ts);
    } else if (!seg || event.ts - seg.endTs > this.combatGapMs) {
      seg = null; // out-of-combat heals/resources are not attributed to a fight
    }

    if (event.kind === 'damage' || event.kind === 'heal') this.#remember(event);
    if (event.kind === 'death') {
      this.#recordDeath(event, this.current);
      return;
    }
    if (seg) {
      seg.apply(event);
      this.overall.apply(event);
    }
  }

  #remember(event) {
    const list = bump(this.recaps, event.target, () => []);
    list.push({ ts: event.ts, kind: event.kind, source: event.source, spell: event.spell, amount: event.amount, crit: event.crit });
    if (list.length > RECAP_SIZE) list.shift();
  }

  #recordDeath(event, seg) {
    const recent = (this.recaps.get(event.target) ?? []).filter((e) => event.ts - e.ts <= DEATH_RECAP_MS);
    const lastHit = [...recent].reverse().find((e) => e.kind === 'damage');
    const death = {
      ts: event.ts,
      name: event.target,
      killer: event.killer ?? lastHit?.source ?? null,
      killingBlow: lastHit ? { spell: lastHit.spell, amount: lastHit.amount } : null,
      events: recent,
    };
    this.recaps.delete(event.target);
    if (seg) seg.deaths.push(death);
    this.overall.deaths.push(death);
  }

  segmentById(id) {
    if (id === 'overall') return this.overall;
    if (id === 'current' || id == null) return this.current;
    if (typeof id === 'string' && id.startsWith('run:')) return this.#runSegment(id);
    return this.segments.find((s) => s.id === id) ?? null;
  }

  segmentName(seg) {
    if (!seg) return 'No combat yet';
    if (seg.run) return `${seg.run.location.name} (run)`;
    if (seg.overall) return 'Overall Data';
    let best = null;
    for (const a of seg.actors.values()) {
      if (a.dmgIn.total > 0 && this.factions.isHostile(a.name) && (!best || a.dmgIn.total > best.dmgIn.total)) best = a;
    }
    return best ? best.name : `Fight #${seg.id}`;
  }

  #unitInfo(name) {
    return {
      isSelf: name === SELF,
      isPet: this.pets.isPet(name, (n) => this.factions.isFriendly(n)),
      cls: this.classes.classOf(name),
      spec: this.classes.specOf(name),
    };
  }

  // pet name -> owner name, for the pets of this segment whose owner can be resolved
  #owners(seg) {
    const isFriendly = (n) => this.factions.isFriendly(n);
    const friendly = [...seg.actors.keys()].filter(isFriendly);
    const players = friendly.filter((n) => !this.pets.isPet(n, isFriendly));
    const ctx = { isFriendly, classOf: (n) => this.classes.classOf(n), players };
    const owners = new Map();
    for (const name of friendly) {
      if (!this.pets.isPet(name, isFriendly)) continue;
      const owner = this.pets.ownerOf(name, ctx);
      if (owner && owner !== name) owners.set(name, owner);
    }
    return owners;
  }

  // Outgoing damage/healing with pets folded into their owner, like Details!.
  #outgoingRows(seg, friendly, flowKey, rate) {
    const owners = this.#owners(seg);
    const groups = new Map();
    for (const a of friendly) {
      const owner = owners.get(a.name) ?? a.name;
      const g = bump(groups, owner, () => ({ value: 0, active: 1, pets: [] }));
      g.value += a[flowKey].total;
      if (a[flowKey].total > 0) g.active = Math.max(g.active, a.activeSeconds());
      if (owner !== a.name && a[flowKey].total > 0) g.pets.push(a.name);
    }
    const duration = seg.durationSeconds();
    return [...groups]
      .filter(([, g]) => g.value > 0)
      .map(([name, g]) => ({
        name,
        value: g.value,
        perSecond: g.value / (rate === 'active' ? g.active : duration),
        pets: g.pets,
        ...this.#unitInfo(name),
      }));
  }

  view(categoryId, segmentId = 'current') {
    const seg = this.segmentById(segmentId);
    const location = seg?.run ? seg.run.location : this.locationOf(seg);
    return { ...this.#viewOf(categoryId, seg), location };
  }

  #viewOf(categoryId, seg) {
    const duration = seg ? seg.durationSeconds() : 0;
    const empty = { rows: [], total: 0, duration, name: this.segmentName(seg) };
    if (!seg) return empty;

    const friendly = [...seg.actors.values()].filter((a) => this.factions.isFriendly(a.name));
    const hostile = [...seg.actors.values()].filter((a) => this.factions.isHostile(a.name));
    let rows;

    const flowRows = (actors, pick, rate) => actors
      .map((a) => {
        const value = pick(a);
        return { name: a.name, value, perSecond: value / (rate === 'active' ? a.activeSeconds() : duration), ...this.#unitInfo(a.name) };
      })
      .filter((r) => r.value > 0);

    switch (categoryId) {
      case 'damage-done': rows = this.#outgoingRows(seg, friendly, 'dmgOut', 'effective'); break;
      case 'dps': rows = this.#outgoingRows(seg, friendly, 'dmgOut', 'active').map((r) => ({ ...r, sortValue: r.perSecond })); break;
      case 'damage-taken': rows = flowRows(friendly, (a) => a.dmgIn.total, 'effective'); break;
      case 'enemies': rows = flowRows(hostile, (a) => a.dmgIn.total, 'effective'); break;
      case 'healing-done': rows = this.#outgoingRows(seg, friendly, 'healOut', 'effective'); break;
      case 'hps': rows = this.#outgoingRows(seg, friendly, 'healOut', 'active').map((r) => ({ ...r, sortValue: r.perSecond })); break;
      case 'healing-taken': rows = flowRows(friendly, (a) => a.healIn.total, 'effective'); break;
      case 'resources': rows = flowRows(friendly, (a) => [...a.resources.values()].reduce((s, r) => s + r.total, 0), 'effective'); break;
      case 'damage-taken-by-spell': {
        const bySpell = new Map();
        for (const a of friendly) {
          for (const s of a.dmgIn.spells.values()) bump(bySpell, s.name, () => ({ total: 0 })).total += s.total;
        }
        rows = [...bySpell].map(([name, { total }]) => ({ name, value: total, perSecond: total / duration, isSelf: false, isPet: false, cls: null }));
        break;
      }
      case 'deaths': {
        rows = seg.deaths
          .filter((d) => this.factions.isFriendly(d.name))
          .map((d, i) => ({ name: d.name, value: d.ts, deathIndex: i, killer: d.killer, killingBlow: d.killingBlow, ...this.#unitInfo(d.name) }));
        rows.sort((a, b) => a.value - b.value);
        return { rows: rows.map((r) => ({ ...r, share: 0, barPct: 100 })), total: rows.length, duration, name: this.segmentName(seg) };
      }
      default: return empty;
    }

    rows.sort((a, b) => (b.sortValue ?? b.value) - (a.sortValue ?? a.value));
    const total = rows.reduce((s, r) => s + r.value, 0);
    const top = rows.length ? (rows[0].sortValue ?? rows[0].value) : 1;
    return {
      rows: rows.map((r) => ({ ...r, share: total ? (r.value / total) * 100 : 0, barPct: top ? ((r.sortValue ?? r.value) / top) * 100 : 0 })),
      total,
      duration,
      name: this.segmentName(seg),
    };
  }

  breakdown(categoryId, segmentId, name, deathIndex = null) {
    const seg = this.segmentById(segmentId);
    if (!seg) return null;

    if (categoryId === 'deaths') {
      const deaths = seg.deaths.filter((d) => this.factions.isFriendly(d.name));
      const d = deaths[deathIndex ?? 0];
      return d && { title: `${d.name} — death recap`, kind: 'recap', death: d };
    }

    if (categoryId === 'damage-taken-by-spell') {
      const sources = new Map();
      for (const a of seg.actors.values()) {
        if (!this.factions.isFriendly(a.name)) continue;
        const s = a.dmgIn.spells.get(name);
        if (s) bump(sources, a.name, () => ({ total: 0 })).total += s.total;
      }
      return { title: `${name} — damage taken by`, kind: 'flow', spells: [], units: toUnitRows(sources), unitsTitle: 'Targets' };
    }

    const actor = seg.actors.get(name);
    if (!actor) return null;
    const pick = {
      'damage-done': ['dmgOut', 'Abilities', 'Targets'],
      dps: ['dmgOut', 'Abilities', 'Targets'],
      'damage-taken': ['dmgIn', 'Abilities taken', 'Damage sources'],
      enemies: ['dmgIn', 'Abilities taken', 'Damage sources'],
      'healing-done': ['healOut', 'Spells', 'Healed units'],
      hps: ['healOut', 'Spells', 'Healed units'],
      'healing-taken': ['healIn', 'Spells received', 'Healers'],
    }[categoryId];

    if (categoryId === 'resources') {
      const spells = [];
      for (const [resource, r] of actor.resources) for (const s of r.spells.values()) spells.push({ ...s, name: `${s.name} (${resource})` });
      return { title: `${name} — resources`, kind: 'flow', spells: toSpellRows(spells), units: [], spellsTitle: 'Sources' };
    }
    if (!pick) return null;
    const [flowKey] = pick;
    const outgoing = flowKey.endsWith('Out');

    // Outgoing breakdowns include the owner's pets, with their abilities labelled "(Pet Name)".
    const members = [actor];
    if (outgoing) {
      for (const [pet, owner] of this.#owners(seg)) if (owner === name && seg.actors.has(pet)) members.push(seg.actors.get(pet));
    }
    const spells = [];
    const units = new Map();
    let total = 0;
    let active = 1;
    for (const m of members) {
      const flow = m[flowKey];
      total += flow.total;
      if (flow.total > 0) active = Math.max(active, m.activeSeconds());
      for (const s of flow.spells.values()) spells.push(m === actor ? s : { ...s, name: `${s.name} (${m.name})` });
      for (const [unit, u] of flow.units) bump(units, unit, () => ({ total: 0 })).total += u.total;
    }
    return {
      title: name,
      kind: 'flow',
      spellsTitle: pick[1],
      unitsTitle: pick[2],
      total,
      perSecond: total / (outgoing ? active : seg.durationSeconds()),
      pets: members.slice(1).map((m) => m.name),
      spells: toSpellRows(spells),
      units: toUnitRows(units),
    };
  }
}

function toSpellRows(spells) {
  const total = spells.reduce((s, x) => s + x.total, 0);
  return spells
    .filter((s) => s.total > 0 || s.misses > 0)
    .map((s) => ({
      name: s.name,
      total: s.total,
      share: total ? (s.total / total) * 100 : 0,
      hits: s.hits,
      crits: s.crits,
      critPct: s.hits ? (s.crits / s.hits) * 100 : 0,
      misses: s.misses,
      avg: s.hits ? s.total / s.hits : 0,
      min: Number.isFinite(s.min) ? s.min : 0,
      max: s.max,
      periodic: s.periodic,
      school: s.school,
    }))
    .sort((a, b) => b.total - a.total);
}

function toUnitRows(units) {
  const total = [...units.values()].reduce((s, u) => s + u.total, 0);
  return [...units]
    .map(([name, u]) => ({ name, total: u.total, share: total ? (u.total / total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);
}
