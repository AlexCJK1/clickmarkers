// The header: the office's name, whether it is open and how many desks are working, the sheets, the
// API meter and the clock. On the phone it shrinks to the name, the open state and the day's
// API spend, with a button for a new job; the sheets move to the tab bar.
import React, { useEffect, useState } from 'react';
import { useActions, useMeters, useCompany, useDrawer, useInTray, useNow, useOnline, useHealth } from '../lib/hooks.js';
import { usd, usdShort, hm, plural } from '../lib/format.js';
import { Icon, Meter, Tip } from './ui.jsx';

export function Mark({ size = 30 }) {
  return <svg className="mark" width={size} height={size} viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="13.5" className="mk-o" /><circle cx="15" cy="15" r="8.5" className="mk-r" strokeWidth="1.6" /><circle cx="15" cy="15" r="3.2" className="mk-c" /></svg>;
}
export const NAV = [
  [['room', 'War room', 'radar', null]],
  [['intray', 'In-tray', 'inbox', 'I'], ['board', 'Board', 'board', 'B']],
  [['ledger', 'Ledger', 'ledger', 'L'], ['numbers', 'Numbers', 'numbers', 'N'], ['calendar', 'Calendar', 'calendar', 'C']],
  [['brain', 'Brain', 'brain', 'G'], ['routines', 'Routines', 'routines', 'R']],
];
const NAV_TIP = { room: 'The floor, the suite and the numbers', intray: 'Drafts waiting for your OK', board: 'Every ticket', ledger: 'Spend by day, by desk and by run', numbers: 'Every chart, full size', calendar: 'Routines ahead, booked jobs, work done', brain: 'The notes and how they link', routines: 'The standing work and when it fires' };

function Clock() { const t = useNow(1000); return <span className="clock tnum" aria-label={`Time ${hm(t)}`}>{hm(t)}</span>; }

function ApiMeter() {
  const m = useMeters(); const lanes = m.lanes || {};
  const laneText = !lanes.apiKey ? 'No API key: nothing can run until ANTHROPIC_API_KEY is in the secrets file' : lanes.apiDown ? `The API is resting (${lanes.apiDown.why}); jobs wait until it is back` : 'Runs are billed to your API key; past the ceiling, jobs wait until midnight';
  const tip = `API spend today: ${usd(m.usd)} of the ${usdShort(m.ceiling)} ceiling (about £${m.gbp.toFixed(2)}).\n${m.runs} runs today.\n${laneText}.`;
  const f = m.ceiling ? m.usd / m.ceiling : 0;
  return <Tip text={tip}><div className="gauge" tabIndex={0} role="group" aria-label={`API today ${usd(m.usd)} of ${usdShort(m.ceiling)}`}><div className="gauge-top"><span>API today</span><b>{usd(m.usd)}</b></div><Meter value={m.usd} max={m.ceiling || 1} tone={f > 0.9 ? 'crit' : f > 0.75 ? 'warn' : ''} label="API spend today" /><div className="gauge-sub">of {usdShort(m.ceiling)} ceiling · {plural(m.runs, 'run')}</div></div></Tip>;
}

function OpenState({ compact = false }) {
  const m = useMeters(); const a = useActions();
  // On the phone a pause is one thumb away from a scroll, so it takes a second tap within four seconds.
  // Resuming takes one tap: opening the office again can do no harm.
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  useEffect(() => { setArmed(false); }, [m.paused]);
  const click = () => { if (m.paused) return a.pauseOffice(false); if (compact && !armed) return setArmed(true); setArmed(false); a.pauseOffice(true); };
  const label = m.paused ? 'Office paused. Resume' : armed ? 'Tap again to pause the office' : 'Office open. Pause';
  return (
    <Tip text={m.paused ? 'The office is paused: nothing new starts. Click to resume.' : 'The office is open. Click to pause it: nothing new starts, work in hand finishes.'}>
      <button type="button" className={`stat ${m.paused ? 'paused' : ''} ${armed ? 'armed' : ''}`} onClick={click} aria-pressed={m.paused} aria-label={label}>
        {m.paused ? <Icon name="pause" size={13} className="warn-ic" /> : armed ? <Icon name="pause" size={13} /> : <i className="live-dot" />}<b>{m.paused ? (compact ? 'Paused' : 'Office paused') : armed ? 'Pause?' : compact ? 'Open' : 'Office open'}</b>
      </button>
    </Tip>
  );
}

