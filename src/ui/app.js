import { parseLine, SELF } from '../domain/combat-log-parser.js';
import { parseNativeLine } from '../domain/locations.js';
import { Meter, CATEGORIES } from '../domain/meter.js';
import { CLASS_COLORS } from '../domain/class-detect.js';
import { abbreviate, duration, clock, pct } from '../domain/format.js';
import { buildReport, buildReportLines } from '../domain/report.js';
import { parsePhaseLine, combatLogHealth } from '../domain/log-health.js';
import { ICONS, iconImg, setSpellIcons, spellIcon, unitIcon, unitDescription } from './icons.js';

const api = window.meterApi;
const meter = new Meter();
const COMBAT_GAP_MS = 6000;
const TOOLTIP_TOP = 3;

const state = {
  category: 'damage-done',
  segmentId: 'current',
  detail: null, // { name, deathIndex }
  hover: null, // bar under the mouse, for the live tooltip
  paused: false,
  logPath: '',
  logExists: null,
  lastLiveCombat: 0,
  lastLogWrite: null, // last time the combat log grew (file mtime at start, then live appends)
  phase: null, // latest activity phase from native.log: { ts, phase }
  gameRunning: false,
  playerSetting: null, // chosen character, null = auto
  characters: [], // account characters, most recently played first
};

// The combat log writes the player as "You"; show the character's real name instead.
const playerName = () => state.playerSetting ?? state.characters[0] ?? SELF;
const dn = (name) => (name === SELF ? playerName() : name);

const $ = (id) => document.getElementById(id);
const el = {
  content: $('content'), segmentBtn: $('segmentBtn'), segmentLabel: $('segmentLabel'), segmentIcon: $('segmentIcon'),
  categoryBtn: $('categoryBtn'), categoryLabel: $('categoryLabel'), categoryIcon: $('categoryIcon'),
  location: $('location'), status: $('status'), statusText: $('statusText'), footerInfo: $('footerInfo'),
  menu: $('menu'), tooltip: $('tooltip'),
};

