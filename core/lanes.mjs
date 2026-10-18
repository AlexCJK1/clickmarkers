// The lane: whether a run may go on the API now, and with what cap. Every run is billed to the owner's
// Anthropic API key (products built on the Agent SDK may not run on a Claude subscription). There is no
// room when: no key, the API is resting after a billing or auth failure, the office has reached its daily
// ceiling, or the desk its budget. The first means nothing can run until a key is set; the others pass
// (the rest ends, or midnight comes), so a ticket waits instead of failing.
import { secret } from './secrets.mjs';
import { emit, log } from './events.mjs';

export class Lanes {
  constructor({ apiCooldownMin = 30, ledger }) {
    this.cooldownMs = apiCooldownMin * 60000;
    this.ledger = ledger;
    this.apiDownUntil = 0;
    this.apiDownWhy = '';
  }
  get apiKey() {
    return secret('ANTHROPIC_API_KEY');
  }
  /** Can this desk run on the API now? Returns { lane: 'api', reason, capUsd } or { lane: '', reason, wait }. */
  pick(agent) {
    if (!this.apiKey) return { lane: '', reason: 'no ANTHROPIC_API_KEY in the secrets file', wait: false, capUsd: 0 };
    if (Date.now() < this.apiDownUntil)
      return { lane: '', reason: `the API is resting after "${this.apiDownWhy}"`, wait: true, capUsd: 0 };
    const room = this.ledger.room(agent.id, agent.budgetUsd);
    if (room.cap <= 0) return { lane: '', reason: room.reason || 'no room left today', wait: true, capUsd: 0 };
    return { lane: 'api', reason: 'api', capUsd: room.cap };
  }
  /** The API answered with a billing or auth problem: rest it for a while. */
  apiDown(why) {
    this.apiDownUntil = Date.now() + this.cooldownMs;
    this.apiDownWhy = why;
    log.warn(`the API is resting for ${this.cooldownMs / 60000} min: ${why}`);
    emit('lane', { lane: 'api', state: 'down', why, until: this.apiDownUntil });
  }
  apiUp() {
    if (this.apiDownUntil) emit('lane', { lane: 'api', state: 'up' });
    this.apiDownUntil = 0;
    this.apiDownWhy = '';
  }
  state() {
    return {
      apiKey: !!this.apiKey,
      apiDown: Date.now() < this.apiDownUntil ? { why: this.apiDownWhy, until: this.apiDownUntil } : null,
    };
  }
}

/** Is this error (text or result) the API telling us it will not serve? */
export function classifyApiError(text = '', status = null) {
  const t = String(text).toLowerCase();
  if (/credit balance|billing|payment|insufficient funds|purchase credits/.test(t)) return 'billing';
  if (
    /invalid api key|authentication|unauthori[sz]ed|disabled organization|api key.*(invalid|revoked)/.test(t) ||
    status === 401 ||
    status === 403
  )
    return 'auth';
  if (status === 402) return 'billing';
  if (/rate limit|overloaded|529|too many requests/.test(t) || status === 429 || status === 529) return 'rate';
  return '';
}
