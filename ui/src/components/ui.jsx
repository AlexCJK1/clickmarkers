// The small parts every panel is built from: icons, status tags (an icon and a word, never colour
// alone), tooltips that show on hover and on keyboard focus, meters, segmented controls, tab lists and
// the polite announcer for screen readers.
import React, { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* ---------- icons: one 24 px stroked set ---------- */
const P = {
  check: <path d="M20 6 9 17l-5-5" />,
  warn: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5h.01" />
    </>
  ),
  serious: (
    <>
      <path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4.2" />
      <path d="M12 17h.01" />
    </>
  ),
  critical: (
    <>
      <path d="M7.9 2.5h8.2l5.4 5.4v8.2l-5.4 5.4H7.9l-5.4-5.4V7.9Z" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m18 15-6-6-6 6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2.5" width="6" height="12" rx="3" />
      <path d="M5 10.5v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 18.5v3" />
    </>
  ),
  micOn: (
    <>
      <rect x="9" y="2.5" width="6" height="12" rx="3" fill="currentColor" />
      <path d="M5 10.5v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 18.5v3" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 10v4h4l5 4V6L8 10z" />
      <path d="M16 9a4 4 0 0 1 0 6" />
    </>
  ),
  speakerOn: (
    <>
      <path d="M4 10v4h4l5 4V6L8 10z" fill="currentColor" />
      <path d="M16 9a4 4 0 0 1 0 6" />
      <path d="M19 6a8 8 0 0 1 0 12" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  expand: (
    <>
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="m21 3-7 7" />
      <path d="m3 21 7-7" />
    </>
  ),
  send: (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 7v8" />
      <path d="M12 7v4" />
      <path d="M16 7v10" />
    </>
  ),
  ledger: (
    <>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </>
  ),
  numbers: (
    <>
      <path d="M3 3v18h18" />
      <path d="M8 17v-4" />
      <path d="M13 17V8" />
      <path d="M18 17v-7" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="17" rx="2" />
      <path d="M16 2.5v4" />
      <path d="M8 2.5v4" />
      <path d="M3 10h18" />
    </>
  ),
  brain: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="10" cy="18" r="2.5" />
      <path d="M8.5 6.4 15.5 7.6" />
      <path d="m7 8.3 2.2 7.3" />
      <path d="m16.5 10.2-5 5.8" />
    </>
  ),
  routines: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 0 0-15.4-6.4L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15.4 6.4L21 16" />
      <path d="M16 16h5v5" />
    </>
  ),
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  plug: (
    <>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
  logs: (
    <>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </>
  ),
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5Z" />,
  workflow: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M6 8.5v7" />
      <path d="M8.3 7.1 15.7 11" />
    </>
  ),
  open: (
    <>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </>
  ),
  phone: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  desk: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.5h.01" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13" />
      <path d="M9 7V4h6v3" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  reset: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  fit: (
    <>
      <path d="M4 9V5a1 1 0 0 1 1-1h4" />
      <path d="M15 4h4a1 1 0 0 1 1 1v4" />
      <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
      <path d="M9 20H5a1 1 0 0 1-1-1v-4" />
    </>
  ),
  chat: <path d="M4 5h16v11H9l-5 4Z" />,
  list: (
    <>
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <path d="M4.5 6h.01" />
      <path d="M4.5 12h.01" />
      <path d="M4.5 18h.01" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="17" cy="5" r="2.5" />
      <circle cx="15" cy="17" r="2.5" />
      <path d="m8.4 6.5 6.2-1" />
      <path d="m7.6 9 5.6 6.2" />
    </>
  ),
  repeat: (
    <>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 12v-2a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 12v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  done: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  failed: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </>
  ),
  booked: (
    <>
      <rect x="3" y="4.5" width="18" height="17" rx="2" />
      <path d="M3 10h18" />
      <path d="M12 13.5v3l2 1" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9" />
      <path d="m16 7 3 3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M18 14a6.5 6.5 0 0 1 3.5 6" />
    </>
  ),
  note: (
    <>
      <path d="M6 3h9l4 4v14H6Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h7" />
      <path d="M9 17h5" />
    </>
  ),
  arrowDown: (
    <>
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6 3h12" />
      <path d="M6 21h12" />
      <path d="M7 3c0 5 10 5 10 9s-10 4-10 9" />
      <path d="M17 3c0 5-10 5-10 9s10 4 10 9" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
  ring: <circle cx="12" cy="12" r="7" />,
  working: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </>
  ),
};
export function Icon({ name, size = 16, sw = 1.75, className = '', style, title }) {
  return (
    <svg
      className={`ic ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      style={style}
    >
      {title && <title>{title}</title>}
      {P[name] || P.dot}
    </svg>
  );
}

/* ---------- status ---------- */
const LEVEL_ICON = {
  good: 'check',
  warn: 'warn',
  serious: 'serious',
  critical: 'critical',
  neutral: 'info',
  live: 'working',
};
/** A status tag: the icon carries the colour, the word carries the meaning. Square corners, never a pill. */
export function Tag({ level = 'neutral', icon, children, className = '' }) {
  return (
    <span className={`tag tag-${level} ${className}`}>
      <Icon name={icon || LEVEL_ICON[level]} size={13} sw={2} />
      <span>{children}</span>
    </span>
  );
}
/** A desk's state as words and a shape: idle is a hollow ring, working a filled ring, waiting the warning
 *  mark, failed the critical mark, paused the pause bars. */
export const DESK_STATE = {
  idle: { icon: 'ring', word: 'Idle', cls: 'st-idle' },
  working: { icon: 'working', word: 'Working', cls: 'st-working' },
  waiting: { icon: 'warn', word: 'Waiting for you', cls: 'st-waiting' },
  failed: { icon: 'critical', word: 'Failed', cls: 'st-failed' },
  paused: { icon: 'pause', word: 'Paused', cls: 'st-paused' },
};
export function StateMark({ status = 'idle', size = 12 }) {
  const s = DESK_STATE[status] || DESK_STATE.idle;
  return (
    <span className={`smark ${s.cls}`}>
      <Icon name={s.icon} size={size} sw={2} />
    </span>
  );
}

/* ---------- tooltips ---------- */
let tipSeq = 0;
/**
 * A visible tooltip for any one child element, shown on hover and on keyboard focus and linked with
 * aria-describedby, so nothing hides behind a title attribute. text may hold line breaks.
 */
export function Tip({ text, children, side = 'bottom', delay = 350 }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const timer = useRef(0);
  const idRef = useRef(null);
  if (!idRef.current) idRef.current = `tip-${++tipSeq}`;
  const show = (now = false) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), now ? 0 : delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth,
      vh = window.innerHeight;
    const below = side === 'bottom' ? r.bottom + 8 < vh - 60 : r.top < 70;
    setPos({ x: Math.max(8, Math.min(vw - 8, r.left + r.width / 2)), y: below ? r.bottom + 8 : r.top - 8, below });
  }, [open, side]);
  useEffect(() => {
    if (!open) return undefined;
    const k = e => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', k);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('keydown', k);
      window.removeEventListener('scroll', hide, true);
    };
  }, [open]);
  if (!text) return children;
  const child = React.Children.only(children);
  const merge = (a, b) => e => {
    a?.(e);
    b?.(e);
  };
  return (
    <>
      {cloneElement(child, {
        ref: node => {
          ref.current = node;
          const r = child.props.ref;
          if (typeof r === 'function') r(node);
          else if (r) r.current = node;
        },
        'aria-describedby': open ? idRef.current : child.props['aria-describedby'],
        onMouseEnter: merge(child.props.onMouseEnter, () => show()),
        onMouseLeave: merge(child.props.onMouseLeave, hide),
        onFocus: merge(child.props.onFocus, e => {
          if (e.target.matches?.(':focus-visible')) show(true);
        }),
        onBlur: merge(child.props.onBlur, hide),
        onPointerDown: merge(child.props.onPointerDown, hide),
        onClick: merge(child.props.onClick, hide), // a tip never sits over what the click opened
      })}
      {open && pos && createPortal(<TipBox id={idRef.current} pos={pos} text={text} />, document.body)}
    </>
  );
}
function TipBox({ id, pos, text }) {
  const box = useRef(null);
  const [dx, setDx] = useState(0);
  useLayoutEffect(() => {
    const b = box.current?.getBoundingClientRect();
    if (!b) return;
    const vw = window.innerWidth;
    setDx(b.left < 8 ? 8 - b.left : b.right > vw - 8 ? vw - 8 - b.right : 0);
  }, [pos.x, pos.y, text]);
  return (
    <div
      ref={box}
      id={id}
      role="tooltip"
      className="tip"
      style={{ left: pos.x, top: pos.y, transform: `translate(calc(-50% + ${dx}px), ${pos.below ? '0' : '-100%'})` }}
    >
      {text}
    </div>
  );
}

/* ---------- meters, segmented controls, tabs ---------- */
/** A meter: a 1 px outline marks the whole, the fill sits inside. tone: '' (data blue), 'warn', 'crit', 'plain'. */
export function Meter({ value = 0, max = 1, tone = '', label, className = '' }) {
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div
      className={`meter ${tone} ${className}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={+(+value || 0).toFixed(2)}
    >
      <i style={{ width: f > 0 ? `max(2px, calc(${(f * 100).toFixed(2)}% - 2px))` : 0 }} />
    </div>
  );
}
/** A segmented control: one choice out of a few, as pressed buttons. */
export function Seg({ options, value, onChange, label, className = '' }) {
  return (
    <div className={`seg ${className}`} role="group" aria-label={label}>
      {options.map(o => {
        const [v, l] = Array.isArray(o) ? o : [o.value, o.label];
        return (
          <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        );
      })}
    </div>
  );
}
/** A tab list with arrow keys. tabs: [[key, label]]; the panel is rendered by the caller with tabPanelProps(key). */
export function Tabs({ tabs, value, onChange, label, idBase, className = '' }) {
  const refs = useRef({});
  const onKey = e => {
    const i = tabs.findIndex(t => t[0] === value);
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = tabs.length - 1;
    if (j !== null) {
      e.preventDefault();
      onChange(tabs[j][0]);
      refs.current[tabs[j][0]]?.focus();
    }
  };
  return (
    <div className={`tabs ${className}`} role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map(([k, l, extra]) => (
        <button
          key={k}
          ref={n => {
            refs.current[k] = n;
          }}
          type="button"
          role="tab"
          id={`${idBase}-tab-${k}`}
          aria-controls={`${idBase}-panel-${k}`}
          aria-selected={value === k}
          tabIndex={value === k ? 0 : -1}
          onClick={() => onChange(k)}
        >
          {l}
          {extra}
        </button>
      ))}
    </div>
  );
}
export const tabPanelProps = (idBase, key) => ({
  role: 'tabpanel',
  id: `${idBase}-panel-${key}`,
  'aria-labelledby': `${idBase}-tab-${key}`,
  tabIndex: 0,
});

