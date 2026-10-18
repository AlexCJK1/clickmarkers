// Tickets: the unit of work. Everything a desk does starts as a ticket and ends as a result on it.
//
// States: scheduled (booked for a time; becomes next when it comes) · inbox (needs routing) → next (assigned, queued) → doing → done | failed
//         doing → waiting (a draft that needs the owner's OK) → doing (approved) → done
//         waiting → next (rejected with a note, re-drafted)
//         doing → next (the evaluations desk found a fault and sent the draft back to the same desk, up to maxRounds checks)
//         doing → blocked (waiting on child tickets) → next (children done, wrap-up run)
//         any → cancelled
// Phases of a run: draft (do the work, outbound steps written up under AFTER YOUR OK), execute (the
// owner said yes, do the outbound steps), wrap (children finished, pull their results together).
import path from 'node:path';
import { createHash } from 'node:crypto';
import { jsonFile, jsonl, nid } from '../core/store.mjs';
import { emit } from '../core/events.mjs';
import { evalLine } from './evals.mjs';

/** The short fingerprint of a draft. The owner's OK is tied to it, so what is frozen is what he was shown. */
export const draftHash = s =>
  createHash('sha256')
    .update(String(s || ''))
    .digest('hex')
    .slice(0, 16);

export const STATES = ['scheduled', 'inbox', 'next', 'doing', 'waiting', 'blocked', 'done', 'failed', 'cancelled'];
const OPEN = new Set(['scheduled', 'inbox', 'next', 'doing', 'waiting', 'blocked']);
const KEEP = 400;
/** Why an approved run that the office lost is not run again. */
export const INTERRUPTED =
  'The office stopped while it was carrying out the approved steps, so some of them may have gone out. Check what was sent before you press Retry.'; // open plus the most recent closed tickets stay in the live file; the rest go to the archive

