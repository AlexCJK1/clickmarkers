// The Clickmarkers page. On a wide screen: three columns, the executive suite with the live logs under
// it, the war room with the job bar under it, and telemetry (or the desk in hand). The in-tray, board,
// ledger, routines, numbers, calendar, brain and help open as sheets from the right. Under 1024 px it is
// the phone layout: a header, one page at a time and a tab bar, every sheet full screen.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Header, { Banners, PhoneHeader } from './components/Header.jsx';
import ExecutiveSuite from './components/ExecutiveSuite.jsx';
import LiveLogs from './components/LiveLogs.jsx';
import Telemetry from './components/Telemetry.jsx';
import DeskDeck from './components/DeskDeck.jsx';
import Drawers from './components/Drawers.jsx';
import JobBar from './components/JobBar.jsx';
import PowerOn from './components/PowerOn.jsx';
import WarRoom from './components/WarRoom.jsx';
import { PhonePage, PhoneTabs, SuiteSheet } from './components/Phone.jsx';
import { Announcer, announce } from './components/ui.jsx';
import { useActions, useCompany, useDrawer, useInTray, useIsPhone, useSelected } from './lib/hooks.js';
import { useOffice, deskName, tidyTitle } from './lib/store.js';
import { plain } from './lib/format.js';

const typing = e => {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};
const DRAWERS = {
  i: 'intray',
  b: 'board',
  l: 'ledger',
  r: 'routines',
  n: 'numbers',
  c: 'calendar',
  g: 'brain',
  '?': 'help',
};

/** Tell a screen reader when a new draft lands in the in-tray. */
function useTrayAnnouncer() {
  const items = useInTray();
  const names = useOffice(s => x => deskName(s, x));
  const ready = useOffice(s => s.ready);
  const seen = useRef(null);
  useEffect(() => {
    // The first list after the office answers is the baseline: drafts already waiting are not news.
    if (!ready) return;
    const ids = new Set(items.map(t => t.id));
    if (seen.current)
      for (const t of items)
        if (!seen.current.has(t.id)) announce(`New draft for your OK from ${names(t.agent)}: ${tidyTitle(t.title)}`);
    seen.current = ids;
  }, [items, ready]);
}

export default function App() {
  const a = useActions();
  const selected = useSelected();
  const drawer = useDrawer();
  const company = useCompany();
  const phone = useIsPhone();
  const jobBar = useRef(null);
  const [on, setOn] = useState(() => {
    try {
      return sessionStorage.getItem('cm:on') === '1';
    } catch {
      return false;
    }
  });
  const done = useCallback(() => {
    setOn(true);
    try {
      sessionStorage.setItem('cm:on', '1');
    } catch {
      // no session storage (a private window): the welcome shows again next time, no harm
    }
  }, []);
  const [tab, setTab] = useState('room');
  const [suite, setSuite] = useState(false);
  useTrayAnnouncer();
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') {
        if (typing(e)) return;
        if (selected || drawer) {
          a.select(null);
          a.drawer(null);
        }
        return;
      }
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.key === 'E' || e.key === 'e') && e.shiftKey && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          jobBar.current?.big();
        }
        return;
      }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === '?' || (k === '/' && e.shiftKey)) {
        e.preventDefault();
        a.drawer(drawer === 'help' ? null : 'help');
        return;
      }
      if (DRAWERS[k]) {
        e.preventDefault();
        a.drawer(DRAWERS[k]);
        return;
      }
      if (k === '/') {
        e.preventDefault();
        a.drawer(null);
        jobBar.current?.focus();
        return;
      }
      if (k === 'm') {
        e.preventDefault();
        jobBar.current?.mic();
        return;
      }
      if (k === 'k') {
        e.preventDefault();
        announce('Checking the connectors');
        a.checkConnectors().then(r => {
          if (r?.error) announce(`Not checked. ${plain(r.error)}`);
        });
        return;
      }
      if (k === '0') {
        a.select(null);
        a.drawer(null);
        return;
      }
      if (/^[1-9]$/.test(k)) {
        const deps = (company?.departments || []).filter(d => d.id !== 'exec');
        const d = deps[+k - 1];
        if (d) {
          e.preventDefault();
          a.select(d.lead);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [a, selected, drawer, company]);
  const goTab = k => {
    setTab(k);
    a.drawer(null);
    a.select(null);
  };
  return (
    <>
      {!on && <PowerOn onDone={done} />}
      {phone ? (
        <div className="ph">
          <PhoneHeader onNewJob={() => jobBar.current?.big()} />
          <Banners />
          <main className={`ph-main ${tab}`} id="main">
            <PhonePage tab={tab} onSuite={() => setSuite(true)} />
          </main>
          <PhoneTabs tab={tab} setTab={goTab} />
          <JobBar ref={jobBar} phone />
          {suite && !selected && <SuiteSheet onClose={() => setSuite(false)} />}
          {selected && <DeskDeck id={selected} asSheet />}
        </div>
      ) : (
        <div className="app">
          <Header />
          <Banners />
          <main className="grid-main" id="main">
            <div className="col">
              <ExecutiveSuite />
              <LiveLogs />
            </div>
            <div className="col">
              <WarRoom />
              <JobBar ref={jobBar} />
            </div>
            <div className="col">{selected ? <DeskDeck key={selected} id={selected} /> : <Telemetry />}</div>
          </main>
        </div>
      )}
      <Drawers />
      <Announcer />
    </>
  );
}
