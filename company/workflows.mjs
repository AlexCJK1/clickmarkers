// Workflows: named chains of desks, run as ordered child tickets under one parent that wraps them.
// The deterministic sibling of delegation: the owner (or the chief of staff) names the workflow and the
// topic, the office lays out the tickets with their "after" links, and the wrap-up run joins the ends.
//
// workflows.json: { "new-post": { "title": "New post: {topic}", "owner": "mlead", "steps": [
//   { "id": "words", "agent": "newt", "title": "Words for {topic}", "text": "…{topic}…" },
//   { "id": "check", "agent": "comply", "after": ["words"], "text": "…" },
//   { "id": "render", "agent": "gfx", "after": ["check"], "text": "…", "needsOk": false } ] } }
// {topic} and {input} are filled from the request; "after" names earlier step ids.
import fs from 'node:fs';
import { emit } from '../core/events.mjs';
import { routable } from './model.mjs';

export class Workflows {
  constructor(file) { this.file = file; this.load(); }
  load() { try { this.map = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')); this.mtime = fs.statSync(this.file).mtimeMs; } catch { this.map = this.map || {}; } return this; }
  reloadIfChanged() { try { if (fs.statSync(this.file).mtimeMs !== this.mtime) this.load(); } catch {} }
  names() { return Object.keys(this.map); }
  get(name) { return this.map[name] || null; }
  /** "workflow: new-post, topic: the spring offer" or "new-post: the spring offer" → { name, topic } or null. */
  parse(text) {
    const t = String(text || '').trim();
    let m = t.match(/^workflow:\s*([a-z0-9-]+)(?:\s*[,:]?\s*(?:topic:\s*)?(.*))?$/is);
    if (m && this.get(m[1])) return { name: m[1], topic: (m[2] || '').trim() };
    m = t.match(/^([a-z0-9-]+):\s*(.+)$/is);
    if (m && this.get(m[1])) return { name: m[1], topic: m[2].trim() };
    return null;
  }
  /** Lay the tickets out. Returns the parent ticket. */
  run(office, name, topic, { by = 'owner' } = {}) {
    const w = this.get(name); if (!w) throw new Error(`no workflow called ${name}`);
    const fill = s => String(s || '').replace(/\{topic\}/g, topic).replace(/\{input\}/g, topic);
    // A desk that takes no jobs cannot own a workflow or hold a step. The owner falls back to the chief; a step is
    // refused before anything is laid out, so a bad file never leaves half a chain on the board.
    for (const step of w.steps || []) { const s = office.company.agent(step.agent); if (s && !routable(s)) throw new Error(`workflow ${name}: ${s.name} takes no jobs`); }
    const owner = office.company.taker(w.owner);
    const parent = office.tickets.create({ title: fill(w.title || `${name}: {topic}`), text: fill(w.text || `Workflow ${name} on: {topic}. The steps run as your child tickets; wrap their results when they finish.`), dept: owner.dept, agent: owner.id, by, needsOk: w.needsOk ?? owner.outbound ?? false, state: 'blocked', phase: 'draft', workflow: name });
    const ids = {};
    for (const step of w.steps || []) {
      const a = office.company.agent(step.agent); if (!a) throw new Error(`workflow ${name}: no desk ${step.agent}`);
      const after = (step.after || []).map(k => ids[k]).filter(Boolean);
      const t = office.tickets.create({ title: fill(step.title || `${a.name}: {topic}`), text: fill(step.text), dept: a.dept, agent: a.id, parent: parent.id, by: `workflow:${name}`, needsOk: step.needsOk ?? a.outbound, model: step.model || '', engine: step.engine || '', after, priority: 1 });
      ids[step.id || a.id] = t.id;
    }
    office.tickets.update(parent.id, { draft: `Workflow ${name} laid out: ${Object.keys(ids).join(' → ')}.` });
    emit('workflow', { name, parent: parent.id, steps: Object.values(ids) });
    office.kick();
    return office.tickets.get(parent.id);
  }
  view() { return Object.entries(this.map).map(([name, w]) => ({ name, title: w.title, owner: w.owner || 'chief', steps: (w.steps || []).map(s => `${s.id || s.agent} (${s.agent})${s.after ? ' after ' + s.after.join(',') : ''}`) })); }
}
