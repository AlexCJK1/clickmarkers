// The charts, drawn from the pure layouts in lib/charts.js: fixed day slots, a hatched band for the days
// before tracking began (never zeros), today outlined as "so far", two or three ticks, the maximum and
// today labelled directly in text colours. Each chart can be read with the keyboard (focus it, then the
// arrows) and carries a table for screen readers.
import React, { useId, useMemo, useRef, useState } from 'react';
import { columnLayout, sparkLayout, shortDate, dayLabel } from '../lib/charts.js';
import { useSize } from '../lib/hooks.js';
import { Icon } from './ui.jsx';

const R = 4;
const barPath = (x, y, w, h, r = R) => {
  const q = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + q} Q${x},${y} ${x + q},${y} H${x + w - q} Q${x + w},${y} ${x + w},${y + q} V${y + h} Z`;
};

/**
 * Columns over day slots. values: numbers, or null for "not tracked yet". dates: ISO days, one per slot.
 * fmt formats a value for labels and the tooltip; tickFmt the axis. partialLast: today is so far.
 */
export function Columns({
  values,
  dates,
  height = 236,
  fmt = v => String(v),
  tickFmt,
  label,
  partialLast = true,
  untrackedText = 'Not tracked yet',
  maxBar = 16,
}) {
  const box = useRef(null);
  const { w } = useSize(box);
  const uid = useId().replace(/[:«»]/g, '');
  const [hi, setHi] = useState(null);
  const L = useMemo(
    () => (w > 40 ? columnLayout({ w, h: height, values, partialLast, maxBar }) : null),
    [w, height, values, partialLast, maxBar],
  );
  const n = values.length;
  const tf = tickFmt || fmt;
  const dateText = i => (i === n - 1 && partialLast ? 'Today' : shortDate(dates[i]));
  const move = d => {
    const idx = values.map((v, i) => i).filter(i => values[i] !== null && values[i] !== undefined);
    if (!idx.length) return;
    const cur = hi === null ? (d > 0 ? -1 : n) : hi;
    const next = d > 0 ? idx.find(i => i > cur) : [...idx].reverse().find(i => i < cur);
    setHi(next ?? cur);
  };
  const onKey = e => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHi(values.findIndex(v => v !== null));
    } else if (e.key === 'End') {
      e.preventDefault();
      setHi(n - 1);
    } else if (e.key === 'Escape') setHi(null);
  };
  const tipAt = hi !== null && L ? L.slots[hi] : null;
  const [asTable, setAsTable] = useState(false);
  const cell = i =>
    values[i] === null || values[i] === undefined
      ? 'Not tracked yet'
      : `${fmt(values[i])}${i === n - 1 && partialLast ? ' so far' : ''}`;
  const table = (cls, cap) => (
    <table className={cls}>
      <caption>{cap}</caption>
      <thead>
        <tr>
          <th scope="col">Day</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {values.map((v, i) => (
          <tr key={i}>
            <td>{dayLabel(dates[i])}</td>
            <td className={v === null || v === undefined ? 'nt' : ''}>{cell(i)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div>
      <div ref={box} className="chart-box" style={{ height, position: 'relative' }}>
        {asTable && (
          <div className="chart-table-wrap" style={{ height }}>
            {table('chart-table', label)}
          </div>
        )}
        {L && !asTable && (
          <svg
            className="chart"
            width={w}
            height={height}
            viewBox={`0 0 ${w} ${height}`}
            role="img"
            aria-label={label}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setHi(null)}
            onMouseLeave={() => setHi(null)}
          >
            <defs>
              <pattern id={`${uid}h`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" className="c-hatch" strokeWidth="1.2" />
              </pattern>
              <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" className="c-bar-top" />
                <stop offset="1" className="c-bar-base" />
              </linearGradient>
            </defs>
            {L.untracked && (
              <rect
                x={L.untracked.x0}
                y={L.plot.y}
                width={Math.max(0, L.untracked.x1 - L.untracked.x0)}
                height={L.plot.h}
                fill={`url(#${uid}h)`}
                rx="3"
              />
            )}
            {L.ticks.slice(1).map(t => (
              <line
                key={t.v}
                x1={L.plot.x}
                x2={L.plot.x + L.plot.w}
                y1={t.y}
                y2={t.y}
                className="c-grid"
                shapeRendering="crispEdges"
              />
            ))}
            {L.ticks.map(t => (
              <text key={'t' + t.v} x={w} y={t.y + 4} textAnchor="end" className="ax c-axis">
                {tf(t.v, true)}
              </text>
            ))}
            {L.untracked &&
              L.untracked.x1 - L.untracked.x0 > untrackedText.length * 6.4 + 20 &&
              (() => {
                const cx = (L.untracked.x0 + L.untracked.x1) / 2,
                  cy = Math.round(L.plot.y + L.plot.h / 2);
                const tw = untrackedText.length * 6.2 + 16;
                return (
                  <g>
                    <rect x={cx - tw / 2} y={cy - 11} width={tw} height={20} rx="4" className="c-nt-bg" />
                    <text x={cx} y={cy + 3} textAnchor="middle" className="ax ax-nt c-axis">
                      {untrackedText}
                    </text>
                  </g>
                );
              })()}
            {L.slots.map(s => {
              if (s.kind === 'untracked')
                return (
                  <line key={s.i} x1={s.cx} x2={s.cx} y1={L.plot.base} y2={L.plot.base + 4} className="c-axis-tick" />
                );
              const on = hi === s.i;
              if (s.kind === 'zero')
                return <rect key={s.i} x={s.x} y={s.y} width={s.w} height={2} className={on ? 'c-bar-hi' : 'c-bar'} />;
              if (s.kind === 'today')
                return (
                  <path
                    key={s.i}
                    d={barPath(s.x + 0.75, s.y + 0.75, s.w - 1.5, s.h - 0.75)}
                    className={on ? 'c-today c-today-hi' : 'c-today'}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                );
              return (
                <g key={s.i}>
                  <path
                    d={barPath(s.x, s.y, s.w, s.h)}
                    fill={on ? undefined : `url(#${uid}g)`}
                    className={on ? 'c-bar-hi' : ''}
                  />
                  {s.h > 3 && <line x1={s.x + 3} x2={s.x + s.w - 3} y1={s.y + 0.5} y2={s.y + 0.5} className="c-cap" />}
                </g>
              );
            })}
            <line
              x1={L.plot.x}
              x2={L.plot.x + L.plot.w}
              y1={L.plot.base + 0.5}
              y2={L.plot.base + 0.5}
              className="c-base"
            />
            {L.labelled.map(i => {
              const s = L.slots[i];
              const top = s.kind === 'zero' ? L.plot.base - 2 : s.y;
              if (i === n - 1 && partialLast)
                return (
                  <g key={'l' + i}>
                    <text x={s.cx} y={top - 20} textAnchor="middle" className="dl c-label">
                      {fmt(values[i])}
                    </text>
                    <text x={s.cx} y={top - 7} textAnchor="middle" className="ax c-axis">
                      so far
                    </text>
                  </g>
                );
              return (
                <text key={'l' + i} x={s.cx} y={top - 7} textAnchor="middle" className="dl c-label">
                  {fmt(values[i])}
                </text>
              );
            })}
            {L.dateIdx.map((i, k) => {
              const anchor = k === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
              const x =
                anchor === 'start' ? L.plot.x + 1 : anchor === 'end' ? L.plot.x + L.slot * (i + 1) - 1 : L.slots[i].cx;
              return (
                <text key={'d' + i} x={x} y={height - 6} textAnchor={anchor} className="ax c-axis">
                  {dateText(i)}
                </text>
              );
            })}
            {L.trackedStart > 0 && !L.dateIdx.some(i => Math.abs(L.slots[i].cx - L.slots[L.trackedStart].cx) < 56) && (
              <text x={L.slots[L.trackedStart].cx} y={height - 6} textAnchor="middle" className="ax c-axis">
                {shortDate(dates[L.trackedStart])}
              </text>
            )}
            {values.map((v, i) => (
              <rect
                key={'h' + i}
                x={L.plot.x + L.slot * i}
                y={L.plot.y}
                width={L.slot}
                height={L.plot.h}
                fill="transparent"
                onMouseEnter={() => setHi(v === null || v === undefined ? null : i)}
              />
            ))}
          </svg>
        )}
        {!asTable && tipAt && tipAt.kind !== 'untracked' && (
          <div
            className="chart-tip"
            style={{ left: tipAt.cx, top: (tipAt.kind === 'zero' ? L.plot.base : tipAt.y) - 30 }}
          >
            {dayLabel(dates[hi])}: <b>{fmt(values[hi])}</b>
            {hi === n - 1 && partialLast ? ' so far' : ''}
          </div>
        )}
        {!asTable && table('sr-only', label)}
      </div>
      <div className="chart-foot">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-pressed={asTable}
          onClick={() => setAsTable(!asTable)}
        >
          <Icon name={asTable ? 'numbers' : 'list'} size={13} />
          {asTable ? 'Show as chart' : 'Show as table'}
        </button>
      </div>
    </div>
  );
}

