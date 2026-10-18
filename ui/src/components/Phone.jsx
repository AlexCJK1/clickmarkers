// The page under 1024 px: a fixed header, one page at a time, a tab bar at the foot (war room, in-tray
// with its count, numbers, logs, more). Everything else opens as a full-screen sheet with a Back button.
import React from 'react';
import { useActions, useInTray } from '../lib/hooks.js';
import WarRoom from './WarRoom.jsx';
import LiveLogs from './LiveLogs.jsx';
import { TrayList } from './InTray.jsx';
import { NumbersBody } from './Numbers.jsx';
import ExecutiveSuite from './ExecutiveSuite.jsx';
import { Sheet } from './Sheet.jsx';
import { CostPerChat, Freshness, LeadsToday, SpendToday, Stuck, Waiting, useFigures } from './Telemetry.jsx';
import { Icon } from './ui.jsx';

export const PHONE_TABS = [['room', 'War room', 'radar'], ['intray', 'In-tray', 'inbox'], ['numbers', 'Numbers', 'numbers'], ['logs', 'Logs', 'logs'], ['more', 'More', 'more']];
const MORE = [['suite', 'Executive suite', 'users', 'Every desk and its state'], ['board', 'Board', 'board', 'Every ticket'], ['ledger', 'Ledger', 'ledger', 'Spend by day, desk and run'], ['routines', 'Routines', 'routines', 'The standing work'], ['calendar', 'Calendar', 'calendar', 'Routines ahead, booked jobs'], ['brain', 'Brain', 'brain', 'The notes and their links'], ['help', 'Keys and help', 'keyboard', 'How the room works']];

export function PhoneTabs({ tab, setTab }) {
  const n = useInTray().length;
  return (
    <nav className="ph-tabs" aria-label="Main">
      {PHONE_TABS.map(([k, l, ic]) => <button key={k} type="button" className="ph-tab" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}><Icon name={ic} size={22} /><span>{l}</span>{k === 'intray' && n > 0 && <span className="count count-warn" aria-label={`${n} waiting`}>{n}</span>}</button>)}
    </nav>
  );
}

function RoomPage() {
  const F = useFigures();
  return (
    <>
      <h1 className="sr-only">The office</h1>
      <WarRoom phone />
      {F && <div className="ph-tiles"><div className="span2"><CostPerChat F={F} phone /></div><SpendToday F={F} phone /><LeadsToday F={F} phone /><Waiting F={F} phone /><Stuck F={F} phone /></div>}
    </>
  );
}

export function PhonePage({ tab, onSuite }) {
  const a = useActions();
  if (tab === 'intray') return <section className="ph-page" aria-labelledby="pg-t"><h1 id="pg-t" className="title-l">In-tray</h1><TrayList /></section>;
  if (tab === 'numbers') return <section className="ph-page" aria-labelledby="pg-t"><div className="row-ctl"><h1 id="pg-t" className="title-l grow">Numbers</h1><Freshness compact /></div><NumbersBody n={14} /></section>;
  if (tab === 'logs') return <><h1 className="sr-only">Live logs</h1><LiveLogs className="ph-logs" phone /></>;
  if (tab === 'more') return (
    <section className="ph-page" aria-labelledby="pg-t">
      <h1 id="pg-t" className="title-l">More</h1>
      <ul className="menu">{MORE.map(([k, l, ic, m]) => <li key={k}><button type="button" className="menu-row" onClick={() => (k === 'suite' ? onSuite() : a.drawer(k))}><Icon name={ic} size={20} /><span>{l}</span><span className="m">{m}</span><Icon name="chevronRight" size={16} /></button></li>)}</ul>
    </section>
  );
  return <RoomPage />;
}

export function SuiteSheet({ onClose }) {
  return <Sheet title="Executive suite" onClose={onClose} bodyClass="suite-sheet"><ExecutiveSuite className="bare" /></Sheet>;
}
