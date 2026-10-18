// Tiny persistence: one JSON file per state object (written atomically) and append-only JSONL logs.
// No native modules, so the same code runs on Windows, macOS, Linux and a VPS.
import fs from 'node:fs';
import path from 'node:path';

export function jsonFile(file, fallback) {
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return structuredClone(fallback);
    }
  };
  const write = obj => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
    fs.renameSync(tmp, file);
  };
  return { file, read, write };
}

export function jsonl(file) {
  const append = obj => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
  };
  const readAll = (keep = () => true) => {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    const out = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (keep(o)) out.push(o);
      } catch {
        // a half-written last line (a crash mid-write) is dropped, the rest kept
      }
    }
    return out;
  };
  return { file, append, readAll };
}

export const nid = (n = 8) =>
  Math.random()
    .toString(36)
    .slice(2, 2 + n) + Date.now().toString(36).slice(-3);
