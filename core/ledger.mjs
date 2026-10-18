// The spend ledger. One line per run: who ran, which engine, which model, what it cost in USD (the SDK's
// own figure, close enough for a daily cap; the Anthropic Console is the invoice). estUsd carries the same
// figure, and the estimate for lines with no bill of their own.
//
// Budgets: a daily ceiling for the whole office and a daily budget per desk. When one is reached, the
// office starts no more runs for it until midnight (the jobs wait). A per-run cap bounds a runaway run.
import path from 'node:path';
import { jsonl } from './store.mjs';
import { dayKey } from './clock.mjs';

export class Ledger {
  constructor({ dir, tz = 'Europe/London', ceilingUsd = 13, perRunUsd = 1, defaultAgentUsd = 2, gbpPerUsd = 0.75 }) {
    this.tz = tz; this.ceilingUsd = ceilingUsd; this.perRunUsd = perRunUsd; this.defaultAgentUsd = defaultAgentUsd; this.gbpPerUsd = gbpPerUsd;
    this.file = jsonl(path.join(dir, 'ledger.jsonl'));
    this.rows = this.file.readAll();
  }
  record(row) {
    const r = { at: Date.now(), day: dayKey(Date.now(), this.tz), usd: 0, estUsd: 0, ...row };
    r.usd = round(r.usd); r.estUsd = round(r.estUsd);
    this.rows.push(r); this.file.append(r);
    return r;
  }
  /** Totals for one day (default today): overall, per desk, per lane (older ledgers may hold other lanes). */
  day(key = dayKey(Date.now(), this.tz)) {
    const out = { day: key, usd: 0, estUsd: 0, runs: 0, byAgent: {}, byLane: { api: 0 }, runsByLane: { api: 0 } };
    for (const r of this.rows) {
      if (r.day !== key) continue;
      out.usd += r.usd; out.estUsd += r.estUsd; out.runs++;
      out.byAgent[r.agent] = round((out.byAgent[r.agent] || 0) + r.usd);
      if (r.lane) { out.byLane[r.lane] = round((out.byLane[r.lane] || 0) + (r.lane === 'api' ? r.usd : r.estUsd)); out.runsByLane[r.lane] = (out.runsByLane[r.lane] || 0) + 1; }
    }
    out.usd = round(out.usd); out.estUsd = round(out.estUsd);
    return out;
  }
  days(n = 7) {
    const keys = [...new Set(this.rows.map(r => r.day))].sort().slice(-n);
    return keys.map(k => this.day(k));
  }
  /** How much API money a desk may still spend today, and why it might be none. */
  room(agentId, budgetUsd = this.defaultAgentUsd) {
    const t = this.day();
    const office = round(this.ceilingUsd - t.usd);
    const desk = round(budgetUsd - (t.byAgent[agentId] || 0));
    const cap = round(Math.max(0, Math.min(this.perRunUsd, office, desk)));
    let reason = '';
    if (office <= 0) reason = `daily ceiling reached ($${this.ceilingUsd})`;
    else if (desk <= 0) reason = `desk budget spent ($${budgetUsd} today)`;
    return { cap, office, desk, reason };
  }
  gbp(usd) { return round(usd * this.gbpPerUsd); }
  recent(n = 50) { return this.rows.slice(-n).reverse(); }
}
const round = x => Math.round((+x || 0) * 10000) / 10000;