// Tiny DOM builder: h('div', { class: 'x' }, 'text', child)
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('--')) node.style.setProperty(k, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

const RATE_FIRST = new Set(['dps', 'hps']);

function rowColor(row) {
  if (state.category === 'enemies') return '#b8433b';
  if (state.category === 'damage-taken-by-spell') return '#6d74a8';
  if (row.isPet) return '#5fa58d';
  return CLASS_COLORS[row.cls] ?? '#8a93a3';
}

function rowIcon(row) {
  switch (state.category) {
    case 'enemies': return ICONS.enemy;
    case 'damage-taken-by-spell': return spellIcon(row.name);
    case 'deaths': return row.killingBlow ? spellIcon(row.killingBlow.spell ?? 'Melee') : ICONS.death;
    default: return unitIcon(row);
  }
}

function rowValueText(row) {
  if (state.category === 'deaths') return clock(row.value);
  if (state.category === 'damage-taken-by-spell') return [abbreviate(row.value), `${pct(row.share)}`];
  if (RATE_FIRST.has(state.category)) return [abbreviate(row.perSecond), `${abbreviate(row.value)}, ${pct(row.share)}`];
  return [abbreviate(row.value), `${abbreviate(row.perSecond)}, ${pct(row.share)}`];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  const category = CATEGORIES.find((c) => c.id === state.category) ?? CATEGORIES[0];
  const view = meter.view(state.category, state.segmentId);
  el.categoryLabel.textContent = category.label;
  el.categoryIcon.replaceChildren(iconImg(ICONS.categories[category.id], 'icon btn-icon'));
  el.segmentLabel.textContent = segmentButtonLabel(view);
  renderLocation(view.location);

  el.content.replaceChildren(state.detail ? renderBreakdown() : renderBars(view));
  refreshTooltip(view);
  renderFooter(view);
}

function segmentButtonLabel(view) {
  if (state.segmentId === 'current') return meter.current ? view.name : 'Current';
  if (state.segmentId === 'overall') return 'Overall';
  return view.name;
}

function renderLocation(location) {
  const loc = location ?? meter.currentLocation();
  el.location.hidden = !loc;
  if (!loc) return;
  el.location.replaceChildren(
    h('span', { class: `tag ${loc.type}` }, loc.type === 'unknown' ? 'zone' : loc.type),
    h('span', { class: 'loc-name' }, loc.name),
    state.segmentId === 'overall' ? null : h('span', { class: 'loc-seg' }, segmentKindLabel()),
  );
}

function segmentKindLabel() {
  if (state.segmentId === 'current') return 'current fight';
  if (String(state.segmentId).startsWith('run:')) return 'full run';
  return `fight #${state.segmentId}`;
}

function renderBars(view) {
  if (state.logExists === false) {
    return h('div', { class: 'empty' },
      iconImg(ICONS.unknown, 'icon empty-icon'),
      h('div', {}, 'Combat log not found.'),
      h('div', {}, 'Type ', h('strong', {}, '/combatlog'), ' in the game chat to start logging.'),
      h('div', { class: 'empty-path' }, state.logPath));
  }
  if (!view.rows.length) {
    return h('div', { class: 'empty' }, meter.current ? 'No data for this display yet.' : 'Waiting for combat…');
  }
  return h('div', { class: 'bars' }, view.rows.map((row, i) => {
    const value = rowValueText(row);
    return h('div', {
      class: `bar${row.isSelf ? ' self' : ''}`,
      '--w': `${Math.max(0, Math.min(100, row.barPct))}%`,
      '--c': rowColor(row),
      onclick: () => openDetail(row),
      onmouseenter: (e) => showTooltip(row, e),
      onmousemove: (e) => positionTooltip(e),
      onmouseleave: hideTooltip,
    },
    iconImg(rowIcon(row), 'icon bar-icon'),
    h('div', { class: 'track' },
      h('div', { class: 'fill' }),
      h('span', { class: 'rank' }, `${i + 1}.`),
      h('span', { class: 'name' }, deathName(row), row.isPet ? h('span', { class: 'pet-tag' }, 'PET') : null),
      Array.isArray(value)
        ? h('span', { class: 'value' }, value[0], h('span', { class: 'value-sub' }, ` (${value[1]})`))
        : h('span', { class: 'value' }, value)));
  }));
}

function deathName(row) {
  if (state.category !== 'deaths') return dn(row.name);
  const by = row.killingBlow ? ` — ${row.killingBlow.spell ?? 'Melee'} ${abbreviate(row.killingBlow.amount)}` : '';
  return `${dn(row.name)}${by}`;
}

function unitInfoFor(name) {
  const row = meter.view(state.category, state.segmentId).rows.find((r) => r.name === name);
  return row ?? { cls: meter.classes.classOf(name), spec: meter.classes.specOf(name) };
}

function renderBreakdown() {
  const bd = meter.breakdown(state.category, state.segmentId, state.detail.name, state.detail.deathIndex);
  const back = h('button', { class: 'bd-back', onclick: closeDetail, title: 'Back (right-click)' }, '‹');
  if (!bd) return h('div', { class: 'breakdown' }, h('div', { class: 'bd-head' }, back), h('div', { class: 'empty' }, 'No data.'));
  if (bd.kind === 'recap') return renderRecap(bd, back);

  const info = unitInfoFor(state.detail.name);
  const isUnit = state.category !== 'damage-taken-by-spell';
  const desc = isUnit ? unitDescription(info) : null;
  const headIcon = isUnit ? (state.category === 'enemies' ? ICONS.enemy : unitIcon(info)) : spellIcon(state.detail.name);
  const summary = bd.total != null ? [abbreviate(bd.total), h('span', { class: 'muted' }, ` · ${abbreviate(bd.perSecond)}/s`)] : [];

  const parts = [h('div', { class: 'bd-head' }, back,
    iconImg(headIcon, 'icon bd-icon'),
    h('div', { class: 'bd-titles' },
      h('div', { class: 'bd-title', style: { color: isUnit ? (CLASS_COLORS[info.cls] ?? '#fff') : '#fff' } }, dn(bd.title)),
      desc ? h('div', { class: 'bd-desc' }, desc) : null),
    h('span', { class: 'bd-sum' }, summary))];

  if (bd.spells.length) {
    parts.push(h('div', { class: 'bd-section' }, bd.spellsTitle ?? 'Abilities'));
    parts.push(h('table', { class: 'bd' },
      h('tr', {}, h('th', {}, ''), h('th', {}, 'Amount'), h('th', {}, '%'), h('th', {}, 'Hits'), h('th', {}, 'Crit'), h('th', {}, 'Avg'), h('th', {}, 'Max')),
      bd.spells.map((s) => h('tr', { class: 'row', title: `${s.name}\nHits ${s.hits} · Crits ${s.crits} · Misses ${s.misses}\nMin ${abbreviate(s.min)} · Max ${abbreviate(s.max)}${s.periodic ? '\nPeriodic' : ''}` },
        h('td', {}, h('div', { class: 'share-fill', style: { width: `${s.share}%` } }),
          h('span', { class: 'cell-name' }, iconImg(spellIcon(s.name), 'icon cell-icon'), s.name)),
        h('td', {}, h('span', {}, abbreviate(s.total))),
        h('td', {}, h('span', {}, pct(s.share))),
        h('td', {}, h('span', {}, s.hits)),
        h('td', {}, h('span', {}, pct(s.critPct))),
        h('td', {}, h('span', {}, abbreviate(s.avg))),
        h('td', {}, h('span', {}, abbreviate(s.max)))))));
  }

  if (bd.units.length) {
    parts.push(h('div', { class: 'bd-section' }, bd.unitsTitle ?? 'Units'));
    parts.push(h('table', { class: 'bd' },
      h('tr', {}, h('th', {}, ''), h('th', {}, 'Amount'), h('th', {}, '%')),
      bd.units.map((u) => {
        const ui = { cls: meter.classes.classOf(u.name), spec: meter.classes.specOf(u.name) };
        const hostile = meter.factions.isHostile(u.name);
        return h('tr', { class: 'row' },
          h('td', {}, h('div', { class: 'share-fill', style: { width: `${u.share}%` } }),
            h('span', { class: 'cell-name' }, iconImg(hostile ? ICONS.enemy : unitIcon(ui), 'icon cell-icon'), dn(u.name))),
          h('td', {}, h('span', {}, abbreviate(u.total))),
          h('td', {}, h('span', {}, pct(u.share))));
      })));
  }
  return h('div', { class: 'breakdown' }, parts);
}

function renderRecap(bd, back) {
  const d = bd.death;
  const killer = d.killer ? `Killed by ${dn(d.killer)}` : 'Died';
  const rows = d.events.map((e, i) => {
    const isHeal = e.kind === 'heal';
    const killing = i === d.events.length - 1 && !isHeal;
    return h('div', { class: `recap-row${killing ? ' killing' : ''}` },
      h('span', { class: 't' }, `${((e.ts - d.ts) / 1000).toFixed(1)}s`),
      h('span', { class: 'cell-name' }, iconImg(spellIcon(e.spell ?? 'Melee'), 'icon cell-icon'), `${dn(e.source)}: ${e.spell ?? 'Melee'}${e.crit ? ' (crit)' : ''}`),
      h('span', { class: isHeal ? 'heal' : 'dmg' }, `${isHeal ? '+' : '-'}${abbreviate(e.amount)}`));
  });
  return h('div', { class: 'breakdown' },
    h('div', { class: 'bd-head' }, back, iconImg(ICONS.death, 'icon bd-icon'),
      h('div', { class: 'bd-titles' }, h('div', { class: 'bd-title' }, dn(d.name)), h('div', { class: 'bd-desc' }, 'Death recap')),
      h('span', { class: 'bd-sum' }, clock(d.ts))),
    h('div', { class: 'bd-section' }, killer),
    rows.length ? rows : h('div', { class: 'empty' }, 'No events recorded before this death.'));
}

function logHealth() {
  return combatLogHealth({
    exists: state.logExists,
    gameRunning: state.gameRunning,
    phase: state.phase?.phase,
    phaseSince: state.phase?.ts,
    lastWrite: state.lastLogWrite,
    now: Date.now(),
  });
}

function renderFooter(view) {
  const health = logHealth();
  $('logWarning').hidden = health !== 'stale';
  const inCombat = Date.now() - state.lastLiveCombat < COMBAT_GAP_MS && meter.isInCombat();
  let status = inCombat ? ['combat', 'IN COMBAT'] : ['idle', 'OUT OF COMBAT'];
  if (health === 'missing') status = ['warn', 'NO COMBAT LOG'];
  else if (health === 'stale') status = ['warn', 'COMBAT LOG OFF'];
  else if (state.paused) status = ['paused', 'PAUSED'];
  el.status.className = `status ${status[0]}`;
  el.statusText.textContent = status[1];
  const parts = [];
  if (view.duration) parts.push(duration(view.duration));
  if (state.category !== 'deaths' && view.total) parts.push(`${abbreviate(view.total)} · ${abbreviate(view.total / Math.max(1, view.duration))}/s`);
  parts.push(`${meter.segments.length} fights`);
  el.footerInfo.textContent = parts.join('  ·  ');
}

let renderQueued = false;
let lastRender = 0;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  const wait = Math.max(0, 200 - (performance.now() - lastRender));
  setTimeout(() => {
    renderQueued = false;
    lastRender = performance.now();
    render();
  }, wait);
}

