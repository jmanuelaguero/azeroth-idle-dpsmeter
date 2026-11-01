import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../src/domain/combat-log-parser.js';
import { Meter } from '../src/domain/meter.js';
import { parseNativeLine } from '../src/domain/locations.js';

const NOW = new Date(2026, 10, 1, 12, 0, 0);

function feed(meter, lines) {
  for (const l of lines) {
    const e = parseLine(l, NOW);
    assert.ok(e, `unparsed: ${l}`);
    meter.ingest(e);
  }
}

const FIGHT_1 = [
  '11/1 05:00:00.000  You hit Kobold for 100.',
  "11/1 05:00:01.000  Teysa's Smite hits Kobold for 50 Holy damage.",
  '11/1 05:00:02.000  Kobold hits Sheldog for 30.',
  "11/1 05:00:03.000  Sheldog gains 20 health from Teysa's Renew.",
  '11/1 05:00:04.000  Sheldog crits Kobold for 70.',
  '11/1 05:00:04.500  Kobold dies.',
];

test('friend/foe is inferred from who damages and heals whom', () => {
  const m = new Meter();
  feed(m, FIGHT_1);
  assert.equal(m.factions.sideOf('Teysa'), 'friendly');
  assert.equal(m.factions.sideOf('Sheldog'), 'friendly');
  assert.equal(m.factions.sideOf('Kobold'), 'hostile');
});

test('damage done ranks friendly units with share and effective dps', () => {
  const m = new Meter();
  feed(m, FIGHT_1);
  const v = m.view('damage-done', 'current');
  assert.deepEqual(v.rows.map((r) => [r.name, r.value]), [['You', 100], ['Sheldog', 70], ['Teysa', 50]]);
  assert.equal(v.total, 220);
  assert.equal(v.duration, 4);
  assert.equal(v.rows[0].perSecond, 25);
  assert.ok(Math.abs(v.rows[0].share - 45.45) < 0.01);
});

test('damage taken, healing and enemy views', () => {
  const m = new Meter();
  feed(m, FIGHT_1);
  assert.deepEqual(m.view('damage-taken').rows.map((r) => [r.name, r.value]), [['Sheldog', 30]]);
  assert.deepEqual(m.view('healing-done').rows.map((r) => [r.name, r.value]), [['Teysa', 20]]);
  assert.deepEqual(m.view('healing-taken').rows.map((r) => [r.name, r.value]), [['Sheldog', 20]]);
  assert.deepEqual(m.view('enemies').rows.map((r) => [r.name, r.value]), [['Kobold', 220]]);
  assert.equal(m.view('damage-done').name, 'Kobold');
});

test('a gap without combat starts a new segment; overall sums both', () => {
  const m = new Meter();
  feed(m, FIGHT_1);
  feed(m, ['11/1 05:01:00.000  You hit Gnoll for 40.', '11/1 05:01:02.000  You hit Gnoll for 60.']);
  assert.equal(m.segments.length, 2);
  assert.equal(m.view('damage-done', 'current').total, 100);
  assert.equal(m.view('damage-done', 'overall').total, 320);
  assert.equal(m.view('damage-done', 'overall').duration, 6);
});

test('ability breakdown reports hits, crits and max', () => {
  const m = new Meter();
  feed(m, [...FIGHT_1, '11/1 05:00:04.600  Sheldog hits Kobold for 30.']);
  const bd = m.breakdown('damage-done', 'current', 'Sheldog');
  assert.equal(bd.spells[0].name, 'Melee');
  assert.deepEqual([bd.spells[0].hits, bd.spells[0].crits, bd.spells[0].max, bd.spells[0].total], [2, 1, 70, 100]);
  assert.deepEqual(bd.units.map((u) => u.name), ['Kobold']);
});