export class Tickets {
  constructor(dir) {
    this.store = jsonFile(path.join(dir, 'tickets.json'), { tickets: [] });
    this.archive = jsonl(path.join(dir, 'tickets-archive.jsonl'));
    this.list = this.store.read().tickets;
    this.recovered = [];
    for (const t of this.list) {
      if (t.state === 'doing' && t.checking && t.pendingDraft) {
        // The office stopped while the evaluations desk was checking this draft. The desk has done its work and been
        // paid: the candidate goes to the owner as it stands, marked unchecked, rather than being run again.
        t.state = 'waiting';
        t.draft = t.pendingDraft;
        t.eval = {
          verdict: 'unchecked',
          why: 'the office restarted during the check',
          rounds: t.evalRounds || 0,
          problems: [],
          autofixed: t.pendingFixed || [],
          notes: [],
          at: Date.now(),
        };
        t.evalProblems = [];
        t.evalDraft = '';
        t.pendingDraft = '';
        t.pendingFixed = [];
        t.checking = false;
        this.recovered.push(t.id);
        continue;
      }
      if (t.checking) {
        t.checking = false;
        t.pendingDraft = '';
        t.pendingFixed = [];
      }
      // An approved run that was cut off may have sent some of its steps already: it is never run again on its own.
      // It fails with a note, and the owner looks before pressing Retry. (A batched ticket keeps waiting for its answer.)
      if (t.state === 'doing' && t.engine !== 'batch' && t.phase === 'execute') {
        t.state = 'failed';
        t.error = INTERRUPTED;
      } else if (t.state === 'doing' && t.engine !== 'batch') {
        t.state = 'next';
        t.note = (t.note ? t.note + ' ' : '') + '(restarted: the office was stopped mid-run)';
      }
    }
    this.save();
  }
  save() {
    if (this.list.length > KEEP) {
      const closed = this.list.filter(t => !OPEN.has(t.state)).sort((a, b) => a.updatedAt - b.updatedAt);
      const drop = closed.slice(0, this.list.length - KEEP);
      for (const t of drop) this.archive.append(t);
      const ids = new Set(drop.map(t => t.id));
      this.list = this.list.filter(t => !ids.has(t.id));
    }
    this.store.write({ tickets: this.list });
  }
  get(id) {
    return this.list.find(t => t.id === id) || null;
  }
  all(filter = {}) {
    return this.list
      .filter(
        t =>
          (!filter.state ||
            (Array.isArray(filter.state) ? filter.state.includes(t.state) : t.state === filter.state)) &&
          (!filter.agent || t.agent === filter.agent) &&
          (!filter.parent || t.parent === filter.parent),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  open() {
    return this.list.filter(t => OPEN.has(t.state));
  }
  waiting() {
    return this.list.filter(t => t.state === 'waiting');
  }
  /** Booked jobs whose time has come (a late office runs each once). */
  dueScheduled(now = Date.now()) {
    return this.list.filter(t => t.state === 'scheduled' && (t.at || 0) <= now);
  }
  /** Oldest queued tickets whose desk is free and whose "after" tickets have closed. */
  nextUp(busyAgents = new Set(), limit = 1, now = Date.now()) {
    const closed = id => {
      const k = this.get(id);
      return !k || !OPEN.has(k.state);
    };
    // a job that waited for room on the API is not looked at again until its wait is over
    return this.list
      .filter(
        t =>
          t.state === 'next' &&
          t.agent &&
          !busyAgents.has(t.agent) &&
          !(t.waitUntil > now) &&
          (t.after || []).every(closed),
      )
      .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.updatedAt - b.updatedAt)
      .slice(0, limit);
  }
  create(fields) {
    const now = Date.now();
    const t = {
      id: nid(),
      title: '',
      text: '',
      dept: '',
      agent: '',
      parent: null,
      children: [],
      state: 'inbox',
      by: 'owner',
      needsOk: false,
      phase: 'draft',
      draft: '',
      result: '',
      note: '',
      comments: [],
      calls: [],
      lane: '',
      model: '',
      effort: '',
      at: 0,
      reads: [],
      engine: '',
      costUsd: 0,
      estUsd: 0,
      timings: {},
      routine: '',
      priority: 0,
      error: '',
      after: [],
      workflow: '',
      thread: '',
      eval: null,
      evalRounds: 0,
      evalProblems: [],
      evalDraft: '',
      runId: '',
      checking: false,
      pendingDraft: '',
      pendingFixed: [],
      createdAt: now,
      updatedAt: now,
      ...fields,
    };
    if (!t.title) t.title = String(t.text).split('\n')[0].slice(0, 90);
    if (t.agent && t.state === 'inbox') t.state = 'next';
    this.list.push(t);
    this.save();
    if (t.parent) {
      const p = this.get(t.parent);
      if (p && !p.children.includes(t.id)) {
        p.children.push(t.id);
      }
    }
    emit('ticket', { ticket: brief(t), change: 'created' });
    return t;
  }
  update(id, patch) {
    const t = this.get(id);
    if (!t) return null;
    const was = t.state;
    Object.assign(t, patch, { updatedAt: Date.now() });
    this.save();
    emit('ticket', {
      ticket: brief(t),
      change: patch.state && patch.state !== was ? `${was} → ${patch.state}` : 'updated',
    });
    return t;
  }
  comment(id, who, text) {
    const t = this.get(id);
    if (!t) return null;
    t.comments.push({ at: Date.now(), who, text: String(text).slice(0, 4000) });
    return this.update(id, {});
  }
  /** Earlier exchanges in a thread (closed tickets), oldest first. */
  thread(threadId, max = 6) {
    return threadId
      ? this.list
          .filter(t => t.thread === threadId && !OPEN.has(t.state))
          .sort((a, b) => a.updatedAt - b.updatedAt)
          .slice(-max)
      : [];
  }
  childrenDone(id) {
    const t = this.get(id);
    return (
      !!t &&
      t.children.length > 0 &&
      t.children.every(c => {
        const k = this.get(c);
        return k && !OPEN.has(k.state);
      })
    );
  }
  counts() {
    const c = {};
    for (const s of STATES) c[s] = 0;
    for (const t of this.list) c[t.state]++;
    return c;
  }
}

/** The light view the page and the phone get (no prompts, trimmed text). */
export function brief(t) {
  const {
    id,
    title,
    dept,
    agent,
    parent,
    children,
    state,
    by,
    needsOk,
    phase,
    lane,
    model,
    effort,
    at,
    engine,
    costUsd,
    estUsd,
    timings,
    routine,
    workflow,
    thread,
    createdAt,
    updatedAt,
    error,
    calls,
  } = t;
  return {
    id,
    title,
    dept,
    agent,
    parent,
    children,
    state,
    by,
    needsOk,
    phase,
    lane,
    model,
    effort,
    at,
    engine,
    costUsd,
    estUsd,
    timings,
    routine,
    workflow,
    thread,
    createdAt,
    updatedAt,
    error,
    calls: (calls || []).length,
    eval: t.eval || null,
    evalRounds: t.evalRounds || 0,
    evalProblems: t.evalProblems || [],
    evalLine: evalLine(t.eval),
    draftHash: t.state === 'waiting' ? draftHash(t.draft) : '',
    text: String(t.text).slice(0, 600),
    result: String(t.state === 'waiting' ? t.draft : t.result).slice(0, 6000),
    note: t.note,
    comments: t.comments,
  };
}
