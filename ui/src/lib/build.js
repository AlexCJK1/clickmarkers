// A page opened before a deploy keeps the old code, and the old code can do harm quietly (an approve it
// can no longer send properly, for one). The office sends a build id with /api/health. This keeps the first
// id the page saw and reloads the page once when a later one differs.
// It cannot loop: it reloads only for an id it has not already reloaded for, never twice within a minute,
// and not at all where the reload cannot be recorded (no session storage).
const KEY = 'co.reloadedFor';
const WAIT_MS = 60000;
export function buildWatcher({ storage = () => globalThis.sessionStorage, now = Date.now, reload = () => globalThis.location.reload() } = {}) {
  let known = '';
  return function see(id) {
    if (!id || typeof id !== 'string') return false;
    if (!known) { known = id; return false; }
    if (id === known) return false;
    try {
      const st = storage(); const [was, at] = String(st.getItem(KEY) || '').split('@');
      if (was === id || now() - (+at || 0) < WAIT_MS) return false;
      st.setItem(KEY, `${id}@${now()}`);
    } catch { return false; }
    reload(); return true;
  };
}
