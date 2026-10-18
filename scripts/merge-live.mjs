// Keep the owner's changes across an update. The company files are both shipped (in git) and changed
// while the office runs (routines added from the phone, a desk paused, a brief written by the set-up
// interview, Google switched on). An update replaces them, so before it does, save the live copies;
// after it, this merges three versions of each file:
//   base   = the file as the previous version shipped it   (git show HEAD:<file>, before the update)
//   live   = the file as it is on the machine              (the owner's changes on top of base)
//   drop   = the file in the new version                   (the developer's changes on top of base)
// What only one side changed is taken from that side; where both changed the same value, the live
// value is kept (the owner's word wins) and the clash is reported so a developer can look.
// Lists of objects with an "id" (desks, departments, routines) are merged item by item.
//
//   node scripts/merge-live.mjs <baseDir> <liveDir> <repoDir> company/company.json company/routines.json …
// Writes the merged files into <repoDir>; prints one line per file; exit code 0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const byId = xs => Array.isArray(xs) && xs.length > 0 && xs.every(x => isObj(x) && typeof x.id === 'string');

/** Three-way merge of JSON values. clashes collects the paths where both sides changed differently. */
export function merge3(base, live, drop, at = '$', clashes = []) {
  if (eq(live, base)) return drop;
  if (eq(drop, base)) return live;
  if (eq(live, drop)) return live;
  if (isObj(live) && isObj(drop)) {
    const b = isObj(base) ? base : {}; const out = {};
    for (const k of new Set([...Object.keys(drop), ...Object.keys(live)])) {
      const inL = k in live, inD = k in drop, inB = k in b;
      if (inL && inD) out[k] = merge3(b[k], live[k], drop[k], `${at}.${k}`, clashes);
      else if (inD && !inL) { if (inB && eq(b[k], drop[k])) continue; if (inB) { clashes.push(`${at}.${k} (removed live, changed in the drop: kept removed)`); continue; } out[k] = drop[k]; }
      else if (inL && !inD) { if (inB && eq(b[k], live[k])) continue; if (inB) { clashes.push(`${at}.${k} (removed in the drop, changed live: kept)`); } out[k] = live[k]; }
    }
    return out;
  }
  if ((byId(live) || live?.length === 0) && (byId(drop) || drop?.length === 0) && (base === undefined || byId(base) || base?.length === 0)) {
    const B = new Map((base || []).map(x => [x.id, x])), L = new Map(live.map(x => [x.id, x])), D = new Map(drop.map(x => [x.id, x]));
    const out = [];
    for (const d of drop) {
      const id = d.id;
      if (L.has(id)) out.push(merge3(B.get(id), L.get(id), d, `${at}[${id}]`, clashes));
      else if (!B.has(id)) out.push(d); // new in the drop
      else if (!eq(B.get(id), d)) { clashes.push(`${at}[${id}] (removed live, changed in the drop: kept removed)`); }
      // else: removed live, untouched in the drop: stays removed
    }
    for (const l of live) if (!D.has(l.id)) { if (!B.has(l.id)) out.push(l); else if (!eq(B.get(l.id), l)) { clashes.push(`${at}[${l.id}] (removed in the drop, changed live: kept)`); out.push(l); } }
    return out;
  }
  clashes.push(at);
  return live;
}

function main([baseDir, liveDir, repoDir, ...files]) {
  for (const f of files) {
    const read = d => { try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8').replace(/^﻿/, '')); } catch { return undefined; } };
    const base = read(baseDir), live = read(liveDir), drop = read(repoDir);
    if (live === undefined) { console.log(`${f}: no live copy, the drop's version stands`); continue; }
    if (drop === undefined) { fs.mkdirSync(path.dirname(path.join(repoDir, f)), { recursive: true }); fs.writeFileSync(path.join(repoDir, f), JSON.stringify(live, null, 1) + '\n'); console.log(`${f}: not in the drop, the live copy stays`); continue; }
    if (base === undefined) { console.log(`${f}: no base to compare with; the live copy is kept and the drop's version saved beside it`); fs.writeFileSync(path.join(repoDir, f + '.drop'), JSON.stringify(drop, null, 1) + '\n'); fs.writeFileSync(path.join(repoDir, f), JSON.stringify(live, null, 1) + '\n'); continue; }
    const clashes = []; const merged = merge3(base, live, drop, '$', clashes);
    if (eq(merged, drop)) { console.log(`${f}: the drop's version (no live changes)`); continue; }
    fs.writeFileSync(path.join(repoDir, f), JSON.stringify(merged, null, 1) + '\n');
    console.log(`${f}: merged the live changes${clashes.length ? `; CLASH (live kept): ${clashes.join('; ')}` : ''}`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
