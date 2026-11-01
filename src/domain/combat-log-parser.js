// Parses the vanilla-style text combat log (WoWCombatLog.txt) written by Azeroth Idle.
// Each line: "M/D HH:MM:SS.mmm  <english sentence>".
// parseLine returns a typed event or null when the line is not understood.

export const SELF = 'You';
export const MELEE = 'Melee';
export const ENVIRONMENT = 'Environment';

const LINE = /^(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})\s+(.*)$/;

export function parseTimestamp(month, day, h, m, s, ms, now = new Date()) {
  let year = now.getFullYear();
  let date = new Date(year, month - 1, day, h, m, s, ms);
  // A log from late December read in early January belongs to the previous year.
  if (date.getTime() - now.getTime() > 2 * 24 * 3600 * 1000) {
    year -= 1;
    date = new Date(year, month - 1, day, h, m, s, ms);
  }
  return date.getTime();
}

const unit = (name) => (/^you$/i.test(name) ? SELF : name);

// "Your Fireball" / "your Deep Wound" (mid-sentence) -> { source: You, spell }, "Teysa's Shoot" -> { source: Teysa, spell: Shoot }
function splitOwned(owned) {
  const yours = /^[Yy]our (.+)$/.exec(owned);
  if (yours) return { source: SELF, spell: yours[1] };
  const idx = owned.indexOf("'s ");
  if (idx > 0) return { source: owned.slice(0, idx), spell: owned.slice(idx + 3) };
  return null;
}

function parseExtras(rest) {
  const extras = { blocked: 0, absorbed: 0, resisted: 0 };
  const re = /\((\d+) (blocked|absorbed|resisted)\)/g;
  let m;
  while ((m = re.exec(rest))) extras[m[2]] += Number(m[1]);
  return extras;
}

const AMOUNT = String.raw`for (\d+)(?: (\w+) damage)?\.(.*)$`;
const OWNED = String.raw`(Your .+?|.+?'s .+?)`;

const damage = (fields) => ({ kind: 'damage', crit: false, periodic: false, school: 'Physical', ...fields });

