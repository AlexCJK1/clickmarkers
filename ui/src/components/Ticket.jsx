// One ticket: a row that opens to the brief, the draft or result, what the desk read and called, and the
// controls its state allows. A waiting draft is approved against the hash of the draft shown here (the
// office refuses an OK for any other); a refusal is shown inline and nothing is approved.
import React, { useEffect, useState } from 'react';
import { useActions } from '../lib/hooks.js';
import { useOffice, deskName, displayName, tidyTitle } from '../lib/store.js';
import { when, whenLong, dur, usd, modelName, plain, sentence } from '../lib/format.js';
import { MicButton, SpeakButton } from '../lib/voice.jsx';
import { Icon, Tag, announce } from './ui.jsx';

export const TICKET_STATE = {
  scheduled: ['booked', 'Booked', 'st-booked'],
  next: ['ring', 'Queued', ''],
  inbox: ['ring', 'In the inbox', ''],
  doing: ['working', 'Doing', 'st-working'],
  waiting: ['warn', 'Waiting for you', 'st-waiting'],
  blocked: ['hourglass', 'Blocked', ''],
  done: ['done', 'Done', 'st-done'],
  failed: ['critical', 'Failed', 'st-failed'],
  cancelled: ['close', 'Cancelled', ''],
};
export function StateWord({ state }) {
  const [ic, word, cls] = TICKET_STATE[state] || ['ring', state, ''];
  return (
    <span className={`state-word ${cls}`}>
      <Icon name={ic} size={13} sw={2} />
      {word}
    </span>
  );
}

