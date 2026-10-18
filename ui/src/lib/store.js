// The one store. One SSE connection to the office, periodic fetches, and a plain state object that
// React reads through selectors (useOffice) and the Three.js floor reads directly. Every panel, 2D or
// 3D, is a consumer of this; nothing else talks to the API.
import { useRef, useSyncExternalStore } from 'react';
import { buildWatcher } from './build.js';

const api = (p, body) =>
  fetch(
    p,
    body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined,
  ).then(r => r.json());
const put = (p, body) =>
  fetch(p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r =>
    r.json(),
  );

const seeBuild = buildWatcher(); // reloads the page once when the office is a newer build than this page
const WIRE_MAX = 600;
const state = {
  ready: false,
  online: true,
  company: null, // { name, business, mission, departments, tree }
  desks: [], // flat list: { id, name, role, dept, model, paused, outbound, budgetUsd, tools, reports: [ids], lead: bool }
  health: null,
  tickets: [],
  stats: null,
  ledger: null, // { ceilingUsd, today, days, recent }
  series: null, // { days, total, est, runs, byAgent }
  connectors: [],
  probing: false, // a connector check is running
  routines: [],
  workflows: [],
  wire: [], // events, oldest first
  lastLine: {}, // deskId → { text, at, type }
  running: {}, // deskId → ticket id
  waiting: {}, // deskId → count
  failed: {}, // deskId → true when the desk's latest ticket failed
  pulses: [], // { id, from, to, kind, at } recent filament pulses (consumed by the floor)
  selected: null, // desk id in focus (deck open)
  hovered: null, // desk id under the pointer
  drawer: null, // the open sheet: 'intray' | 'ledger' | 'routines' | 'board' | 'numbers' | 'calendar' | 'brain' | 'help' | null
  seq: 0,
};
const listeners = new Set();
let snapshot = { ...state };
function set(patch) {
  Object.assign(state, patch);
  snapshot = { ...state };
  for (const fn of listeners) fn();
}
export const getState = () => snapshot;
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const same = (a, b) => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a),
      kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => a[k] === b[k]);
  }
  return false;
};
/** Select a slice of the store. The result is cached per snapshot so React sees a stable value, and a
 *  freshly built array or object that shallow-equals the last one keeps the old identity (no re-render). */
export function useOffice(selector = s => s) {
  const ref = useRef(null);
  if (!ref.current) ref.current = { snap: null, selector: null, value: undefined };
  const get = () => {
    const r = ref.current;
    if (r.snap !== snapshot || r.selector !== selector) {
      const v = selector(snapshot);
      r.snap = snapshot;
      r.selector = selector;
      if (!same(v, r.value)) r.value = v;
    }
    return r.value;
  };
  return useSyncExternalStore(subscribe, get, get);
}

/* ---------- derived ---------- */
// desk names are stored in capitals (they double as job prefixes); the page shows them in sentence case
import { displayName, tidyTitle } from './format.js';
export { displayName, tidyTitle };
function flatten(company) {
  const out = [];
  const leads = new Set((company.departments || []).map(d => d.lead));
  const walk = (n, parent) => {
    out.push({
      id: n.id,
      name: displayName(n.name),
      role: n.role,
      dept: n.dept,
      model: n.model,
      paused: n.paused,
      outbound: n.outbound,
      budgetUsd: n.budgetUsd,
      tools: n.tools || [],
      reportsTo: parent,
      reports: (n.reports || []).map(r => r.id),
      lead: leads.has(n.id) || !parent,
    });
    (n.reports || []).forEach(r => walk(r, n.id));
  };
  (company.tree || []).forEach(n => walk(n, null));
  return out;
}
function deriveFromTickets(tickets, health) {
  const running = {};
  for (const r of health?.running || []) running[r.agent] = r.ticket;
  const waiting = {};
  for (const t of tickets) if (t.state === 'waiting') waiting[t.agent] = (waiting[t.agent] || 0) + 1;
  // a desk shows "failed" until its next ticket moves on: the newest ticket per desk decides
  const latest = {};
  for (const t of tickets)
    if (!latest[t.agent] || (t.updatedAt || 0) > (latest[t.agent].updatedAt || 0)) latest[t.agent] = t;
  const failed = {};
  for (const [id, t] of Object.entries(latest)) if (t.state === 'failed') failed[id] = true;
  return { running, waiting, failed };
}

