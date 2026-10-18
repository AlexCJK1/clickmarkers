// The executive suite: the chief and the department leads as cards. Each card shows the pod's portrait,
// the desk's state as a shape and a word, what it last did, and its share of the day's API budget; the
// foot opens the team below it. Hover a card and the war room lights the pod; click it to open the desk.
import React, { Fragment, useMemo, useState } from 'react';
import { useActions, useDesk, useHovered, useSelected, useSuite } from '../lib/hooks.js';
import { useOffice, deskStatus } from '../lib/store.js';
import { usd, when, dur, hm, modelName, plural } from '../lib/format.js';
import { usePodStill } from '../floor/stills.js';
import { DESK_STATE, Icon, Meter, Skeleton, StateMark } from './ui.jsx';
import { useReady } from '../lib/hooks.js';

const variantOf = (status, lit) => (lit && status === 'idle' ? 'hot' : status);
/** The pod portrait, or a drawn mark while it renders (or without WebGL). */
export function PodPortrait({ kind = 'lead', status = 'idle', lit = false, size = 36 }) {
  const url = usePodStill(kind === 'chief' ? 'chief' : 'lead', variantOf(status, lit));
  if (url) return <img src={url} width={size} height={size} alt="" className="pod-img" />;
  return <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className={`pod-mark st-${lit && status === 'idle' ? 'hot' : status}`}><circle cx="20" cy="22" r="15" className="pm-body" /><circle cx="20" cy="20" r="10" className="pm-ring" strokeWidth="2" /><circle cx="20" cy="19" r="4" className="pm-core" /></svg>;
}

/** The last thing a desk did, from the wire or the ledger: "ran at 12:08", "done in 21 s". */
function useLastLine(id, status, short = false) {
  const live = useOffice(s => s.lastLine[id] || null);
  const run = useOffice(s => (s.ledger?.recent || []).find(r => r.agent === id) || null);
  return useMemo(() => {
    // while the desk works, its live line; otherwise when it last ran, which reads better than a log line
    if (live && live.type === 'run' && live.stage === 'start') return `started at ${hm(live.at)}`;
    if (live && (status === 'working' || !run || live.at > run.at + 60000)) return live.text;
    // the half-width cards have room for when, not how long
    if (run) { const w = when(run.at); return short ? `ran ${w}` : `${/^\d/.test(w) ? 'ran at' : 'last ran'} ${w}${run.ms ? ` in ${dur(run.ms)}` : ''}`; }
    return 'no runs yet';
  }, [live, run, status, short]);
}

function Card({ id, wide = false, team, open, onToggle, kind }) {
  const { desk, status, today, waiting } = useDesk(id); const a = useActions();
  const lit = useSelected() === id; const hov = useHovered() === id; const line = useLastLine(id, status, !wide);
  if (!desk) return null;
  const st = DESK_STATE[status] || DESK_STATE.idle;
  return (
    <div className={`desk-card ${wide ? 'wide' : ''} ${lit ? 'on' : ''} ${hov && !lit ? 'hov' : ''}`} onMouseEnter={() => a.hover(id)} onMouseLeave={() => a.hover(null)}>
      <button type="button" className="open" onClick={() => a.select(id)} onFocus={() => a.hover(id)} onBlur={() => a.hover(null)} aria-label={`Open ${desk.name}, ${st.word.toLowerCase()}`} aria-pressed={lit} />
      <div className="desk-head">
        <PodPortrait kind={kind} status={status} lit={lit || hov} size={wide ? 52 : 34} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="desk-name">{desk.name}</div>
          <div className="desk-sub">{modelName(desk.model)}{wide && team ? ` · the hub, ${plural(team.groups, 'department')}` : ''}</div>
        </div>
        {waiting > 0 && <span className="count count-warn" aria-label={`${waiting} waiting for you`}>{waiting}</span>}
      </div>
      <div className={`desk-state ${st.cls}`}><StateMark status={status} /><span><b>{st.word}</b> · {status === 'waiting' ? `${waiting} draft${waiting === 1 ? '' : 's'} for your OK` : line}</span></div>
      {(today > 0 || wide) && <div className="bud"><Meter value={today} max={desk.budgetUsd || 1} tone={today > desk.budgetUsd * 0.9 ? 'crit' : ''} label={`${desk.name}: API spend today`} /><span>{usd(today)} of {usd(desk.budgetUsd)}{wide ? ' today' : ''}</span></div>}
      {!wide && team && (
        <div className="desk-foot">
          <button type="button" className="live-ctl" aria-expanded={open} onClick={onToggle}>{plural(team.desks.length, 'desk')}<Icon name={open ? 'chevronUp' : 'chevron'} size={14} /></button>
          <span className="money">{team.today > 0 ? `Team ${usd(team.today)}` : 'No spend'}</span>
        </div>
      )}
    </div>
  );
}

