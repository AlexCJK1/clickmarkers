// The brain: every note a dot, every link a line, the three biggest folders in the three colours that
// stay apart for every kind of colour vision and the rest in grey. The six best-linked notes keep their
// names at rest; the rest show on hover, on the note in hand and its links, or when zoomed in. The list
// view holds the same notes as text. Search, filter by folder, show what changed today. While it is open,
// a note lights up the moment a desk reads it, and a new deliverable reloads the map.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActions, useIsPhone, useReducedMotion } from '../lib/hooks.js';
import { useOffice, deskName } from '../lib/store.js';
import { ago, plural } from '../lib/format.js';
import { T, rgba } from '../lib/tokens.js';
import { Sheet } from './Sheet.jsx';
import { Empty, Icon, Tabs, tabPanelProps } from './ui.jsx';

// the server files notes at the vault's root under "(top)"
const folderName = f => (f === '(top)' ? 'Top level' : f);

/** Positions: folders on a ring, notes round their folder, then a short relaxation. Deterministic. */
function layout(notes, links) {
  const folders = [...new Set(notes.map(n => n.folder))].sort();
  const R = 70 + folders.length * 10;
  const centre = {};
  folders.forEach((f, i) => {
    const a = (i / folders.length) * Math.PI * 2;
    centre[f] = [Math.cos(a) * R, Math.sin(a) * R];
  });
  const count = {};
  const P = notes.map(n => {
    const k = (count[n.folder] = (count[n.folder] || 0) + 1);
    const a = k * 2.399963;
    const r = 9 * Math.sqrt(k);
    const c = centre[n.folder];
    return { x: c[0] + Math.cos(a) * r, y: c[1] + Math.sin(a) * r, vx: 0, vy: 0 };
  });
  for (let it = 0; it < 90; it++) {
    const cell = 30;
    const grid = new Map();
    P.forEach((p, i) => {
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      (grid.get(k) || grid.set(k, []).get(k)).push(i);
    });
    P.forEach((p, i) => {
      const cx = Math.floor(p.x / cell),
        cy = Math.floor(p.y / cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const j of grid.get(`${cx + dx},${cy + dy}`) || []) {
            if (j <= i) continue;
            const q = P[j];
            let ex = p.x - q.x,
              ey = p.y - q.y;
            let d2 = ex * ex + ey * ey;
            if (d2 < 0.01) {
              ex = (i % 7) - 3;
              ey = (j % 5) - 2;
              d2 = ex * ex + ey * ey;
            }
            if (d2 > 900) continue;
            const f = 18 / d2;
            p.vx += ex * f;
            p.vy += ey * f;
            q.vx -= ex * f;
            q.vy -= ey * f;
          }
    });
    for (const [a, b] of links) {
      const p = P[a],
        q = P[b];
      const ex = q.x - p.x,
        ey = q.y - p.y;
      const d = Math.sqrt(ex * ex + ey * ey) || 1;
      const f = (d - 40) * 0.0004;
      p.vx += ex * f;
      p.vy += ey * f;
      q.vx -= ex * f;
      q.vy -= ey * f;
    }
    P.forEach((p, i) => {
      const c = centre[notes[i].folder];
      p.vx += (c[0] - p.x) * 0.004 - p.x * 0.003;
      p.vy += (c[1] - p.y) * 0.004 - p.y * 0.003;
      p.x += Math.max(-6, Math.min(6, p.vx));
      p.y += Math.max(-6, Math.min(6, p.vy));
      p.vx *= 0.5;
      p.vy *= 0.5;
    });
  }
  // notes with no links would drift to their folder's corner and make the map mostly empty space:
  // they sit instead on a ring just outside the linked notes, grouped by folder
  const deg = notes.map(() => 0);
  for (const [a, b] of links) {
    deg[a]++;
    deg[b]++;
  }
  const linked = P.filter((p, i) => deg[i] > 0);
  if (linked.length && linked.length < P.length) {
    const cx = linked.reduce((s, p) => s + p.x, 0) / linked.length,
      cy = linked.reduce((s, p) => s + p.y, 0) / linked.length;
    const d = linked.map(p => Math.hypot(p.x - cx, p.y - cy)).sort((x, y) => x - y);
    const r = (d[Math.floor(d.length * 0.9)] || 40) + 36;
    const lone = notes
      .map((n, i) => i)
      .filter(i => !deg[i])
      .sort((x, y) => notes[x].folder.localeCompare(notes[y].folder));
    lone.forEach((i, k) => {
      const a = -Math.PI / 2 + (k / lone.length) * Math.PI * 2;
      P[i].x = cx + Math.cos(a) * r;
      P[i].y = cy + Math.sin(a) * r;
    });
  }
  return P;
}

