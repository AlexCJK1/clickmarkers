// Routines and workflows: the standing work on the clock, soonest first, with run, pause, edit and delete;
// a new routine in plain words, read back as you type; and the rehearsed chains of desks.
import React, { useEffect, useMemo, useState } from 'react';
import { useActions, useDesks, useIsPhone, useRoutines, useWorkflows, useHealth } from '../lib/hooks.js';
import { useOffice, deskName } from '../lib/store.js';
import { whenLong, until, sentence, weekdayDate, plain } from '../lib/format.js';
import { MicButton } from '../lib/voice.jsx';
import { Sheet } from './Sheet.jsx';
import Combobox from './Combobox.jsx';
import { useChoices } from './JobBar.jsx';
import { Icon, Seg, Tag, announce } from './ui.jsx';

/** "2026-10-11 20:00" (a routine's slot) as "Sun 11 Oct 20:00". */
const fmtSlot = s => {
  const m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d:\d\d)/);
  return m ? `${weekdayDate(new Date(+m[1], +m[2] - 1, +m[3]).getTime())} ${m[4]}` : s;
};
const fmtNext = ts => {
  if (!ts) return '';
  const m = Math.round((ts - Date.now()) / 60000);
  return m < 60 ? until(ts) : m < 1440 ? `${until(ts)}, ${whenLong(ts).split(' ').pop()}` : whenLong(ts);
};
/** Reads a schedule sentence back as you type it ("weekdays 08:00"). */
function useParsed(text) {
  const a = useActions();
  const [p, setP] = useState(null);
  useEffect(() => {
    if (!text.trim()) {
      setP(null);
      return undefined;
    }
    const t = setTimeout(
      () =>
        a
          .parseWhen(text)
          .then(setP)
          .catch(() => setP(null)),
      250,
    );
    return () => clearTimeout(t);
  }, [text]);
  return p;
}
function useDeskGroups(withOffice) {
  const c = useChoices();
  return useMemo(
    () => [
      ...(withOffice ? [{ items: [{ value: '', label: 'The office picks', meta: 'Recommended' }] }] : []),
      ...c.who.slice(2),
    ],
    [c, withOffice],
  );
}

function NewRoutine() {
  const a = useActions();
  const desks = useDesks();
  const groups = useDeskGroups(true);
  const [text, setText] = useState('');
  const [agent, setAgent] = useState('');
  const [ok, setOk] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const p = useParsed(text);
  const add = async () => {
    if (!text.trim() || busy || !p?.ok) return;
    setBusy(true);
    setMsg(null);
    const r = await a
      .addRoutine({ sentence: text, agent: agent || undefined, needsOk: ok === '' ? undefined : ok === 'yes' })
      .catch(e => ({ error: e.message }));
    setBusy(false);
    if (r.error) {
      setMsg({ bad: true, text: r.error });
      announce(`Error: ${r.error}`);
      return;
    }
    setText('');
    const line = `Added: ${r.routine.title}, ${r.whenText}, ${deskName({ desks }, r.routine.agent)}`;
    setMsg({ text: line });
    announce(line);
  };
  return (
    <section className="new-routine" aria-labelledby="nr-t">
      <h3 id="nr-t" className="title-s">
        A new routine, in plain words
      </h3>
      <div className="row-ctl">
        <input
          className="field grow"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') add();
          }}
          placeholder="every weekday at 8am send me the inbox digest"
          aria-label="The routine, in plain words"
          aria-describedby="nr-read"
        />
        <MicButton value={text} onChange={setText} />
      </div>
      <div id="nr-read" className="readback" aria-live="polite">
        {p ? (
          p.ok ? (
            <>
              <Icon name="check" size={14} sw={2} className="good-ic" />
              <span>
                <b>{p.whenText}</b>
                {p.guess ? ' (a guess from your words: say a clock time to be exact)' : ''} ·{' '}
                {p.task || 'what should it do?'}
              </span>
            </>
          ) : (
            <>
              <Icon name="warn" size={14} sw={2} className="warn-ic" />
              <span>
                {p.ask === 'time'
                  ? 'What time? Add one, for example "at 8am".'
                  : p.ask === 'day'
                    ? 'Which day? For example "every Monday at 9".'
                    : 'Say when: "every weekday at 8am", "daily 7:30", "every 2 hours between 9 and 5".'}
              </span>
            </>
          )
        ) : (
          <span className="t3">
            Daily, weekdays, named days, weekends, hourly, every N hours or minutes; times like 8am, 17:30, noon.
          </span>
        )}
      </div>
      <div className="row-ctl wrap">
        <Combobox label="Desk" value={agent} onChange={setAgent} groups={groups} placeholder="Type a desk" />
        <Seg
          label="Your OK"
          value={ok}
          onChange={setOk}
          options={[
            ['', 'Office decides'],
            ['yes', 'Waits for my OK'],
            ['no', 'Read-only'],
          ]}
        />
        <button type="button" className="btn btn-primary" disabled={busy || !p?.ok} onClick={add}>
          <Icon name="plus" size={15} sw={2} />
          {busy ? 'Adding…' : 'Add routine'}
        </button>
      </div>
      {msg && (
        <div className={msg.bad ? 'err-line' : 'ok-line'}>
          <Icon name={msg.bad ? 'critical' : 'check'} size={14} sw={2} />
          <span>{msg.text}</span>
        </div>
      )}
    </section>
  );
}