/** The legend for a columns chart. */
export function ColumnsLegend({ untracked = true, zero = true }) {
  return (
    <div className="legend">
      <span>
        <i className="sw day" />A day
      </span>
      <span>
        <i className="sw sofar" />
        Today so far
      </span>
      {untracked && (
        <span>
          <i className="sw hatch" />
          Not tracked yet
        </span>
      )}
      {zero && (
        <span>
          <i className="sw zero" />
          Zero
        </span>
      )}
    </div>
  );
}

/** A small spark for tiles: the same slots, no axis. Decorative: the tile states the figures. */
export function Spark({ values, height = 30, maxBar = 8 }) {
  const box = useRef(null);
  const { w } = useSize(box);
  const uid = useId().replace(/[:«»]/g, '');
  const S = useMemo(() => (w > 10 ? sparkLayout({ w, h: height, values, maxBar }) : null), [w, height, values, maxBar]);
  return (
    <div ref={box} style={{ height }} aria-hidden="true">
      {S && (
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} className="spark">
          <defs>
            <pattern id={`${uid}s`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="5" className="c-hatch" strokeWidth="1.1" />
            </pattern>
          </defs>
          {S.untrackedW > 0 && (
            <rect x="0" y="0" width={S.untrackedW} height={height - 1} fill={`url(#${uid}s)`} rx="2" />
          )}
          {S.bars.map(b =>
            b.today ? (
              <rect
                key={b.i}
                x={b.x + 0.75}
                y={height - 1 - b.h + 0.75}
                width={Math.max(1, b.w - 1.5)}
                height={Math.max(1, b.h - 0.75)}
                rx="1.5"
                className="c-today"
                strokeWidth="1.5"
              />
            ) : (
              <rect
                key={b.i}
                x={b.x}
                y={b.zero ? height - 3 : height - 1 - b.h}
                width={b.w}
                height={b.zero ? 2 : b.h}
                rx="1.5"
                className="c-bar"
              />
            ),
          )}
          <line x1="0" x2={w} y1={height - 0.5} y2={height - 0.5} className="c-base" />
        </svg>
      )}
    </div>
  );
}

