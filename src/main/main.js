import { app, BrowserWindow, ipcMain, dialog, shell, protocol, clipboard, globalShortcut } from 'electron';
import { IconCache, loadSpellIcons } from './icon-cache.js';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LogTail } from './log-tail.js';
import { Settings, nativeLogPath, spellIconsPath, detectCharacters } from './settings.js';

const here = dirname(fileURLToPath(import.meta.url));

// Testing hook: run against an isolated settings/cache folder instead of the real one.
if (process.env.AZEROTH_METER_USER_DATA) app.setPath('userData', process.env.AZEROTH_METER_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'wowicon', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
let win = null;
let tail = null;
let nativeTail = null;
let settings = null;

function createWindow() {
  const bounds = settings.get('bounds');
  win = new BrowserWindow({
    ...bounds,
    minWidth: 220,
    minHeight: 120,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    title: 'Azeroth Meter',
    icon: join(here, '..', '..', 'build', 'icon.png'),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 'screen-saver' level keeps the overlay above borderless-fullscreen games.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(join(here, '..', 'ui', 'index.html'));

  let saveTimer = null;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => win && !win.isDestroyed() && settings.update({ bounds: win.getBounds() }), 400);
  };
  win.on('move', saveBounds);
  win.on('resize', saveBounds);
  win.on('closed', () => {
    win = null;
    tail?.stop();
    nativeTail?.stop();
    clearInterval(gameTimer);
  });
}

function startTail() {
  tail?.stop();
  tail = new LogTail(settings.get('logPath'), {
    onLines: (lines, { live }) => win?.webContents.send('log:lines', { lines, live }),
    onStatus: (status) => win?.webContents.send('log:status', status),
  });
  tail.start();
}

// The engine log records teleports ("worldport: map 189 ..."), which tells us dungeon vs open world.
function startNativeTail() {
  nativeTail?.stop();
  nativeTail = new LogTail(nativeLogPath(), {
    onLines: (lines) => {
      // teleports (zone detection) + activity phase changes (detects a combat log that was switched off)
      const teleports = lines.filter((l) => l.includes('worldport:') || l.includes('fps: target'));
      if (teleports.length) win?.webContents.send('native:lines', teleports);
    },
    intervalMs: 1000,
  });
  nativeTail.start();
}

// Is the game open? Used to tell "combat log switched off" apart from "game closed".
const GAME_EXE = 'Azeroth Idle.exe';
let gameTimer = null;
function watchGameProcess() {
  clearInterval(gameTimer);
  const check = () => execFile('tasklist', ['/FI', `IMAGENAME eq ${GAME_EXE}`, '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, stdout) => {
    win?.webContents.send('game:running', !err && stdout.includes(`"${GAME_EXE}"`));
  });
  check();
  gameTimer = setInterval(check, 10000);
}

ipcMain.handle('meter:ready', () => {
  watchGameProcess();
  startNativeTail();
  startTail();
  return { ...settings.values, characters: detectCharacters(), spellIcons: loadSpellIcons(spellIconsPath()) };
});

ipcMain.handle('characters:list', () => detectCharacters());
ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text ?? '').slice(0, 4000)));

// Line-by-line report: while armed, a global hotkey asks the overlay to copy the next line,
// so the player only presses Ctrl+V + Enter in the game. Nothing is ever typed into the game.
const NEXT_LINE_HOTKEY = 'CommandOrControl+Shift+N';
ipcMain.handle('report:arm', (_e, armed) => {
  globalShortcut.unregister(NEXT_LINE_HOTKEY);
  if (!armed) return false;
  return globalShortcut.register(NEXT_LINE_HOTKEY, () => win?.webContents.send('report:next'));
});
app.on('will-quit', () => globalShortcut.unregisterAll());

ipcMain.handle('log:choose', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Select WoWCombatLog.txt',
    defaultPath: settings.get('logPath'),
    filters: [{ name: 'Combat log', extensions: ['txt', 'log'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  settings.update({ logPath: result.filePaths[0] });
  win?.webContents.send('log:restart');
  startTail();
  return result.filePaths[0];
});

ipcMain.handle('log:open-folder', () => shell.showItemInFolder(settings.get('logPath')));
ipcMain.handle('settings:save', (_e, partial) => settings.update(partial));
ipcMain.handle('win:opacity', (_e, value) => {
  const v = Math.min(1, Math.max(0.3, Number(value) || 1));
  settings.update({ opacity: v });
  return v;
});
ipcMain.on('win:resize', (_e, { width, height }) => {
  if (!win) return;
  const b = win.getBounds();
  win.setBounds({ ...b, width: Math.max(220, Math.round(width)), height: Math.max(120, Math.round(height)) });
});
ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:close', () => win?.close());

app.whenReady().then(() => {
  settings = new Settings(join(app.getPath('userData'), 'settings.json'));
  const icons = new IconCache(join(app.getPath('userData'), 'icons'));
  protocol.handle('wowicon', (request) => icons.handle(request));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