function RoutineCard({ r }) {
  const a = useActions();
  const name = useOffice(s => deskName(s, r.agent));
  const groups = useDeskGroups(false);
  const [edit, setEdit] = useState(false);
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState('');
  const [title, setTitle] = useState(r.title || '');
  const [when, setWhen] = useState('');
  const [agent, setAgent] = useState(r.agent);
  const [needsOk, setNeedsOk] = useState(!!r.needsOk);
  const [text, setText] = useState(r.text || '');
  const p = useParsed(when);
  useEffect(() => {
    if (!sure) return undefined;
    const t = setTimeout(() => setSure(false), 4000);
    return () => clearTimeout(t);
  }, [sure]);
  const save = async () => {
    const r2 = await a
      .editRoutine(r.id, { title, text, agent, needsOk, ...(when.trim() ? { sentence: when } : {}) })
      .catch(e => ({ error: e.message }));
    if (r2?.error) setMsg(r2.error);
    else {
      setEdit(false);
      setWhen('');
      setMsg('');
      announce('Routine saved');
    }
  };
  const run = async () => {
    setMsg('Running…');
    const t = await a.runRoutine(r.id);
    setMsg(t?.error ? t.error : 'Started: the result lands in the desk and on the phone');
    setTimeout(() => setMsg(''), 4000);
  };
  return (
    <li className={`routine ${r.paused ? 'paused' : ''}`}>
      <div className="routine-top">
        <span className="routine-when tnum">{r.whenText}</span>
        <span className="routine-desk">{name}</span>
        {r.needsOk && (
          <Tag level="neutral" icon="inbox">
            Waits for your OK
          </Tag>
        )}
        {r.engine === 'batch' && (
          <Tag level="neutral" icon="list">
            Batch
          </Tag>
        )}
        {r.kind === 'probe' && (
          <Tag level="neutral" icon="plug">
            Check
          </Tag>
        )}
        {r.paused && (
          <Tag level="neutral" icon="pause">
            Paused
          </Tag>
        )}
        <span className="routine-next t3">{r.paused ? '' : r.nextAt ? `Next ${fmtNext(r.nextAt)}` : ''}</span>
      </div>
      <div className="routine-title">{r.title}</div>
      <div className="meta t3">Last fired {r.lastSlot ? fmtSlot(r.lastSlot) : 'never'}</div>
      {!edit && (
        <div className="row-ctl">
          <button type="button" className="btn btn-secondary btn-sm" onClick={run}>
            <Icon name="play" size={13} />
            Run now
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => a.pauseRoutine(r.id, !r.paused)}>
            <Icon name={r.paused ? 'play' : 'pause'} size={13} />
            {r.paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(true)}>
            <Icon name="edit" size={13} />
            Edit
          </button>
          <button
            type="button"
            className={`btn btn-sm ${sure ? 'btn-danger-fill' : 'btn-danger'}`}
            onClick={() => (sure ? a.deleteRoutine(r.id) : setSure(true))}
          >
            <Icon name="trash" size={13} />
            {sure ? 'Sure? Delete' : 'Delete'}
          </button>
        </div>
      )}
      {edit && (
        <div className="routine-edit">
          <input
            className="field"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title"
            aria-label="Title"
          />
          <textarea
            className="field"
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            placeholder="What the desk is asked to do"
            aria-label="What the desk is asked to do"
          />
          <input
            className="field"
            value={when}
            onChange={e => setWhen(e.target.value)}
            placeholder={`A new time in words (now: ${r.whenText})`}
            aria-label="A new time in words"
          />
          {when && (
            <div className="readback">
              {p?.ok ? (
                <>
                  <Icon name="check" size={14} sw={2} className="good-ic" />
                  <span>
                    {p.whenText}
                    {p.guess ? ' (a guess)' : ''}
                  </span>
                </>
              ) : (
                <>
                  <Icon name="warn" size={14} sw={2} className="warn-ic" />
                  <span>{p?.ask === 'day' ? 'Which day?' : 'What time?'}</span>
                </>
              )}
            </div>
          )}
          <div className="row-ctl wrap">
            <Combobox label="Desk" value={agent} onChange={setAgent} groups={groups} placeholder="Type a desk" />
            <label className="check-l">
              <input type="checkbox" className="check" checked={needsOk} onChange={e => setNeedsOk(e.target.checked)} />
              Waits for my OK
            </label>
            <button type="button" className="btn btn-primary btn-sm" disabled={!!when && !p?.ok} onClick={save}>
              Save
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setEdit(false);
                setWhen('');
                setMsg('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && (
        <div className="meta" role="status">
          {msg}
        </div>
      )}
    </li>
  );
}

