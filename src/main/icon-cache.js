// Serves WoW icons to the renderer through the custom `wowicon://icon/<name>` scheme.
// Icons are downloaded once from Wowhead's public CDN and cached on disk, so later runs work offline.
import { net } from 'electron';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CDN = 'https://wow.zamimg.com/images/wow/icons/medium';
const VALID = /^[a-z0-9_-]{1,80}$/;

export class IconCache {
  constructor(dir) {
    this.dir = dir;
    this.pending = new Map(); // name -> Promise<Buffer|null>
    this.missing = new Set(); // names the CDN does not have (this session)
    mkdirSync(dir, { recursive: true });
  }

  async handle(request) {
    const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, '')).toLowerCase();
    if (!VALID.test(name)) return new Response(null, { status: 400 });
    const data = await this.#load(name);
    if (!data) return new Response(null, { status: 404 });
    return new Response(data, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000' } });
  }

  #load(name) {
    const file = join(this.dir, `${name}.jpg`);
    if (existsSync(file)) return Promise.resolve(readFileSync(file));
    if (this.missing.has(name)) return Promise.resolve(null);
    if (!this.pending.has(name)) {
      const job = this.#download(name, file).finally(() => this.pending.delete(name));
      this.pending.set(name, job);
    }
    return this.pending.get(name);
  }

  async #download(name, file) {
    try {
      const res = await net.fetch(`${CDN}/${name}.jpg`);
      if (!res.ok) {
        if (res.status === 404) this.missing.add(name);
        return null;
      }
      const data = Buffer.from(await res.arrayBuffer());
      await writeFile(file, data);
      return data;
    } catch {
      return null; // offline: the UI falls back to a plain colored square
    }
  }
}

// Reads the game's own spell -> icon table (gamedata/idle-assets/spell-icons.json).
export function loadSpellIcons(path) {
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    const out = {};
    for (const table of [json.talents ?? {}, json.spells ?? {}]) {
      for (const [spell, index] of Object.entries(table)) {
        const icon = json.icons?.[index];
        if (icon && icon !== 'Temp') out[spell] = icon.toLowerCase();
      }
    }
    return out;
  } catch {
    return {};
  }
}
