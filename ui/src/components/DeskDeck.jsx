// The desk deck: one desk in hand. Work: today's spend against its budget, its licence to send, its
// connectors, its standing brief, a job for it, its live thoughts, its tickets, notebook, routines and
// the lessons you have given it. Chat: a quick word with the desk, not a job. On a wide screen it takes
// the telemetry column; on the phone it is a full-screen sheet.
import React, { useEffect, useRef, useState } from 'react';
import { useActions, useDesk, useDeskTickets, useWire } from '../lib/hooks.js';
import { useOffice, deskName } from '../lib/store.js';
import { usd, hm, modelName, plural, plain } from '../lib/format.js';
import { MicButton, SpeakButton } from '../lib/voice.jsx';
import ClientBrief from './ClientBrief.jsx';
import Ticket from './Ticket.jsx';
import { LogLines } from './LiveLogs.jsx';
import { PodPortrait } from './ExecutiveSuite.jsx';
import { Sheet } from './Sheet.jsx';
import { DESK_STATE, Icon, Meter, StateMark, Tabs, Tag, Tip, announce, tabPanelProps } from './ui.jsx';

function DeskChat({ id, name }) {
  const a = useActions();
  const [msgs, setMsgs] = useState([]);
  const [meta, setMeta] = useState({});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState({});
  const box = useRef(null);
  useEffect(() => {
    setMsgs([]);
    a.chatHistory(id)
      .then(r => {
        setMsgs(r.messages || []);
        setMeta(r);
      })
      .catch(() => {});
  }, [id]);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [msgs, busy]);
  const say = async t => {
    t = String(t || '').trim();
    if (!t || busy) return;
    setBusy(true);
    setErr('');
    setText('');
    setMsgs(m => [...m, { role: 'user', text: t, at: Date.now() }]);
    const r = await a.chat(id, t).catch(e => ({ error: e.message }));
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      announce(`Error: ${r.error}`);
      return;
    }
    setMsgs(r.messages || []);
    setMeta(m => ({
      ...m,
      interview: r.interview ? { step: r.interview - 1 } : r.interview === 0 ? null : m.interview,
      setUp: r.wrote ? true : m.setUp,
    }));
    const last = (r.messages || []).filter(x => x.role === 'assistant').pop();
    if (last) announce(`${name}: ${last.text.slice(0, 200)}`);
  };
  const asJob = async (i, t) => {
    const r = await a.submit(t, id);
    setSent(s => ({ ...s, [i]: r.error ? 'Failed' : 'Sent as a job' }));
    announce(r.error ? `Error: ${r.error}` : 'Sent as a job');
  };
  const chips = meta.interview
    ? ['skip', 'done', 'cancel']
    : [
        'What are you working on?',
        'What can you do for me?',
        'What tools can you use?',
        ...(meta.lead ? ['Set up'] : []),
      ];
  return (
    <div className="chat">
      <div ref={box} className="chat-log" role="log" aria-label={`Chat with ${name}`} tabIndex={0}>
        {msgs.length === 0 && (
          <p className="meta t3">
            A quick word with {name}, not a job: no tools, nothing goes out, a few cents a reply. Ask what it is doing,
            what it knows, how it would tackle something.
            {meta.lead ? ' As a department lead it also runs the set-up interview: say "set up".' : ''}
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble-row ${m.role === 'user' ? 'me' : ''}`}>
            <div className={`bubble ${m.role === 'user' ? 'me' : 'desk'}`}>
              {m.text}
              <div className="b-meta">
                {m.role === 'assistant' ? (
                  <SpeakButton text={m.text} />
                ) : (
                  !/^(set ?up|skip|done|cancel)\b/i.test(m.text) && (
                    <button type="button" className="link-btn" onClick={() => asJob(i, m.text)} disabled={!!sent[i]}>
                      {sent[i] || 'Send as a job'}
                    </button>
                  )
                )}
                <span>
                  {hm(m.at)}
                  {m.lane ? ` · ${m.lane}` : ''}
                </span>
              </div>
            </div>
          </div>
        ))}
        {busy && (
          <p className="meta t3" role="status">
            {name} is thinking…
          </p>
        )}
      </div>
      {err && (
        <div className="err-line" role="alert">
          <Icon name="critical" size={14} sw={2} />
          <span>{err}</span>
        </div>
      )}
      <div className="row-ctl wrap chat-chips">
        {chips.map(c => (
          <button key={c} type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => say(c)}>
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
        {msgs.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm push"
            onClick={() => a.clearChat(id).then(() => setMsgs([]))}
          >
            Clear the chat
          </button>
        )}
      </div>
      <div className="row-ctl">
        <input
          className="field grow"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') say(text);
          }}
          placeholder={meta.interview ? 'Your answer (or skip, done, cancel)' : `Ask ${name} ("job: ..." sends a job)`}
          aria-label={`Message ${name}`}
        />
        <MicButton value={text} onChange={setText} />
        <button type="button" className="btn btn-primary" onClick={() => say(text)} disabled={busy || !text.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}

function Lessons({ id, lessons, onChange }) {
  const a = useActions();
  const [all, setAll] = useState(false);
  if (!lessons || (!lessons.rules.length && !lessons.oneoffs.length)) return null;
  const drop = async (kind, n) => {
    const r = await a.removeLesson(id, kind, n);
    if (r.lessons) {
      onChange(r.lessons);
      announce('Lesson dropped');
    }
  };
  return (
    <section className="deck-sec" aria-labelledby={`les-${id}`}>
      <div className="sec">
        <h3 id={`les-${id}`} className="title-s">
          Lessons from you
        </h3>
        <span className="aside">Standing rules go into every job</span>
      </div>
      <ul className="lessons">
        {lessons.rules.map((r, n) => (
          <li key={`r${n}`}>
            <Tip text={r.quote ? `You said: "${r.quote}"${r.task ? ` (${r.task})` : ''} · ${r.date}` : r.date || ''}>
              <span tabIndex={0}>{r.text}</span>
            </Tip>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              aria-label={`Drop the rule: ${r.text}`}
              onClick={() => drop('rule', n)}
            >
              <Icon name="close" size={13} />
            </button>
          </li>
        ))}
      </ul>
      {lessons.oneoffs.length > 0 && (
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={all} onClick={() => setAll(!all)}>
          <Icon name={all ? 'chevronUp' : 'chevron'} size={13} />
          {all ? 'Hide' : 'Show'} {plural(lessons.oneoffs.length, 'one-off')}
        </button>
      )}
      {all && (
        <ul className="lessons quiet">
          {lessons.oneoffs.map((r, n) => (
            <li key={`o${n}`}>
              <span>{r.text}</span>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                aria-label={`Drop: ${r.text}`}
                onClick={() => drop('oneoff', n)}
              >
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function connTag(c) {
  const st = c.health?.status;
  const label = c.label || c.key;
  if (c.missing?.length || c.disabled)
    return (
      <Tag level="neutral">
        {label}
        {c.missing?.length ? ', needs a key' : ', off'}
      </Tag>
    );
  if (st === 'connected') return <Tag level="good">{label}</Tag>;
  if (st === 'needs-auth') return <Tag level="warn">{label}, needs a sign-in</Tag>;
  if (st)
    return (
      <Tag level="serious">
        {label}, {st}
      </Tag>
    );
  return <Tag level="neutral">{label}, not checked</Tag>;
}

function Work({ id, desk, today, info, setInfo, tickets, onBrief }) {
  const a = useActions();
  const [open, setOpen] = useState(null);
  const [job, setJob] = useState('');
  const [more, setMore] = useState(false);
  const lines = useWire(id, 40);
  const names = useOffice(s => x => deskName(s, x));
  const waiting = tickets.filter(t => t.state === 'waiting'),
    live = tickets.filter(t => ['doing', 'next', 'blocked', 'scheduled'].includes(t.state)),
    past = tickets.filter(t => ['done', 'failed', 'cancelled'].includes(t.state)).slice(0, 12);
  const [sending, setSending] = useState(false);
  const [jobErr, setJobErr] = useState('');
  // The job stays in the box until the office has taken it, so a refusal never loses what was typed.
  const send = async () => {
    const text = job.trim();
    if (!text || sending) return;
    setSending(true);
    setJobErr('');
    try {
      const r = await a.submit(text, id);
      if (r?.error) setJobErr(`Not sent. ${plain(r.error)}`);
      else {
        announce(`Sent to ${desk.name}: ${r?.title || text}`);
        setJob('');
      }
    } catch {
      setJobErr('Not sent. The office did not answer. Try again.');
    } finally {
      setSending(false);
    }
  };
  const list = (ts, label, empty) => (
    <section className="deck-sec">
      <div className="sec">
        <h3 className="title-s">{label}</h3>
        <span className="aside">{ts.length}</span>
      </div>
      {ts.length ? (
        <div className="stack-s">
          {ts.map(t => (
            <Ticket key={t.id} t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
          ))}
        </div>
      ) : (
        <p className="meta t3">{empty}</p>
      )}
    </section>
  );
  return (
    <>
      <div className="deck-today">
        <div className="deck-today-top">
          <span className="meta">Today</span>
          <b className="tnum">{usd(today)}</b>
          <span className="meta">of {usd(desk.budgetUsd)} on the API</span>
        </div>
        <Meter
          value={today}
          max={desk.budgetUsd || 1}
          tone={today > (desk.budgetUsd || 0) * 0.9 ? 'crit' : ''}
          label="API spend today against the desk's budget"
        />
        <div className="deck-counts">
          <Tag level={live.length ? 'live' : 'neutral'} icon={live.length ? 'working' : 'ring'}>
            {live.length} live
          </Tag>
          <Tag level={waiting.length ? 'warn' : 'neutral'} icon={waiting.length ? 'warn' : 'inbox'}>
            {waiting.length} waiting for you
          </Tag>
        </div>
      </div>
      <dl className="settings">
        <div>
          <dt>Licence to send</dt>
          <dd>{desk.outbound ? 'With your OK' : 'Never'}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>
            {modelName(desk.model)}
            {info?.effort ? `, effort ${info.effort}` : ''}
          </dd>
        </div>
        <div>
          <dt>Daily budget</dt>
          <dd>{usd(desk.budgetUsd)} a day on the API</dd>
        </div>
      </dl>
      <div className="tag-row">
        {(info?.connectors || desk.tools.map(k => ({ key: k }))).map(c => (
          <Tip
            key={c.key}
            text={
              c.health
                ? `${c.health.status}${c.health.tools ? `, ${c.health.tools} tools` : ''}`
                : c.missing?.join('; ') || 'Not checked yet'
            }
          >
            <span>{connTag(c)}</span>
          </Tip>
        ))}
        {info?.web && (
          <Tag level="neutral" icon="globe">
            The web
          </Tag>
        )}
        {info?.team?.length > 0 && (
          <Tag level="neutral" icon="users">
            Team of {info.team.length}
          </Tag>
        )}
      </div>
      {info && (
        <section className="deck-sec">
          <div className="sec">
            <h3 className="title-s">Standing brief</h3>
          </div>
          <p className={`brief-text ${more ? '' : 'clamp'}`}>
            {info.does} {info.brief}
          </p>
          <div className="row-ctl wrap">
            <button type="button" className="btn btn-ghost btn-sm" aria-expanded={more} onClick={() => setMore(!more)}>
              {more ? 'Show less' : 'Show all'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onBrief}>
              <Icon name="edit" size={13} />
              Brief this desk
            </button>
            <button
              type="button"
              className={`btn btn-sm ${desk.paused ? 'btn-secondary' : 'btn-danger'}`}
              onClick={async () => {
                const want = !desk.paused;
                setJobErr('');
                try {
                  const r = await a.pauseDesk(id, want);
                  if (r?.error) setJobErr(`${want ? 'Not paused' : 'Not resumed'}. ${plain(r.error)}`);
                  else announce(want ? 'Desk paused' : 'Desk resumed');
                } catch {
                  setJobErr(`${want ? 'Not paused' : 'Not resumed'}. The office did not answer. Try again.`);
                }
              }}
            >
              <Icon name={desk.paused ? 'play' : 'pause'} size={13} />
              {desk.paused ? 'Resume desk' : 'Pause desk'}
            </button>
          </div>
        </section>
      )}
      <div className="row-ctl">
        <input
          className="field grow"
          value={job}
          onChange={e => setJob(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') send();
          }}
          placeholder={`A job for ${desk.name}`}
          aria-label={`A job for ${desk.name}`}
        />
        <MicButton value={job} onChange={setJob} />
        <button type="button" className="btn btn-primary" disabled={!job.trim() || sending} onClick={send}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {jobErr && (
        <div className="err-line" role="alert">
          <Icon name="critical" size={14} sw={2} />
          <span>{jobErr}</span>
        </div>
      )}
      <section className="deck-sec">
        <div className="sec">
          <h3 className="title-s">Live thoughts</h3>
          <span className="aside">This desk's wire</span>
        </div>
        <div className="deck-log">
          <LogLines
            lines={lines}
            names={names}
            label={`${desk.name}'s live thoughts`}
            empty="Quiet. Lines appear as the desk works."
          />
        </div>
      </section>
      {waiting.length > 0 && list(waiting, 'Waiting for your OK', '')}
      {list(live, 'In hand', 'Nothing in hand.')}
      {list(past, 'Done', 'Nothing yet.')}
      {info?.notebook && (
        <section className="deck-sec">
          <div className="sec">
            <h3 className="title-s">Notebook</h3>
            <span className="aside">The last lines</span>
          </div>
          <div className="prose quiet log-font">{info.notebook.split('\n').slice(-8).join('\n')}</div>
        </section>
      )}
      {info?.routines?.length > 0 && (
        <section className="deck-sec">
          <div className="sec">
            <h3 className="title-s">Routines</h3>
          </div>
          <ul className="mini-list">
            {info.routines.map(r => (
              <li key={r.id}>
                <b className="tnum">{r.whenText}</b>
                <span>{r.title}</span>
                {r.paused && (
                  <Tag level="neutral" icon="pause">
                    Paused
                  </Tag>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {info && <Lessons id={id} lessons={info.lessons} onChange={l => setInfo({ ...info, lessons: l })} />}
    </>
  );
}

export default function DeskDeck({ id, asSheet = false }) {
  const { desk, status, today } = useDesk(id);
  const tickets = useDeskTickets(id);
  const a = useActions();
  const [info, setInfo] = useState(null);
  const [brief, setBrief] = useState(false);
  const [tab, setTab] = useState('work');
  useEffect(() => {
    setInfo(null);
    setTab('work');
    a.agent(id)
      .then(setInfo)
      .catch(() => {});
  }, [id]);
  if (!desk) return null;
  const st = DESK_STATE[status] || DESK_STATE.idle;
  const head = (
    <div className="deck-head">
      <PodPortrait kind={!desk.reportsTo ? 'chief' : 'lead'} status={status} lit size={52} />
      <div style={{ minWidth: 0, flex: 1 }}>
        {!asSheet && <h2 className="title-l deck-name">{desk.name}</h2>}
        <div className="meta">
          {desk.role && desk.role.toLowerCase() !== String(desk.name).toLowerCase() ? `${desk.role} · ` : ''}
          {modelName(desk.model)}
        </div>
        <div className={`desk-state ${st.cls}`}>
          <StateMark status={status} />
          <span>{st.word}</span>
        </div>
      </div>
      {!asSheet && (
        <Tip text="Back to the whole office (Esc or 0)">
          <button type="button" className="btn btn-secondary" onClick={() => a.select(null)}>
            <Icon name="close" size={15} />
            Close
          </button>
        </Tip>
      )}
    </div>
  );
  const body = (
    <>
      {head}
      <Tabs
        label={`${desk.name}`}
        idBase={`deck-${id}`}
        value={tab}
        onChange={setTab}
        tabs={[
          ['work', 'Work'],
          ['chat', 'Chat'],
        ]}
        className="deck-tabs"
      />
      <div className={`deck-body ${tab}`} {...tabPanelProps(`deck-${id}`, tab)}>
        {tab === 'chat' ? (
          <DeskChat id={id} name={desk.name} />
        ) : (
          <Work
            id={id}
            desk={desk}
            status={status}
            today={today}
            info={info}
            setInfo={setInfo}
            tickets={tickets}
            onBrief={() => setBrief(true)}
          />
        )}
      </div>
      {brief && info && (
        <ClientBrief
          agent={info}
          onClose={() => setBrief(false)}
          onSaved={() => {
            setBrief(false);
            announce('Brief saved');
            a.agent(id).then(setInfo);
          }}
        />
      )}
    </>
  );
  if (asSheet)
    return (
      <Sheet title={desk.name} onClose={() => a.select(null)} size="md" bodyClass="deck-sheet">
        {body}
      </Sheet>
    );
  return (
    <section className="panel deck" aria-label={`${desk.name}, the desk in hand`}>
      {body}
    </section>
  );
}
