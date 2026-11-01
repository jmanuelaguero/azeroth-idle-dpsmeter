import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassDetector } from '../src/domain/class-detect.js';

const hit = (source, spell) => ({ kind: 'damage', source, spell });

test('detects the class from signature spells', () => {
  const d = new ClassDetector();
  for (let i = 0; i < 5; i++) d.observe(hit('You', 'Slam'));
  assert.equal(d.classOf('You'), 'warrior');
});

test('follows a character switch in the same log: recent spells win over old ones', () => {
  const d = new ClassDetector();
  for (let i = 0; i < 200; i++) d.observe(hit('You', 'Stormstrike'));
  assert.equal(d.classOf('You'), 'shaman');
  assert.equal(d.specOf('You'), 'shaman:enhancement');

  // Warriors mostly auto-attack (Melee carries no class), so only a dozen class spells show up.
  for (let i = 0; i < 12; i++) {
    d.observe(hit('You', 'Melee'));
    d.observe(hit('You', i % 2 ? 'Slam' : 'Sweeping Strikes'));
  }
  assert.equal(d.classOf('You'), 'warrior');
  assert.equal(d.specOf('You'), 'warrior:arms');
});

test('ignores auras and energize events', () => {
  const d = new ClassDetector();
  d.observe({ kind: 'aura', source: 'You', spell: 'Windfury Totem' });
  d.observe({ kind: 'energize', source: 'You', spell: 'Mana Spring' });
  assert.equal(d.classOf('You'), null);
});
