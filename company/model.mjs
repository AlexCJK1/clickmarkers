// The company: mission, departments, the org chart and every desk's standing brief. One JSON file,
// read on start and re-read when it changes. A desk ("agent") is anything that can hold a ticket:
// the chief of staff, a department lead, a specialist, or a sub-agent a lead may call inside a run.
//
// agent fields: id, name (the sign on the door), role, dept, reportsTo, model (opus|sonnet|haiku or a
// full model id), engine (agent|oneshot|batch), tools (connector keys), web (WebSearch/WebFetch),
// office (office tool names this desk may call), team (ids of desks it may run as sub-agents),
// budgetUsd (per day), outbound (true when its tools can send or change things: drafts wait for the
// owner), paused (board control), routable (false: the desk never receives work; the router, a "NAME:"
// prefix, a routine, a workflow, a delegation or a team all skip it), does, brief.
import fs from 'node:fs';

export const MODELS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };
export const modelId = m => MODELS[m] || m || MODELS.opus;
/** Can a job be given to this desk? Every desk can unless its file says `routable: false` (the evaluations desk). */
export const routable = a => !!a && a.routable !== false;

export class Company {
  constructor(file, { defaultAgentUsd = 2 } = {}) { this.file = file; this.defaultAgentUsd = defaultAgentUsd; this.load(); }
  load() {
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^﻿/, ''));
    this.name = raw.name || 'Nightdesk';
    this.business = raw.business || '';
    this.mission = raw.mission || '';
    this.owner = raw.owner || { name: 'the owner' };
    this.rules = raw.rules || [];
    this.departments = raw.departments || [];
    this.chiefId = this.departments.find(d => d.id === 'exec')?.lead || raw.chief || 'cos';
    this.agents = new Map();
    for (const a of raw.agents || []) {
      const dept = this.departments.find(d => d.id === a.dept);
      this.agents.set(a.id, {
        model: 'opus', engine: 'agent', tools: [], web: false, office: ['brain_read', 'brain_append', 'ticket_note'], team: [], outbound: false, paused: false,
        budgetUsd: this.defaultAgentUsd, reportsTo: dept && dept.lead !== a.id ? dept.lead : (a.dept === 'exec' ? null : this.chiefId),
        ...a,
      });
    }
    this.mtime = fs.statSync(this.file).mtimeMs;
    return this;
  }
  reloadIfChanged() { try { if (fs.statSync(this.file).mtimeMs !== this.mtime) this.load(); } catch {} }
  agent(id) { return this.agents.get(id) || null; }
  /** The desk that takes what nobody else does: the exec department's lead. */
  chief() { return this.agent(this.chiefId) || null; }
  /** The desk a job addressed to `id` goes to: that desk, or the chief when it is missing or takes no jobs. */
  taker(id) { const a = this.agent(id); return routable(a) ? a : this.chief(); }
  dept(id) { return this.departments.find(d => d.id === id) || null; }
  lead(deptId) { const d = this.dept(deptId); return d ? this.agent(d.lead) : null; }
  /** Desks in a department, lead first. */
  desks(deptId) { const d = this.dept(deptId); return [...this.agents.values()].filter(a => a.dept === deptId).sort((a, b) => (a.id === d?.lead ? -1 : b.id === d?.lead ? 1 : 0)); }
  reports(id) { return [...this.agents.values()].filter(a => a.reportsTo === id); }
  chain(id) { const out = []; let a = this.agent(id); while (a && a.reportsTo && !out.includes(a.reportsTo)) { out.push(a.reportsTo); a = this.agent(a.reportsTo); } return out; }
  /** Find a desk by the name typed before a colon ("DESIGN: …", "ads: …"). */
  byName(s) {
    const k = String(s || '').trim().toLowerCase(); if (!k) return null;
    for (const a of this.agents.values()) if (a.id === k || a.name.toLowerCase() === k || a.role.toLowerCase() === k) return a;
    return null;
  }
  deptByWord(s) {
    const k = String(s || '').trim().toLowerCase(); if (!k) return null;
    for (const d of this.departments) if (d.id === k || d.name.toLowerCase() === k || (d.words || []).includes(k)) return d;
    return null;
  }
  /** The org chart as nested rows for the page. */
  chart() {
    const node = a => ({ id: a.id, name: a.name, role: a.role, dept: a.dept, model: a.model, effort: a.effort || '', paused: a.paused, outbound: a.outbound, budgetUsd: a.budgetUsd, tools: a.tools, reports: this.reports(a.id).map(node) });
    const roots = [...this.agents.values()].filter(a => !a.reportsTo);
    return { name: this.name, business: this.business, mission: this.mission, departments: this.departments, tree: roots.map(node) };
  }
  /** Change a desk's standing settings on disk (brief, model, budget, licence to send, connectors, web, paused). */
  save(id, patch) {
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''));
    const a = (raw.agents || []).find(x => x.id === id); if (!a) throw new Error(`no desk ${id}`);
    const allowed = ['brief', 'does', 'model', 'effort', 'budgetUsd', 'outbound', 'tools', 'web', 'paused', 'reads', 'skills', 'engine'];
    if (patch.model !== undefined && (/fable/i.test(patch.model) || !(['opus', 'sonnet', 'haiku'].includes(patch.model) || /^claude-|\//.test(patch.model)))) throw new Error(`model ${patch.model} is not allowed on a desk`);
    if (patch.effort !== undefined && !['', 'low', 'medium', 'high', 'xhigh', 'max'].includes(patch.effort)) throw new Error(`unknown effort ${patch.effort}`);
    for (const k of allowed) if (patch[k] !== undefined) a[k] = patch[k];
    if (a.effort === '') delete a.effort;
    if (typeof a.budgetUsd === 'string') a.budgetUsd = +a.budgetUsd;
    fs.writeFileSync(this.file, JSON.stringify(raw, null, 1) + '\n');
    this.load();
    return this.agent(id);
  }
  /**
   * The faults validate() reports that are errors, not warnings: a department lead or a team member that takes
   * no jobs. The office does not start on these (bin/nightdesk.mjs); a desk that takes no jobs must never be handed one.
   */
  fatal() { return this.validate().filter(x => /takes no jobs/.test(x)); }
  validate() {
    const out = [];
    for (const d of this.departments) {
      if (!this.agent(d.lead)) out.push(`department ${d.id}: lead "${d.lead}" is not an agent`);
      else if (!routable(this.agent(d.lead))) out.push(`department ${d.id}: lead "${d.lead}" takes no jobs (routable: false)`);
    }
    for (const a of this.agents.values()) {
      if (a.dept !== 'exec' && !this.dept(a.dept)) out.push(`agent ${a.id}: department "${a.dept}" does not exist`);
      if (a.reportsTo && !this.agent(a.reportsTo)) out.push(`agent ${a.id}: reportsTo "${a.reportsTo}" is not an agent`);
      for (const t of a.team || []) { if (!this.agent(t)) out.push(`agent ${a.id}: team member "${t}" is not an agent`); else if (!routable(this.agent(t))) out.push(`agent ${a.id}: team member "${t}" takes no jobs (routable: false)`); }
      if (!a.brief) out.push(`agent ${a.id}: no brief`);
    }
    if (!this.chief()) out.push(`no chief: the exec department's lead (${this.chiefId}) is not an agent`);
    return out;
  }
}
