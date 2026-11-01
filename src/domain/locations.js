// Location tracking from the game's engine log (native.log), which records teleports like:
// "2026-11-01T08:16:41.586Z worldport: map 189 at [1608.0, -318.9, 18.6] (...)"
// Map ids follow the classic WoW Map.dbc ids.

const MAPS = {
  0: ['Eastern Kingdoms', 'world'], 1: ['Kalimdor', 'world'], 530: ['Outland', 'world'], 571: ['Northrend', 'world'],
  30: ['Alterac Valley', 'battleground'], 489: ['Warsong Gulch', 'battleground'], 529: ['Arathi Basin', 'battleground'],
  33: ['Shadowfang Keep', 'dungeon'], 34: ['The Stockade', 'dungeon'], 36: ['The Deadmines', 'dungeon'],
  43: ['Wailing Caverns', 'dungeon'], 47: ['Razorfen Kraul', 'dungeon'], 48: ['Blackfathom Deeps', 'dungeon'],
  70: ['Uldaman', 'dungeon'], 90: ['Gnomeregan', 'dungeon'], 109: ['Sunken Temple', 'dungeon'],
  129: ['Razorfen Downs', 'dungeon'], 189: ['Scarlet Monastery', 'dungeon'], 209: ["Zul'Farrak", 'dungeon'],
  229: ['Blackrock Spire', 'dungeon'], 230: ['Blackrock Depths', 'dungeon'], 289: ['Scholomance', 'dungeon'],
  329: ['Stratholme', 'dungeon'], 349: ['Maraudon', 'dungeon'], 389: ['Ragefire Chasm', 'dungeon'],
  429: ['Dire Maul', 'dungeon'],
  249: ["Onyxia's Lair", 'raid'], 309: ["Zul'Gurub", 'raid'], 409: ['Molten Core', 'raid'],
  469: ['Blackwing Lair', 'raid'], 509: ["Ruins of Ahn'Qiraj", 'raid'], 531: ["Temple of Ahn'Qiraj", 'raid'],
  533: ['Naxxramas', 'raid'],
};

// Dungeons whose wings share one map id: each wing has its own entrance point.
// A position belongs to the wing with the nearest entrance (wings are far apart inside the instance map).
// Scarlet Monastery entrances verified against the game's own worldport lines.
const WINGS = {
  189: [
    ['Graveyard', 1688, 1053],
    ['Library', 255, -209],
    ['Armory', 1610, -323],
    ['Cathedral', 855, 1321],
  ],
};

function wingAt(mapId, pos) {
  const wings = WINGS[mapId];
  if (!wings || !pos) return null;
  let best = null;
  let bestDist = Infinity;
  for (const [name, x, y] of wings) {
    const d = (pos.x - x) ** 2 + (pos.y - y) ** 2;
    if (d < bestDist) [best, bestDist] = [name, d];
  }
  return best;
}

export function describeMap(mapId, pos = null) {
  const known = MAPS[mapId];
  if (!known) return { mapId, name: `Map ${mapId}`, type: 'unknown', wing: null };
  const wing = wingAt(mapId, pos);
  return { mapId, name: wing ? `${known[0]}: ${wing}` : known[0], type: known[1], wing };
}

export const isInstance = (location) => location && ['dungeon', 'raid', 'battleground'].includes(location.type);

const WORLDPORT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+worldport: (login on )?map (\d+)(?: at \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\])?/;

// Returns { ts, mapId, pos, login } for a teleport line of native.log, otherwise null.
// `login` marks entering the world with a character, the only trace of a character switch.
export function parseNativeLine(line) {
  const m = WORLDPORT.exec(line);
  if (!m) return null;
  const pos = m[4] != null ? { x: Number(m[4]), y: Number(m[5]), z: Number(m[6]) } : null;
  return { ts: Date.parse(m[1]), mapId: Number(m[3]), pos, login: Boolean(m[2]) };
}

// Ordered teleport history; answers "where was the player at time t" regardless of arrival order.
export class LocationTimeline {
  constructor() {
    this.entries = []; // sorted by ts: { ts, mapId, pos, place }
  }

  add({ ts, mapId, pos = null }) {
    const place = describeMap(mapId, pos);
    const entry = { ts, mapId, pos, place };
    if (this.entries.some((e) => e.ts === ts && e.place.name === place.name)) return;
    const last = this.entries[this.entries.length - 1];
    this.entries.push(entry);
    if (last && ts < last.ts) this.entries.sort((a, b) => a.ts - b.ts);
  }

  // Index of the teleport in effect at `ts`, or -1 when unknown.
  indexAt(ts) {
    let lo = 0;
    let hi = this.entries.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.entries[mid].ts <= ts) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  at(ts) {
    const i = this.indexAt(ts);
    return i < 0 ? null : { ...this.entries[i].place, since: this.entries[i].ts, visit: this.#visitStart(i) };
  }

  // Consecutive teleports into the same place (e.g. a wipe/re-entry) count as one visit;
  // moving to another wing of the same dungeon starts a new one.
  #visitStart(i) {
    let j = i;
    while (j > 0 && this.entries[j - 1].place.name === this.entries[i].place.name) j -= 1;
    return this.entries[j].ts;
  }
}
