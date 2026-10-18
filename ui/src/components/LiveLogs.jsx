// Live logs: the office's wire, oldest at the top, newest at the foot, a line per event in time order
// with a heading at each new day. The view follows the foot while you are there; scroll up and it holds
// still, with "Jump to latest" to come back. With a desk in hand it shows that desk only.
import React, { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useOffice, deskName } from '../lib/store.js';
import { useActions, useOnline, useSelected, useWire, reducedMotion } from '../lib/hooks.js';
import { hms, dayHeading, dur } from '../lib/format.js';
import { Icon } from './ui.jsx';

const s = n => `${Math.round(n / 1000)} s`;
export function wireText(e, names) {
  const who = e.agent ? names(e.agent) : '';
  switch (e.type) {
    case 'call':
      return `${who} → ${e.server}.${e.tool}`;
    case 'say':
      return `${who}: ${e.text}`;
    case 'run':
      return `${who} ${e.stage}${e.bootMs ? ` (boot ${s(e.bootMs)}${e.toolsInContext ? `, ${e.toolsInContext} tools` : ''}${e.strict === false ? ', full setup' : ''})` : ''}${e.ms ? ` in ${dur(e.ms)}` : ''}${e.usd ? ` $${e.usd.toFixed(3)}` : ''}${e.lane ? ` · ${e.lane}` : ''}${e.error ? ` · ${e.error}` : ''}${e.why ? ` · ${e.why}` : ''}`;
    case 'intake':
      return `ticket → ${who} (${e.by})${e.why ? `: ${e.why}` : ''}`;
    case 'delegate':
      return `${names(e.from)} delegated to ${names(e.to)}${e.after ? ` (after ${e.after})` : ''}`;
    case 'approval':
      return `owner ${e.verdict}${e.note ? `: ${e.note}` : ''}`;
    case 'lane':
      return `api lane ${e.state}${e.why ? `: ${e.why}` : ''}`;
    case 'mcp':
      return `${who}: connector ${e.server} ${e.status}`;
    case 'deny':
      return `${who}: refused ${e.tool} (${e.why})`;
    case 'guard':
      return `guard held back ${e.file}: ${(e.hits || []).join(' | ')}`;
    case 'workflow':
      return `workflow ${e.name}: ${(e.steps || []).length} steps laid out`;
    case 'batch':
      return `batch ${e.stage}${e.count ? ` ${e.count}` : ''}${e.error ? ` ${e.error}` : ''}`;
    case 'routine':
      return `routine ${e.id} ${e.change}${e.bad?.length ? `: ${e.bad.join(', ')}` : ''}`;
    case 'board':
      return e.office
        ? `office ${e.office}`
        : `${names(e.agent)} ${e.paused === true ? 'paused' : e.paused === false ? 'resumed' : e.change || ''}`;
    case 'spend':
      return `spend ${Math.round(e.frac * 100)}% of the ceiling ($${(e.usd || 0).toFixed(2)})`;
    case 'connector':
      return `connector ${e.key} ${e.status}${e.tools ? ` (${e.tools} tools)` : ''}`;
    case 'phone':
      return `phone ${e.state}${e.bot ? ` @${e.bot}` : ''}`;
    case 'notebook':
      return `${who} wrote in the notebook`;
    case 'route':
      return `routed in ${e.ms} ms${e.agent ? ` → ${names(e.agent)}` : ''}`;
    case 'reads':
      return `${who} read ${(e.notes || []).length} note${(e.notes || []).length === 1 ? '' : 's'}`;
    case 'brain':
      return `brain ${e.change || 'changed'}${e.rel ? `: ${e.rel}` : ''}`;
    case 'stats':
      return e.ok === false ? `stats refresh failed${e.error ? `: ${e.error}` : ''}` : 'stats refreshed';
    default:
      return `${e.type}`;
  }
}
/** How a line reads: strong (a result), quiet (housekeeping), tool (work moving), bad (a refusal or failure). */
export function lineTone(e) {
  if (
    e.type === 'deny' ||
    e.type === 'guard' ||
    (e.type === 'run' && e.stage === 'failed') ||
    (e.type === 'lane' && e.state !== 'up') ||
    (e.type === 'mcp' && /fail|error/.test(e.status)) ||
    (e.type === 'connector' && /fail|absent|missing/.test(e.status)) ||
    (e.type === 'stats' && e.ok === false)
  )
    return 'bad';
  if (e.type === 'run' && (e.stage === 'done' || e.stage === 'waiting')) return 'strong';
  if (e.type === 'approval' || e.type === 'say') return 'strong';
  if (e.type === 'call' || e.type === 'intake' || e.type === 'delegate' || e.type === 'workflow') return 'tool';
  if (
    [
      'connector',
      'phone',
      'route',
      'board',
      'routine',
      'batch',
      'notebook',
      'spend',
      'reads',
      'brain',
      'stats',
    ].includes(e.type)
  )
    return 'quiet';
  return '';
}

