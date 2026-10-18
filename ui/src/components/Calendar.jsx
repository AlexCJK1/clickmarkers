// The calendar: routines ahead, jobs booked for a time, and work done (on the day it finished). What runs
// every day sits once in a lane above the grid, so the cells hold only the exceptions: the weekly and
// one-off routines, the booked jobs, what finished and what failed. Month or week, weeks start on Monday;
// on the phone it is an agenda. Click anything for its controls; + on a day books a job or a routine.
// Keys while it is open: left and right move, W week, M month, T today.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useActions, useCompany, useDesks, useIsPhone } from '../lib/hooks.js';
import { deskName, tidyTitle } from '../lib/store.js';
import { hm, whenLong, weekdayDate, dayHeading } from '../lib/format.js';
import { Sheet, Modal } from './Sheet.jsx';
import Combobox from './Combobox.jsx';
import { useChoices } from './JobBar.jsx';
import { Icon, Seg, Tag, announce } from './ui.jsx';

const DAY = 86400000;
const startOfDay = d => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const mondayOf = d => {
  const x = startOfDay(d);
  const wd = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - wd);
  return x;
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const key = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LANES = [
  ['daily', 'Every day', /^(daily|every day|hourly|every \d+ (hour|minute)s?)/i],
  ['weekdays', 'Weekdays', /^weekdays?/i],
];
const laneOf = r => LANES.find(([, , re]) => re.test(r.whenText || ''))?.[0] || null;
const ICON = it =>
  it.kind === 'routine'
    ? 'repeat'
    : it.kind === 'scheduled'
      ? 'booked'
      : it.kind === 'open'
        ? 'working'
        : it.state === 'failed'
          ? 'critical'
          : 'done';

function Item({ it, onPick, names }) {
  return (
    <button
      type="button"
      className={`cal-item k-${it.kind} ${it.state === 'failed' ? 'k-failed' : ''} ${it.paused ? 'is-paused' : ''}`}
      onClick={() => onPick(it)}
      aria-label={`${it.kind === 'done' ? (it.state === 'failed' ? 'Failed' : 'Done') : it.kind === 'scheduled' ? 'Booked' : it.kind === 'open' ? 'Open' : 'Routine'}: ${tidyTitle(it.title)}, ${names(it.agent)}, ${hm(it.at)}`}
    >
      <Icon name={ICON(it)} size={12} sw={2} />
      <span>
        {it.kind !== 'done' ? `${hm(it.at)} ` : ''}
        {tidyTitle(it.title)}
      </span>
    </button>
  );
}

function Detail({ it, onClose, reload }) {
  const a = useActions();
  const desks = useDesks();
  const names = id => deskName({ desks }, id);
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState('');
  const act = async (fn, after = '') => {
    const r = await fn();
    if (r?.error) setMsg(r.error);
    else {
      setMsg(after);
      announce(after);
      reload();
    }
  };
  const what =
    it.kind === 'routine'
      ? `${it.whenText}${it.needsOk ? ' · waits for your OK' : ''}`
      : it.kind === 'scheduled'
        ? `Booked for ${whenLong(it.at)}`
        : `${it.state === 'failed' ? 'Failed' : it.kind === 'open' ? 'Open' : 'Done'} ${whenLong(it.at)}`;
  return (
    <Modal title={tidyTitle(it.title)} sub={`${names(it.agent)} · ${what}`} onClose={onClose} width={480}>
      {it.kind === 'routine' && (
        <p className="meta">
          This run {whenLong(it.at)} · last fired {it.lastSlot || 'never'}
        </p>
      )}
      {it.deliverable && <p className="meta">Saved in the brain: {it.deliverable}</p>}
      <div className="row-ctl wrap">
        {it.kind === 'routine' && (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => act(() => a.runRoutine(it.id), 'Started: the result lands in the desk')}
            >
              <Icon name="play" size={13} />
              Run now
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => act(() => a.pauseRoutine(it.id, !it.paused), it.paused ? 'Resumed' : 'Paused')}
            >
              <Icon name={it.paused ? 'play' : 'pause'} size={13} />
              {it.paused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              className={`btn ${sure ? 'btn-danger-fill' : 'btn-danger'}`}
              onClick={() => (sure ? act(() => a.deleteRoutine(it.id), 'Deleted') : setSure(true))}
            >
              <Icon name="trash" size={13} />
              {sure ? 'Sure? Delete' : 'Delete'}
            </button>
          </>
        )}
        {it.kind === 'scheduled' && (
          <button type="button" className="btn btn-danger" onClick={() => act(() => a.cancel(it.id), 'Cancelled')}>
            <Icon name="close" size={13} />
            Cancel it
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            onClose();
            a.select(it.agent);
          }}
        >
          <Icon name="desk" size={14} />
          Open the desk
        </button>
      </div>
      {msg && (
        <div className="ok-line" role="status">
          <Icon name="check" size={14} sw={2} />
          <span>{msg}</span>
        </div>
      )}
    </Modal>
  );
}

