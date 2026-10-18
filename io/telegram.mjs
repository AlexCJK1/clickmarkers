// The phone: a Telegram bot that is the owner's pocket office. Type a job and it becomes a ticket;
// results come back with any pictures or videos the desk made; drafts that need the OK arrive with
// APPROVE and REJECT; /waiting, /tasks, /pause, /resume, /help. Only the configured chat is obeyed.
// The token is read through secrets and never logged.
import fs from 'node:fs';
import path from 'node:path';
import { secret, redact } from '../core/secrets.mjs';
import { jsonFile } from '../core/store.mjs';
import { emit, log } from '../core/events.mjs';
import { transcribeLocal, available as voiceAvailable } from './transcribe.mjs';
import { parseAt, fmtAt } from '../core/when.mjs';
import { evalLine, afterOkAt, EVALS_ID } from '../company/evals.mjs';
import { draftHash } from '../company/tickets.mjs';
import { mediaFile } from '../core/media.mjs';

const API = 'https://api.telegram.org';
const MAX = 3500;
export const esc = s =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
export { mediaFile };
const clip = (s, n = MAX) => {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// A message is clipped by send() at LIMIT characters of the HTML as sent, so the room for a draft is counted escaped.
const LIMIT = 4000;
const PRE = '<pre></pre>'.length;
const MAX_STEP_MESSAGES = 6; // longer than this and the steps are for the page, not the phone
const escLen = s => esc(s).length;
/** `text` with the middle cut out, so that it is at most `room` characters once escaped. A marker says how much went. */
export function cutMiddle(text, room) {
  text = String(text || '');
  if (escLen(text) <= room) return text;
  const build = k => {
    const a = Math.ceil(k / 2),
      b = Math.floor(k / 2);
    return `${text.slice(0, a).trimEnd()}\n… (${text.length - a - b} characters cut; the full draft is on the page)\n${b ? text.slice(text.length - b).trimStart() : ''}`.trimEnd();
  };
  let lo = 0,
    hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (escLen(build(mid)) <= room) lo = mid;
    else hi = mid - 1;
  }
  return build(lo);
}
/** Cut a long text on its line ends into pieces of at most `room` characters once escaped (a line too long for one piece is split). */
export function pieces(text, room) {
  const out = [];
  let cur = '';
  const put = line => {
    const next = cur ? `${cur}\n${line}` : line;
    if (escLen(next) <= room) {
      cur = next;
      return;
    }
    if (cur) out.push(cur);
    cur = line;
  };
  for (let line of String(text || '').split('\n')) {
    while (escLen(line) > room) {
      let n = Math.min(line.length, room);
      while (escLen(line.slice(0, n)) > room) n--;
      put(line.slice(0, n));
      line = line.slice(n);
    }
    put(line);
  }
  if (cur) out.push(cur);
  return out;
}

