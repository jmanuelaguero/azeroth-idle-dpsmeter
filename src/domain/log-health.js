// Detects a combat log that exists but is no longer being written (e.g. /combatlog toggled off).
//
// Signals:
// - The game process is running (checked by the main process).
// - The combat log's last write. In an idle game the hero fights almost constantly, so a long silence
//   while the game runs usually means logging is off.
// - native.log's activity phase ("fps: target 30 (in world, unfocused, fight)"). It is only written when the
//   FPS target or focus changes, so it is a hint, never the only signal.

const PHASE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+fps: target [^(]*\(in world, \w+, (\w+)\)/;

export const FIGHT_SILENCE_MS = 20000; // engine says "fight" but nothing was logged
export const QUIET_SILENCE_MS = 90000; // game running and nothing was logged for this long

// Returns { ts, phase } for a phase line of native.log, otherwise null.
export function parsePhaseLine(line) {
  const m = PHASE.exec(line);
  return m ? { ts: Date.parse(m[1]), phase: m[2] } : null;
}

// 'missing' | 'stale' | 'ok'
export function combatLogHealth({
  exists, gameRunning = false, phase, phaseSince, lastWrite, now,
  fightSilenceMs = FIGHT_SILENCE_MS, quietSilenceMs = QUIET_SILENCE_MS,
}) {
  if (exists === false) return 'missing';
  const silentFor = now - (lastWrite ?? 0);
  if (phase === 'fight' && phaseSince != null && now - phaseSince > fightSilenceMs && silentFor > fightSilenceMs) return 'stale';
  if (gameRunning && silentFor > quietSilenceMs) return 'stale';
  return 'ok';
}