/* ---------- the announcer ---------- */
let say = () => {};
/** Speak a line to screen readers (job results, new drafts in the in-tray). */
export const announce = text => say(String(text || ''));
export function Announcer() {
  const [msg, setMsg] = useState('');
  const [alert, setAlert] = useState('');
  useEffect(() => {
    say = t => {
      if (/^(error|failed|nothing was)/i.test(t)) {
        setAlert('');
        setTimeout(() => setAlert(t), 30);
      } else {
        setMsg('');
        setTimeout(() => setMsg(t), 30);
      }
    };
    return () => {
      say = () => {};
    };
  }, []);
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {msg}
      </div>
      <div className="sr-only" role="alert" aria-atomic="true">
        {alert}
      </div>
    </>
  );
}

/** A labelled field with an id wired up. */
export function Field({ label, hint, children, className = '' }) {
  const id = useId();
  return (
    <div className={`fld ${className}`}>
      <label htmlFor={id} className="fld-l">
        {label}
      </label>
      {cloneElement(React.Children.only(children), { id, 'aria-describedby': hint ? `${id}-h` : undefined })}
      {hint && (
        <div id={`${id}-h`} className="fld-h">
          {hint}
        </div>
      )}
    </div>
  );
}

/** "Nothing here" with a reason and, when there is one, the next step. */
export function Empty({ icon = 'info', title, children, action }) {
  return (
    <div className="empty">
      <Icon name={icon} size={22} className="t3" />
      <div className="title-s">{title}</div>
      {children && (
        <div className="meta" style={{ maxWidth: 420 }}>
          {children}
        </div>
      )}
      {action}
    </div>
  );
}

/** A placeholder shaped like the content that is on its way, so nothing jumps when it lands. */
export function Skeleton({ rows = [64, 64], className = '' }) {
  return (
    <div className={`skel ${className}`} aria-busy="true" aria-label="Loading">
      {rows.map((h, i) => (
        <i key={i} style={{ height: h }} />
      ))}
    </div>
  );
}