// ---------------------------------------------------------------------------
// Hover tooltip: top 3 contributors of the hovered bar (Details! shows abilities, then pets)
// ---------------------------------------------------------------------------
function ttRow(icon, label, amount, share, cls = '') {
  return h('div', { class: 'tt-row' },
    h('span', { class: 'n' }, icon ? iconImg(icon, 'icon tt-icon') : null, label),
    h('span', { class: cls }, amount),
    h('span', { class: 'p' }, share));
}

function tooltipContent(row) {
  const bd = meter.breakdown(state.category, state.segmentId, row.name, row.deathIndex ?? null);
  if (!bd) return null;

  if (bd.kind === 'recap') {
    const last = bd.death.events.slice(-TOOLTIP_TOP).reverse();
    return [
      h('div', { class: 'tt-title' }, h('span', {}, dn(row.name)), h('span', { class: 'tt-rate' }, clock(bd.death.ts))),
      h('div', { class: 'tt-section' }, bd.death.killer ? `Killed by ${dn(bd.death.killer)}` : 'Last hits'),
      last.length
        ? last.map((e) => ttRow(spellIcon(e.spell ?? 'Melee'), `${dn(e.source)}: ${e.spell ?? 'Melee'}`,
          `${e.kind === 'heal' ? '+' : '-'}${abbreviate(e.amount)}`, `${((e.ts - bd.death.ts) / 1000).toFixed(1)}s`, e.kind === 'heal' ? 'heal' : 'dmg'))
        : h('div', { class: 'tt-row' }, 'No events recorded'),
    ];
  }

  const desc = state.category === 'damage-taken-by-spell' || state.category === 'enemies' ? null : unitDescription(row);
  const rate = bd.perSecond != null ? `${abbreviate(bd.perSecond)}/s` : '';
  const parts = [
    h('div', { class: 'tt-title', style: { color: state.category === 'enemies' ? '#fff' : (CLASS_COLORS[row.cls] ?? '#fff') } },
      h('span', {}, dn(row.name)), h('span', { class: 'tt-rate' }, rate)),
    desc ? h('div', { class: 'tt-desc' }, desc) : null,
  ];
  const ownSpells = bd.spells.filter((s) => !bd.pets?.some((p) => s.name.endsWith(`(${p})`)));

  if (ownSpells.length) {
    parts.push(h('div', { class: 'tt-section' }, `Top ${Math.min(TOOLTIP_TOP, ownSpells.length)} ${bd.spellsTitle ?? 'abilities'}`));
    for (const s of ownSpells.slice(0, TOOLTIP_TOP)) parts.push(ttRow(spellIcon(s.name), s.name, abbreviate(s.total), pct(s.share)));
  } else if (bd.units.length) {
    parts.push(h('div', { class: 'tt-section' }, `Top ${Math.min(TOOLTIP_TOP, bd.units.length)} ${bd.unitsTitle ?? 'units'}`));
    for (const u of bd.units.slice(0, TOOLTIP_TOP)) {
      parts.push(ttRow(unitIcon({ cls: meter.classes.classOf(u.name), spec: meter.classes.specOf(u.name) }), dn(u.name), abbreviate(u.total), pct(u.share)));
    }
  }

  if (bd.pets?.length) {
    parts.push(h('div', { class: 'tt-section' }, 'Pets'));
    for (const pet of bd.pets) {
      const petTotal = bd.spells.filter((s) => s.name.endsWith(`(${pet})`)).reduce((sum, s) => sum + s.total, 0);
      parts.push(ttRow(ICONS.pet, pet, abbreviate(petTotal), pct(bd.total ? (petTotal / bd.total) * 100 : 0)));
    }
  }
  parts.push(h('div', { class: 'tt-hint' }, 'Click for full breakdown'));
  return parts;
}