/* ---------- loading ---------- */
export async function loadAll() {
  const [company, health, tickets, stats, ledger, series, connectors, routines, workflows] = await Promise.all([
    api('/api/company'),
    api('/api/health'),
    api('/api/tickets?n=200'),
    api('/api/stats').catch(() => null),
    api('/api/ledger?days=14'),
    api('/api/ledger/series?days=14'),
    api('/api/connectors'),
    api('/api/routines'),
    api('/api/workflows'),
  ]);
  seeBuild(health?.build);
  const desks = flatten(company);
  set({
    ready: true,
    online: true,
    company,
    desks,
    health,
    tickets,
    stats,
    ledger,
    series,
    connectors,
    routines,
    workflows,
    ...deriveFromTickets(tickets, health),
  });
}
let refreshTimer = null;
export function refreshSoon(ms = 350) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      const [health, tickets] = await Promise.all([api('/api/health'), api('/api/tickets?n=200')]);
      seeBuild(health?.build);
      set({ health, tickets, online: true, ...deriveFromTickets(tickets, health) });
    } catch {
      set({ online: false });
    }
  }, ms);
}
export async function refreshRoutines() {
  try {
    set({ routines: await api('/api/routines') });
  } catch {
    // the office is restarting: the next event refreshes the list
  }
}
async function refreshSlow() {
  try {
    const [stats, ledger, series, connectors] = await Promise.all([
      api('/api/stats').catch(() => null),
      api('/api/ledger?days=14'),
      api('/api/ledger/series?days=14'),
      api('/api/connectors'),
    ]);
    set({ stats, ledger, series, connectors, online: true });
  } catch {
    set({ online: false });
  }
}

/* ---------- the wire ---------- */
let es = null,
  lastSeq = 0;
export function connect() {
  if (es) es.close();
  es = new EventSource('/api/events?since=' + lastSeq);
  es.onmessage = ev => {
    let e;
    try {
      e = JSON.parse(ev.data);
    } catch {
      return;
    }
    lastSeq = Math.max(lastSeq, e.seq || 0);
    absorb(e);
  };
  es.onerror = () => {
    set({ online: false });
    es.close();
    es = null;
    setTimeout(connect, 3000);
  };
}
const PULSE_TYPES = {
  delegate: 'delegate',
  call: 'call',
  intake: 'intake',
  approval: 'approval',
  workflow: 'workflow',
};
function absorb(e) {
  const patch = {};
  // the same event twice (a stream that reconnects and replays) is kept once; only a whole-event match
  // counts, since two processes can give different events the same seq, time and type
  const same = x => x.seq === e.seq && x.type === e.type && x.at === e.at && JSON.stringify(x) === JSON.stringify(e);
  if (e.type !== 'ticket' && !state.wire.slice(-200).some(same)) {
    const wire = state.wire.length >= WIRE_MAX ? state.wire.slice(-WIRE_MAX + 1) : state.wire.slice();
    wire.push(e);
    patch.wire = wire;
  }
  if (e.agent && (e.type === 'say' || e.type === 'run' || e.type === 'call' || e.type === 'deny')) {
    const text =
      e.type === 'say'
        ? e.text
        : e.type === 'call'
          ? `${e.server}.${e.tool}`
          : e.type === 'deny'
            ? `refused ${e.tool}`
            : stageText(e);
    if (text) patch.lastLine = { ...state.lastLine, [e.agent]: { text, at: e.at, type: e.type, stage: e.stage } };
  }
  if (e.type === 'run' && e.stage === 'start') patch.running = { ...state.running, [e.agent]: e.ticket };
  if (e.type === 'run' && ['done', 'failed', 'waiting', 'blocked'].includes(e.stage)) {
    const r = { ...state.running };
    delete r[e.agent];
    patch.running = r;
  }
  if (PULSE_TYPES[e.type] || (e.type === 'run' && (e.stage === 'done' || e.stage === 'waiting'))) {
    const p = pulseFor(e);
    if (p) patch.pulses = [...state.pulses.filter(x => Date.now() - x.at < 15000), p];
  }
  set(patch);
  if (['ticket', 'run', 'approval', 'board', 'lane', 'intake', 'workflow', 'delegate'].includes(e.type)) refreshSoon();
  if (e.type === 'spend' || e.type === 'connector' || e.type === 'stats') refreshSlow();
  if (e.type === 'routine') refreshRoutines();
}
function stageText(e) {
  const m = {
    start: 'working',
    booted: `booted in ${Math.round((e.bootMs || 0) / 1000)} s${e.strict === false ? ' (full setup)' : ''}`,
    done: `done${e.ms ? ' in ' + Math.round(e.ms / 1000) + ' s' : ''}${e.usd ? ' · $' + e.usd.toFixed(3) : ''}`,
    failed: `failed: ${e.error || ''}`,
    waiting: 'draft waiting for your OK',
    blocked: 'waiting on delegated work',
    'waiting for room': `waiting: ${e.why || 'no room on the API'}`,
    retry: `retrying (${e.error || ''})`,
    'wrap-ready': 'wrapping up',
  };
  return m[e.stage] || e.stage;
}
function pulseFor(e) {
  const id = `${e.seq}`;
  if (e.type === 'delegate') return { id, from: e.from, to: e.to, kind: 'delegate', at: Date.now() };
  if (e.type === 'call') return { id, from: e.agent, to: `conn:${e.server}`, kind: 'call', at: Date.now() };
  if (e.type === 'intake')
    return {
      id,
      from: e.by === 'telegram' ? 'phone' : e.by === 'routine' ? 'clock' : 'owner',
      to: e.agent,
      kind: 'intake',
      at: Date.now(),
    };
  if (e.type === 'approval')
    return { id, from: 'owner', to: e.agent || null, kind: 'approval', at: Date.now(), ticket: e.ticket };
  if (e.type === 'run' && e.stage === 'done') return { id, from: e.agent, to: 'owner', kind: 'done', at: Date.now() };
  if (e.type === 'run' && e.stage === 'waiting')
    return { id, from: e.agent, to: 'owner', kind: 'waiting', at: Date.now() };
  return null;
}

