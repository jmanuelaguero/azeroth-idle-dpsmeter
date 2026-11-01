// Builds chat-ready reports, like Details!' "Report" button.
// Details! sends one chat message per line (header + one line per unit); WoW caps each message at 255 chars.
import { abbreviate, duration, pct } from './format.js';

export const CHAT_LIMIT = 255;
const RATE_FIRST = new Set(['dps', 'hps']);

const clip = (text) => (text.length > CHAT_LIMIT ? `${text.slice(0, CHAT_LIMIT - 1)}…` : text);

function rowValue(categoryId, row) {
  if (categoryId === 'deaths') {
    return row.killingBlow ? `${row.killingBlow.spell ?? 'Melee'} ${abbreviate(row.killingBlow.amount)}` : 'died';
  }
  if (categoryId === 'damage-taken-by-spell') return `${abbreviate(row.value)} (${pct(row.share)})`;
  if (RATE_FIRST.has(categoryId)) return `${abbreviate(row.perSecond)} (${abbreviate(row.value)}, ${pct(row.share)})`;
  return `${abbreviate(row.value)} (${abbreviate(row.perSecond)}, ${pct(row.share)})`;
}

function compactValue(categoryId, row) {
  if (categoryId === 'deaths') return row.killingBlow ? ` (${row.killingBlow.spell ?? 'Melee'} ${abbreviate(row.killingBlow.amount)})` : '';
  if (categoryId === 'damage-taken-by-spell') return ` ${abbreviate(row.value)}`;
  if (RATE_FIRST.has(categoryId)) return ` ${abbreviate(row.perSecond)}`;
  return ` ${abbreviate(row.value)} (${abbreviate(row.perSecond)})`;
}

const headerOf = (categoryLabel, view) => `${categoryLabel} - ${view.name} [${duration(view.duration)}]`;

// One line per unit, Details!-style:
//   Azeroth Meter: Damage Done - Herod [0:43]
//   1. Dementsham - 12.5K (285, 54.9%)
export function buildReportLines({ categoryLabel, categoryId, view, top = 5, displayName = (n) => n }) {
  const lines = [clip(`Azeroth Meter: ${headerOf(categoryLabel, view)}`)];
  view.rows.slice(0, top).forEach((row, i) => {
    lines.push(clip(`${i + 1}. ${displayName(row.name)} - ${rowValue(categoryId, row)}`));
  });
  if (lines.length === 1) lines.push('no data');
  return lines;
}

// Everything in a single chat message, adding rows only while they fit in 255 chars.
export function buildReport({ categoryLabel, categoryId, view, top = 5, displayName = (n) => n }) {
  const header = `${headerOf(categoryLabel, view)}:`;
  let line = header;
  let added = 0;
  for (const row of view.rows.slice(0, top)) {
    const next = `${line} ${added + 1}. ${displayName(row.name)}${compactValue(categoryId, row)}`;
    if (next.length > CHAT_LIMIT) break;
    line = next;
    added += 1;
  }
  if (!added) line = clip(`${header} no data`);
  return { text: line, rows: added };
}
