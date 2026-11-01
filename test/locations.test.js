import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNativeLine, describeMap, LocationTimeline } from '../src/domain/locations.js';

const line = (pos, login = false) =>
  `2026-11-01T08:16:41.586Z worldport: ${login ? 'login on ' : ''}map 189 at [${pos}] (settle hold until the ground streams in)`;

test('parses map id and position from a worldport line', () => {
  assert.deepEqual(parseNativeLine(line('1608.0996, -318.92188, 18.6714')),
    { ts: Date.parse('2026-11-01T08:16:41.586Z'), mapId: 189, pos: { x: 1608.0996, y: -318.92188, z: 18.6714 }, login: false });
});

test('Scarlet Monastery wings are told apart by their entrance (positions from real logs)', () => {
  const wing = (pos, login) => describeMap(189, parseNativeLine(line(pos, login)).pos).name;
  assert.equal(wing('1608.0, -318.9, 18.6'), 'Scarlet Monastery: Armory');
  assert.equal(wing('853.5, 1319.2, 18.6'), 'Scarlet Monastery: Cathedral');
  assert.equal(wing('1687.1, 1050.4, 18.6'), 'Scarlet Monastery: Graveyard');
  assert.equal(wing('253.4, -206.8, 18.6'), 'Scarlet Monastery: Library');
  // logging in deep inside a wing still maps to that wing
  assert.equal(wing('1928.4, -378.1, 18.6', true), 'Scarlet Monastery: Armory');
  assert.equal(wing('228.2, -424.5, 18.6', true), 'Scarlet Monastery: Library');
  assert.equal(wing('885.3, 1396.0, 18.6', true), 'Scarlet Monastery: Cathedral');
});

test('single-wing dungeons and teleports without position keep the plain name', () => {
  assert.equal(describeMap(36, { x: 1, y: 2 }).name, 'The Deadmines');
  assert.equal(describeMap(189, null).name, 'Scarlet Monastery');
});

test('moving to another wing starts a new visit', () => {
  const t = new LocationTimeline();
  t.add({ ts: 1000, mapId: 189, pos: { x: 1608, y: -318 } });
  t.add({ ts: 5000, mapId: 189, pos: { x: 1610, y: -320 } }); // re-entry, same wing
  t.add({ ts: 9000, mapId: 189, pos: { x: 853, y: 1319 } });
  assert.equal(t.at(6000).visit, 1000);
  assert.equal(t.at(9500).name, 'Scarlet Monastery: Cathedral');
  assert.equal(t.at(9500).visit, 9000);
});

test('a login worldport line is flagged as a character login', () => {
  assert.equal(parseNativeLine(line('1924.0, -410.4, 18.0', true)).login, true);
  assert.equal(parseNativeLine(line('1924.0, -410.4, 18.0')).login, false);
});