/** The evaluations step's verdict on a draft: a tag, the one-line summary (with any note), the problems. */
export function Verdict({ t }) {
  const ev = t.eval;
  if (!ev && !t.evalLine) return null;
  const v = ev?.verdict;
  const problems = ev?.problems || t.evalProblems || [];
  const tag =
    v === 'pass' ? (
      <Tag level="good">Checked, passed</Tag>
    ) : v === 'fix' ? (
      <Tag level="warn">
        {problems.length} problem{problems.length === 1 ? '' : 's'} left
      </Tag>
    ) : v === 'unchecked' ? (
      <Tag level="neutral">Not checked</Tag>
    ) : null;
  return (
    <div className="verdict">
      <div className="verdict-top">
        {tag}
        {t.evalRounds > 0 && (
          <span className="t3">
            {t.evalRounds} round{t.evalRounds === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {t.evalLine && (
        <p className="verdict-line">
          {t.evalLine.replace(/\b[A-Z][A-Z0-9/ ]*[A-Z]\b(?=[ .:(]|$)/g, w => (w.length > 3 ? displayName(w) : w))}
        </p>
      )}
      {v === 'fix' && problems.length > 0 && (
        <ul className="verdict-list">
          {problems.map((p, i) => (
            <li key={i}>
              <b>{p.unit}</b>
              {p.reason ? `: ${p.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Ticket({ t, open, onToggle, showDesk = false, tray = false }) {
  const a = useActions();
  const name = useOffice(s => deskName(s, t.agent));
  const [full, setFull] = useState(null);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const runs = full?.runs ?? t.runs ?? null; // when the steps would run once approved (the office works it out)
  useEffect(() => {
    if (open)
      a.ticket(t.id)
        .then(setFull)
        .catch(() => setErr('The office did not answer. Try again.'));
    else setFull(null);
  }, [open, t.id, t.updatedAt]);
  const body = full
    ? full.state === 'waiting'
      ? full.draft
      : full.result
        ? plain(full.result)
        : full.error
          ? plain(full.error)
          : 'No result yet.'
    : '';
  // One way for every button here: wait for the office, show its refusal on the line under the buttons
  // (the role="alert" line is the only announcement of a failure), and announce only a success.
  const act = async (key, call, ok, lead = '') => {
    setErr('');
    setBusy(key);
    try {
      const r = await call();
      if (r?.error) {
        setErr(`${lead}${plain(r.error)}`);
        return false;
      }
      if (ok) ok(r);
      return true;
    } catch {
      setErr(`${lead}The office did not answer. Try again.`);
      return false;
    } finally {
      setBusy('');
    }
  };
  const approve = () =>
    act(
      'approve',
      () => a.approve(t.id, full.draftHash),
      () => announce(`Approved: ${tidyTitle(t.title)}`),
      'Nothing was approved. ',
    ).then(done => {
      if (!done)
        a.ticket(t.id)
          .then(setFull)
          .catch(() => {});
    });
  const reject = () =>
    act(
      'reject',
      () => a.reject(t.id, note),
      () => {
        announce(`Sent back: ${tidyTitle(t.title)}`);
        setNote('');
      },
      'Nothing was sent back. ',
    );
  const sendReply = () => {
    const text = reply.trim();
    if (!text) return;
    act(
      'reply',
      () => a.reply(t.id, text),
      () => {
        announce('Reply sent');
        setReply('');
      },
    );
  };
  const retry = () =>
    act(
      'retry',
      () => a.retry(t.id),
      () => announce('Retrying'),
    );
  const cancel = () =>
    act(
      'cancel',
      () => a.cancel(t.id),
      () => announce(`Cancelled: ${tidyTitle(t.title)}`),
    );
  const lane = t.lane && (t.lane === 'api' ? 'API' : sentence(t.lane));
  const meta = [
    showDesk && name,
    t.state === 'scheduled' && t.at ? `booked for ${whenLong(t.at)}` : when(t.updatedAt),
    t.by === 'routine' || t.routine ? 'from a routine' : t.by && `by ${t.by}`,
    t.workflow,
    lane,
    t.model && modelName(t.model),
    t.effort && `effort ${t.effort}`,
    t.timings?.totalMs && dur(t.timings.totalMs),
    t.costUsd && usd(t.costUsd, 3),
  ].filter(Boolean);
  const id = `tk-${t.id}`;
  return (
    <article
      className={`ticket ${t.state === 'waiting' ? 'waiting' : ''} ${open ? 'open' : ''}`}
      aria-labelledby={`${id}-t`}
    >
      <button type="button" className="ticket-head" aria-expanded={!!open} aria-controls={`${id}-b`} onClick={onToggle}>
        <span className="ticket-main">
          <span id={`${id}-t`} className="ticket-title">
            {tidyTitle(t.title)}
          </span>
          <span className="ticket-meta">
            <StateWord state={t.state} />
            <span>{meta.join(' · ')}</span>
          </span>
        </span>
        <Icon name={open ? 'chevronUp' : 'chevron'} size={16} className="t3" />
      </button>
      {open && (
        <div className="ticket-body" id={`${id}-b`}>
          {!full && !err && <div className="meta t3">Opening…</div>}
          {full?.why && <p className="meta">{full.why}</p>}
          {full?.note && (
            <p className="meta">
              <b className="t1">Office note:</b> {full.note}
            </p>
          )}
          {full && full.text && (
            <details className="brief">
              <summary className="cap">The brief</summary>
              <div className="prose quiet">{full.text}</div>
            </details>
          )}
          {t.state === 'waiting' && !tray && <Verdict t={full || t} />}
          {full && (
            <div className="body-wrap">
              <div
                className={`prose ${t.state === 'waiting' ? 'draft' : ''}`}
                tabIndex={0}
                aria-label={t.state === 'waiting' ? 'The draft' : 'The result'}
              >
                {body}
              </div>
              {body && <SpeakButton text={body} className="speak-abs" />}
            </div>
          )}
          {full?.reads?.length > 0 && <p className="meta t3">Read: {full.reads.join(', ')}</p>}
          {full?.calls?.length > 0 && (
            <p className="meta t3">Tools: {full.calls.map(c => `${c.server}.${c.tool}`).join(', ')}</p>
          )}
          {t.state === 'waiting' && (
            <div className="ticket-ctl">
              {runs?.error ? (
                <div className="err-line" role="alert">
                  <Icon name="critical" size={14} sw={2} />
                  <span>Approve is refused: {runs.error}. Reject it with a note.</span>
                </div>
              ) : runs?.at ? (
                <p className="meta">Runs {runs.when}, after your OK.</p>
              ) : runs?.posts ? (
                <p className="meta">Runs on your OK; Facebook publishes the post {runs.postsWhen}.</p>
              ) : runs?.held ? (
                <p className="meta">Goes out as soon as you approve.</p>
              ) : null}
              <div className="row-ctl">
                <input
                  className="field grow"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="What should change (sent back with Reject)"
                  aria-label="What should change"
                />
                <MicButton value={note} onChange={setNote} />
              </div>
              <div className="row-ctl">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!full?.draftHash || !!busy || !!runs?.error}
                  onClick={approve}
                >
                  <Icon name="check" size={15} sw={2.2} />
                  {busy === 'approve'
                    ? 'Approving…'
                    : runs?.at
                      ? `Approve, runs ${runs.when}`
                      : runs?.posts
                        ? `Approve, posts ${runs.postsWhen}`
                        : 'Approve'}
                </button>
                <button type="button" className="btn btn-danger" disabled={!!busy} onClick={reject}>
                  <Icon name="close" size={15} />
                  Reject{note.trim() ? ' with the note' : ''}
                </button>
              </div>
            </div>
          )}
          {err && (
            <div className="err-line" role="alert">
              <Icon name="critical" size={14} sw={2} />
              <span>{err}</span>
            </div>
          )}
          {['done', 'failed', 'cancelled'].includes(t.state) && (
            <div className="row-ctl">
              <input
                className="field grow"
                value={reply}
                onChange={e => setReply(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !busy) sendReply();
                }}
                placeholder="Carry on, or say what to change"
                aria-label="Reply to this ticket"
              />
              <MicButton value={reply} onChange={setReply} />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!!busy || !reply.trim()}
                onClick={sendReply}
              >
                {busy === 'reply' ? 'Sending…' : 'Reply'}
              </button>
              {t.state !== 'done' && (
                <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={retry}>
                  <Icon name="refresh" size={14} />
                  {busy === 'retry' ? 'Retrying…' : 'Retry'}
                </button>
              )}
            </div>
          )}
          {['scheduled', 'next', 'doing', 'blocked'].includes(t.state) && (
            <div className="row-ctl">
              <button type="button" className="btn btn-danger" disabled={!!busy} onClick={cancel}>
                <Icon name="close" size={14} />
                {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