function showTooltip(row, e) {
  state.hover = { name: row.name, deathIndex: row.deathIndex ?? null };
  const content = tooltipContent(row);
  if (!content) return;
  el.tooltip.replaceChildren(...content.flat().filter(Boolean));
  el.tooltip.hidden = false;
  positionTooltip(e);
}

function positionTooltip(e) {
  if (el.tooltip.hidden) return;
  const pad = 4;
  const { offsetWidth: w, offsetHeight: hgt } = el.tooltip;
  let x = e.clientX + 14;
  let y = e.clientY + 14;
  if (x + w > window.innerWidth - pad) x = Math.max(pad, e.clientX - w - 10);
  if (y + hgt > window.innerHeight - pad) y = Math.max(pad, e.clientY - hgt - 10);
  el.tooltip.style.left = `${x}px`;
  el.tooltip.style.top = `${y}px`;
}

function hideTooltip() {
  state.hover = null;
  el.tooltip.hidden = true;
}

// Bars are rebuilt on every render, so refresh the open tooltip with live numbers.
function refreshTooltip(view) {
  if (!state.hover || state.detail) return hideTooltip();
  const row = view.rows.find((r) => r.name === state.hover.name && (r.deathIndex ?? null) === state.hover.deathIndex);
  const content = row && tooltipContent(row);
  if (!content) return hideTooltip();
  el.tooltip.replaceChildren(...content.flat().filter(Boolean));
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------
function openDetail(row) {
  hideTooltip();
  state.detail = { name: row.name, deathIndex: row.deathIndex ?? null };
  render();
}

function closeDetail() {
  state.detail = null;
  render();
}

let menuAnchor = null;

// Clicking the same button again closes its menu (toggle), like Details!.
function toggleMenu(anchor) {
  if (!el.menu.hidden && menuAnchor === anchor) {
    hideMenu();
    return false;
  }
  return true;
}

function showMenu(anchor, items, onPick) {
  hideTooltip();
  menuAnchor = anchor;
  el.menu.replaceChildren(...items.map((item) => {
    if (item.header) return h('div', { class: 'header' }, item.icon ? iconImg(item.icon, 'icon menu-icon') : null, item.header);
    if (item.separator) return h('div', { class: 'sep' });
    return h('div', {
      class: `item${item.active ? ' active' : ''}`,
      onclick: (e) => {
        e.stopPropagation();
        hideMenu();
        onPick(item.value);
      },
    },
    h('span', { class: 'item-label' }, item.icon ? iconImg(item.icon, 'icon menu-icon') : null, item.label),
    item.sub ? h('span', { class: 'sub' }, item.sub) : null);
  }));
  el.menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.left, window.innerWidth - el.menu.offsetWidth - 4);
  el.menu.style.left = `${Math.max(4, left)}px`;
  el.menu.style.top = `${r.bottom + 2}px`;
}