function Workflow({ w }) {
  const a = useActions();
  const owner = useOffice(s => deskName(s, w.owner));
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // The sheet closes only once the office has started the chain; a refusal stays here, under the button.
  const run = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await a.workflow(w.name, topic);
      if (r?.error) setErr(`Not started. ${plain(r.error)}`);
      else {
        announce(`Workflow ${sentence(w.name.replace(/-/g, ' '))} started`);
        setTopic('');
        a.drawer(null);
      }
    } catch {
      setErr('Not started. The office did not answer. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="routine">
      <div className="routine-top">
        <Icon name="workflow" size={15} className="t3" />
        <span className="routine-desk">{sentence(w.name.replace(/-/g, ' '))}</span>
        <span className="routine-next t3">Owner {owner}</span>
      </div>
      <ol className="steps">
        {w.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <div className="row-ctl">
        <input
          className="field grow"
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="Topic"
          aria-label={`Topic for ${w.name}`}
        />
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={run}>
          <Icon name="play" size={13} />
          {busy ? 'Starting…' : 'Run'}
        </button>
      </div>
      {err && (
        <div className="err-line" role="alert">
          <Icon name="critical" size={14} sw={2} />
          <span>{err}</span>
        </div>
      )}
    </li>
  );
}

export default function Routines() {
  const a = useActions();
  const routines = useRoutines();
  const workflows = useWorkflows();
  const phone = useIsPhone();
  const tz = useHealth()?.tz || 'Europe/London';
  const sorted = [...routines].sort((x, y) => x.paused - y.paused || (x.nextAt || 9e15) - (y.nextAt || 9e15));
  return (
    <Sheet
      title="Routines"
      size="lg"
      onClose={() => a.drawer(null)}
      sub={`${routines.length} routines on the clock (${tz.replace(/_/g, ' ')}), soonest first, and ${workflows.length} workflows. The phone takes /routines, /run, /pause and "routine: …" too.`}
    >
      <div className={phone ? 'stack' : 'two-col'}>
        <div className="stack">
          <NewRoutine />
          <ul className="routine-list" aria-label="Routines">
            {sorted.map(r => (
              <RoutineCard key={r.id} r={r} />
            ))}
          </ul>
        </div>
        <div className="stack">
          <h3 className="title-s">
            Workflows <span className="meta t3">a rehearsed chain of desks</span>
          </h3>
          <ul className="routine-list" aria-label="Workflows">
            {workflows.map(w => (
              <Workflow key={w.name} w={w} />
            ))}
          </ul>
        </div>
      </div>
    </Sheet>
  );
}