function Book({ day, onClose, reload }) {
  const a = useActions();
  const c = useChoices();
  const groups = useMemo(() => [c.who[0], ...c.who.slice(2)], [c]);
  const [time, setTime] = useState('09:00');
  const [text, setText] = useState('');
  const [agent, setAgent] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setMsg('');
    const [h, m] = time.split(':').map(Number);
    const at = new Date(day);
    at.setHours(h, m, 0, 0);
    const r = repeat
      ? await a.addRoutine({ sentence: `every ${WD[day.getDay()]} at ${time} ${text}`, agent: agent || undefined })
      : await a.submit(text, agent || undefined, { at: at.getTime() });
    setBusy(false);
    if (r.error) {
      setMsg(r.error);
      return;
    }
    announce(repeat ? 'Routine added' : `Booked for ${whenLong(at.getTime())}`);
    reload();
    onClose();
  };
  return (
    <Modal
      title={`Book on ${day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <label className="check-l">
            <input type="checkbox" className="check" checked={repeat} onChange={e => setRepeat(e.target.checked)} />
            Repeat every {WD[day.getDay()]}
          </label>
          <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={go}>
            {busy ? 'Booking…' : repeat ? 'Add routine' : 'Book it'}
          </button>
        </>
      }
    >
      <textarea
        className="field"
        data-autofocus
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        placeholder="What should happen"
        aria-label="What should happen"
      />
      <div className="row-ctl wrap">
        <input
          type="time"
          className="field dt"
          value={time}
          onChange={e => setTime(e.target.value)}
          aria-label="Time"
        />
        <Combobox label="Who" value={agent} onChange={setAgent} groups={groups} placeholder="Type a desk" />
      </div>
      {msg && (
        <div className="err-line" role="alert">
          <Icon name="critical" size={14} sw={2} />
          <span>{msg}</span>
        </div>
      )}
    </Modal>
  );
}

export default function Calendar() {
  const a = useActions();
  const desks = useDesks();
  const company = useCompany();
  const phone = useIsPhone();
  const [view, setView] = useState('month');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [data, setData] = useState(null);
  const [pick, setPick] = useState(null);
  const [book, setBook] = useState(null);
  const [depts, setDepts] = useState(new Set());
  const [showRoutines, setShowRoutines] = useState(true);
  const [showDone, setShowDone] = useState(true);
  const [q, setQ] = useState('');
  const names = useCallback(id => deskName({ desks }, id), [desks]);
  const range = useMemo(() => {
    if (phone) return { start: startOfDay(anchor), days: 14 };
    if (view === 'week') return { start: mondayOf(anchor), days: 7 };
    const s = mondayOf(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    const end = addDays(mondayOf(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)), 7);
    return { start: s, days: Math.round((startOfDay(end) - s) / DAY) };
  }, [view, anchor, phone]);
  // a month cell shows as many items as its height holds (a day line, then 20 px an item), and when some
  // are left over, one line fewer plus "N more"; the counts come from the CSS sizes of .cal-day and .cal-item
  const [cellsEl, setCellsEl] = useState(null);
  const [gridH, setGridH] = useState(0);
  useEffect(() => {
    if (!cellsEl) return undefined;
    const ro = new ResizeObserver(() => setGridH(Math.round(cellsEl.clientHeight)));
    ro.observe(cellsEl);
    return () => ro.disconnect();
  }, [cellsEl]);
  // and again after every render, before paint: the lane above the grid arrives with the data and takes its room
  useLayoutEffect(() => {
    if (cellsEl) {
      const h = Math.round(cellsEl.clientHeight);
      if (h !== gridH) setGridH(h);
    }
  });
  const fits = useMemo(() => {
    const rows = Math.max(1, Math.round(range.days / 7));
    const room = (gridH - (rows - 1) * 4) / rows - 12 - 26; // an item and the "more" button are each 24 px tall with a 2 px gap
    return gridH
      ? { all: Math.max(1, Math.floor((room + 2) / 26)), withMore: Math.max(1, Math.floor((room - 24) / 26)) }
      : { all: 3, withMore: 2 };
  }, [gridH, range.days]);
  const load = useCallback(() => {
    a.calendar(range.start.getTime(), addDays(range.start, range.days).getTime() - 1)
      .then(setData)
      .catch(() => {});
  }, [a, range]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (pick || book) return undefined;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load, pick, book]);
  const move = useCallback(
    dir =>
      setAnchor(x =>
        phone
          ? addDays(x, dir * 14)
          : view === 'week'
            ? addDays(x, dir * 7)
            : new Date(x.getFullYear(), x.getMonth() + dir, 1),
      ),
    [view, phone],
  );
  useEffect(() => {
    const onKey = e => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || pick || book) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const hit = {
        ArrowLeft: () => move(-1),
        ArrowRight: () => move(1),
        w: () => setView('week'),
        m: () => setView('month'),
        t: () => setAnchor(startOfDay(new Date())),
      }[k];
      if (hit && !document.activeElement?.closest?.('[role="tablist"],[role="listbox"]')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hit();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [move, pick, book]);
  const deptOf = useCallback(id => desks.find(d => d.id === id)?.dept || '', [desks]);
  const keep = useCallback(
    it =>
      (!depts.size || depts.has(it.dept || deptOf(it.agent))) &&
      (!q || `${it.title} ${names(it.agent)}`.toLowerCase().includes(q.toLowerCase())),
    [depts, q, names, deptOf],
  );
  const { byDay, lanes } = useMemo(() => {
    const out = {};
    const ln = { daily: [], weekdays: [] };
    if (!data) return { byDay: out, lanes: ln };
    const push = it => {
      if (!keep(it)) return;
      (out[key(new Date(it.at))] ||= []).push(it);
    };
    if (showRoutines)
      for (const r of data.routines) {
        const l = laneOf(r);
        if (l) {
          if (keep(r)) ln[l].push(r);
          continue;
        }
        for (const at of r.slots) push({ ...r, kind: 'routine', at });
      }
    for (const s of data.scheduled) push({ ...s, kind: 'scheduled' });
    if (showDone) for (const d of data.done) push({ ...d, kind: 'done' });
    for (const o of data.open) push({ ...o, kind: 'open' });
    for (const k of Object.keys(out)) out[k].sort((x, y) => x.at - y.at);
    for (const l of Object.values(ln))
      l.sort(
        (x, y) =>
          ((x.nextAt || 0) % DAY) - ((y.nextAt || 0) % DAY) || String(x.whenText).localeCompare(String(y.whenText)),
      );
    return { byDay: out, lanes: ln };
  }, [data, keep, showRoutines, showDone]);
  const counts = useMemo(() => {
    const all = Object.values(byDay).flat();
    return {
      routine: all.filter(x => x.kind === 'routine').length + lanes.daily.length + lanes.weekdays.length,
      scheduled: all.filter(x => x.kind === 'scheduled').length,
      done: all.filter(x => x.kind === 'done').length,
    };
  }, [byDay, lanes]);
  const today = startOfDay(new Date());
  const title = phone
    ? `${range.start.getDate()} ${range.start.toLocaleDateString('en-GB', { month: 'short' })} to ${addDays(range.start, 13).getDate()} ${addDays(range.start, 13).toLocaleDateString('en-GB', { month: 'short' })}`
    : view === 'week'
      ? `${range.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} to ${addDays(range.start, 6).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const deps = (company?.departments || []).filter(d => d.id !== 'exec');
  const toggleDept = id =>
    setDepts(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const onPick = it => {
    setBook(null);
    setPick(it);
  };
  const laneBlock = lanes.daily.length + lanes.weekdays.length > 0 && (
    <div className="lanes">
      {LANES.map(
        ([k, label]) =>
          lanes[k].length > 0 && (
            <div key={k} className="lane-row">
              <span className="lane-h">
                <Icon name="repeat" size={13} />
                {label}
              </span>
              <div className="lane">
                {lanes[k].map(r => (
                  <button
                    key={r.id}
                    type="button"
                    className={`lane-item ${r.paused ? 'is-paused' : ''}`}
                    onClick={() => onPick({ ...r, kind: 'routine', at: r.nextAt || r.slots?.[0] })}
                  >
                    <b className="tnum">
                      {(r.whenText || '').replace(/^(daily|weekdays?|every day)\s*/i, '') || r.whenText}
                    </b>
                    <span>{tidyTitle(r.title).split(':')[0]}</span>
                    <span className="t3">{names(r.agent)}</span>
                    {r.paused && <Icon name="pause" size={12} />}
                  </button>
                ))}
              </div>
            </div>
          ),
      )}
    </div>
  );
  return (
    <Sheet
      title="Calendar"
      size="xl"
      onClose={() => a.drawer(null)}
      sub="Routines ahead, booked jobs, work done. Left and right move, W week, M month, T today."
      bodyClass={phone ? 'cal-body' : 'fill cal-body'}
    >
      <div className="cal-bar">
        <div className="row-ctl">
          <button type="button" className="btn btn-secondary btn-icon" aria-label="Earlier" onClick={() => move(-1)}>
            <Icon name="chevronLeft" size={16} />
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setAnchor(startOfDay(new Date()))}>
            Today
          </button>
          <button type="button" className="btn btn-secondary btn-icon" aria-label="Later" onClick={() => move(1)}>
            <Icon name="chevronRight" size={16} />
          </button>
          <h3 className="title-s cal-title" aria-live="polite">
            {title}
          </h3>
          {!phone && (
            <Seg
              label="View"
              value={view}
              onChange={setView}
              options={[
                ['month', 'Month'],
                ['week', 'Week'],
              ]}
            />
          )}
        </div>
        <div className="row-ctl wrap cal-filters">
          {(() => {
            const t = (
              <div className="toggles" role="group" aria-label="Departments">
                {deps.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    className="toggle"
                    aria-pressed={depts.has(d.id)}
                    onClick={() => toggleDept(d.id)}
                  >
                    {d.name}
                  </button>
                ))}
                {depts.size > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDepts(new Set())}>
                    Every department
                  </button>
                )}
              </div>
            );
            return phone ? (
              <details className="cal-depts">
                <summary className="btn btn-secondary">Departments{depts.size ? ` (${depts.size})` : ''}</summary>
                {t}
              </details>
            ) : (
              t
            );
          })()}
          <button
            type="button"
            className="toggle"
            aria-pressed={showRoutines}
            onClick={() => setShowRoutines(!showRoutines)}
          >
            <Icon name="repeat" size={13} />
            Routines
          </button>
          <button type="button" className="toggle" aria-pressed={showDone} onClick={() => setShowDone(!showDone)}>
            <Icon name="done" size={13} />
            Done
          </button>
          <input
            className="field cal-search"
            value={q}
            data-esc="local"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape' && q) {
                e.preventDefault();
                setQ('');
              }
            }}
            placeholder="Search"
            aria-label="Search the calendar"
          />
          <span className="meta t3">
            {counts.routine} routine runs · {counts.scheduled} booked · {counts.done} done
          </span>
        </div>
      </div>
      {laneBlock}
      {phone ? (
        <ol className="agenda">
          {Array.from({ length: range.days }, (_, i) => addDays(range.start, i)).map(d => {
            const items = byDay[key(d)] || [];
            return (
              <li key={key(d)} className={`agenda-day ${+d === +today ? 'today' : ''}`}>
                <div className="agenda-h">
                  <b>{dayHeading(d.getTime())}</b>
                  {d >= today && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      aria-label={`Book on ${weekdayDate(d)}`}
                      onClick={() => {
                        setPick(null);
                        setBook(d);
                      }}
                    >
                      <Icon name="plus" size={16} />
                    </button>
                  )}
                </div>
                {items.length ? (
                  items.map((it, j) => <Item key={j} it={it} names={names} onPick={onPick} />)
                ) : (
                  <p className="meta t3">Nothing but the standing routines.</p>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="cal-wrap">
          <div className="cal-grid cal-head" aria-hidden="true">
            {DAYS.map(d => (
              <div key={d} className="cap">
                {d}
              </div>
            ))}
          </div>
          <ul ref={setCellsEl} className={`cal-grid cal-cells ${view}`} aria-label={title}>
            {Array.from({ length: range.days }, (_, i) => addDays(range.start, i)).map(d => {
              const items = byDay[key(d)] || [];
              const isToday = +d === +today;
              const past = d < today;
              const other = view === 'month' && d.getMonth() !== anchor.getMonth();
              const lim = view === 'week' || items.length <= fits.all ? items.length : fits.withMore;
              return (
                <li
                  key={key(d)}
                  className={`cal-cell ${isToday ? 'today' : ''} ${other ? 'other' : ''}`}
                  aria-current={isToday ? 'date' : undefined}
                >
                  <div className="cal-day">
                    <b className="tnum" aria-hidden="true">
                      {d.getDate()}
                    </b>
                    <span className="sr-only">
                      {weekdayDate(d)}
                      {items.length ? `, ${items.length} ${items.length === 1 ? 'item' : 'items'}` : ', nothing booked'}
                    </span>
                    {!past && (
                      <button
                        type="button"
                        className="cal-add"
                        aria-label={`Book on ${weekdayDate(d)}`}
                        onClick={() => {
                          setPick(null);
                          setBook(d);
                        }}
                      >
                        <Icon name="plus" size={14} />
                      </button>
                    )}
                  </div>
                  <div className="cal-items">
                    {items.slice(0, lim).map((it, j) => (
                      <Item key={j} it={it} names={names} onPick={onPick} />
                    ))}
                    {items.length > lim && (
                      <button
                        type="button"
                        className="cal-more"
                        onClick={() => {
                          setView('week');
                          setAnchor(d);
                        }}
                      >
                        {items.length - lim} more
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="legend cal-legend">
        <span>
          <Icon name="repeat" size={12} sw={2} className="lg-routine" />
          Routine
        </span>
        <span>
          <Icon name="booked" size={12} sw={2} className="lg-booked" />
          Booked
        </span>
        <span>
          <Icon name="done" size={12} sw={2} className="lg-done" />
          Done
        </span>
        <span>
          <Icon name="critical" size={12} sw={2} className="lg-failed" />
          Failed
        </span>
        {lanes.daily.length > 0 && (
          <Tag level="neutral" icon="repeat">
            The lane above holds what runs every day
          </Tag>
        )}
      </div>
      {pick && <Detail it={pick} onClose={() => setPick(null)} reload={load} />}
      {book && <Book day={book} onClose={() => setBook(null)} reload={load} />}
    </Sheet>
  );
}