export class Phone {
  constructor(office) {
    this.office = office;
    const t = office.cfg.telegram || {};
    this.token = secret('OFFICE_TELEGRAM_TOKEN');
    this.chat = String(secret('OFFICE_TELEGRAM_CHAT') || t.chatId || secret('TELEGRAM_CHAT_ID') || '');
    this.on = !!(this.token && this.chat) && t.enabled !== false;
    this.reason = !this.token
      ? 'OFFICE_TELEGRAM_TOKEN not set'
      : !this.chat
        ? 'OFFICE_TELEGRAM_CHAT not set'
        : t.enabled === false
          ? 'telegram.enabled is false'
          : 'on';
    this.state_ = jsonFile(path.join(office.cfg.data, 'phone.json'), {});
    this.pending = new Map();
    this.sent = new Map();
    this.offset = 0;
    this.stopped = false;
    this.me = '';
  }
  state() {
    return { on: this.on, reason: this.reason, chat: this.chat ? this.chat.slice(0, 3) + '…' : '', bot: this.me };
  }
  async call(method, body) {
    const res = await fetch(`${API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(`telegram ${method}: ${redact(String(j.description || res.status))}`);
    return j.result;
  }
  async send(text, extra = {}) {
    if (!this.on) return null;
    try {
      return await this.call('sendMessage', {
        chat_id: this.chat,
        text: clip(text, 4000),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...extra,
      });
    } catch (e) {
      log.warn('phone:', e.message);
      return null;
    }
  }

  /* ---------- outbound ---------- */
  /**
   * A draft that needs the OK. APPROVE covers the whole draft, so the owner must be shown the whole of what goes
   * out: the AFTER YOUR OK steps are always in full, and it is the prose above them that is cut (from its middle,
   * with a marker). Steps too long for one message go first in messages of their own; if they cannot be sent that
   * way either, the message carries no APPROVE button and points to the page. So does a cut draft in which no
   * AFTER YOUR OK heading is found (afterOkAt, the rule the rest of the office uses).
   */
  async notifyWaiting(t, agentName) {
    if (!this.on || !t) return;
    const checked = evalLine(t.eval, this.office.company.agent(EVALS_ID)?.name || 'EVALUATIONS'); // one line: checked, problems left, or not checked
    // when the steps would run once approved, so the owner sees it before he taps (a time it cannot read: no APPROVE)
    const runs = t.runs && t.runs.hash === draftHash(t.draft) ? t.runs : null;
    const when = runs?.error
      ? `⚠ APPROVE is refused: ${runs.error}. Send it back.\n`
      : runs?.at
        ? `⏱ Runs ${runs.when}, after your OK.\n`
        : runs?.posts
          ? `⏱ Runs on your OK; Facebook publishes the post ${runs.postsWhen}.\n`
          : runs?.held
            ? 'Goes out as soon as you approve.\n'
            : '';
    const head = `<b>⏸ WAITING FOR YOUR OK</b>\n<b>${esc(t.title)}</b> · ${esc(agentName || t.agent)}${t.routine ? ' · routine' : ''}\n${checked ? `<i>${esc(checked)}</i>\n` : ''}${esc(when)}\n`;
    const draft = String(t.draft || '');
    const at = afterOkAt(draft);
    const prose = at >= 0 ? draft.slice(0, at).trimEnd() : draft;
    const steps = at >= 0 ? draft.slice(at) : '';
    const room = LIMIT - head.length - PRE;
    let body;
    let approvable = !runs?.error;
    if (escLen(draft) <= room) body = draft;
    else if (!steps) {
      // cut, and no steps heading found: there may be steps in what is cut, so the owner is not offered an OK he cannot see the whole of
      approvable = false;
      const note = `This draft is ${draft.length} characters and has no AFTER YOUR OK heading the phone can find, so what is cut may hold steps. Read it on the page and approve there.`;
      body = `${cutMiddle(draft, room - escLen(note) - 2)}\n\n${note}`;
    } else if (escLen(steps) + 90 <= room) body = `${cutMiddle(prose, room - escLen(steps) - 2)}\n\n${steps}`;
    else {
      // the steps alone are more than a message holds: they go first, in messages of their own
      const label = (i, n) => `<b>AFTER YOUR OK (part ${i} of ${n})</b>\n`;
      const parts = pieces(steps, LIMIT - label(99, 99).length - PRE);
      let said = parts.length <= MAX_STEP_MESSAGES;
      for (let i = 0; said && i < parts.length; i++)
        said = !!(await this.send(`${label(i + 1, parts.length)}<pre>${esc(parts[i])}</pre>`));
      approvable = said;
      const note = said
        ? `The outbound steps (${steps.length} characters) are in the ${parts.length} messages above. APPROVE covers them.`
        : `The outbound steps (${steps.length} characters) are too long for the phone. Read them on the page and approve there.`;
      body = `${cutMiddle(prose, room - escLen(note) - 2)}\n\n${note}`;
    }
    const row = [
      ...(approvable ? [{ text: '✅ APPROVE', callback_data: `ok:${t.id}:${draftHash(t.draft)}` }] : []),
      { text: '↩ REJECT', callback_data: `no:${t.id}` },
    ];
    await this.send(`${head}<pre>${esc(body)}</pre>`, { reply_markup: { inline_keyboard: [row] } });
  }
  async notifyDone(t, agentName) {
    if (!this.on || !t) return;
    const tail = String(t.result || '')
      .split('AFTER YOUR OK')
      .pop()
      .trim();
    const m = await this.send(
      `<b>${t.error ? '✗' : '✓'} ${esc(t.title)}</b> · ${esc(agentName || t.agent)}\n<pre>${esc(clip(tail, 1500))}</pre>`,
    );
    if (m) this.remember(m.message_id, t.id);
  }
  remember(messageId, ticketId) {
    this.sent.set(messageId, ticketId);
    if (this.sent.size > 500) this.sent.delete(this.sent.keys().next().value);
  }
  async notifyResult(t, agentName) {
    if (!this.on || !t) return;
    const text = t.error ? `${t.error}` : String(t.result || '');
    const meta = [
      t.lane,
      t.engine,
      t.timings?.totalMs ? `${Math.round(t.timings.totalMs / 1000)}s` : '',
      t.costUsd ? `$${t.costUsd.toFixed(3)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const m = await this.send(
      `<b>${t.error ? '✗' : '✓'} ${esc(t.title)}</b> · ${esc(agentName || t.agent)}${meta ? `\n<i>${esc(meta)}</i>` : ''}\n<pre>${esc(clip(text, MAX - 160))}</pre>\n<i>reply to this message to carry on with ${esc(agentName || t.agent)}</i>`,
    );
    if (m) this.remember(m.message_id, t.id);
    await this.sendMedia(text);
  }
  /** Pictures and videos named in a result, if they sit under the media roots. */
  async sendMedia(text, caption = '') {
    if (!this.on) return;
    const roots = this.office.cfg.media.roots || [];
    if (!roots.length) return;
    const seen = new Set();
    const files = [];
    for (const m of String(text).matchAll(/(?:[A-Za-z]:\\|\/)[^\s"'<>|*?]+?\.(png|jpe?g|gif|mp4)\b/g)) {
      const f = m[0];
      if (!seen.has(f.toLowerCase())) {
        seen.add(f.toLowerCase());
        files.push(f);
      }
    }
    for (const f of files
      .map(x => mediaFile(x, roots))
      .filter(Boolean)
      .slice(0, 6)) {
      try {
        if (!fs.statSync(f).isFile()) continue;
        const video = /\.mp4$/i.test(f);
        const form = new FormData();
        form.set('chat_id', this.chat);
        form.set('caption', caption ? `${caption}\n${path.basename(f)}`.slice(0, 1000) : path.basename(f));
        form.set(video ? 'video' : 'photo', new Blob([fs.readFileSync(f)]), path.basename(f));
        const res = await fetch(`${API}/bot${this.token}/${video ? 'sendVideo' : 'sendPhoto'}`, {
          method: 'POST',
          body: form,
        });
        const j = await res.json().catch(() => ({}));
        if (!j.ok) log.warn('phone file:', redact(String(j.description || res.status)));
      } catch (e) {
        log.warn('phone file:', e.message);
      }
    }
  }

  /* ---------- inbound ---------- */
  async handle(u) {
    const o = this.office;
    if (u.callback_query) {
      const q = u.callback_query;
      const from = String(q.message?.chat?.id || q.from?.id || '');
      const answer = text => this.call('answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => {});
      if (from !== this.chat) return answer('Not your office.');
      const [verb, id, shown] = String(q.data || '').split(':');
      const t = o.tickets.get(id);
      if (!t) return answer('That ticket is gone.');
      if (t.state !== 'waiting')
        return answer(
          verb === 'ok'
            ? `Nothing was approved: it is not waiting any more (${t.state}).`
            : `Not waiting any more (${t.state}).`,
        );
      // APPROVE is tied to the draft on the message he tapped. If the ticket holds a different one now (a button from
      // before the change counts too), nothing is approved and the current draft is sent for a fresh look.
      const resend = async () => this.notifyWaiting(o.tickets.get(id), o.company.agent(t.agent)?.name);
      if (verb === 'ok' && shown !== draftHash(t.draft)) {
        await answer('That draft has changed. Read the new one.');
        await resend();
        return;
      }
      if (verb === 'ok') {
        // approve first, then say so: the answer reports what happened, not what was asked
        let done = null;
        try {
          done = o.approve(id, shown);
        } catch (e) {
          if (e.code !== 'stale') return answer(String(e.message).slice(0, 190));
          await answer('That draft changed. Nothing was approved.');
          await resend();
          return;
        }
        if (!done) {
          const now = o.tickets.get(id);
          return answer(`Nothing was approved: it is not waiting any more (${now ? now.state : 'gone'}).`);
        }
        const booked = o.tickets.get(id)?.state === 'scheduled' ? o.tickets.get(id).at : 0;
        await answer(booked ? `Approved. It runs ${fmtAt(booked, o.cfg.timezone)}.` : 'Approved. Sending.');
        await this.call('editMessageReplyMarkup', {
          chat_id: this.chat,
          message_id: q.message.message_id,
          reply_markup: { inline_keyboard: [] },
        }).catch(() => {});
        await this.send(
          booked
            ? `✅ Approved <b>${esc(t.title)}</b>. It waits and runs ${esc(fmtAt(booked, o.cfg.timezone))}; cancel it on the board to stop it.`
            : `✅ Approved <b>${esc(t.title)}</b>. The desk is doing the outbound step now.`,
        );
      } else if (verb === 'no') {
        await answer('Reply with what should change.');
        const m = await this.send(
          `↩ <b>${esc(t.title)}</b>: reply to THIS message with what should change (or "no" to send it back with no note).`,
          { reply_markup: { force_reply: true, selective: true } },
        );
        if (m) this.pending.set(m.message_id, id);
      }
      return;
    }
    const msg = u.message;
    if (!msg || String(msg.chat?.id) !== this.chat) return;
    let text = String(msg.text || msg.caption || '').trim();
    if (msg.voice || msg.audio) {
      const heard = await this.transcribe(msg.voice || msg.audio).catch(e => {
        log.warn('voice:', e.message);
        return '';
      });
      if (!heard) return this.send(this.voiceWhy || 'I could not make out that voice note. Try again or type it.');
      text = heard;
      await this.send(`🎙 Heard: <i>${esc(clip(heard, 500))}</i>`);
    }
    const replyTo = msg.reply_to_message?.message_id;
    if (replyTo && this.pending.has(replyTo)) {
      const id = this.pending.get(replyTo);
      this.pending.delete(replyTo);
      const t = o.tickets.get(id);
      if (!t || t.state !== 'waiting') return this.send('That one is not waiting any more.');
      const note = /^(no|none|-)$/i.test(text) ? '' : text;
      o.reject(id, note);
      return this.send(
        `↩ Sent back <b>${esc(t.title)}</b>${note ? ' with your note' : ''}. It comes back here for your OK.`,
      );
    }
    if (replyTo && this.sent.has(replyTo) && text && !text.startsWith('/')) {
      const prev = o.tickets.get(this.sent.get(replyTo));
      if (prev) {
        try {
          const t = await o.reply(prev.id, text, { by: 'telegram' });
          await this.send(
            `↪ <b>${esc(o.company.agent(t.agent)?.name || t.agent)}</b> carries on. The answer lands here.`,
          );
        } catch (e) {
          await this.send(`Could not place that: ${esc(e.message)}`);
        }
        return;
      }
    }
    if (/^\/(start|waiting)\b/.test(text)) {
      const w = o.tickets.waiting();
      return this.send(
        w.length
          ? '<b>Waiting for your OK</b>\n' +
              w.map(t => `• ${esc(t.title)} (${esc(o.company.agent(t.agent)?.name || t.agent)})`).join('\n') +
              '\n\nEach was sent here with its buttons; scroll up, or open the office page.'
          : 'Nothing is waiting for your OK.',
      );
    }
    if (/^\/tasks\b/.test(text)) {
      const open = o.tickets.open();
      return this.send(
        open.length
          ? '<b>Open tickets</b>\n' +
              open
                .slice(0, 20)
                .map(
                  t =>
                    `• [${t.state}${t.state === 'scheduled' && t.at ? ' ' + esc(fmtAt(t.at, o.cfg.timezone)) : ''}] ${esc(t.title)} (${esc(o.company.agent(t.agent)?.name || t.agent)})`,
                )
                .join('\n')
          : 'Nothing open.',
      );
    }
    if (/^\/spend\b/.test(text)) {
      const h = o.health();
      return this.send(
        `<b>Today</b>: $${h.today.usd.toFixed(2)}${h.today.gbp ? ` (£${h.today.gbp.toFixed(2)})` : ''} of $${h.today.ceilingUsd} on the API, ${h.today.runs} runs. ${h.lanes.apiDown ? 'The API is resting: ' + esc(h.lanes.apiDown.why) : ''}`,
      );
    }
    const rw = text.match(/^\/(pause|resume|run)\b\s*(.*)$/is);
    const generic = /^(now|all|everything|the office|office|please|it)[\s.!]*$/i;
    if (rw && rw[2].trim() && !(rw[1] !== 'run' && generic.test(rw[2].trim()))) {
      const r = o.routines.find(rw[2]);
      if (!r)
        return this.send(
          `No single routine matches "${esc(rw[2].trim())}". /routines lists them; /${rw[1] === 'run' ? 'run with a routine name' : rw[1] + ' on its own ' + (rw[1] === 'pause' ? 'pauses' : 'resumes') + ' the whole office'}.`,
        );
      if (rw[1] === 'run') {
        await o.runRoutine(r.id);
        return this.send(`▶ Running <b>${esc(r.title || r.id)}</b> now. The result lands here.`);
      }
      o.routines.pause(r.id, rw[1] === 'pause');
      return this.send(`${rw[1] === 'pause' ? '⏸ Paused' : '▶ Resumed'} <b>${esc(r.title || r.id)}</b>.`);
    }
    if (/^\/run\b/.test(text))
      return this.send('Which routine? For example /run morning numbers. /routines lists them.');
    if (/^\/pause\b/.test(text)) {
      o.pauseOffice(true);
      return this.send('⏸ Office paused. Nothing new starts until /resume.');
    }
    if (/^\/resume\b/.test(text)) {
      o.pauseOffice(false);
      return this.send('▶ Office running.');
    }
    if (/^\/routines\b/.test(text)) {
      const v = o.routines.view();
      return this.send(
        v.length
          ? '<b>Routines</b>\n' +
              v
                .map(
                  r =>
                    `• ${r.paused ? '⏸ ' : ''}<b>${esc(r.title || r.id)}</b> · ${esc(r.whenText)} · ${esc(o.company.agent(r.agent)?.name || r.agent)}${r.nextAt ? ` · next ${esc(fmtAt(r.nextAt, o.cfg.timezone))}` : ''}`,
                )
                .join('\n') +
              '\n\n/run, /pause or /resume with a few words of the name. "routine: every weekday at 8am …" adds one.'
          : 'No routines yet. "routine: every weekday at 8am send the digest" adds one.',
      );
    }
    const rt = text.match(/^routine\s*:\s*(.+)$/is);
    if (rt) {
      try {
        const r = await o.addRoutine({ sentence: rt[1] });
        const a = o.company.agent(r.routine.agent);
        return this.send(
          `⏱ New routine <b>${esc(r.routine.title)}</b>\n${esc(r.whenText)}${r.guess ? ' (my reading of your words: check the time)' : ''} · ${esc(a?.name || r.routine.agent)}${r.routine.needsOk ? ' · waits for your OK' : ''}`,
        );
      } catch (e) {
        return this.send(esc(e.message));
      }
    }
    if (/^\/workflows?\b/.test(text))
      return this.send(
        '<b>Workflows</b> (type "name: topic")\n' +
          o.workflows
            .view()
            .map(w => `• ${esc(w.name)}: ${esc(w.steps.join(' → '))}`)
            .join('\n'),
      );
    if (/^\/help\b/.test(text))
      return this.send(
        'Type a job and it goes to a desk. Start with the desk or department to choose it ("design: …", "marketing: …", "ads: …", "finance: …"); leave it out and the office picks. Results land here with any pictures. Anything outbound stops with APPROVE and REJECT; after REJECT, reply to my question with the note. /waiting, /tasks, /spend, /workflows, /routines, /pause, /resume. /run, /pause or /resume with a routine\'s name act on that routine. "routine: every weekday at 8am …" adds a routine. "tomorrow 9am: …" or "fri 10:30: …" books a job for then. A workflow runs a chain: "new-post: the spring offer".',
      );
    if (text.startsWith('/')) return this.send('Unknown command. /help lists them, or just type the job.');
    if (!text) return;
    const when = parseAt(text, { tz: o.cfg.timezone });
    if (when) {
      try {
        const t = await o.submit({ text: when.task, by: 'telegram', at: when.at });
        const a = o.company.agent(t.agent);
        return this.send(
          `⏱ Booked <b>${esc(t.title)}</b> for ${esc(fmtAt(t.at, o.cfg.timezone))}${when.guess ? ' (my reading of your words)' : ''}\n${esc(a?.name || t.agent)}${t.needsOk ? ' · will wait for your OK before anything goes out' : ''}. /tasks shows it; the result lands here.`,
        );
      } catch (e) {
        return this.send(`Could not book that: ${esc(e.message)}`);
      }
    }
    try {
      const t = await o.submit({ text, by: 'telegram' });
      const a = o.company.agent(t.agent);
      await this.send(
        `📋 <b>${esc(t.title)}</b>\n${esc(o.company.dept(t.dept)?.name || t.dept)} · ${esc(a?.name || t.agent)}${t.needsOk ? ' · will wait for your OK before anything goes out' : ''}\nOn it. The result lands here.`,
      );
    } catch (e) {
      await this.send(`Could not place that: ${esc(e.message)}`);
    }
  }
  /** Voice notes: fetch the file and hand it to the transcriber: local Whisper by default, OpenAI when configured. */
  async transcribe(voice) {
    const how = this.office.cfg.telegram.transcribe || 'local';
    this.voiceWhy = '';
    if (how === 'off') {
      this.voiceWhy = 'Voice notes are off (telegram.transcribe). Type it, or use the keyboard mic.';
      return '';
    }
    const f = await this.call('getFile', { file_id: voice.file_id });
    const audio = await (await fetch(`${API}/file/bot${this.token}/${f.file_path}`)).arrayBuffer();
    if (how === 'local') {
      if (!(await voiceAvailable())) {
        this.voiceWhy =
          'Voice notes need the speech packages (npm install adds them where they can build). Type it for now.';
        return '';
      }
      try {
        return await transcribeLocal(audio, this.office.cfg);
      } catch (e) {
        log.warn('voice:', e.message);
        this.voiceWhy = `Could not transcribe: ${redact(e.message).slice(0, 120)}`;
        return '';
      }
    }
    if (how === 'openai') {
      const key = secret('OPENAI_API_KEY');
      if (!key) throw new Error('OPENAI_API_KEY not set');
      const form = new FormData();
      form.set('model', 'whisper-1');
      form.set('file', new Blob([audio]), 'voice.ogg');
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: form,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
      return String(j.text || '').trim();
    }
    throw new Error(`unknown transcriber ${how}`);
  }
  async loop() {
    while (!this.stopped) {
      try {
        const ups = await this.call('getUpdates', {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        });
        for (const u of ups) {
          this.offset = u.update_id + 1;
          try {
            await this.handle(u);
          } catch (e) {
            log.warn('phone update:', e.message);
          }
        }
      } catch (e) {
        log.warn('phone:', e.message);
        await new Promise(r => setTimeout(r, 15000));
      }
    }
  }
  async start() {
    if (!this.on) return false;
    try {
      await this.call('deleteWebhook', { drop_pending_updates: false });
    } catch {
      // no webhook to remove, or Telegram is slow: polling works either way
    }
    try {
      const me = await this.call('getMe');
      this.me = me.username;
      log.info(`phone: @${me.username} → chat ${this.chat.slice(0, 3)}…`);
    } catch (e) {
      log.warn('phone: token rejected,', e.message);
      this.on = false;
      this.reason = 'token rejected';
      return false;
    }
    const st = this.state_.read();
    if (this.office.cfg.telegram.hello !== false && !(st.helloAt && Date.now() - st.helloAt < 12 * 3600000)) {
      await this.send(
        `🏢 <b>${esc(this.office.company.name)}</b> is open.\nType a job ("design: three posts on the spring offer"); without a desk the office picks one. Drafts that need your OK land here with APPROVE and REJECT. /help for the rest.`,
      );
      this.state_.write({ ...st, helloAt: Date.now() });
    }
    this.loop();
    emit('phone', { state: 'on', bot: this.me });
    return true;
  }
  stop() {
    this.stopped = true;
  }
}
