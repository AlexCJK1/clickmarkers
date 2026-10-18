// The one-liners panels use. Each hook selects its own slice of the store, so a panel re-renders only
// when that slice changes; the wire can tick several times a second without the whole page redrawing.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useOffice, actions, deskStatus } from './store.js';

export const useActions = () => actions;
export const useReady = () => useOffice(s => s.ready);
export const useOnline = () => useOffice(s => s.online);
export const useCompany = () => useOffice(s => s.company);
export const useDesks = () => useOffice(s => s.desks);
export const useHealth = () => useOffice(s => s.health);
export const useSelected = () => useOffice(s => s.selected);
export const useHovered = () => useOffice(s => s.hovered);
export const useDrawer = () => useOffice(s => s.drawer);
export const useTickets = () => useOffice(s => s.tickets);
export const useConnectors = () => useOffice(s => s.connectors);
export const useRoutines = () => useOffice(s => s.routines);
export const useWorkflows = () => useOffice(s => s.workflows);
export const useStats = () => useOffice(s => s.stats);
export const useSeries = () => useOffice(s => s.series);
export const useLedger = () => useOffice(s => s.ledger);

/** One desk with its live status, last line, today's spend and waiting count. */
export function useDesk(id) {
  const desk = useOffice(s => s.desks.find(d => d.id === id) || null);
  const status = useOffice(s => deskStatus(s, id));
  const line = useOffice(s => s.lastLine[id] || null);
  const waiting = useOffice(s => s.waiting[id] || 0);
  const today = useOffice(s => s.ledger?.today?.byAgent?.[id] || 0);
  return { desk, status, line, waiting, today };
}

/** Desks grouped for the executive suite: the chief first, then each department with its lead first. */
export function useSuite() {
  const company = useCompany();
  const desks = useDesks();
  return useMemo(() => {
    if (!company) return [];
    const chief = desks.find(d => !d.reportsTo);
    const groups = (company.departments || [])
      .filter(d => d.id !== 'exec')
      .map(dep => ({
        dept: dep,
        lead: desks.find(x => x.id === dep.lead),
        desks: desks.filter(x => x.dept === dep.id && x.id !== dep.lead),
      }));
    return { chief, groups };
  }, [company, desks]);
}

/** The wire, optionally for one desk; newest last. */
export function useWire(deskId = null, n = 250) {
  const wire = useOffice(s => s.wire);
  return useMemo(
    () => (deskId ? wire.filter(e => e.agent === deskId || e.from === deskId || e.to === deskId) : wire).slice(-n),
    [wire, deskId, n],
  );
}

/** The office's own meters: API money against the ceiling, desks working, the lanes, the pause. */
export function useMeters() {
  const health = useHealth();
  const running = useOffice(s => Object.keys(s.running).length);
  const maxParallel = 2;
  const usd = health?.today?.usd || 0,
    ceiling = health?.today?.ceilingUsd || 10,
    gbp = health?.today?.gbp || 0;
  return {
    usd,
    gbp,
    ceiling,
    remaining: Math.max(0, 1 - usd / ceiling),
    runs: health?.today?.runs || 0,
    working: running,
    maxParallel,
    load: Math.min(1, running / maxParallel),
    lanes: health?.lanes || {},
    paused: !!health?.paused,
    phone: health?.phone || {},
    batches: health?.batches || {},
  };
}

/** Waiting tickets (the in-tray). */
export function useInTray() {
  return useOffice(s => s.tickets.filter(t => t.state === 'waiting'));
}
export function useDeskTickets(id) {
  return useOffice(s => s.tickets.filter(t => t.agent === id));
}

/* ---------- the page itself ---------- */
function media(q) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false);
  const sub = fn => {
    const m = window.matchMedia(q);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  };
  return [sub, get];
}
// Phones, tablets and small laptops get the compact layout: the desktop layout needs 1280 px.
const PHONE_Q = '(max-width: 1279.98px)';
const [subPhone, getPhone] = media(PHONE_Q);
const RM_Q = '(prefers-reduced-motion: reduce)';
const [subRm, getRm] = media(RM_Q);
/** Under 1024 px the page is the phone layout: a fixed header, a bottom tab bar, full-screen sheets. */
export const useIsPhone = () => useSyncExternalStore(subPhone, getPhone, () => false);
export const useReducedMotion = () => useSyncExternalStore(subRm, getRm, () => false);
export const reducedMotion = getRm;

/** The width (and height) of an element, kept current. */
export function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize(s => (Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height }));
    };
    // measured at once, before the first paint: the observer only reports on a later frame, which a busy
    // page (or a slow GPU) can hold back long enough to show an empty chart
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
/** The time, ticking every `ms`. */
export function useNow(ms = 1000) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return t;
}
/** A value from the previous render. */
export function usePrevious(v) {
  const r = useRef(v);
  useEffect(() => {
    r.current = v;
  });
  return r.current;
}
