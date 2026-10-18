// The brain as a graph: every note a node, every [[wiki link]] or markdown link between notes an edge.
// Built on demand for the page's brain view and cached for half a minute. Notes the office writes
// (deliverables, lessons, notebooks) are in it too, under "Nightdesk".
import fs from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.git', '.obsidian', '.trash', '99-Archive']);
const MAX = 1500;

export function buildGraph(root) {
  const notes = []; const byKey = new Map();
  const walk = dir => {
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (notes.length >= MAX) return;
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name)); continue; }
      if (!e.name.endsWith('.md')) continue;
      const file = path.join(dir, e.name); const rel = path.relative(root, file).split(path.sep).join('/');
      let text = '', st = null; try { text = fs.readFileSync(file, 'utf8'); st = fs.statSync(file); } catch { continue; }
      const top = rel.includes('/') ? rel.split('/')[0] : '(top)';
      const folder = top === 'Nightdesk' ? `Nightdesk/${rel.split('/')[1] || ''}`.replace(/\/[^/]*\.md$/, '') : top;
      const n = { i: notes.length, rel, name: e.name.replace(/\.md$/, ''), folder, size: st.size, mtime: st.mtimeMs, office: top === 'Nightdesk', text };
      notes.push(n);
      byKey.set(rel.toLowerCase().replace(/\.md$/, ''), n);
      if (!byKey.has(n.name.toLowerCase())) byKey.set(n.name.toLowerCase(), n);
    }
  };
  if (root && fs.existsSync(root)) walk(root);
  const links = new Set();
  for (const n of notes) {
    const targets = [];
    for (const m of n.text.matchAll(/\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) targets.push(m[1].trim());
    // a broken link (a stray %) is skipped, not fatal to the whole graph
    for (const m of n.text.matchAll(/\]\(([^)\s]+?\.md)\)/g)) { let t; try { t = decodeURIComponent(m[1]); } catch { continue; } targets.push(path.posix.normalize(path.posix.join(path.posix.dirname(n.rel), t)).replace(/\.md$/, '')); }
    for (const t of targets) {
      const k = t.toLowerCase().replace(/\.md$/, '');
      const hit = byKey.get(k) || byKey.get(k.split('/').pop());
      if (hit && hit.i !== n.i) links.add(n.i < hit.i ? `${n.i}-${hit.i}` : `${hit.i}-${n.i}`);
    }
  }
  return { notes: notes.map(({ text, ...n }) => n), links: [...links].map(k => k.split('-').map(Number)) };
}

/** One note's text for the side pane: only .md files inside the brain. */
export function readNote(root, rel) {
  const f = path.resolve(root, String(rel || ''));
  if (!f.startsWith(path.resolve(root) + path.sep) || !f.endsWith('.md') || path.relative(root, f).split(path.sep).some(x => x.startsWith('.'))) return null;
  try { const st = fs.statSync(f); return { rel, text: fs.readFileSync(f, 'utf8').slice(0, 8000), mtime: st.mtimeMs, size: st.size }; } catch { return null; }
}