export function LogLines({
  lines,
  names,
  className = '',
  label = 'Live logs',
  empty = 'Quiet on the wire. Lines appear here as the desks work.',
}) {
  const box = useRef(null);
  const [atFoot, setAtFoot] = useState(true);
  const [fresh, setFresh] = useState(0);
  const seen = useRef(lines.length);
  // the fade under the day heading is for lines scrolling away; a log at its top shows its first line in full
  const [scrolled, setScrolled] = useState(false);
  const sorted = useMemo(
    () => [...lines].sort((a, b) => (a.at || 0) - (b.at || 0) || (a.seq || 0) - (b.seq || 0)),
    [lines],
  );
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (atFoot) {
      el.scrollTop = el.scrollHeight;
      seen.current = sorted.length;
      setFresh(0);
    } else setFresh(Math.max(0, sorted.length - seen.current));
    setScrolled(el.scrollTop > 1);
  }, [sorted]);
  const onScroll = () => {
    const el = box.current;
    const up = el.scrollTop > 1;
    if (up !== scrolled) setScrolled(up);
    const foot = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (foot !== atFoot) setAtFoot(foot);
    if (foot) {
      seen.current = sorted.length;
      setFresh(0);
    }
  };
  const jump = () => {
    const el = box.current;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' });
    setAtFoot(true);
    seen.current = sorted.length;
    setFresh(0);
  };
  let lastDay = '';
  const keys = new Set();
  return (
    <div className={`log-body well ${className}`}>
      <div
        ref={box}
        className={`log-scroll ${scrolled ? 'scrolled' : ''}`}
        role="log"
        aria-label={label}
        aria-live="off"
        tabIndex={0}
        onScroll={onScroll}
      >
        {sorted.length === 0 && <div className="log-empty">{empty}</div>}
        {sorted.map(e => {
          const day = new Date(e.at).toDateString();
          const head = day !== lastDay;
          lastDay = day;
          // two processes (the office and a `clickmarkers run`) can number events alike, so a key is made unique here
          let key = `${e.seq}:${e.at}:${e.type}`;
          while (keys.has(key)) key += '+';
          keys.add(key);
          return (
            <Fragment key={key}>
              {head && (
                <div className="log-day" role="separator">
                  {dayHeading(e.at)}
                </div>
              )}
              <div className={`log-line ${lineTone(e)}`}>
                <span className="ts">{hms(e.at)}</span>
                <span className="tx">{wireText(e, names)}</span>
              </div>
            </Fragment>
          );
        })}
      </div>
      {!atFoot && (
        <button type="button" className="btn btn-secondary btn-sm jump" onClick={jump}>
          <Icon name="arrowDown" size={14} />
          Jump to latest{fresh > 0 ? ` (${fresh} new)` : ''}
        </button>
      )}
    </div>
  );
}

export default function LiveLogs({ className = '', phone = false }) {
  const selected = useSelected();
  const lines = useWire(selected, phone ? 200 : 300);
  const online = useOnline();
  const a = useActions();
  const names = useOffice(st => x => deskName(st, x));
  const who = useOffice(st => (selected ? deskName(st, selected) : ''));
  return (
    <section className={`panel logs ${className}`} aria-labelledby="logs-t">
      <div className="panel-h">
        <h2 id="logs-t" className="title-l">
          Live logs
        </h2>
        <span className="aside">
          {selected ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => a.select(null)}
              aria-label={`Showing ${who} only. Show every desk`}
            >
              <Icon name="close" size={13} />
              {who} only
            </button>
          ) : online ? (
            <>
              <i className="live-dot sm" />
              Live · every desk
            </>
          ) : (
            <>
              <Icon name="critical" size={13} className="crit-ic" />
              Not connected
            </>
          )}
        </span>
      </div>
      <LogLines lines={lines} names={names} label={selected ? `Live logs for ${who}` : 'Live logs, every desk'} />
    </section>
  );
}