function hideMenu() {
  el.menu.hidden = true;
  menuAnchor = null;
}

el.categoryBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!toggleMenu(el.categoryBtn)) return;
  const items = [];
  let group = null;
  for (const c of CATEGORIES) {
    if (c.group !== group) {
      group = c.group;
      items.push({ header: group, icon: ICONS.groups[group] });
    }
    items.push({ label: c.label, value: c.id, active: c.id === state.category, icon: ICONS.categories[c.id] });
  }
  showMenu(el.categoryBtn, items, (id) => {
    state.category = id;
    state.detail = null;
    api.saveSettings({ category: id });
    render();
  });
});

el.segmentBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!toggleMenu(el.segmentBtn)) return;
  const items = [
    { label: 'Current Segment', value: 'current', active: state.segmentId === 'current', icon: ICONS.segment },
    { label: 'Overall Data', value: 'overall', active: state.segmentId === 'overall', sub: duration(meter.overall.durationSeconds()), icon: 'inv_misc_book_09' },
  ];
  const runs = meter.runs();
  if (runs.length) {
    items.push({ header: 'Instance runs' });
    for (const run of runs) {
      items.push({ label: run.location.name, value: run.id, active: state.segmentId === run.id, sub: `${run.segments.length} fights · ${clock(run.location.visit)}`, icon: 'inv_misc_key_03' });
    }
  }
  if (meter.segments.length) {
    items.push({ header: 'Fights' });
    for (const seg of meter.segments) {
      const loc = meter.locationOf(seg);
      const where = loc && loc.type !== 'world' ? `${loc.name} · ` : '';
      items.push({ label: `#${seg.id} ${meter.segmentName(seg)}`, value: seg.id, active: state.segmentId === seg.id, sub: `${where}${duration(seg.durationSeconds())}` });
    }
  }
  showMenu(el.segmentBtn, items, (id) => {
    state.segmentId = id;
    state.detail = null;
    render();
  });
});

