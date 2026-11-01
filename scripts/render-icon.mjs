// Renders build/icon.svg to build/icon.png (512x512) with Electron's own Chromium.
// Usage: npx electron scripts/render-icon.mjs
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 512;
const buildDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = readFileSync(join(buildDir, 'icon.svg'), 'utf8').replace('width="256" height="256"', `width="${SIZE}" height="${SIZE}"`);
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, transparent: true, frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  writeFileSync(join(buildDir, 'icon.png'), image.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log(`wrote ${join(buildDir, 'icon.png')}`);
  app.quit();
});
