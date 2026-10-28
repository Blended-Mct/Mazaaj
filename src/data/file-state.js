// Saves the store's agent actions (mood corrections, follow-ups) to a JSON file.

import fs from 'node:fs';
import path from 'node:path';

export function fileState(file) {
  let timer = null;
  let pending = null;

  function write() {
    clearTimeout(timer);
    if (!pending) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(pending, null, 2));
    fs.renameSync(tmp, file);
    pending = null;
  }

  return {
    load() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`[mizaj] Ignoring unreadable state file ${file}: ${err.message}`);
        return null;
      }
    },
    save(state) {
      pending = state;
      clearTimeout(timer);
      timer = setTimeout(write, 150);
      timer.unref?.();
    },
    flush: write,
  };
}