$('gearBtn').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!toggleMenu($('gearBtn'))) return;
  const current = Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha')) || 1;
  state.characters = await api.listCharacters();
  const items = [
    { label: state.paused ? 'Resume' : 'Pause', value: 'pause' },
    { separator: true },
    { header: 'Character' },
    { label: 'Auto-detect', value: 'char:', active: !state.playerSetting, sub: state.characters[0] ?? '' },
    ...state.characters.map((c) => ({ label: c, value: `char:${c}`, active: state.playerSetting === c })),
    { header: 'Log file' },
    { label: 'Choose log file…', value: 'choose' },
    { label: 'Show in folder', value: 'folder' },
    { header: 'Opacity' },
    ...[1, 0.9, 0.8, 0.7, 0.6, 0.5].map((o) => ({ label: `${Math.round(o * 100)}%`, value: `opacity:${o}`, active: Math.abs(current - o) < 0.01 })),
  ];
  showMenu($('gearBtn'), items, async (value) => {
    if (value === 'pause') state.paused = !state.paused;
    else if (value.startsWith('char:')) {
      state.playerSetting = value.slice(5) || null;
      api.saveSettings({ playerName: state.playerSetting });
    }
    else if (value === 'choose') await api.chooseLog();
    else if (value === 'folder') api.openLogFolder();
    else if (value.startsWith('opacity:')) setOpacity(await api.setOpacity(Number(value.split(':')[1])));
    render();
  });
});

// Report: copies a chat-ready line (<= 255 chars) to paste in the game chat, like Details!' report button.
$('reportBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!toggleMenu($('reportBtn'))) return;
  const category = CATEGORIES.find((c) => c.id === state.category) ?? CATEGORIES[0];
  showMenu($('reportBtn'), [
    { header: 'Game chat · line by line' },
    ...[3, 5, 10].map((n) => ({ label: `Top ${n}`, value: `step:${n}`, sub: `${n + 1} lines` })),
    { header: 'Discord · all lines at once' },
    ...[3, 5, 10].map((n) => ({ label: `Top ${n}`, value: `all:${n}`, sub: 'not for game chat' })),
    { header: 'Game chat · one message' },
    { label: 'Top 5 (compact)', value: 'one:5' },
  ], async (value) => {
    const [mode, n] = value.split(':');
    const top = Number(n);
    const view = meter.view(state.category, state.segmentId);
    const args = { categoryLabel: category.label, categoryId: category.id, view, top, displayName: dn };

    if (mode === 'step') return startStepReport(buildReportLines(args));
    stopStepReport();
    if (mode === 'all') {
      await api.copyText(buildReportLines(args).join('\n'));
      return showToast('Report copied', 'Paste it in Discord with Ctrl+V');
    }
    const { text, rows } = buildReport(args);
    await api.copyText(text);
    const fitted = rows < Math.min(top, view.rows.length) ? ` (${rows} fit in one message)` : '';
    return showToast(`Report copied${fitted}`, 'Paste it in the game chat with Ctrl+V');
  });
});

// Line-by-line mode: line 1 goes to the clipboard now; the global hotkey copies the next one.
const STEP_TIMEOUT_MS = 3 * 60 * 1000;
const step = { lines: [], index: 0, timer: null };

async function startStepReport(lines) {
  step.lines = lines;
  step.index = 0;
  const armed = await api.armReport(true);
  if (!armed) {
    stopStepReport();
    await api.copyText(lines.join('\n'));
    return showToast('Hotkey Ctrl+Shift+N is taken by another app', 'Copied all lines at once instead', 5000);
  }
  return copyStepLine();
}