/** Banners for what needs the owner now: the office cannot be reached, or the API lane is resting. */
export function Banners() {
  const online = useOnline(); const lanes = useMeters().lanes || {}; const a = useActions(); const demo = useHealth()?.demo;
  return (
    <>
      {demo && <div className="banner info" role="status"><Icon name="info" size={16} sw={2} /><span>Demo office: a made-up business with made-up work and numbers. The office is paused and no model is reachable, so nothing runs and nothing is sent. Click round as you like.</span></div>}
      {!online && <div className="banner crit" role="alert"><Icon name="critical" size={16} sw={2} /><span>The office cannot be reached. The page keeps trying every few seconds; what you see may be out of date.</span></div>}
      {online && !demo && lanes.apiKey === false && <div className="banner serious" role="status"><Icon name="serious" size={16} sw={2} /><span>No API key: desks cannot run. Put ANTHROPIC_API_KEY in the secrets file; the office reads it within a few seconds.</span></div>}
      {online && lanes.apiDown && <div className="banner serious" role="status"><Icon name="serious" size={16} sw={2} /><span>The API is resting ({lanes.apiDown.why}). Jobs wait until it is back.</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => a.apiUp()}>Try the API again</button></div>}
    </>
  );
}

export default function Header() {
  const company = useCompany(); const m = useMeters(); const inTray = useInTray(); const drawer = useDrawer(); const a = useActions();
  return (
    <header className="hdr">
      <div className="brand"><Mark /><div style={{ minWidth: 0 }}><h1 className="brand-name">{company?.name || 'Nightdesk'}</h1><div className="brand-sub">{company?.business || ''}</div></div></div>
      <div className="hdr-group">
        <OpenState />
        <Tip text={m.working ? `${m.working} desk${m.working === 1 ? '' : 's'} working now` : 'No desk is working right now'}><span className="stat" tabIndex={0}>{m.working ? <i className="live-dot" /> : <i className="idle-dot" />}<b className="tnum">{m.working}</b>working</span></Tip>
      </div>
      <nav className="nav" aria-label="Main">
        {NAV.map((g, gi) => (
          <div className="nav-group" key={gi}>
            {g.map(([id, label, ic, key]) => {
              const on = id === 'room' ? !drawer : drawer === id;
              return (
                <Tip key={id} text={`${NAV_TIP[id]}${key ? ` (${key})` : ''}`}>
                  <button type="button" className="nav-item" aria-current={on ? 'page' : undefined} onClick={() => (id === 'room' ? (a.drawer(null), a.select(null)) : a.drawer(id))}>
                    <Icon name={ic} size={16} /><span>{label}</span>{id === 'intray' && <span className={`count ${inTray.length ? 'count-warn' : ''}`} aria-label={`${inTray.length} waiting`}>{inTray.length}</span>}
                  </button>
                </Tip>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="hdr-group meters"><ApiMeter /></div>
      <div className="hdr-group"><Clock /></div>
    </header>
  );
}

/** The phone's header: name, open state, today's API spend, a new job. */
export function PhoneHeader({ onNewJob }) {
  const company = useCompany(); const m = useMeters();
  return (
    <header className="ph-hdr">
      <Mark size={28} />
      <div className="brand-name ph-name">{company?.name || 'Nightdesk'}</div>
      <OpenState compact />
      <span className="ph-api tnum" aria-label={`API today ${usd(m.usd)}`}>API {usd(m.usd)}</span>
      <button type="button" className="btn btn-primary btn-icon" onClick={onNewJob} aria-label="A new job"><Icon name="plus" size={20} sw={2} /></button>
    </header>
  );
}
