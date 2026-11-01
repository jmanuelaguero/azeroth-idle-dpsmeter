import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, parseMessage, SELF, MELEE, ENVIRONMENT } from '../src/domain/combat-log-parser.js';

const NOW = new Date(2026, 10, 1, 12, 0, 0);

test('parses the timestamp prefix', () => {
  const e = parseLine('11/1 05:06:42.284  Sheldog hits Scarlet Myrmidon for 119.', NOW);
  assert.equal(e.ts, new Date(2026, 10, 1, 5, 6, 42, 284).getTime());
});

test('melee hits and crits', () => {
  assert.deepEqual(pick(parseMessage('Sheldog hits Scarlet Myrmidon for 119.')),
    { kind: 'damage', source: 'Sheldog', target: 'Scarlet Myrmidon', spell: MELEE, amount: 119, crit: false });
  assert.deepEqual(pick(parseMessage('Prophesiepal crits Scarlet Defender for 279.')),
    { kind: 'damage', source: 'Prophesiepal', target: 'Scarlet Defender', spell: MELEE, amount: 279, crit: true });
});

test('first-person forms map to You', () => {
  assert.deepEqual(pick(parseMessage('You crit Scarlet Myrmidon for 453.')),
    { kind: 'damage', source: SELF, target: 'Scarlet Myrmidon', spell: MELEE, amount: 453, crit: true });
  assert.deepEqual(pick(parseMessage('Scarlet Myrmidon hits you for 74.')),
    { kind: 'damage', source: 'Scarlet Myrmidon', target: SELF, spell: MELEE, amount: 74, crit: false });
  assert.deepEqual(pick(parseMessage('Your Stormstrike hits Scarlet Defender for 230.')),
    { kind: 'damage', source: SELF, target: 'Scarlet Defender', spell: 'Stormstrike', amount: 230, crit: false });
});

test('spell damage with school and multi-word owners', () => {
  const e = parseMessage("Teysa's Shoot crits Scarlet Myrmidon for 64 Fire damage.");
  assert.deepEqual(pick(e), { kind: 'damage', source: 'Teysa', target: 'Scarlet Myrmidon', spell: 'Shoot', amount: 64, crit: true });
  assert.equal(e.school, 'Fire');
  assert.deepEqual(pick(parseMessage("Grizzled Thistle Bear's Claw crits Scarlet Defender for 89.")),
    { kind: 'damage', source: 'Grizzled Thistle Bear', target: 'Scarlet Defender', spell: 'Claw', amount: 89, crit: true });
});

test('blocked amounts are kept as extras', () => {
  const e = parseMessage('Sheldog hits Scarlet Myrmidon for 66. (24 blocked)');
  assert.equal(e.amount, 66);
  assert.equal(e.blocked, 24);
});

test('periodic damage', () => {
  const e = parseMessage("Scarlet Myrmidon suffers 42 Nature damage from Scarlet's Serpent Sting.");
  assert.deepEqual(pick(e), { kind: 'damage', source: 'Scarlet', target: 'Scarlet Myrmidon', spell: 'Serpent Sting', amount: 42, crit: false });
  assert.equal(e.periodic, true);
});

test('environmental damage has no player source', () => {
  assert.equal(parseMessage('You fall and lose 120 health.').source, ENVIRONMENT);
});

test('misses and avoidance', () => {
  assert.equal(parseMessage('You miss Scarlet Defender.').kind, 'miss');
  assert.equal(parseMessage('Scarlet Defender attacks. Sheldog parries.').missType, 'parry');
  assert.equal(parseMessage('Scarlet Myrmidon attacks. Teysa absorbs all the damage.').missType, 'absorb');
  const spellMiss = parseMessage("Grizzled Thistle Bear's Claw missed Scarlet Myrmidon.");
  assert.deepEqual([spellMiss.kind, spellMiss.source, spellMiss.spell], ['miss', 'Grizzled Thistle Bear', 'Claw']);
  const dodged = parseMessage("Scarlet Defender's Shield Bash was dodged by Sheldog.");
  assert.deepEqual([dodged.source, dodged.spell, dodged.target, dodged.missType], ['Scarlet Defender', 'Shield Bash', 'Sheldog', 'dodge']);
});

test('healing and resources', () => {
  assert.deepEqual(pick(parseMessage("Sheldog gains 65 health from Teysa's Renew.")),
    { kind: 'heal', source: 'Teysa', target: 'Sheldog', spell: 'Renew', amount: 65, crit: false });
  assert.deepEqual(pick(parseMessage("Teysa's Flash Heal critically heals Sheldog for 900.")),
    { kind: 'heal', source: 'Teysa', target: 'Sheldog', spell: 'Flash Heal', amount: 900, crit: true });
  const mana = parseMessage("Prophesiepal gains 50 Mana from Prophesiepal's Seal of Wisdom.");
  assert.deepEqual([mana.kind, mana.resource, mana.amount, mana.source], ['energize', 'Mana', 50, 'Prophesiepal']);
  const selfMana = parseMessage('You gain 33 Mana from Judgement of Wisdom.');
  assert.deepEqual([selfMana.source, selfMana.target], [SELF, SELF]);
});

test('deaths and auras', () => {
  assert.deepEqual(parseMessage('Scarlet Defender dies.'), { kind: 'death', target: 'Scarlet Defender', killer: null });
  assert.equal(parseMessage('You die.').target, SELF);
  assert.equal(parseMessage('Sheldog gains Berserker Stance.').kind, 'aura');
  assert.equal(parseMessage('Flurry fades from you.').target, SELF);
});

test('unknown sentences return null', () => {
  assert.equal(parseLine('not a combat log line'), null);
  assert.equal(parseLine('11/1 05:06:42.284  Something completely different'), null);
});

function pick(e) {
  return { kind: e.kind, source: e.source, target: e.target, spell: e.spell, amount: e.amount, crit: e.crit };
}
