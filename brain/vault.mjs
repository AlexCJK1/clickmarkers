// The brain: a folder of markdown notes (the business, the facts, the rulings, the ledgers), a drop
// folder (90-Inbox) and a stats file. Desks read it through the prompt and through the office tools.
// Prompt caching likes a stable prefix, so the notes a desk gets are chosen by the desk's standing
// interests first (its "reads" list) and by the ticket second, and the text is sliced deterministically.
import fs from 'node:fs';
import path from 'node:path';
import { scan, fence } from '../core/guard.mjs';

const SKIP_DIRS = new Set(['Nightdesk', 'node_modules', '.git', '.obsidian']);
const NOTE_EXT = new Set(['.md']);
const INBOX_EXT = new Set(['.md', '.txt', '.csv', '.json']);

export class Vault {
  constructor(root, { business = 4000, each = 6000, n = 6, inboxEach = 4000 } = {}) {
    this.root = root; this.limits = { business, each, n, inboxEach };
    this.notes = new Map(); this.indexedAt = 0;
  }
  index(force = false) {
    if (!force && Date.now() - this.indexedAt < 30000) return this;
    this.notes.clear();
    const walk = dir => {
      let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name)); continue; }
        if (!NOTE_EXT.has(path.extname(e.name))) continue;
        const file = path.join(dir, e.name);
        const rel = path.relative(this.root, file).split(path.sep).join('/');
        if (rel.startsWith('90-Inbox/')) continue;
        let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        this.notes.set(rel, { rel, name: e.name.replace(/\.md$/, ''), file, text, mtime: 0 });
      }
    };
    if (this.root) walk(this.root);
    this.indexedAt = Date.now();
    return this;
  }
  note(nameOrRel) {
    this.index();
    if (this.notes.has(nameOrRel)) return this.notes.get(nameOrRel);
    const k = String(nameOrRel).replace(/\.md$/, '').toLowerCase();
    for (const n of this.notes.values()) if (n.name.toLowerCase() === k || n.rel.toLowerCase() === k + '.md') return n;
    return null;
  }
  names() { this.index(); return [...this.notes.keys()].sort(); }
  /** The notes every desk gets: the index and the business note. */
  business() {
    const parts = [];
    for (const n of ['00-Meta/index.md', '10-Business/business.md']) { const x = this.note(n); if (x) parts.push(`### ${x.rel}\n${x.text.trim()}`); }
    return parts.join('\n\n').slice(0, this.limits.business);
  }
  /** Notes by name (a desk's standing reads), then by relevance to the text, up to n. */
  relevant(text, reads = [], n = this.limits.n, exclude = new Set(['00-Meta/index.md', '10-Business/business.md'])) {
    return this.pick(text, reads, n, exclude).map(x => `### ${x.rel}\n${x.text.trim().slice(0, this.limits.each)}`);
  }
  /** The names of the notes relevant() would give (for the record of what a run read). */
  relevantRels(text, reads = [], n = this.limits.n, exclude = new Set(['00-Meta/index.md', '10-Business/business.md'])) { return this.pick(text, reads, n, exclude).map(x => x.rel); }
  pick(text, reads = [], n = this.limits.n, exclude = new Set(['00-Meta/index.md', '10-Business/business.md'])) {
    this.index();
    const chosen = []; const seen = new Set(exclude);
    for (const r of reads) { const x = this.note(r); if (x && !seen.has(x.rel)) { chosen.push(x); seen.add(x.rel); } }
    if (chosen.length < n) {
      const terms = [...new Set(String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || [])];
      const scored = [];
      for (const x of this.notes.values()) {
        if (seen.has(x.rel)) continue;
        const lower = x.text.toLowerCase(); let s = 0;
        for (const t of terms) { if (x.name.toLowerCase().includes(t)) s += 5; const c = lower.split(t).length - 1; s += Math.min(c, 8); }
        if (s > 0) scored.push([s, x]);
      }
      scored.sort((a, b) => b[0] - a[0] || a[1].rel.localeCompare(b[1].rel));
      for (const [, x] of scored.slice(0, n - chosen.length)) chosen.push(x);
    }
    return chosen;
  }
  /** Files dropped in 90-Inbox, newest first. */
  inbox() {
    const dir = path.join(this.root, '90-Inbox'); let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    return ents.filter(e => e.isFile() && INBOX_EXT.has(path.extname(e.name)) && !e.name.startsWith('.') && e.name.toLowerCase() !== 'readme.md')
      .map(e => { const file = path.join(dir, e.name); const st = fs.statSync(file); return { name: e.name, file, mtime: st.mtimeMs, size: st.size }; })
      .sort((a, b) => b.mtime - a.mtime);
  }
  /** Dropped files, fenced as outside material; a file that tries to give orders is held back and reported. */
  inboxText(max = 5, onHeld = null) {
    const out = [];
    for (const f of this.inbox().slice(0, max)) {
      let t = ''; try { t = fs.readFileSync(f.file, 'utf8'); } catch {}
      const hits = scan(t, { strict: true }); // a dropped file is from outside the office: any one signal holds it back
      if (hits.length) { if (onHeld) onHeld({ file: f.name, hits }); out.push(`### Inbox/${f.name}\n(held back by the guard: it contains instruction-like text: ${hits.join(' | ')}. Tell the owner.)`); continue; }
      out.push(`### Inbox/${f.name}\n${fence(`Inbox/${f.name}`, t.trim().slice(0, this.limits.inboxEach))}`);
    }
    return out;
  }
  /** A desk's own notebook: what it learned, what the owner said. */
  notebookFile(id) { return path.join(this.root, 'Nightdesk', 'desks', `${String(id).replace(/[^a-z0-9_-]/gi, '')}.md`); }
  notebook(id, max = 3000) { try { return fs.readFileSync(this.notebookFile(id), 'utf8').trim().slice(-max); } catch { return ''; } }
  noteDesk(id, text, who = 'desk') {
    const f = this.notebookFile(id); fs.mkdirSync(path.dirname(f), { recursive: true });
    const line = `- ${new Date().toISOString().slice(0, 10)} (${who}): ${String(text).trim().replace(/\s+/g, ' ').slice(0, 600)}\n`;
    if (!fs.existsSync(f)) fs.writeFileSync(f, `# ${id}: notebook\n\n`);
    fs.appendFileSync(f, line); return f;
  }
  /* ---------- lessons: the owner's corrections, sorted into standing rules and one-offs ---------- */
  lessonsFile(id) { return path.join(this.root, 'Nightdesk', 'lessons', `${String(id).replace(/[^a-z0-9_-]/gi, '')}.md`); }
  /** { rules: [{ date, text, quote, task }], oneoffs: [...] } from the desk's lessons file (the owner may edit it by hand). */
  lessons(id) {
    let t = ''; try { t = fs.readFileSync(this.lessonsFile(id), 'utf8'); } catch { return { rules: [], oneoffs: [] }; }
    const out = { rules: [], oneoffs: [] }; let into = null;
    for (const line of t.split(/\r?\n/)) {
      if (/^##\s*standing rules/i.test(line)) { into = out.rules; continue; }
      if (/^##\s*one-?offs/i.test(line)) { into = out.oneoffs; continue; }
      const m = into && line.match(/^-\s+(?:(\d{4}-\d{2}-\d{2})\s*·\s*)?(.+?)(?:\s*←\s*"(.*)"(?:\s*\((.*)\))?)?\s*$/);
      if (m && m[2].trim()) into.push({ date: m[1] || '', text: m[2].trim(), quote: m[3] || '', task: m[4] || '' });
    }
    return out;
  }
  writeLessons(id, l) {
    const f = this.lessonsFile(id); fs.mkdirSync(path.dirname(f), { recursive: true });
    const line = x => `- ${x.date ? x.date + ' · ' : ''}${x.text}${x.quote ? ` ← "${x.quote}"${x.task ? ` (${x.task})` : ''}` : ''}`;
    fs.writeFileSync(f, [`# ${id}: lessons from the owner`, '', 'Standing rules go into every job this desk does. Edit or delete lines freely.', '', '## Standing rules', ...l.rules.map(line), '', '## One-offs', ...l.oneoffs.map(line), ''].join('\n'));
    return f;
  }
  addLesson(id, kind, text, { quote = '', task = '' } = {}) {
    const l = this.lessons(id); const list = kind === 'rule' ? l.rules : l.oneoffs;
    const clean = s => String(s || '').replace(/\s+/g, ' ').replace(/["←]/g, "'").trim();
    if (list.some(x => x.text.toLowerCase() === clean(text).toLowerCase())) return null;
    list.push({ date: new Date().toISOString().slice(0, 10), text: clean(text).slice(0, 240), quote: clean(quote).slice(0, 160), task: clean(task).slice(0, 80) });
    this.writeLessons(id, l); return list[list.length - 1];
  }
  removeLesson(id, kind, n) { const l = this.lessons(id); const list = kind === 'rule' ? l.rules : l.oneoffs; if (!(n >= 0 && n < list.length)) return false; list.splice(n, 1); this.writeLessons(id, l); return true; }

  /* ---------- deliverables: every finished job as a dated note ---------- */
  /** Write a finished ticket as <brain>/Nightdesk/deliverables/YYYY-MM-DD HHmm <title>.md; returns the brain-relative path. */
  writeDeliverable({ ticket, desk, deptName = '', tz = 'Europe/London', text }) {
    if (!this.root || !fs.existsSync(this.root)) return '';
    const d = new Date(); const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
    const slug = String(ticket.title || 'job').replace(/[\\/:*?"<>|#^\[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70) || 'job';
    const dir = path.join(this.root, 'Nightdesk', 'deliverables');
    fs.mkdirSync(dir, { recursive: true });
    let name = `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}${p.minute} ${slug}.md`; let n = 2;
    while (fs.existsSync(path.join(dir, name))) name = name.replace(/( \(\d+\))?\.md$/, ` (${n++}).md`);
    const tools = [...new Set((ticket.calls || []).map(c => `${c.server}.${c.tool}`))];
    const meta = [
      `desk: ${desk?.name || ticket.agent} (${ticket.agent})${deptName ? ` · department: ${deptName}` : ''}`,
      `ticket: ${ticket.id} · asked by: ${ticket.by}${ticket.routine ? ` · routine: ${ticket.routine}` : ''}${ticket.workflow ? ` · workflow: ${ticket.workflow}` : ''}${ticket.parent ? ` · part of: ${ticket.parent}` : ''}`,
      `finished: ${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}${ticket.model ? ` · model: ${ticket.model}` : ''}${ticket.effort ? ` · effort: ${ticket.effort}` : ''}${ticket.lane ? ` · ${ticket.lane}/${ticket.engine || ''}` : ''}${ticket.costUsd ? ` · $${(+ticket.costUsd).toFixed(3)}` : ''}`,
      ticket.approvedAt ? `approved by the owner: ${new Date(ticket.approvedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '',
      tools.length ? `tools: ${tools.join(', ')}` : '',
    ].filter(Boolean);
    const reads = (ticket.reads || []).map(r => `[[${String(r).replace(/\.md$/, '')}]]`);
    const body = [`# ${ticket.title || 'job'}`, '', ...meta, '', '---', '', String(text || '').trim(), '', '---', reads.length ? `Read: ${reads.join(' · ')}` : 'Read: no notes picked', ''].join('\n');
    fs.writeFileSync(path.join(dir, name), body);
    return `Nightdesk/deliverables/${name}`;
  }

  /** A skill: <brain>/skills/<name>/SKILL.md (or <brain>/Nightdesk/skills). */
  skill(name) {
    for (const dir of ['skills', 'Nightdesk/skills']) {
      const f = path.join(this.root, dir, name, 'SKILL.md');
      try { return fs.readFileSync(f, 'utf8'); } catch {}
    }
    return '';
  }
  skills() {
    const out = new Set();
    for (const dir of ['skills', 'Nightdesk/skills']) { try { for (const e of fs.readdirSync(path.join(this.root, dir), { withFileTypes: true })) if (e.isDirectory() && fs.existsSync(path.join(this.root, dir, e.name, 'SKILL.md'))) out.add(e.name); } catch {} }
    return [...out].sort();
  }
  /** The live numbers, if the stats file is there. */
  stats(file) {
    try { return JSON.parse(fs.readFileSync(file || path.join(this.root, '00-Meta', 'stats.json'), 'utf8')); } catch { return null; }
  }
  statsText(file) {
    const s = this.stats(file); if (!s) return '';
    const lines = [];
    const r = s.rows || {};
    if (Array.isArray(r)) lines.push(r.map(x => `${x.label || x.key}: ${x.value}${x.sub ? ` (${x.sub})` : ''}`).join('; '));
    else for (const [dept, rows] of Object.entries(r)) lines.push(`${dept}: ` + (Array.isArray(rows) ? rows.map(x => Array.isArray(x) ? `${x[0]} ${x[1]}` : `${x.label || x.key} ${x.value}`).join(', ') : String(rows)));
    if (s.ads && typeof s.ads === 'object') { const a = s.ads; lines.push(`ads: ${Object.entries(a).filter(([k, v]) => typeof v !== 'object').map(([k, v]) => `${k} ${v}`).join(', ')}`); }
    return `### stats (refreshed ${s.updatedAt || '?'}${s.stale ? ', STALE' : ''})\n${lines.join('\n')}${s.errors && s.errors.length ? `\nerrors: ${s.errors.join('; ')}` : ''}`;
  }
  /** Append dated text to a note the desk is allowed to write (newest first under the first heading). */
  append(rel, text, { newestFirst = true } = {}) {
    const x = this.note(rel); if (!x) throw new Error(`no such note: ${rel}`);
    const cur = fs.readFileSync(x.file, 'utf8');
    let out;
    if (newestFirst) { const m = cur.match(/^(#[^\n]*\n(?:[^\n]*\n)?)/); out = m ? cur.replace(m[1], m[1] + '\n' + text.trim() + '\n') : text.trim() + '\n\n' + cur; }
    else out = cur.replace(/\s*$/, '\n\n') + text.trim() + '\n';
    fs.writeFileSync(x.file, out); this.indexedAt = 0;
    return x.rel;
  }
}
