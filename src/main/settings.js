import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const defaultLogPath = () =>
  join(process.env.LOCALAPPDATA ?? '', 'AzerothIdle', 'data', 'config', 'Logs', 'WoWCombatLog.txt');

export const nativeLogPath = () =>
  join(process.env.LOCALAPPDATA ?? '', 'AzerothIdle', 'data', 'logs', 'native.log');

export const spellIconsPath = () =>
  join(process.env.LOCALAPPDATA ?? '', 'AzerothIdle', 'data', 'gamedata', 'idle-assets', 'spell-icons.json');

const gameConfigDir = () => join(process.env.LOCALAPPDATA ?? '', 'AzerothIdle', 'data', 'config', 'azi');

// The game keeps per-character UI files (azi.timeline_<name>.json, azi.rotseen.<name>.json).
// They list the account's characters; the most recently written one is most likely the active hero.
export function detectCharacters(dir = gameConfigDir()) {
  const seen = new Map();
  let files = [];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  for (const file of files) {
    const m = /^azi\.(?:timeline_|rotseen\.)([a-z0-9]+)\.json$/i.exec(file);
    if (!m) continue;
    let mtime = 0;
    try {
      mtime = statSync(join(dir, file)).mtimeMs;
    } catch {
      continue;
    }
    const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    seen.set(name, Math.max(seen.get(name) ?? 0, mtime));
  }
  return [...seen].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

const DEFAULTS = {
  logPath: null,
  bounds: { width: 340, height: 280 },
  category: 'damage-done',
  opacity: 0.92,
  petOwners: {}, // manual overrides: { "Pet Name": "Owner" }
  playerName: null, // null = auto-detect from the game's per-character config files
};

export class Settings {
  constructor(file) {
    this.file = file;
    this.values = { ...DEFAULTS };
    try {
      this.values = { ...DEFAULTS, ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch {
      // first run or unreadable file: keep defaults
    }
    if (!this.values.logPath) this.values.logPath = defaultLogPath();
  }

  get(key) {
    return this.values[key];
  }

  update(partial) {
    this.values = { ...this.values, ...partial };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.values, null, 2));
    } catch {
      // settings are a convenience; never crash the overlay over them
    }
  }
}
