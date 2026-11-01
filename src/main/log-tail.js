// Follows a growing text file (like `tail -f`) by polling its size.
// Polling is used instead of fs.watch because Windows does not reliably report appends made by another process.
import { open, stat } from 'node:fs/promises';

const CHUNK = 4 * 1024 * 1024;

export class LogTail {
  constructor(path, { onLines, onStatus, intervalMs = 250 }) {
    this.path = path;
    this.onLines = onLines;
    this.onStatus = onStatus ?? (() => {});
    this.intervalMs = intervalMs;
    this.position = 0;
    this.remainder = '';
    this.timer = null;
    this.busy = false;
    this.exists = null;
    this.caughtUp = false;
  }

  start() {
    this.stop();
    this.position = 0;
    this.remainder = '';
    this.caughtUp = false;
    this.exists = null;
    this.timer = setInterval(() => this.#poll(), this.intervalMs);
    this.#poll();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async #poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      let info;
      try {
        info = await stat(this.path);
      } catch {
        this.#setExists(false);
        this.caughtUp = true;
        return;
      }
      this.#setExists(true, info.mtimeMs);
      if (info.size < this.position) {
        // File was truncated or recreated: start over from the beginning.
        this.position = 0;
        this.remainder = '';
      }
      while (info.size > this.position) {
        const length = Math.min(CHUNK, info.size - this.position);
        const handle = await open(this.path, 'r');
        try {
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, this.position);
          this.position += bytesRead;
          const text = this.remainder + buffer.toString('utf8', 0, bytesRead);
          const parts = text.split(/\r?\n/);
          this.remainder = parts.pop() ?? '';
          const lines = parts.filter(Boolean);
          const live = this.caughtUp;
          if (lines.length) this.onLines(lines, { live });
        } finally {
          await handle.close();
        }
      }
      this.caughtUp = true;
    } catch (error) {
      this.onStatus({ path: this.path, exists: this.exists, error: String(error) });
    } finally {
      this.busy = false;
    }
  }

  #setExists(exists, mtimeMs = null) {
    if (exists === this.exists) return;
    this.exists = exists;
    this.onStatus({ path: this.path, exists, mtimeMs });
  }
}