/* ---------- actions ---------- */
export const actions = {
  select: id => set({ selected: id, drawer: null }),
  hover: id => {
    if (state.hovered !== id) set({ hovered: id });
  },
  drawer: name =>
    set({
      drawer: state.drawer === name ? null : name,
      selected: name ? null : state.selected,
    }),
  submit: (text, agent, opts = {}) =>
    api('/api/tickets', {
      text,
      agent: agent || undefined,
      model: opts.model || undefined,
      effort: opts.effort || undefined,
      at: opts.at || undefined,
    }),
  parseAt: text => api('/api/when', { text }),
  parseWhen: text => api('/api/routines/parse', { text }),
  addRoutine: r =>
    api('/api/routines', r).then(async x => {
      await refreshRoutines();
      return x;
    }),
  editRoutine: (id, patch) =>
    api(`/api/routines/${id}`, patch).then(async x => {
      await refreshRoutines();
      return x;
    }),
  runRoutine: id => api(`/api/routines/${id}/run`, {}),
  pauseRoutine: (id, on) =>
    api(`/api/routines/${id}/${on ? 'pause' : 'resume'}`, {}).then(async x => {
      await refreshRoutines();
      return x;
    }),
  deleteRoutine: id =>
    fetch(`/api/routines/${id}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(async x => {
        await refreshRoutines();
        return x;
      }),
  refreshStats: () =>
    api('/api/stats/refresh', {}).then(async r => {
      if (r.stats) set({ stats: r.stats });
      return r;
    }),
  chatHistory: id => api(`/api/chat/${id}`),
  chat: (id, text) => api(`/api/chat/${id}`, { text }),
  clearChat: id => fetch(`/api/chat/${id}`, { method: 'DELETE' }).then(r => r.json()),
  removeLesson: (id, kind, n) =>
    fetch(`/api/agents/${id}/lessons/${kind}/${n}`, { method: 'DELETE' }).then(r => r.json()),
  calendar: (from, to) => api(`/api/calendar?from=${from}&to=${to}`),
  brainGraph: (refresh = false) => api(`/api/brain/graph${refresh ? '?refresh=1' : ''}`),
  brainNote: rel => api(`/api/brain/note?rel=${encodeURIComponent(rel)}`),
  // resolves to { error } when the office refuses or does not answer, so the button can say so
  checkConnectors: async () => {
    set({ probing: true });
    try {
      const r = await api('/api/connectors/probe', { keys: 'used' });
      if (Array.isArray(r)) {
        set({ connectors: r });
        return r;
      }
      return { error: r?.error || 'The office did not run the check.' };
    } catch {
      return { error: 'The office did not answer. Try again.' };
    } finally {
      set({ probing: false });
    }
  },
  reply: (id, text) => api(`/api/tickets/${id}/reply`, { text }),
  approve: (id, hash) => api(`/api/tickets/${id}/approve`, { hash }), // hash: the draft the drawer shows (ticket.draftHash); the office refuses an OK for any other
  reject: (id, note) => api(`/api/tickets/${id}/reject`, { note }),
  retry: id => api(`/api/tickets/${id}/retry`, {}),
  cancel: id => api(`/api/tickets/${id}/cancel`, {}),
  pauseDesk: (id, on) =>
    api(`/api/agents/${id}/${on ? 'pause' : 'resume'}`, {}).then(r => {
      loadAll();
      return r;
    }),
  pauseOffice: on => api(on ? '/api/office/pause' : '/api/office/resume', {}),
  ticket: id => api(`/api/tickets/${id}`),
  agent: id => api(`/api/agents/${id}`),
  saveAgent: (id, patch) =>
    put(`/api/agents/${id}`, patch).then(async r => {
      await loadAll();
      return r;
    }),
  workflow: (name, topic) => api('/api/workflows', { name, topic }),
  probe: keys => api('/api/connectors/probe', { keys }),
  apiUp: () => api('/api/lanes/api/up', {}),
};

export function start() {
  if (import.meta.env.DEV || /\bdebug\b/.test(location.search))
    window.clickmarkers = { getState, actions, absorb, loadAll };
  loadAll()
    .then(connect)
    .catch(() => {
      set({ online: false });
      setTimeout(start, 3000);
    });
  setInterval(refreshSlow, 60000);
  setInterval(() => refreshSoon(0), 30000);
}

/* ---------- helpers for panels ---------- */
export const deskStatus = (s, id) => {
  const d = s.desks.find(x => x.id === id);
  if (!d) return 'idle';
  if (d.paused) return 'paused';
  if (s.running[id]) return 'working';
  if (s.waiting[id]) return 'waiting';
  if (s.failed?.[id]) return 'failed';
  return 'idle';
};
export const deskName = (s, id) => s.desks.find(x => x.id === id)?.name || id;
export const fmtUsd = (x, d = 2) => `$${(+x || 0).toFixed(d)}`;
export const fmtTime = ts =>
  new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