test('friendly deaths keep a recap with the killing blow', () => {
  const m = new Meter();
  feed(m, [
    '11/1 05:00:00.000  You hit Ogre for 10.',
    '11/1 05:00:01.000  Ogre hits Sheldog for 300.',
    "11/1 05:00:02.000  Sheldog gains 50 health from Teysa's Renew.",
    "11/1 05:00:03.000  Ogre's Smash crits Sheldog for 900.",
    '11/1 05:00:03.100  Sheldog dies.',
  ]);
  const v = m.view('deaths');
  assert.equal(v.rows.length, 1);
  assert.equal(v.rows[0].killer, 'Ogre');
  assert.deepEqual(v.rows[0].killingBlow, { spell: 'Smash', amount: 900 });
  const bd = m.breakdown('deaths', 'current', 'Sheldog', 0);
  assert.equal(bd.death.events.length, 3);
});

test('fights are tagged with the instance from native.log and grouped into runs', () => {
  const m = new Meter();
  const iso = (h, mi) => new Date(2026, 10, 1, h, mi, 0).toISOString();
  m.addLocation(parseNativeLine(`${iso(4, 50)} worldport: login on map 0 at [1.0, 2.0, 3.0] (settle hold)`));
  m.addLocation(parseNativeLine(`${iso(4, 59)} worldport: map 189 at [1608.0, -318.9, 18.6] (settle hold)`));
  feed(m, FIGHT_1);
  feed(m, ['11/1 05:01:00.000  You hit Gnoll for 40.']);
  assert.equal(m.view('damage-done').location.name, 'Scarlet Monastery: Armory');
  assert.equal(m.view('damage-done').location.type, 'dungeon');
  const runs = m.runs();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].segments.length, 2);
  const run = m.view('damage-done', runs[0].id);
  assert.equal(run.total, 260);
  assert.equal(run.name, 'Scarlet Monastery: Armory (run)');
});

test('open world fights do not create runs', () => {
  const m = new Meter();
  m.addLocation({ ts: new Date(2026, 10, 1, 4, 0).getTime(), mapId: 0 });
  feed(m, FIGHT_1);
  assert.equal(m.view('damage-done').location.type, 'world');
  assert.equal(m.runs().length, 0);
});

const SWITCH_SHAMAN = Array.from({ length: 8 }, (_, i) => `11/1 05:00:0${i}.000  Your Stormstrike hits Kobold for 100.`);
const SWITCH_WARRIOR = ['11/1 05:10:00.000  You hit Gnoll for 40.', '11/1 05:10:01.000  Your Slam hits Gnoll for 90.'];
const selfRow = (m) => m.view('damage-done').rows.find((r) => r.isSelf);

test('logging in with another character forgets the previous class of You', () => {
  const m = new Meter();
  const login = parseNativeLine(`${new Date(2026, 10, 1, 5, 5, 0).toISOString()} worldport: login on map 0 at [1.0, 2.0, 3.0] (settle hold)`);
  feed(m, SWITCH_SHAMAN);
  assert.equal(selfRow(m).cls, 'shaman');
  m.addLocation(login);
  feed(m, SWITCH_WARRIOR);
  assert.equal(selfRow(m).cls, 'warrior');
});

test('the character switch also applies when native.log is read after the combat log (app startup)', () => {
  const m = new Meter();
  feed(m, [...SWITCH_SHAMAN, ...SWITCH_WARRIOR]);
  m.addLocation(parseNativeLine(`${new Date(2026, 10, 1, 5, 5, 0).toISOString()} worldport: login on map 0 at [1.0, 2.0, 3.0] (settle hold)`));
  assert.equal(selfRow(m).cls, 'warrior');
});

test('a plain teleport is not a character switch', () => {
  const m = new Meter();
  feed(m, SWITCH_SHAMAN);
  m.addLocation(parseNativeLine(`${new Date(2026, 10, 1, 5, 5, 0).toISOString()} worldport: map 189 at [1608.0, -318.9, 18.6] (settle hold)`));
  feed(m, SWITCH_WARRIOR);
  assert.equal(selfRow(m).cls, 'shaman');
});