function Chip({ id }) {
  const a = useActions(); const status = useOffice(s => deskStatus(s, id)); const name = useOffice(s => s.desks.find(d => d.id === id)?.name || id); const waiting = useOffice(s => s.waiting[id] || 0); const lit = useSelected() === id;
  return (
    <button type="button" className={`desk-chip ${lit ? 'on' : ''}`} onMouseEnter={() => a.hover(id)} onMouseLeave={() => a.hover(null)} onFocus={() => a.hover(id)} onBlur={() => a.hover(null)} onClick={() => a.select(id)} aria-pressed={lit} aria-label={`Open ${name}${status !== 'idle' ? `, ${DESK_STATE[status].word.toLowerCase()}` : ''}`}>
      <StateMark status={status} /><span>{name}</span>{waiting > 0 && <span className="count count-warn">{waiting}</span>}
    </button>
  );
}

export default function ExecutiveSuite({ className = '' }) {
  const suite = useSuite(); const [open, setOpen] = useState({});
  const byAgent = useOffice(s => s.ledger?.today?.byAgent || {}); const total = useOffice(s => s.desks.length);
  const ready = useReady();
  if (!suite.chief) return <section className={`panel suite ${className}`} aria-labelledby="suite-t"><div className="panel-h"><h2 id="suite-t" className="title-l">Executive suite</h2></div><div className="suite-grid">{ready ? <p className="meta t3">No desks in the company file.</p> : <Skeleton rows={[96, 120, 120, 120]} className="span2" />}</div></section>;
  const teams = suite.groups.filter(g => g.lead).map(g => ({ ...g, today: [g.lead, ...g.desks].reduce((x, d) => x + (byAgent[d.id] || 0), 0) }));
  const rows = []; for (let i = 0; i < teams.length; i += 2) rows.push(teams.slice(i, i + 2));
  return (
    <section className={`panel suite ${className}`} aria-labelledby="suite-t">
      <div className="panel-h"><h2 id="suite-t" className="title-l">Executive suite</h2><span className="aside">{total} desks<span className="wide-only">· spend is today's</span></span></div>
      <div className="suite-grid">
        <Card id={suite.chief.id} wide kind="chief" team={{ groups: teams.length }} />
        {rows.map((row, ri) => (
          <Fragment key={ri}>
            {row.map(t => <Card key={t.dept.id} id={t.lead.id} kind="lead" team={t} open={!!open[t.dept.id]} onToggle={() => setOpen(o => ({ ...o, [t.dept.id]: !o[t.dept.id] }))} />)}
            {row.filter(t => open[t.dept.id]).map(t => <div key={'l' + t.dept.id} className="desk-list" role="group" aria-label={`${t.dept.name} desks`}><div className="cap desk-list-h">{t.dept.name}</div>{t.desks.map(d => <Chip key={d.id} id={d.id} />)}</div>)}
          </Fragment>
        ))}
      </div>
    </section>
  );
}
