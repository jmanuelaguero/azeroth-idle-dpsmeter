import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, buildReportLines, CHAT_LIMIT } from '../src/domain/report.js';

const view = (rows) => ({ name: 'Herod', duration: 43.8, rows });
const row = (name, value, perSecond) => ({ name, value, perSecond });

test('formats a single chat line with name, total and rate', () => {
  const { text, rows } = buildReport({
    categoryLabel: 'Damage Done',
    categoryId: 'damage-done',
    view: view([row('You', 12491, 285.2), row('Sheldog', 5400, 123.3)]),
    displayName: (n) => (n === 'You' ? 'Dementsham' : n),
  });
  assert.equal(text, 'Damage Done - Herod [0:43]: 1. Dementsham 12.5K (285) 2. Sheldog 5.40K (123)');
  assert.equal(rows, 2);
});

test('rate displays lead with the per-second value', () => {
  const { text } = buildReport({ categoryLabel: 'DPS', categoryId: 'dps', view: view([row('Teysa', 900, 45.5)]) });
  assert.equal(text, 'DPS - Herod [0:43]: 1. Teysa 45.5');
});

test('respects the top N and never exceeds the chat limit', () => {
  const many = Array.from({ length: 40 }, (_, i) => row(`Playername${i}`, 100000 - i, 999.9));
  const top3 = buildReport({ categoryLabel: 'Damage Done', categoryId: 'damage-done', view: view(many), top: 3 });
  assert.equal(top3.rows, 3);
  const all = buildReport({ categoryLabel: 'Damage Done', categoryId: 'damage-done', view: view(many), top: 40 });
  assert.ok(all.text.length <= CHAT_LIMIT);
  assert.ok(all.rows < 40);
});

test('line report puts a header and one unit per line, like Details!', () => {
  const lines = buildReportLines({
    categoryLabel: 'Damage Done',
    categoryId: 'damage-done',
    view: view([{ ...row('You', 12491, 285.2), share: 54.9 }, { ...row('Sheldog', 5400, 123.3), share: 23.7 }, row('Teysa', 1, 1)]),
    top: 2,
    displayName: (n) => (n === 'You' ? 'Dementsham' : n),
  });
  assert.deepEqual(lines, [
    'Azeroth Meter: Damage Done - Herod [0:43]',
    '1. Dementsham - 12.5K (285, 54.9%)',
    '2. Sheldog - 5.40K (123, 23.7%)',
  ]);
});

test('every report line fits in one chat message', () => {
  const longName = 'X'.repeat(400);
  const lines = buildReportLines({ categoryLabel: 'Damage Done', categoryId: 'damage-done', view: view([{ ...row(longName, 1, 1), share: 100 }]) });
  assert.ok(lines.every((l) => l.length <= CHAT_LIMIT));
});

test('empty views still produce a short line', () => {
  assert.equal(buildReport({ categoryLabel: 'Deaths', categoryId: 'deaths', view: view([]) }).text, 'Deaths - Herod [0:43]: no data');
});
