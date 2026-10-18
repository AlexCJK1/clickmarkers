// Secrets: read from the environment or a KEY=VALUE file, handed to the one process that needs them,
// never logged, never written here. The file is read again when it changes, so a sign-in written by
// clickmarkers connect reaches the running office without a restart. redact() scrubs any known value out of an
// error before it is shown.
import fs from 'node:fs';

const store = new Map();
const known = new Set();
let source = '',
  seenMtime = 0,
  lastCheck = 0,
  checkEveryMs = 2000;

/** Read the file into the store. keepGood: a missing or empty read (a save half-done, the file moved for
 *  a moment) does not wipe secrets already loaded; the next look tries again. */
function fill(file, { keepGood = false } = {}) {
  const next = new Map();
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.replace(/^﻿/, '').trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 1) continue;
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!v) continue;
      next.set(line.slice(0, i).trim(), v);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (keepGood && !next.size && store.size) return store.size; // seenMtime unchanged: looked at again next time
  store.clear();
  for (const [k, v] of next) {
    store.set(k, v);
    known.add(v);
  }
  seenMtime = mtime;
  return store.size;
}

/** Read the secrets file and remember it (to read again when it changes). Returns how many were read. */
export function loadSecrets(file) {
  if (!file) return 0;
  source = file;
  lastCheck = Date.now();
  return fill(file);
}
/** Read the file again if it changed since the last read (looked at no more than every couple of seconds). */
export function refreshSecrets({ force = false } = {}) {
  if (!source) return false;
  const now = Date.now();
  if (!force && now - lastCheck < checkEveryMs) return false;
  lastCheck = now;
  let m = 0;
  try {
    m = fs.statSync(source).mtimeMs;
  } catch {
    // no secrets file yet: m stays 0 and nothing is loaded
  }
  if (m === seenMtime) return false;
  try {
    fill(source, { keepGood: true });
    return true;
  } catch {
    return false;
  }
}
/** For the tests: how often the file is looked at (ms). */
export function setSecretsCheckMs(ms) {
  checkEveryMs = ms;
}
/** The secrets file in use ('' when none): an office-owned server is given the path, never the values. */
export const secretsSource = () => source;

/** The value, from the environment first, then the file. */
export function secret(name) {
  refreshSecrets();
  const v = process.env[name] || store.get(name) || '';
  if (v) known.add(v);
  return v;
}
export const hasSecret = name => !!secret(name);

/** Names present (never values), for the check page. */
export function secretNames() {
  refreshSecrets();
  return [...new Set([...store.keys()])].sort();
}

/** Replace every known secret value in a string with ***. */
export function redact(s) {
  let out = String(s ?? '');
  for (const v of known) if (v.length >= 8) out = out.split(v).join('***');
  return out;
}
