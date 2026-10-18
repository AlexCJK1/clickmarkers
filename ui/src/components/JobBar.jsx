// The job bar under the war room: a job for the office. Choose who takes it (a desk, a workflow, or the
// office picks), a model and an effort for this one job, a time to book it for, or open the big editor for
// a long brief. "tomorrow 9am: ..." books it; "routine: every weekday at 8am ..." makes a routine. The mic
// types what you say. On the phone the bar lives in the big editor, opened from the header.
import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useActions, useCompany, useDesks, useWorkflows } from '../lib/hooks.js';
import { MicButton } from '../lib/voice.jsx';
import { modelName, sentence, whenLong } from '../lib/format.js';
import Combobox from './Combobox.jsx';
import { Modal } from './Sheet.jsx';
import { Icon, Tip, announce } from './ui.jsx';

const MODELS = [['', "Desk's own", 'what the desk is set to'], ['opus', 'Opus 5.5', 'thinks hardest'], ['sonnet', 'Sonnet 5.5', 'routing, digests'], ['haiku', 'Haiku 5.5', 'sorting, extracting']];
const EFFORTS = [['', "Desk's own", 'the model default'], ['low', 'Low', ''], ['medium', 'Medium', ''], ['high', 'High', ''], ['xhigh', 'Extra high', ''], ['max', 'Max', 'slowest, most thorough']];
const pad = n => String(n).padStart(2, '0');
const localInput = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const PLACEHOLDER = 'A job for the office: "design three posts on spring window cleaning", "tomorrow 9am chase the stuck leads"';

/** The three pickers' choices, built from the company. */
export function useChoices() {
  const desks = useDesks(); const workflows = useWorkflows(); const company = useCompany();
  return useMemo(() => {
    const deps = (company?.departments || []); const leads = new Set(deps.map(d => d.lead)); const chief = desks.find(d => !d.reportsTo);
    const deptName = id => deps.find(d => d.id === id)?.name || '';
    const who = [
      { items: [{ value: '', label: 'The office picks', meta: 'Recommended', keywords: 'auto route' }] },
      { label: 'Workflows', items: workflows.map(w => ({ value: `wf:${w.name}`, label: sentence(w.name.replace(/-/g, ' ')), meta: `${w.steps.length} step${w.steps.length === 1 ? '' : 's'}`, icon: 'workflow', keywords: w.title })) },
      { label: 'Heads of department', items: [chief, ...deps.filter(d => d.id !== 'exec').map(d => desks.find(x => x.id === d.lead))].filter(Boolean).map(d => ({ value: d.id, label: d.name, meta: modelName(d.model), keywords: `${d.role} ${deptName(d.dept)}` })) },
      ...deps.filter(d => d.id !== 'exec').map(dep => ({ label: dep.name, items: desks.filter(d => d.dept === dep.id && !leads.has(d.id)).map(d => ({ value: d.id, label: d.name, meta: modelName(d.model), keywords: `${d.role} ${dep.name}` })) })).filter(g => g.items.length),
    ];
    return {
      who, workflows,
      model: [{ items: MODELS.map(([value, label, meta]) => ({ value, label, meta })) }],
      effort: [{ items: EFFORTS.map(([value, label, meta]) => ({ value, label, meta })) }],
      whoLabel: v => (v.startsWith('wf:') ? `Workflow ${sentence(v.slice(3).replace(/-/g, ' '))}` : v ? desks.find(d => d.id === v)?.name : ''),
    };
  }, [desks, workflows, company]);
}

function Pickers({ to, setTo, model, setModel, effort, setEffort, showAt, toggleAt, at, setAt, onBig, choices, compact = false }) {
  return (
    <div className={`job-opts ${compact ? 'wrap' : ''}`}>
      <Combobox label="Who" value={to} onChange={setTo} groups={choices.who} placeholder="Type a desk or a workflow" width={340} />
      <Combobox label="Model" value={model} onChange={setModel} groups={choices.model} placeholder="Type a model" width={280} />
      <Combobox label="Effort" value={effort} onChange={setEffort} groups={choices.effort} placeholder="Type an effort" width={280} />
      <Tip text="Book it for a time instead of now"><button type="button" className={`btn btn-ghost ${showAt ? 'on' : ''}`} aria-pressed={showAt} onClick={toggleAt}><Icon name="clock" size={15} />{showAt && at ? whenLong(new Date(at).getTime()) : 'Later'}</button></Tip>
      {showAt && <input type="datetime-local" className="field dt" aria-label="Book for" value={at} min={localInput(Date.now())} onChange={e => setAt(e.target.value)} />}
      {onBig && <Tip text="A longer brief in a bigger box (Ctrl+Shift+E)"><button type="button" className="btn btn-ghost" onClick={onBig} aria-label="Big editor"><Icon name="expand" size={15} /><span className="lbl-wide">Big editor</span></button></Tip>}
    </div>
  );
}

