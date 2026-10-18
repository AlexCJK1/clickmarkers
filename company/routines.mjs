// Routines: the standing work. Each one becomes a ticket when its slot comes round, once per slot,
// whether or not a page is open. Edited by hand in routines.json or through the API.
import fs from 'node:fs';
import path from 'node:path';
import { jsonFile } from '../core/store.mjs';
import { dueSlot, describeWhen, nextRun } from '../core/clock.mjs';
import { emit, log } from '../core/events.mjs';

export class Routines {
  constructor(file, dataDir, tz = 'Europe/London') {
    this.file = file;
    this.tz = tz;
    this.state = jsonFile(path.join(dataDir, 'routines-state.json'), { fired: {} });
    const fresh = !fs.existsSync(this.state.file);
    this.fired = this.state.read().fired;
    this.load();
    if (fresh) {
      for (const { routine, slot } of this.due()) this.fired[routine.id] = slot;
      this.state.write({ fired: this.fired });
    } // a first start does not replay today's backlog
  }
  load() {
    try {
      this.list = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')).routines || [];
      this.mtime = fs.statSync(this.file).mtimeMs;
    } catch (e) {
      if (!this.list) this.list = [];
      log.warn('routines:', e.message);
    }
    return this;
  }
  reloadIfChanged() {
    try {
      if (fs.statSync(this.file).mtimeMs !== this.mtime) this.load();
    } catch {
      // the file is mid-save or gone for a moment: keep the copy in memory, look again next tick
    }
  }
  save() {
    fs.writeFileSync(this.file, JSON.stringify({ routines: this.list }, null, 1));
    this.mtime = fs.statSync(this.file).mtimeMs;
  }
  /** Routines whose slot has come. Each is returned once per slot. */
  due(now = Date.now()) {
    const out = [];
    for (const r of this.list) {
      if (r.paused) continue;
      const slot = dueSlot(r.when, { now, tz: this.tz, lastKey: this.fired[r.id] || '' });
      if (slot) out.push({ routine: r, slot });
    }
    return out;
  }
  mark(id, slot) {
    this.fired[id] = slot;
    this.state.write({ fired: this.fired });
  }
  get(id) {
    return this.list.find(r => r.id === id) || null;
  }
  upsert(r) {
    const i = this.list.findIndex(x => x.id === r.id);
    const before = i >= 0 ? JSON.stringify(this.list[i].when) : null;
    if (i >= 0) this.list[i] = { ...this.list[i], ...r };
    else this.list.push(r);
    // a new or re-timed routine starts from the next slot: a slot already past today is not fired at once
    const now = this.get(r.id);
    if (now.when && JSON.stringify(now.when) !== before) {
      const slot = dueSlot(now.when, { tz: this.tz, lastKey: '' });
      if (slot) this.fired[r.id] = slot;
      else delete this.fired[r.id];
      this.state.write({ fired: this.fired });
    }
    this.save();
    emit('routine', { id: r.id, change: i >= 0 ? 'updated' : 'added' });
    return this.get(r.id);
  }
  remove(id) {
    this.list = this.list.filter(r => r.id !== id);
    this.save();
    emit('routine', { id, change: 'removed' });
  }
  pause(id, on = true) {
    if (!this.get(id)) return null;
    const r = this.upsert({ id, paused: !!on });
    emit('routine', { id, change: on ? 'paused' : 'resumed' });
    return r;
  }
  view(now = Date.now()) {
    return this.list.map(r => ({
      ...r,
      whenText: describeWhen(r.when),
      lastSlot: this.fired[r.id] || '',
      nextAt: r.paused ? 0 : nextRun(r.when, now, this.tz),
    }));
  }
  /** A routine by id, or by a few words of its title or id ("spring offer", "morning numbers"). */
  find(words) {
    const k = String(words || '')
      .trim()
      .toLowerCase();
    if (!k) return null;
    const exact = this.list.find(r => r.id.toLowerCase() === k || String(r.title || '').toLowerCase() === k);
    if (exact) return exact;
    const terms = k.split(/[\s-]+/).filter(Boolean);
    const scored = this.list
      .map(r => [terms.filter(t => `${r.id} ${r.title || ''}`.toLowerCase().includes(t)).length, r])
      .filter(([n]) => n === terms.length)
      .sort((a, b) => a[1].id.localeCompare(b[1].id));
    return scored.length === 1 ? scored[0][1] : null;
  }
  /** A free id from a title ("Check ad pacing" → "check-ad-pacing", then -2, -3 …). */
  freeId(title) {
    const base =
      String(title || 'routine')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'routine';
    let id = base,
      n = 2;
    while (this.get(id)) id = `${base}-${n++}`;
    return id;
  }
}
