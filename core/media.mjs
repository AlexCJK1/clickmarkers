// The office's media folders (cfg.media.roots): the only places a picture may be sent from, to the phone or to a
// social account. One check, shared by the phone and the office's own Meta server.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * The real path of a picture or video the office may send, or '': the file, links followed, must sit inside one
 * of the media roots (a sibling folder that only starts with the same letters, /media-private for /media, does not count).
 */
export function mediaFile(f, roots) {
  let real;
  try {
    real = fs.realpathSync.native(path.resolve(f));
  } catch {
    return '';
  }
  const win = process.platform === 'win32';
  for (const root of roots) {
    let r;
    try {
      r = fs.realpathSync.native(path.resolve(root));
    } catch {
      continue;
    }
    const rel = path.relative(win ? r.toLowerCase() : r, win ? real.toLowerCase() : real);
    if (rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)) return real;
  }
  return '';
}

/**
 * A picture a step names, found the one way the office's Meta server and the gate both find it: a full path inside a
 * media folder, or a path inside exactly one of them. Returns { real } or { error } in words for the owner.
 */
export function mediaPath(f, roots) {
  const name = String(f ?? '');
  if (!roots.length) return { error: 'no media folder is set (media.roots in office.config.local.json)' };
  const tries = path.isAbsolute(name) ? [name] : roots.map(r => path.join(r, name));
  const found = [...new Set(tries.map(x => mediaFile(x, roots)).filter(Boolean))];
  if (!found.length) return { error: `${name.slice(0, 120)} is not a picture in the media folders` };
  if (found.length > 1) return { error: `${name.slice(0, 120)} is in more than one media folder; give its full path` };
  return { real: found[0] };
}
/** The SHA-256 of a file's bytes, or '' when it cannot be read. */
export function fileHash(real) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex');
  } catch {
    return '';
  }
}