export default function BrainGraph() {
  const a = useActions();
  const names = useOffice(s => x => deskName(s, x));
  const wire = useOffice(s => s.wire);
  const phone = useIsPhone();
  const reduced = useReducedMotion();
  const [g, setG] = useState(null);
  const [q, setQ] = useState('');
  const [off, setOff] = useState(new Set());
  const [today, setToday] = useState(false);
  const [tab, setTab] = useState(phone ? 'list' : 'map');
  const [sel, setSel] = useState(null);
  const [hover, setHover] = useState(null);
  const [note, setNote] = useState(null);
  // compact layout: the note opens above the map or list, so bring it into view when one is picked
  const noteBox = useRef(null);
  useEffect(() => {
    if (phone && sel !== null)
      noteBox.current?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  }, [sel, phone]);
  const canvas = useRef(null);
  const view = useRef({ x: 0, y: 0, k: 1, fitK: 1 });
  const userMoved = useRef(false);
  const glint = useRef(new Map());
  const drag = useRef(null);
  const raf = useRef(0);
  const seenSeq = useRef(0);
  const load = useCallback(
    (refresh = false) =>
      a
        .brainGraph(refresh)
        .then(setG)
        .catch(() => setG({ notes: [], links: [], error: true })),
    [a],
  );
  useEffect(() => {
    load();
  }, [load]);
  const pos = useMemo(() => (g ? layout(g.notes, g.links) : []), [g]);
  const adj = useMemo(() => {
    const m = new Map();
    for (const [x, y] of g?.links || []) {
      (m.get(x) || m.set(x, []).get(x)).push(y);
      (m.get(y) || m.set(y, []).get(y)).push(x);
    }
    return m;
  }, [g]);
  // the best-linked notes keep their names at rest, so the map says something before anyone hovers
  const hubs = useMemo(
    () =>
      new Set(
        [...adj.entries()]
          .sort((x, y) => y[1].length - x[1].length)
          .slice(0, 6)
          .filter(([, v]) => v.length >= 3)
          .map(([i]) => i),
      ),
    [adj],
  );
  const folders = useMemo(() => {
    if (!g) return [];
    const c = {};
    for (const n of g.notes) c[n.folder] = (c[n.folder] || 0) + 1;
    return Object.entries(c)
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .map(([f, n], i) => ({ f, n, hue: i < T.cats.length ? T.cats[i] : T.other }));
  }, [g]);
  const hueOf = useMemo(() => Object.fromEntries(folders.map(x => [x.f, x.hue])), [folders]);
  const dayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [g]);
  const visible = useCallback(n => !off.has(n.folder) && (!today || n.mtime >= dayStart), [off, today, dayStart]);
  const match = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? new Set((g?.notes || []).filter(n => n.rel.toLowerCase().includes(k)).map(n => n.i)) : null;
  }, [q, g]);
  const byRel = useMemo(() => new Map((g?.notes || []).map(n => [n.rel, n.i])), [g]);

  /** Fit the visible notes, with room for a name on either side. */
  const fit = useCallback(() => {
    const c = canvas.current;
    if (!c || !pos.length || !g) return;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of g.notes) {
      if (!visible(n)) continue;
      const p = pos[n.i];
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    if (!Number.isFinite(x0)) return;
    const k = Math.max(
      0.25,
      Math.min(3, Math.min((c.clientWidth - 200) / Math.max(1, x1 - x0), (c.clientHeight - 80) / Math.max(1, y1 - y0))),
    );
    view.current = { x: -(x0 + x1) / 2, y: -(y0 + y1) / 2, k, fitK: k };
  }, [pos, g, visible]);

  const draw = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = canvas.current;
      if (!c || !g) return;
      const ctx = c.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth,
        h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { x: ox, y: oy, k, fitK } = view.current;
      const P = p => [w / 2 + (p.x + ox) * k, h / 2 + (p.y + oy) * k];
      const focus = hover ?? sel;
      const near = focus != null ? new Set([focus, ...(adj.get(focus) || [])]) : null;
      ctx.lineWidth = 1;
      for (const [x, y] of g.links) {
        const nx = g.notes[x],
          ny = g.notes[y];
        if (!visible(nx) || !visible(ny)) continue;
        const on = near && (x === focus || y === focus);
        ctx.strokeStyle = on ? rgba(T.t2, 0.7) : rgba(T.t3, 0.16);
        const [ax, ay] = P(pos[x]);
        const [bx, by] = P(pos[y]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      const now = Date.now();
      let live = false;
      const zoomed = k > fitK * 1.7;
      const labels = [];
      for (const n of g.notes) {
        if (!visible(n)) continue;
        const [px, py] = P(pos[n.i]);
        if (px < -20 || py < -20 || px > w + 20 || py > h + 20) continue;
        const deg = (adj.get(n.i) || []).length;
        const r = Math.max(3, Math.min(9, 2.5 + Math.sqrt(deg) * 1.4)) * Math.max(0.8, Math.min(1.5, k / fitK));
        const dim = (near && !near.has(n.i)) || (match && !match.has(n.i));
        ctx.globalAlpha = dim ? 0.22 : 1;
        ctx.fillStyle = hueOf[n.folder] || T.other;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (n.i === sel) {
          ctx.strokeStyle = T.brand;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, r + 3.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
        const gl = glint.current.get(n.i);
        if (gl) {
          const age = (now - gl.at) / 6000;
          if (age < 1) {
            live = !reduced;
            ctx.strokeStyle = rgba(T.good, reduced ? 1 : 1 - age);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, r + 4 + (reduced ? 0 : age * 14), 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = 1;
            labels.push({ px, py, r, text: `${names(gl.agent)} read ${n.name}`, read: true });
          } else glint.current.delete(n.i);
        }
        const show =
          n.i === focus ||
          (near && near.has(n.i)) ||
          (zoomed && !dim) ||
          (match && match.has(n.i) && match.size <= 12) ||
          (!near && !match && hubs.has(n.i));
        if (show && !gl) labels.push({ px, py, r, text: n.name, strong: n.i === focus });
      }
      // names last, each on its own plate, skipping one that would land on another
      ctx.font = '500 12px "Inter Variable", system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      const placed = [];
      for (const L of labels.sort((x, y) => (y.strong ? 1 : 0) - (x.strong ? 1 : 0))) {
        const tw = ctx.measureText(L.text).width;
        const bx = Math.min(w - tw - 12, L.px + L.r + 6),
          by = L.py - 10;
        const box = { x: bx, y: by, w: tw + 10, h: 20 };
        if (placed.some(b => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y))
          continue;
        placed.push(box);
        ctx.fillStyle = rgba(T.bg3, 0.94);
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.w, box.h, 4);
        ctx.fill();
        ctx.fillStyle = L.read ? T.good : L.strong ? T.t1 : T.t2;
        ctx.fillText(L.text, box.x + 5, L.py);
      }
      if (live) draw();
    });
  }, [g, pos, adj, hubs, hover, sel, visible, match, hueOf, names, reduced]);

  const fitted = useRef(false);
  useEffect(() => {
    if (pos.length && !fitted.current && canvas.current) {
      fitted.current = true;
      fit();
      draw();
    }
  }, [pos, fit, draw, tab]);
  useEffect(() => {
    draw();
  }, [draw]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return undefined;
    const ro = new ResizeObserver(() => {
      if (!userMoved.current) fit();
      draw();
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [fit, draw, tab]);
  useEffect(() => {
    if (sel == null || !g) {
      setNote(null);
      return;
    }
    setNote(null);
    a.brainNote(g.notes[sel].rel)
      .then(setNote)
      .catch(() => {});
  }, [sel, g]);
  useEffect(() => {
    let reload = false;
    for (const e of wire) {
      if (e.seq <= seenSeq.current) continue;
      seenSeq.current = e.seq;
      if (e.type === 'reads')
        for (const r of e.notes || []) {
          const i = byRel.get(r);
          if (i != null) glint.current.set(i, { at: Date.now(), agent: e.agent });
        }
      if (e.type === 'brain' && e.change === 'deliverable') reload = true;
    }
    if (reload) load(true);
    draw();
  }, [wire]);

  const at = e => {
    const c = canvas.current;
    const rect = c.getBoundingClientRect();
    const { x: ox, y: oy, k } = view.current;
    const mx = e.clientX - rect.left,
      my = e.clientY - rect.top;
    let best = null,
      bd = 196;
    for (const n of g?.notes || []) {
      if (!visible(n)) continue;
      const px = c.clientWidth / 2 + (pos[n.i].x + ox) * k,
        py = c.clientHeight / 2 + (pos[n.i].y + oy) * k;
      const d = (px - mx) ** 2 + (py - my) ** 2;
      if (d < bd) {
        bd = d;
        best = n.i;
      }
    }
    return best;
  };
  useEffect(() => {
    const c = canvas.current;
    if (!c) return undefined;
    const onWheel = e => {
      e.preventDefault();
      userMoved.current = true;
      const v = view.current;
      v.k = Math.max(v.fitK * 0.6, Math.min(v.fitK * 6, v.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      draw();
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [draw, tab]);
  const focusOn = i => {
    userMoved.current = true;
    const p = pos[i];
    view.current = { ...view.current, x: -p.x, y: -p.y, k: Math.max(view.current.k, view.current.fitK * 1.8) };
    setSel(i);
    if (tab !== 'map' && !phone) setTab('map');
    draw();
  };
  const zoom = f => {
    userMoved.current = true;
    const v = view.current;
    v.k = Math.max(v.fitK * 0.6, Math.min(v.fitK * 6, v.k * f));
    draw();
  };
  const n = sel != null && g ? g.notes[sel] : null;
  const last = n && g?.lastRead?.[n.rel];
  const listNotes = useMemo(
    () =>
      g
        ? g.notes
            .filter(x => visible(x) && (!match || match.has(x.i)))
            .sort((x, y) => x.folder.localeCompare(y.folder) || x.name.localeCompare(y.name))
        : [],
    [g, visible, match],
  );
  let lastFolder = '';

  return (
    <Sheet
      title="Brain"
      size="xl"
      onClose={() => a.drawer(null)}
      sub="Every note and how they link. A note lights up when a desk reads it."
      bodyClass="fill brain-body"
    >
      {!g ? (
        <Empty icon="brain" title="Reading the brain" />
      ) : g.error ? (
        <Empty icon="critical" title="The brain did not answer">
          Try again in a moment.
        </Empty>
      ) : (
        <>
          <div className="brain-bar">
            <input
              className="field brain-search"
              value={q}
              data-esc="local"
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && match?.size) focusOn([...match][0]);
                if (e.key === 'Escape' && q) {
                  e.preventDefault();
                  setQ('');
                }
              }}
              placeholder="Find a note"
              aria-label="Find a note"
            />
            <button type="button" className="toggle" aria-pressed={today} onClick={() => setToday(!today)}>
              <Icon name="clock" size={13} />
              New today<span className="count">{g.notes.filter(x => x.mtime >= dayStart).length}</span>
            </button>
            {(() => {
              const chips = (
                <div className="toggles" role="group" aria-label="Folders">
                  {folders.map(x => (
                    <button
                      key={x.f}
                      type="button"
                      className="toggle soft"
                      aria-pressed={!off.has(x.f)}
                      onClick={() =>
                        setOff(s => {
                          const s2 = new Set(s);
                          if (s2.has(x.f)) s2.delete(x.f);
                          else s2.add(x.f);
                          return s2;
                        })
                      }
                    >
                      <i className="sw" style={{ background: x.hue }} />
                      {folderName(x.f)}
                      <span className="count">{x.n}</span>
                    </button>
                  ))}
                </div>
              );
              // on the phone a dozen folder chips would push the notes off the first screen, so they fold away
              return phone ? (
                <details className="cal-depts">
                  <summary className="btn btn-secondary">
                    Folders{off.size ? ` (${folders.length - off.size} of ${folders.length})` : ''}
                  </summary>
                  {chips}
                </details>
              ) : (
                chips
              );
            })()}
            <span className="meta t3 brain-count">
              {g.notes.length} notes · {g.links.length} links
            </span>
          </div>
          <Tabs
            label="Brain view"
            idBase="brain"
            value={tab}
            onChange={setTab}
            tabs={[
              ['map', 'Map'],
              ['list', 'List'],
            ]}
          />
          <div className="brain-main">
            {tab === 'map' ? (
              <div className="brain-map" {...tabPanelProps('brain', 'map')} tabIndex={-1}>
                <canvas
                  ref={canvas}
                  className="brain-canvas"
                  aria-label="The map of notes. The list view holds the same notes as text."
                  role="img"
                  onMouseDown={e => {
                    drag.current = { x: e.clientX, y: e.clientY, ox: view.current.x, oy: view.current.y, moved: false };
                  }}
                  onMouseMove={e => {
                    const d = drag.current;
                    if (d) {
                      const dx = e.clientX - d.x,
                        dy = e.clientY - d.y;
                      if (Math.abs(dx) + Math.abs(dy) > 3) {
                        d.moved = true;
                        userMoved.current = true;
                      }
                      view.current.x = d.ox + dx / view.current.k;
                      view.current.y = d.oy + dy / view.current.k;
                      draw();
                    } else {
                      const h = at(e);
                      if (h !== hover) setHover(h);
                    }
                  }}
                  onMouseUp={e => {
                    const d = drag.current;
                    drag.current = null;
                    if (d && !d.moved) setSel(at(e));
                  }}
                  onMouseLeave={() => {
                    drag.current = null;
                    setHover(null);
                  }}
                />
                <div className="brain-ctl">
                  <button
                    type="button"
                    className="btn btn-secondary btn-icon btn-sm"
                    aria-label="Zoom in"
                    onClick={() => zoom(1.3)}
                  >
                    <Icon name="plus" size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-icon btn-sm"
                    aria-label="Zoom out"
                    onClick={() => zoom(1 / 1.3)}
                  >
                    <Icon name="minus" size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      userMoved.current = false;
                      fit();
                      draw();
                    }}
                  >
                    <Icon name="fit" size={14} />
                    Fit
                  </button>
                </div>
                <div className="brain-hint meta t3">
                  Scroll to zoom, drag to move. The busiest notes are named; the rest show on hover or when zoomed in.
                </div>
              </div>
            ) : (
              <div className="brain-list" {...tabPanelProps('brain', 'list')}>
                <ul>
                  {listNotes.map(x => {
                    const head = x.folder !== lastFolder;
                    lastFolder = x.folder;
                    return (
                      <React.Fragment key={x.i}>
                        {head && (
                          <li className="brain-folder cap">
                            <i className="sw" style={{ background: hueOf[x.folder] }} />
                            {folderName(x.folder)}
                          </li>
                        )}
                        <li>
                          <button
                            type="button"
                            className={`brain-row ${sel === x.i ? 'on' : ''}`}
                            aria-pressed={sel === x.i}
                            onClick={() => setSel(x.i)}
                          >
                            <span>{x.name}</span>
                            <span className="t3">
                              {plural((adj.get(x.i) || []).length, 'link')} · {ago(x.mtime)}
                            </span>
                          </button>
                        </li>
                      </React.Fragment>
                    );
                  })}
                </ul>
                {listNotes.length === 0 && <p className="meta t3">No note matches.</p>}
              </div>
            )}
            {n && (
              <aside ref={noteBox} className="brain-note" aria-label={`Note ${n.name}`}>
                <div className="row-ctl">
                  <h3 className="title-s grow">{n.name}</h3>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    aria-label="Close the note"
                    onClick={() => setSel(null)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
                <div className="meta t3">{n.rel}</div>
                <div className="meta">
                  {plural((adj.get(n.i) || []).length, 'link')} · changed {ago(n.mtime)}
                  {n.mtime >= dayStart ? ' (today)' : ''}
                </div>
                <div className="meta">
                  {last ? (
                    <>
                      <Icon
                        name="check"
                        size={13}
                        sw={2}
                        className="good-ic"
                        style={{ display: 'inline-block', verticalAlign: '-2px' }}
                      />{' '}
                      Last read by {names(last.agent)} {ago(last.at)}
                    </>
                  ) : (
                    <span className="t3">No desk has read it recently</span>
                  )}
                </div>
                {(adj.get(n.i) || []).length > 0 && (
                  <div className="brain-links">
                    {(adj.get(n.i) || []).slice(0, 18).map(j => (
                      <button
                        key={j}
                        type="button"
                        className="toggle"
                        title={g.notes[j].name}
                        onClick={() => focusOn(j)}
                      >
                        <span>{g.notes[j].name}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="prose quiet brain-text" tabIndex={0}>
                  {note ? note.text : 'Opening…'}
                </div>
              </aside>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