const RULES = [
  // --- direct damage -------------------------------------------------------
  [new RegExp(`^${OWNED} (hits|crits) (.+?) ${AMOUNT}`), (m) => {
    const owned = splitOwned(m[1]);
    if (!owned) return null;
    return damage({ ...owned, target: unit(m[3]), amount: Number(m[4]), school: m[5] ?? 'Physical', crit: m[2] === 'crits', ...parseExtras(m[6]) });
  }],
  [new RegExp(`^You (hit|crit) (.+?) ${AMOUNT}`), (m) =>
    damage({ source: SELF, spell: MELEE, target: unit(m[2]), amount: Number(m[3]), school: m[4] ?? 'Physical', crit: m[1] === 'crit', ...parseExtras(m[5]) })],
  [new RegExp(`^(.+?) (hits|crits) (.+?) ${AMOUNT}`), (m) =>
    damage({ source: unit(m[1]), spell: MELEE, target: unit(m[3]), amount: Number(m[4]), school: m[5] ?? 'Physical', crit: m[2] === 'crits', ...parseExtras(m[6]) })],

  // --- periodic damage -----------------------------------------------------
  [/^(.+?) suffers? (\d+) (\w+) damage from (.+?)\.(.*)$/, (m) => {
    const owned = splitOwned(m[4]) ?? { source: ENVIRONMENT, spell: m[4] };
    return damage({ ...owned, target: unit(m[1]), amount: Number(m[2]), school: m[3], periodic: true, ...parseExtras(m[5]) });
  }],
  [/^(.+?) reflects? (\d+) (\w+) damage to (.+?)\.(.*)$/, (m) =>
    damage({ source: unit(m[1]), spell: 'Damage Shield', target: unit(m[4]), amount: Number(m[2]), school: m[3], ...parseExtras(m[5]) })],
  [/^(.+?) (?:falls|fall) and loses? (\d+) health\.$/, (m) =>
    damage({ source: ENVIRONMENT, spell: 'Falling', target: unit(m[1]), amount: Number(m[2]) })],
  [/^(.+?) (?:is|are) (drowning|burned|exhausted|suffocating) and loses? (\d+) health\.$/, (m) =>
    damage({ source: ENVIRONMENT, spell: m[2], target: unit(m[1]), amount: Number(m[3]) })],

  // --- avoidance (spell forms first, so "X's Spell misses Y" is not read as melee) ---
  [new RegExp(`^${OWNED} (?:missed|misses) (.+?)\\.$`), (m) => {
    const owned = splitOwned(m[1]);
    return owned && { kind: 'miss', ...owned, target: unit(m[2]), missType: 'miss' };
  }],
  [new RegExp(`^${OWNED} was (dodged|parried|blocked|resisted|evaded|absorbed|deflected|reflected) by (.+?)\\.$`), (m) => {
    const owned = splitOwned(m[1]);
    return owned && { kind: 'miss', ...owned, target: unit(m[3]), missType: normalizeMiss(m[2]) };
  }],
  [new RegExp(`^${OWNED} fails?\\. (.+?) (?:is|are) immune\\.$`), (m) => {
    const owned = splitOwned(m[1]);
    return owned && { kind: 'miss', ...owned, target: unit(m[2]), missType: 'immune' };
  }],
  [/^(You|.+?) (?:miss|misses) (.+?)\.$/, (m) =>
    ({ kind: 'miss', source: unit(m[1]), spell: MELEE, target: unit(m[2]), missType: 'miss' })],
  [/^(You|.+?) attacks?\. (.+?) (dodges?|parr(?:y|ies)|blocks?|absorbs?|evades?|deflects?)(?: all the damage)?\.$/, (m) =>
    ({ kind: 'miss', source: unit(m[1]), spell: MELEE, target: unit(m[2]), missType: normalizeMiss(m[3]) })],
  [/^(You|.+?) attacks? but (.+?) (?:is|are) immune\.$/, (m) =>
    ({ kind: 'miss', source: unit(m[1]), spell: MELEE, target: unit(m[2]), missType: 'immune' })],

  // --- healing -------------------------------------------------------------
  [new RegExp(`^${OWNED} (heals|critically heals) (.+?) for (\\d+)\\.$`), (m) => {
    const owned = splitOwned(m[1]);
    return owned && { kind: 'heal', ...owned, target: unit(m[3]), amount: Number(m[4]), crit: m[2] !== 'heals' };
  }],
  [/^(.+?) gains? (\d+) (\w+) from (.+?)\.$/, (m) => {
    const target = unit(m[1]);
    const owned = splitOwned(m[4]) ?? { source: target, spell: m[4] };
    if (m[3].toLowerCase() === 'health') {
      return { kind: 'heal', ...owned, target, amount: Number(m[2]), crit: false };
    }
    return { kind: 'energize', ...owned, target, amount: Number(m[2]), resource: m[3] };
  }],

  // --- deaths --------------------------------------------------------------
  [/^You die\.$/, () => ({ kind: 'death', target: SELF, killer: null })],
  [/^(.+?) (?:dies|is destroyed)\.$/, (m) => ({ kind: 'death', target: unit(m[1]), killer: null })],
  [/^(.+?) (?:is|are) slain by (.+?)[.!]$/, (m) => ({ kind: 'death', target: unit(m[1]), killer: unit(m[2]) })],
  [/^You have slain (.+?)!$/, (m) => ({ kind: 'death', target: unit(m[1]), killer: SELF })],

  // --- auras ---------------------------------------------------------------
  [/^(.+?) gains? (\d+) extra attacks? through (.+?)\.$/, (m) => ({ kind: 'proc', target: unit(m[1]), spell: m[3], amount: Number(m[2]) })],
  [/^(.+?) (?:is|are) afflicted by (.+?)\.$/, (m) => ({ kind: 'aura', target: unit(m[1]), spell: m[2], action: 'applied', debuff: true })],
  [/^(.+?) fades from (.+?)\.$/, (m) => ({ kind: 'aura', target: unit(m[2]), spell: m[1], action: 'removed' })],
  [/^(.+?) gains? (.+?)\.$/, (m) => ({ kind: 'aura', target: unit(m[1]), spell: m[2], action: 'applied', debuff: false })],
];

function normalizeMiss(word) {
  const w = word.toLowerCase();
  if (w.startsWith('dodge')) return 'dodge';
  if (w.startsWith('parr')) return 'parry';
  if (w.startsWith('block')) return 'block';
  if (w.startsWith('absorb')) return 'absorb';
  if (w.startsWith('evade')) return 'evade';
  if (w.startsWith('deflect')) return 'deflect';
  if (w.startsWith('reflect')) return 'reflect';
  if (w.startsWith('resist')) return 'resist';
  return 'miss';
}

export function parseMessage(message) {
  for (const [re, build] of RULES) {
    const m = re.exec(message);
    if (!m) continue;
    const event = build(m);
    if (event) return event;
  }
  return null;
}

export function parseLine(line, now = new Date()) {
  const m = LINE.exec(line.trim());
  if (!m) return null;
  const event = parseMessage(m[7]);
  if (!event) return null;
  const [mo, d, h, mi, s] = m.slice(1, 6).map(Number);
  event.ts = parseTimestamp(mo, d, h, mi, s, Number(m[6].padEnd(3, '0')), now);
  return event;
}