/** Horizontal bars for a breakdown by name: rows [{ key, name, sub, value, text }]. */
export function HBars({ rows, max, gap = 10, minPct = 1.5, label }) {
  const top = max ?? Math.max(1e-9, ...rows.map(r => r.value));
  return (
    <ul className="hb" style={{ gap }} aria-label={label}>
      {rows.map(r => (
        <li key={r.key || r.name}>
          <div className="hb-name">
            <span>
              {r.name}
              {r.sub && <span className="t3"> · {r.sub}</span>}
            </span>
            <b>{r.text ?? r.value}</b>
          </div>
          <div className="hb-track" aria-hidden="true">
            <i style={{ width: `${Math.max(r.value > 0 ? minPct : 0, (100 * r.value) / top)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "Under 4 days: the figures, not a chart." rows: [{ label, value, note? }]. */
export function Figures({ rows, note }) {
  return (
    <div>
      <div className="fig-rows">
        {rows.map(r => (
          <div key={r.label}>
            <span className="t3">{r.label}</span>
            <b className="tnum">{r.value}</b>
            {r.note && <span className="t3">{r.note}</span>}
          </div>
        ))}
      </div>
      {note && (
        <div className="note" style={{ marginTop: 10 }}>
          <Icon name="info" size={14} />
          <span>{note}</span>
        </div>
      )}
    </div>
  );
}
