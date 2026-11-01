import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../src/domain/combat-log-parser.js';
import { Meter } from '../src/domain/meter.js';

const NOW = new Date(2026, 10, 1, 12, 0, 0);

function feed(meter, lines) {
  for (const l of lines) {
    const e = parseLine(`11/1 05:00:${l}`, NOW);
    assert.ok(e, `unparsed: ${l}`);
    meter.ingest(e);
  }
}

const PARTY = [
  '00.000  You hit Kobold for 100.',
  "01.000  Scarlet's Auto Shot hits Kobold for 60.",
  "01.500  Scarlet's Serpent Sting hits Kobold for 20.",
  '02.000  Grizzled Thistle Bear hits Kobold for 50.',
  "03.000  Grizzled Thistle Bear's Claw crits Kobold for 30.",
  '03.500  Kobold hits Grizzled Thistle Bear for 40.',
];

const rowsOf = (m, cat) => m.view(cat).rows.map((r) => [r.name, r.value]);

test("a pet's damage counts for the only hunter in the party", () => {
  const m = new Meter();
  feed(m, PARTY);
  assert.deepEqual(rowsOf(m, 'damage-done'), [['Scarlet', 160], ['You', 100]]);
  assert.deepEqual(m.view('damage-done').rows[0].pets, ['Grizzled Thistle Bear']);
});

test('the owner breakdown lists pet abilities labelled with the pet name', () => {
  const m = new Meter();
  feed(m, PARTY);
  const bd = m.breakdown('damage-done', 'current', 'Scarlet');
  assert.equal(bd.total, 160);
  assert.deepEqual(bd.pets, ['Grizzled Thistle Bear']);
  assert.deepEqual(bd.spells.map((s) => s.name).sort(),
    ['Auto Shot', 'Claw (Grizzled Thistle Bear)', 'Melee (Grizzled Thistle Bear)', 'Serpent Sting']);
});

test('damage taken still shows the pet as its own unit', () => {
  const m = new Meter();
  feed(m, PARTY);
  assert.deepEqual(rowsOf(m, 'damage-taken'), [['Grizzled Thistle Bear', 40]]);
});

test('with two hunters and no evidence the pet stays separate', () => {
  const m = new Meter();
  feed(m, [...PARTY, "04.000  Teysa's Arcane Shot hits Kobold for 10."]);
  assert.deepEqual(rowsOf(m, 'damage-done'), [['You', 100], ['Scarlet', 80], ['Grizzled Thistle Bear', 80], ['Teysa', 10]]);
});

test('Mend Pet links the pet to its owner even with two hunters', () => {
  const m = new Meter();
  feed(m, [...PARTY, "04.000  Teysa's Arcane Shot hits Kobold for 10.", "04.500  Grizzled Thistle Bear gains 70 health from Teysa's Mend Pet."]);
  assert.deepEqual(rowsOf(m, 'damage-done'), [['You', 100], ['Teysa', 90], ['Scarlet', 80]]);
});

test('a manual mapping wins over inference', () => {
  const m = new Meter();
  m.pets.setManual({ 'Grizzled Thistle Bear': 'You' });
  feed(m, PARTY);
  assert.deepEqual(rowsOf(m, 'damage-done'), [['You', 180], ['Scarlet', 80]]);
});
