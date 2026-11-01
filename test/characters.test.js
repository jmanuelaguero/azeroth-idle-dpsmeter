import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectCharacters } from '../src/main/settings.js';

test('lists account characters from the game config, most recently played first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'azi-config-'));
  try {
    const touch = (file, minutesAgo) => {
      writeFileSync(join(dir, file), '[]');
      const t = new Date(Date.now() - minutesAgo * 60000);
      utimesSync(join(dir, file), t, t);
    };
    touch('azi.timeline_dementpriest.json', 300);
    touch('azi.timeline_dementsham.json', 5);
    touch('azi.rotseen.dementgodx.json', 60);
    touch('azi.timeline_dementgodx.json', 120);
    touch('azi.prefs.json', 1);
    assert.deepEqual(detectCharacters(dir), ['Dementsham', 'Dementgodx', 'Dementpriest']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing config folder yields no characters', () => {
  assert.deepEqual(detectCharacters(join(tmpdir(), 'does-not-exist-azi')), []);
});
