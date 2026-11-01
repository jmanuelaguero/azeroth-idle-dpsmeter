import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhaseLine, combatLogHealth } from '../src/domain/log-health.js';

test('reads the activity phase from native.log', () => {
  assert.deepEqual(parsePhaseLine('2026-11-01T08:54:23.875Z fps: target 30 (in world, unfocused, fight)'),
    { ts: Date.parse('2026-11-01T08:54:23.875Z'), phase: 'fight' });
  assert.equal(parsePhaseLine('2026-11-01T08:56:42.914Z fps: target uncapped (in world, focused, rest)').phase, 'rest');
  assert.equal(parsePhaseLine('2026-11-01T08:16:28.591Z worldport: map 0 at [1, 2, 3]'), null);
});

const NOW = 1_000_000;

test('a missing file is reported as missing', () => {
  assert.equal(combatLogHealth({ exists: false, now: NOW }), 'missing');
});

test('fighting with no combat log writes for 20s means logging is off', () => {
  assert.equal(combatLogHealth({ exists: true, phase: 'fight', phaseSince: NOW - 30000, lastWrite: NOW - 25000, now: NOW }), 'stale');
});

test('a fight that just started or keeps writing is fine', () => {
  assert.equal(combatLogHealth({ exists: true, phase: 'fight', phaseSince: NOW - 5000, lastWrite: NOW - 60000, now: NOW }), 'ok');
  assert.equal(combatLogHealth({ exists: true, phase: 'fight', phaseSince: NOW - 60000, lastWrite: NOW - 1000, now: NOW }), 'ok');
});

test('game running with no combat events for 90s warns, even if the last known phase is travel', () => {
  // native.log only logs phase changes when FPS target/focus changes, so "travel" can be outdated
  assert.equal(combatLogHealth({ exists: true, gameRunning: true, phase: 'travel', phaseSince: NOW - 150000, lastWrite: NOW - 100000, now: NOW }), 'stale');
});

test('short pauses while the game runs do not warn', () => {
  assert.equal(combatLogHealth({ exists: true, gameRunning: true, phase: 'travel', phaseSince: NOW - 150000, lastWrite: NOW - 60000, now: NOW }), 'ok');
});

test('with the game closed an old log never warns', () => {
  for (const phase of ['rest', 'travel', 'idle', 'errand', undefined]) {
    assert.equal(combatLogHealth({ exists: true, gameRunning: false, phase, phaseSince: NOW - 600000, lastWrite: NOW - 600000, now: NOW }), 'ok');
  }
});