async function copyStepLine() {
  if (step.index >= step.lines.length) {
    stopStepReport();
    return showToast('Report finished', 'All lines were copied');
  }
  await api.copyText(step.lines[step.index]);
  step.index += 1;
  clearTimeout(step.timer);
  step.timer = setTimeout(stopStepReport, STEP_TIMEOUT_MS);
  const last = step.index === step.lines.length;
  return showToast(`Line ${step.index}/${step.lines.length} copied — Ctrl+V, Enter`,
    last ? 'That was the last line' : 'Then press Ctrl+Shift+N for the next line', 6000);
}

function stopStepReport() {
  clearTimeout(step.timer);
  step.lines = [];
  step.index = 0;
  api.armReport(false);
}

api.onReportNext(() => {
  if (step.lines.length) copyStepLine();
});

let toastTimer = null;
function showToast(message, sub, ms = 2800) {
  const toast = $('toast');
  toast.replaceChildren(message, sub ? h('span', { class: 'toast-sub' }, sub) : null);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
}

$('resetBtn').addEventListener('click', () => {
  hideMenu();
  meter.reset();
  state.segmentId = 'current';
  state.detail = null;
  render();
});
$('minBtn').addEventListener('click', () => api.minimize());
$('closeBtn').addEventListener('click', () => api.close());

document.addEventListener('click', hideMenu);
// The title bar's drag area swallows clicks, and clicks outside the overlay never reach the page.
window.addEventListener('blur', hideMenu);
document.querySelector('.titlebar').addEventListener('mousedown', (e) => {
  if (!e.target.closest('button')) hideMenu();
});
el.menu.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideMenu();
    if (state.detail) closeDetail();
  }
});
el.content.addEventListener('mouseleave', hideTooltip);
el.content.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (state.detail) closeDetail();
});

// Custom resize grip: transparent frameless windows on Windows cannot be resized from their edges.
$('grip').addEventListener('mousedown', (e) => {
  e.preventDefault();
  const start = { x: e.screenX, y: e.screenY, w: window.outerWidth, h: window.outerHeight };
  const move = (ev) => api.resize(start.w + ev.screenX - start.x, start.h + ev.screenY - start.y);
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

function setOpacity(value) {
  document.documentElement.style.setProperty('--alpha', String(value));
}

// ---------------------------------------------------------------------------
// Data feed
// ---------------------------------------------------------------------------
api.onLines(({ lines, live }) => {
  if (live) state.lastLogWrite = Date.now();
  if (state.paused) return;
  for (const line of lines) {
    const event = parseLine(line);
    if (!event) continue;
    meter.ingest(event);
    if (live && (event.kind === 'damage' || event.kind === 'miss')) state.lastLiveCombat = Date.now();
  }
  scheduleRender();
});

api.onNativeLines((lines) => {
  for (const line of lines) {
    const entry = parseNativeLine(line);
    if (entry) meter.addLocation(entry);
    const phase = parsePhaseLine(line);
    if (phase && (!state.phase || phase.ts >= state.phase.ts)) state.phase = phase;
  }
  scheduleRender();
});

api.onGameRunning((running) => {
  state.gameRunning = running;
  scheduleRender();
});

api.onStatus((status) => {
  state.logPath = status.path;
  state.logExists = status.exists;
  if (status.mtimeMs) state.lastLogWrite = Math.max(state.lastLogWrite ?? 0, status.mtimeMs);
  scheduleRender();
});

api.onRestart(() => {
  meter.reset();
  state.segmentId = 'current';
  state.detail = null;
  scheduleRender();
});

setInterval(() => renderFooter(meter.view(state.category, state.segmentId)), 1000);

el.segmentIcon.replaceChildren(iconImg(ICONS.segment, 'icon btn-icon'));
const saved = await api.ready();
state.category = saved.category ?? state.category;
state.logPath = saved.logPath;
meter.pets.setManual(saved.petOwners);
state.characters = saved.characters ?? [];
state.playerSetting = saved.playerName ?? null;
setSpellIcons(saved.spellIcons);
setOpacity(saved.opacity ?? 0.92);
render();