const JobBar = React.forwardRef(function JobBar({ phone = false }, ref) {
  const a = useActions(); const choices = useChoices();
  const [text, setText] = useState(''); const [to, setTo] = useState(''); const [model, setModel] = useState(''); const [effort, setEffort] = useState('');
  const [at, setAt] = useState(''); const [showAt, setShowAt] = useState(false); const [big, setBig] = useState(false);
  const [flash, setFlash] = useState(null); const [busy, setBusy] = useState(false);
  const input = useRef(null); const mic = useRef(null); const bigBox = useRef(null); const timer = useRef(0);
  useImperativeHandle(ref, () => ({ focus: () => (phone ? setBig(true) : input.current?.focus()), mic: () => mic.current?.toggle(), big: () => setBig(true) }), [phone]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // a result fades after a few seconds; an error stays until it is dismissed or the next job is sent
  const say = (text, bad = false) => { setFlash({ text, bad }); announce(bad ? `Error: ${text}` : text); clearTimeout(timer.current); if (!bad) timer.current = setTimeout(() => setFlash(null), 5000); };
  const toggleAt = () => { const on = !showAt; setShowAt(on); if (on && !at) setAt(localInput(Date.now() + 3600000 - (Date.now() % 3600000))); };
  const send = async () => {
    const t = text.trim(); if (!t || busy) return;
    setBusy(true); setFlash(null);
    try {
      const rt = t.match(/^routine\s*:\s*(.+)$/is);
      if (rt) {
        const r = await a.addRoutine({ sentence: rt[1], agent: to && !to.startsWith('wf:') ? to : undefined, model: model || undefined, effort: effort || undefined });
        if (r.error) return say(r.error, true);
        say(`Routine added: ${r.routine.title}, ${r.whenText}${r.guess ? ' (check the time)' : ''}`);
      } else if (to.startsWith('wf:')) {
        const when = at && showAt ? new Date(at).getTime() : 0; const name = to.slice(3);
        if (when) { const r = await a.submit(`${name}: ${t}`, undefined, { at: when }); if (r.error) return say(r.error, true); say(`Workflow ${name} booked for ${whenLong(when)}`); }
        else { const r = await a.workflow(name, t); if (r?.error) return say(r.error, true); say(`Workflow ${name} started`); }
      } else {
        let when = at && showAt ? new Date(at).getTime() : 0; let job = t;
        if (!when) { const p = await a.parseAt(t).catch(() => null); if (p?.at) { when = p.at; job = p.task; } }
        const r = await a.submit(job, to || undefined, { model, effort, at: when || undefined });
        if (r.error) return say(r.error, true);
        say(when ? `Booked for ${whenLong(when)}: ${r.title}` : `Sent: ${r.title || job.slice(0, 60)}`);
      }
      setText(''); setAt(''); setShowAt(false); setBig(false);
    } catch (e) { say(String(e.message || e), true); } finally { setBusy(false); }
  };
  const label = [choices.whoLabel(to), model && modelName(model), effort && `effort ${EFFORTS.find(x => x[0] === effort)?.[1].toLowerCase()}`, at && showAt && `at ${whenLong(new Date(at).getTime())}`].filter(Boolean).join(' · ');
  const sendLabel = busy ? 'Sending…' : showAt && at ? 'Book' : 'Send';
  const pickers = { to, setTo, model, setModel, effort, setEffort, showAt, toggleAt, at, setAt, choices };
  const result = flash && <div className={flash.bad ? 'err-line' : 'ok-line'} role={flash.bad ? 'alert' : 'status'}><Icon name={flash.bad ? 'critical' : 'check'} size={14} sw={2} /><span>{flash.bad ? `Not sent. ${flash.text}` : flash.text}</span>{flash.bad && <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss the error" onClick={() => setFlash(null)}><Icon name="close" size={13} /></button>}</div>;
  return (
    <>
      {!phone && (
        <section className="panel jobbar" aria-label="A job for the office">
          <div className="job-input">
            <input ref={input} className="field field-lg" value={text} onChange={e => setText(e.target.value)} aria-label="A job for the office" placeholder={PLACEHOLDER}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } if ((e.key === 'E' || e.key === 'e') && e.shiftKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setBig(true); } }} />
            <MicButton ref={mic} value={text} onChange={setText} large />
            <button type="button" className="btn btn-primary btn-lg" disabled={busy || !text.trim()} onClick={send}>{sendLabel}<Icon name="send" size={16} sw={2} /></button>
          </div>
          <div className="job-row2">
            <Pickers {...pickers} onBig={() => setBig(true)} />
            {result || <span className="hint"><span className="kbd">/</span> to type <span className="kbd">M</span> to speak</span>}
          </div>
        </section>
      )}
      {phone && result && <div className="ph-flash">{result}</div>}
      {big && (
        <Modal title="A longer brief" sub={label || 'The office picks who takes it'} onClose={() => setBig(false)} width={880} initial={bigBox}
          footer={<><span className="meta t3">{phone ? '' : 'Ctrl+Enter sends · Esc keeps the text and closes'}</span><button type="button" className="btn btn-primary btn-lg" disabled={busy || !text.trim()} onClick={send}>{sendLabel}<Icon name="send" size={16} sw={2} /></button></>}>
          <Pickers {...pickers} compact />
          <div className="big-box">
            <textarea ref={bigBox} className="field big-text" value={text} onChange={e => setText(e.target.value)} aria-label="The whole job" rows={phone ? 10 : 16}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} placeholder="The whole job: what, for whom, the shape of the answer, anything to avoid." />
            {phone && <MicButton value={text} onChange={setText} large />}
          </div>
          {result}
        </Modal>
      )}
    </>
  );
});
export default JobBar;
