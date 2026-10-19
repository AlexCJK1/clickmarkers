// The war room: the office as a 3D table. The chief is the hub, the six leads sit on a ring round it and
// each lead's desks fan out behind. A pod is a graphite puck under a frosted dome, neutral when idle; its
// ring turns teal only while the desk works or is in hand, amber-yellow when a draft waits for the owner,
// red when its last job failed, and goes dark when the desk is paused. Every state is also a word on the
// desk's label, so colour is never the only sign. Apart from a faint sweep that
// turns round the table while the office is quiet (floor/sweep.js), nothing moves unless something
// happened: the scene is drawn on demand (a camera glide, a drag, a ticket travelling a link), and with reduced motion the
// glides jump and the travelling light becomes a short highlight of the route.
// Labels are real buttons over the canvas, placed after each draw with collisions avoided by priority.
import {
  THREE,
  makeRenderer,
  envMap,
  lights,
  fit,
  toScreen,
  fatLine,
  circlePoints,
  radialTexture,
  SIZE,
  podMaterials,
  pod,
  dressPod,
  disposeScene,
} from './kit.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { T, hex } from '../lib/tokens.js';
import { beamAt, glintOf } from './sweep.js';

const LS = 'cm:layout:v1'; // where each pod sits, remembered in this browser
const SVG = {
  ring: '<circle cx="12" cy="12" r="7"/>',
  working: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>',
  warn: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
  critical: '<path d="M7.9 2.5h8.2l5.4 5.4v8.2l-5.4 5.4H7.9l-5.4-5.4V7.9Z"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>',
};
const STATE = {
  working: ['working', 'Working'],
  waiting: ['warn', 'Waiting for you'],
  failed: ['critical', 'Failed'],
  paused: ['pause', 'Paused'],
};
const icon = n =>
  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[n]}</svg>`;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Where every desk sits before the owner moves anything: the chief at the hub, leads on a ring, desks fanned. */
export function layoutDesks(desks, departments, { R = 11, fan = 5.6 } = {}) {
  const pos = {};
  const chief = desks.find(d => !d.reportsTo);
  if (chief) pos[chief.id] = { x: 0, z: 0, a: 0 };
  const deps = departments.filter(d => d.id !== 'exec' && desks.some(x => x.id === d.lead));
  deps.forEach((dep, i) => {
    const a = -Math.PI / 2 + (i / deps.length) * Math.PI * 2 + Math.PI / deps.length;
    const lx = Math.cos(a) * R,
      lz = Math.sin(a) * R;
    pos[dep.lead] = { x: lx, z: lz, a };
    const subs = desks.filter(x => x.dept === dep.id && x.id !== dep.lead);
    const spread = Math.min(Math.PI * 0.8, 0.42 * subs.length + 0.3);
    subs.forEach((s, j) => {
      const t = subs.length === 1 ? 0 : (j / (subs.length - 1) - 0.5) * spread;
      pos[s.id] = { x: lx + Math.cos(a + t) * fan, z: lz + Math.sin(a + t) * fan, a: a + t };
    });
  });
  return pos;
}

// The idle sweep's beam, drawn once on a canvas: a bright leading edge with a trail fading behind it,
// kept off the hub and inside the bezel.
function sweepTexture(color, trail = 1.1, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const n = hex(color);
  const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  const h = size / 2;
  const f = trail / (Math.PI * 2);
  const cg = g.createConicGradient(0, h, h);
  cg.addColorStop(0, `rgba(${rgb},0.16)`);
  cg.addColorStop(f * 0.35, `rgba(${rgb},0.06)`);
  cg.addColorStop(f, `rgba(${rgb},0)`);
  cg.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = cg;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'destination-in';
  const rg = g.createRadialGradient(h, h, 0, h, h, h);
  rg.addColorStop(0, `rgba(${rgb},0)`);
  rg.addColorStop(0.22, `rgba(${rgb},1)`);
  rg.addColorStop(0.97, `rgba(${rgb},1)`);
  rg.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = rg;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function createFloor(
  { host, labels },
  { onSelect = () => {}, onHover = () => {}, onDead = () => {}, reduced = () => false, phone = false } = {},
) {
  const renderer = makeRenderer(host, { exposure: 1.05, clear: T.bg0 });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(hex(T.bg0));
  scene.fog = new THREE.FogExp2(hex(T.bg0), phone ? 0.006 : 0.011);
  scene.environment = envMap(renderer, 0.05);
  scene.environmentIntensity = 0.3;
  const m = podMaterials();
  lights(scene, { key: 1.4 });
  // a pool of cool light over the hub, falling off into the dark at the edge of the table
  const pool = new THREE.SpotLight(hex(T.pool), 900, 90, 0.42, 1, 1.6);
  pool.position.set(-4, 44, 10);
  pool.target.position.set(0, 0, 1);
  pool.castShadow = true;
  pool.shadow.mapSize.set(2048, 2048);
  pool.shadow.radius = 10;
  pool.shadow.blurSamples = 20;
  pool.shadow.bias = -0.0003;
  scene.add(pool, pool.target);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(90, 128),
    new THREE.MeshStandardMaterial({ color: hex(T.floor), roughness: 0.78, metalness: 0.15 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  // one light follows the desk in hand; the count of lights never changes, so no shader rebuilds
  const handLight = new THREE.PointLight(hex(T.brand), 0, 9, 2);
  handLight.position.y = 2.2;
  scene.add(handLight);

  let W = Math.max(1, host.clientWidth),
    H = Math.max(1, host.clientHeight);
  const lineMats = new Set();
  const track = l => {
    lineMats.add(l.material);
    return l;
  };
  const line = (pts, o) => track(fatLine(pts, { ...o, w: W, h: H }));
  for (const rr of [5.5, 11, 16.6, 22.2])
    scene.add(line(circlePoints(rr, 0.01, 220), { color: T.ringGrid, width: rr === 22.2 ? 1.4 : 1 }));
  {
    // the bezel: a tick every 3 degrees, a longer one every 30
    const minor = [],
      major = [];
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const l = i % 10 === 0 ? 0.9 : 0.4;
      (i % 10 === 0 ? major : minor).push(
        Math.cos(a) * 22.2,
        0.01,
        Math.sin(a) * 22.2,
        Math.cos(a) * (22.2 + l),
        0.01,
        Math.sin(a) * (22.2 + l),
      );
    }
    for (const [arr, col] of [
      [minor, T.ringGrid],
      [major, T.tick],
    ]) {
      const g = new LineSegmentsGeometry();
      g.setPositions(arr);
      const mt = new LineMaterial({ color: hex(col), linewidth: 1 });
      mt.resolution.set(W, H);
      lineMats.add(mt);
      scene.add(new LineSegments2(g, mt));
    }
  }
  const halo = {
    hot: radialTexture([
      [0, T.brand, 0.55],
      [0.35, T.brand, 0.16],
      [1, T.brand, 0],
    ]),
    warn: radialTexture([
      [0, T.warn, 0.4],
      [0.35, T.warn, 0.12],
      [1, T.warn, 0],
    ]),
    crit: radialTexture([
      [0, T.crit, 0.45],
      [0.35, T.crit, 0.12],
      [1, T.crit, 0],
    ]),
  };
  const haloMat = Object.fromEntries(
    Object.entries(halo).map(([k, t]) => [
      k,
      new THREE.MeshBasicMaterial({
        map: t,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    ]),
  );
  const haloGeo = new THREE.PlaneGeometry(1, 1);
  // the idle sweep: a faint beam of the pool's light turns round the table, so a quiet office still reads
  // as switched on. A pod glints as the beam passes, a lead's glint runs out along its links, and the hub
  // breathes. It is never the teal of work and never a ticket; it stops with reduced motion, and a hidden
  // tab draws nothing.
  const sweep = new THREE.Mesh(
    new THREE.PlaneGeometry(44.4, 44.4),
    new THREE.MeshBasicMaterial({
      map: sweepTexture(T.pool),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  sweep.rotation.x = -Math.PI / 2;
  sweep.position.y = 0.015;
  sweep.raycast = () => {};
  sweep.visible = false;
  scene.add(sweep);
  const glintTex = radialTexture([
    [0, T.pool, 0.32],
    [0.35, T.pool, 0.1],
    [1, T.pool, 0],
  ]);
  const glintMat = new THREE.MeshBasicMaterial({
    map: glintTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const runs = [];
  const camera = new THREE.PerspectiveCamera(phone ? 34 : 30, W / H, 0.5, 1000);
  camera.position.set(phone ? 0 : 4, phone ? 30 : 27, phone ? 26 : 31);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reduced();
  controls.dampingFactor = 0.09;
  controls.minPolarAngle = 0.26;
  controls.maxPolarAngle = 1.12;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.zoomSpeed = 0.8;
  // on a touch screen one finger scrolls the page past the room and two fingers orbit and zoom it; a tap
  // still opens a desk, and pods are moved only with a mouse (the layout is edited on the desktop)
  controls.touches = { ONE: -1, TWO: THREE.TOUCH.DOLLY_ROTATE };
  renderer.domElement.style.touchAction = 'pan-y';
  const home = { target: new THREE.Vector3(0, 0, 0.6), dist: 60, dy: 0 };

  const nodes = {};
  const links = [];
  let order = [];
  const linkGroup = new THREE.Group();
  scene.add(linkGroup);
  let state = { running: {}, waiting: {}, failed: {}, paused: {}, selected: null, hovered: null };
  let lastData = null;

  /* ---------- building ---------- */
  function loadLayout() {
    try {
      return JSON.parse(localStorage.getItem(LS) || '{}') || {};
    } catch {
      return {};
    }
  }
  function saveLayout() {
    try {
      const out = {};
      for (const [id, n] of Object.entries(nodes))
        out[id] = [+n.group.position.x.toFixed(2), +n.group.position.z.toFixed(2)];
      localStorage.setItem(LS, JSON.stringify(out));
    } catch {
      // no local storage: the layout is not remembered, no harm
    }
  }
  function clear() {
    for (const n of Object.values(nodes)) {
      scene.remove(n.group, n.halo);
      n.plate.remove();
    }
    for (const l of links) {
      linkGroup.remove(l.line);
      l.line.geometry.dispose();
      lineMats.delete(l.line.material);
      l.line.material.dispose();
    }
    for (const k in nodes) delete nodes[k];
    links.length = 0;
    order = [];
  }
  function build(desks, departments) {
    clear();
    const base = layoutDesks(desks, departments);
    const saved = loadLayout();
    const leadOf = {};
    for (const d of departments) leadOf[d.id] = d.lead;
    const chief = desks.find(d => !d.reportsTo);
    const leads = new Set(departments.filter(d => d.id !== 'exec').map(d => d.lead));
    const deptName = id => departments.find(d => d.id === id)?.name || '';
    for (const d of desks) {
      const p = base[d.id];
      if (!p) continue;
      const s = saved[d.id];
      const x = Array.isArray(s) ? s[0] : p.x,
        z = Array.isArray(s) ? s[1] : p.z;
      const kind = d.id === chief?.id ? 'chief' : leads.has(d.id) ? 'lead' : 'worker';
      const g = pod(kind, m);
      g.position.set(x, 0, z);
      g.rotation.y = -p.a;
      scene.add(g);
      g.traverse(o => {
        if (o.isMesh) o.userData.desk = d.id;
      });
      const hl = new THREE.Mesh(haloGeo, haloMat.hot);
      hl.rotation.x = -Math.PI / 2;
      hl.scale.setScalar(SIZE[kind] * 7);
      hl.position.set(x, 0.02, z);
      hl.visible = false;
      hl.raycast = () => {};
      scene.add(hl);
      // hidden until the first draw places it, so no label ever shows at the corner of the stage
      const plate = document.createElement('button');
      plate.type = 'button';
      plate.hidden = true;
      plate.className = `plate ${kind === 'worker' ? 'sm' : ''} ${kind === 'chief' ? 'chief' : ''}`;
      plate.addEventListener('click', () => onSelect(d.id));
      plate.addEventListener('mouseenter', () => onHover(d.id));
      plate.addEventListener('mouseleave', () => onHover(null));
      plate.addEventListener('focus', () => onHover(d.id));
      plate.addEventListener('blur', () => onHover(null));
      const nDesks = desks.filter(x => x.dept === d.dept && x.id !== d.id).length;
      const sub =
        kind === 'chief'
          ? `Hub · ${leads.size} departments`
          : kind === 'lead'
            ? `${nDesks} desk${nDesks === 1 ? '' : 's'}`
            : '';
      nodes[d.id] = {
        id: d.id,
        kind,
        group: g,
        halo: hl,
        plate,
        name: kind === 'lead' && phone ? deptName(d.dept) || d.name : d.name,
        fullName: d.name,
        sub,
        parent: d.reportsTo || null,
        lead: kind === 'worker' ? leadOf[d.dept] : null,
        status: 'idle',
        size: null,
        html: '',
      };
    }
    // the plates in reading order: the chief, the leads round the ring, then each team
    order = [
      chief?.id,
      ...departments.filter(d => d.id !== 'exec').map(d => d.lead),
      ...desks.filter(d => nodes[d.id]?.kind === 'worker').map(d => d.id),
    ].filter(id => id && nodes[id]);
    for (const id of order) labels.appendChild(nodes[id].plate);
    for (const n of Object.values(nodes)) {
      if (!n.parent || !nodes[n.parent]) continue;
      const l = line([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)], { color: T.link, width: 1.25 });
      linkGroup.add(l);
      links.push({ from: nodes[n.parent], to: n, line: l, hot: null });
    }
    relink();
    frame(true);
  }
  function relink() {
    for (const l of links) {
      const a = l.from.group.position,
        b = l.to.group.position;
      l.line.geometry.setPositions([a.x, 0.03, a.z, b.x, 0.03, b.z]);
    }
  }

  /* ---------- state ---------- */
  const statusOf = id =>
    state.paused[id]
      ? 'paused'
      : state.running[id]
        ? 'working'
        : state.waiting[id]
          ? 'waiting'
          : state.failed[id]
            ? 'failed'
            : 'idle';
  const inHand = () => state.hovered || state.selected;
  function setState(s) {
    state = { ...state, ...s };
    const hand = inHand();
    let lightAt = null;
    for (const n of Object.values(nodes)) {
      const st = statusOf(n.id);
      const lit = n.id === state.selected || n.id === state.hovered;
      n.status = st;
      dressPod(n.group, m, { status: st, lit });
      const showHalo = lit || st === 'working' || st === 'waiting' || st === 'failed';
      if (st !== 'working') n.halo.scale.setScalar(SIZE[n.kind] * 7);
      n.halo.visible = showHalo && !n.away;
      n.halo.material = st === 'waiting' && !lit ? haloMat.warn : st === 'failed' && !lit ? haloMat.crit : haloMat.hot;
      if (lit && (!lightAt || n.id === state.hovered)) lightAt = n;
      const [ic, word] = STATE[st] || [];
      const line2 =
        st !== 'idle' ? `<span>${icon(ic)}${word}</span>` : n.sub && !phone ? `<span>${esc(n.sub)}</span>` : '';
      const html = `<b>${esc(n.name)}</b>${line2}`;
      if (html !== n.html) {
        n.html = html;
        n.plate.innerHTML = html;
        n.size = null;
      }
      n.plate.className = `plate ${n.kind === 'worker' ? 'sm' : ''} ${n.kind === 'chief' ? 'chief' : ''} ${lit ? 'hot' : ''} st-${st}`;
      n.plate.setAttribute('aria-label', `Open ${n.fullName}${st !== 'idle' ? `, ${word.toLowerCase()}` : ''}`);
      n.plate.setAttribute('aria-pressed', String(n.id === state.selected));
    }
    if (lightAt) {
      handLight.position.set(lightAt.group.position.x, 2.2, lightAt.group.position.z);
      handLight.intensity = 6;
    } else handLight.intensity = 0;
    for (const l of links) {
      const hot = !!hand && (l.to.id === hand || l.from.id === hand);
      if (hot !== l.hot) {
        l.hot = hot;
        l.line.material.color.set(hex(hot ? T.brand : T.link));
        l.line.material.linewidth = hot ? 1.5 : 1.25;
        l.line.material.opacity = hot ? 0.8 : 1;
        l.line.material.transparent = hot;
        l.line.material.needsUpdate = true;
      }
    }
    frame();
  }

  /* ---------- the camera: framing, limits, glides ---------- */
  function framePoints() {
    const pts = [];
    for (const n of Object.values(nodes)) {
      const s = SIZE[n.kind];
      const p = n.group.position;
      pts.push(
        new THREE.Vector3(p.x - s, 0, p.z - s),
        new THREE.Vector3(p.x + s, 0, p.z + s),
        new THREE.Vector3(p.x, s * 0.9, p.z),
      );
    }
    return pts.length ? pts : [new THREE.Vector3(-12, 0, -12), new THREE.Vector3(12, 0, 12)];
  }
  function computeHome() {
    const keep = camera.position.clone(),
      keepT = controls.target.clone();
    camera.position
      .copy(home.target)
      .addScaledVector(phone ? new THREE.Vector3(0, 30, 26).normalize() : new THREE.Vector3(4, 27, 31).normalize(), 60);
    const r = fit(
      camera,
      framePoints(),
      W,
      H,
      phone
        ? { margin: 10, marginTop: 16, marginBottom: 30, target: home.target, centre: true }
        : { margin: 30, marginTop: 34, marginBottom: 56, target: home.target, centre: true },
    );
    home.dist = r.distance;
    home.dy = r.dy;
    home.pos = camera.position.clone();
    // close enough to read a pod, never so close that the near ones crop into blobs
    controls.minDistance = Math.min(home.dist * 0.55, phone ? 20 : 15);
    controls.maxDistance = home.dist * 1.45;
    return { keep, keepT };
  }
  let moved = false;
  let glide = null;
  function goHome(animate) {
    loom();
    const { keep, keepT } = computeHome();
    if (!animate || reduced()) {
      controls.target.copy(home.target);
      camera.position.copy(home.pos);
      camera.lookAt(home.target);
      controls.update();
      moved = false;
      frame();
      return;
    }
    camera.position.copy(keep);
    controls.target.copy(keepT);
    glideTo(home.target, home.dist, home.pos);
    moved = false;
  }
  function glideTo(target, dist, finalPos) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    const to = finalPos ? finalPos.clone() : target.clone().addScaledVector(dir, dist);
    if (reduced()) {
      controls.target.copy(target);
      camera.position.copy(to);
      controls.update();
      frame();
      return;
    }
    glide = {
      t0: performance.now(),
      ms: 720,
      fromT: controls.target.clone(),
      toT: target.clone(),
      fromP: camera.position.clone(),
      toP: to,
    };
    frame();
  }
  function stepGlide(now) {
    if (!glide) return false;
    const k = Math.min(1, (now - glide.t0) / glide.ms);
    const e = 1 - Math.pow(1 - k, 3);
    controls.target.lerpVectors(glide.fromT, glide.toT, e);
    camera.position.lerpVectors(glide.fromP, glide.toP, e);
    camera.lookAt(controls.target);
    if (k >= 1) glide = null;
    return !!glide;
  }
  // In a close-up, a pod outside the team that would sit right in front of the camera is put away until
  // the view goes home again: seen that close it is only a cropped blob over the team.
  function loom(hide = new Set()) {
    for (const x of Object.values(nodes)) {
      const away = hide.has(x.id);
      x.away = away;
      x.group.visible = !away;
    }
    for (const l of links) l.line.visible = !l.from?.away && !l.to?.away;
    setState({}); // halos follow the state again, and an away pod's halo stays off
  }
  function focus(id) {
    const n = id && nodes[id];
    if (!n || n.kind === 'chief') {
      if (moved || glide || n) goHome(true);
      return;
    }
    // look down on the desk's team from a steeper angle than the home view, keeping the bearing, so the
    // pods nearest the camera never loom into blobs; the team fills the frame within the limits
    const leadId = n.kind === 'lead' ? n.id : n.lead;
    const team = Object.values(nodes).filter(x => x.id === leadId || x.lead === leadId);
    const target = new THREE.Vector3();
    for (const x of team) target.add(x.group.position);
    target.divideScalar(Math.max(1, team.length));
    target.y = 0;
    if (n.kind === 'worker') target.lerp(n.group.position.clone().setY(0), 0.5);
    const off = camera.position.clone().sub(controls.target);
    const az = Math.atan2(off.x, off.z);
    const polar = 0.62;
    const dir = new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az));
    const probe = camera.clone();
    probe.position.copy(target).addScaledVector(dir, 60);
    const pts = [];
    for (const x of team) {
      const s = SIZE[x.kind];
      const p = x.group.position;
      pts.push(
        new THREE.Vector3(p.x - s * 1.6, 0, p.z - s * 1.6),
        new THREE.Vector3(p.x + s * 1.6, 0, p.z + s * 1.6),
        new THREE.Vector3(p.x, s, p.z),
      );
    }
    const r = fit(probe, pts, W, H, { margin: 70, marginTop: 50, marginBottom: 80, target });
    const d = THREE.MathUtils.clamp(r.distance, Math.max(controls.minDistance, home.dist * 0.5), home.dist * 0.9);
    const P = target.clone().addScaledVector(dir, d);
    // Seen from the final pose: a pod outside the team that is too near the camera, or that the frame
    // would cut (its disc reaches within 40 px of an edge, or it sits outside), is put away for the close-up.
    const cam = camera.clone();
    cam.position.copy(P);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const px = v => {
      const q = v.clone().project(cam);
      return { x: ((q.x + 1) / 2) * W, y: ((1 - q.y) / 2) * H, behind: q.z > 1 };
    };
    const cut = x => {
      const c = px(x.group.position);
      if (c.behind) return true;
      const e = px(x.group.position.clone().addScaledVector(right, SIZE[x.kind] * 1.6));
      const r = Math.hypot(e.x - c.x, e.y - c.y);
      const m = 40 + r;
      return c.x < m || c.y < m || c.x > W - m || c.y > H - m;
    };
    loom(
      new Set(
        Object.values(nodes)
          .filter(x => !team.includes(x) && (x.group.position.distanceTo(P) < d * 0.82 || cut(x)))
          .map(x => x.id),
      ),
    );
    moved = true;
    glideTo(target, d, P);
  }
  controls.addEventListener('start', () => {
    glide = null;
    moved = true;
  });
  controls.addEventListener('change', () => {
    // the table stays in view: the point the camera looks at cannot leave the bezel
    const t = controls.target;
    const r = Math.hypot(t.x, t.z);
    if (r > 16) {
      t.x *= 16 / r;
      t.z *= 16 / r;
    }
    if (t.y !== 0) t.y = 0;
    frame();
  });

  /* ---------- pulses: a ticket travelling the links ---------- */
  const pulses = [];
  const flashes = [];
  const ancestors = id => {
    const out = [id];
    let cur = id,
      guard = 0;
    while (nodes[cur]?.parent && guard++ < 12) {
      cur = nodes[cur].parent;
      out.push(cur);
    }
    return out;
  };
  const chiefId = () => Object.keys(nodes).find(k => nodes[k].kind === 'chief');
  const fixture = x =>
    typeof x === 'string' && (x.startsWith('conn:') || ['phone', 'clock', 'owner', 'rack'].includes(x)) ? chiefId() : x;
  function route(from, to) {
    const a = fixture(from),
      b = fixture(to);
    if (!nodes[a] || !nodes[b] || a === b) return null;
    const A = ancestors(a),
      B = ancestors(b);
    const lca = A.find(x => B.includes(x));
    if (!lca) return null;
    return [...A.slice(0, A.indexOf(lca) + 1), ...B.slice(0, B.indexOf(lca)).reverse()];
  }
  const cometGeo = new THREE.SphereGeometry(0.22, 16, 12);
  const cometMat = {
    hot: new THREE.MeshBasicMaterial({ color: new THREE.Color(hex(T.brand)).multiplyScalar(1.6), toneMapped: false }),
    warn: new THREE.MeshBasicMaterial({ color: new THREE.Color(hex(T.warn)).multiplyScalar(1.3), toneMapped: false }),
  };
  function pulse({ from, to, kind }) {
    const ids = route(from, to);
    if (!ids || ids.length < 2) return;
    const warn = kind === 'waiting';
    if (reduced()) {
      // no travelling light: the route lights up for a moment instead
      const hit = links.filter(l => ids.includes(l.from.id) && ids.includes(l.to.id));
      for (const l of hit) {
        l.line.material.color.set(hex(warn ? T.warn : T.brand));
        l.hot = null;
      }
      flashes.push({ until: performance.now() + 1400, links: hit });
      setTimeout(() => frame(), 1450);
      frame();
      return;
    }
    const pts = ids.map(id => nodes[id].group.position.clone().setY(0.5));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0);
    const orb = new THREE.Mesh(cometGeo, warn ? cometMat.warn : cometMat.hot);
    scene.add(orb);
    const glow = new THREE.Mesh(haloGeo, warn ? haloMat.warn : haloMat.hot);
    glow.rotation.x = -Math.PI / 2;
    glow.scale.setScalar(3);
    glow.raycast = () => {};
    scene.add(glow);
    pulses.push({
      curve,
      orb,
      glow,
      t0: performance.now(),
      ms: THREE.MathUtils.clamp(curve.getLength() * 70, 700, 1800),
    });
    frame();
  }
  function breathe(now) {
    if (reduced()) return false;
    let any = false;
    for (const n of Object.values(nodes)) {
      if (n.status !== 'working' || n.id === state.selected || n.id === state.hovered) continue;
      any = true;
      n.halo.material = haloMat.hot;
      n.halo.scale.setScalar(SIZE[n.kind] * (6.2 + Math.sin(now / 700) * 0.9));
    }
    // a slow change needs few frames: the loop asks for about 20 a second while desks work
    return any;
  }
  function stepPulses(now) {
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      const k = Math.max(0, (now - p.t0) / p.ms); // a frame's clock can run a hair behind the pulse's start: never ask the curve for a point before 0
      if (k >= 1) {
        scene.remove(p.orb, p.glow);
        pulses.splice(i, 1);
        continue;
      }
      const at = p.curve.getPointAt(k);
      p.orb.position.copy(at);
      p.glow.position.set(at.x, 0.03, at.z);
    }
    for (let i = flashes.length - 1; i >= 0; i--)
      if (now > flashes[i].until) {
        flashes.splice(i, 1);
        setState({});
      }
    return pulses.length > 0;
  }

  function ambient(now) {
    const on = !reduced() && Object.keys(nodes).length > 0;
    sweep.visible = on;
    if (!on) {
      for (const r of runs.splice(0)) scene.remove(r.glow);
      return false;
    }
    const beam = beamAt(now);
    sweep.rotation.z = beam;
    for (const n of Object.values(nodes)) {
      if (n.status !== 'idle' || n.away || n.id === state.selected || n.id === state.hovered) {
        n.swept = false;
        continue;
      }
      const p = n.group.position;
      const g = n.kind === 'chief' ? 0.55 + Math.sin(now / 1100) * 0.2 : glintOf(beam, p.x, p.z);
      if (n.kind === 'lead') {
        if (g > 0.85 && !n.swept) {
          n.swept = true;
          for (const l of links) {
            if (l.from !== n || l.to.status !== 'idle') continue;
            const glow = new THREE.Mesh(haloGeo, glintMat);
            glow.rotation.x = -Math.PI / 2;
            glow.raycast = () => {};
            scene.add(glow);
            runs.push({ a: p.clone(), b: l.to.group.position.clone(), glow, t0: now, ms: 900 });
          }
        } else if (g === 0) n.swept = false;
      }
      if (g > 0.02) {
        n.halo.material = glintMat;
        n.halo.scale.setScalar(SIZE[n.kind] * 6 * g);
        n.halo.visible = true;
      } else if (n.halo.material === glintMat) n.halo.visible = false;
    }
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i];
      const k = (now - r.t0) / r.ms;
      if (k >= 1 || k < 0) {
        scene.remove(r.glow);
        runs.splice(i, 1);
        continue;
      }
      r.glow.position.lerpVectors(r.a, r.b, k).setY(0.03);
      r.glow.scale.setScalar(1.8 * Math.sin(k * Math.PI));
    }
    return true;
  }
  /* ---------- picking and dragging ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitP = new THREE.Vector3();
  let hoverId = null,
    drag = null;
  const toNdc = ev => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const pickables = () => Object.values(nodes).flatMap(n => [n.group.userData.body, n.group.userData.dome]);
  const pick = ev => {
    toNdc(ev);
    const h = ray.intersectObjects(pickables(), false)[0];
    return h?.object.userData.desk || null;
  };
  const el = renderer.domElement;
  const onDown = ev => {
    if (ev.button !== 0) return;
    const id = pick(ev);
    if (!id) return;
    drag = { id, x: ev.clientX, y: ev.clientY, moved: false, touch: ev.pointerType !== 'mouse' };
    if (!drag.touch) {
      controls.enabled = false;
      el.setPointerCapture(ev.pointerId);
    }
  };
  const onMove = ev => {
    if (drag) {
      if (Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y) > 4) drag.moved = true;
      if (drag.moved && !drag.touch) {
        toNdc(ev);
        if (ray.ray.intersectPlane(plane, hitP)) {
          const n = nodes[drag.id];
          const x = THREE.MathUtils.clamp(hitP.x, -21, 21),
            z = THREE.MathUtils.clamp(hitP.z, -21, 21);
          n.group.position.set(x, 0, z);
          n.halo.position.set(x, 0.02, z);
          relink();
          setState({});
        }
      }
      return;
    }
    const id = pick(ev);
    if (id !== hoverId) {
      hoverId = id;
      onHover(id);
      el.style.cursor = id ? 'pointer' : '';
    }
  };
  const onUp = ev => {
    if (!drag) return;
    const d = drag;
    drag = null;
    controls.enabled = true;
    try {
      el.releasePointerCapture(ev.pointerId);
    } catch {
      // the pointer was already released
    }
    if (!d.moved) onSelect(d.id);
    else if (!d.touch) saveLayout();
  };
  const onLeave = () => {
    if (hoverId) {
      hoverId = null;
      onHover(null);
      el.style.cursor = '';
    }
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', onLeave);
  const onLost = e => {
    e.preventDefault();
    onDead('The browser took the 3D view away (WebGL context lost).');
  };
  el.addEventListener('webglcontextlost', onLost);

  /* ---------- labels: placed after each draw, highest priority first, never overlapping ---------- */
  const tmp = new THREE.Vector3();
  function placeLabels() {
    const hand = inHand();
    const handLead = hand ? (nodes[hand]?.kind === 'lead' ? hand : nodes[hand]?.lead) : null;
    const close = !hand && camera.position.distanceTo(controls.target) < home.dist * 0.66;
    const rank = n =>
      n.id === state.selected
        ? 0
        : n.id === state.hovered
          ? 0.5
          : n.kind === 'chief'
            ? 1
            : n.status !== 'idle' && n.status !== 'paused'
              ? 2
              : n.kind === 'lead'
                ? 3
                : n.lead === handLead
                  ? 4
                  : 5;
    const hit = (r, list) =>
      list.some(q => r.x < q.x + q.w + 3 && r.x + r.w + 3 > q.x && r.y < q.y + q.h + 3 && r.y + r.h + 3 > q.y);
    const inside = r => r.x >= 4 && r.y >= 4 && r.x + r.w <= W - 4 && r.y + r.h <= H - 4;
    const spots = n => {
      const s = SIZE[n.kind];
      const p = n.group.position;
      const foot = toScreen(camera, tmp.set(p.x, 0, p.z + s * 1.15), W, H);
      const top = toScreen(camera, tmp.set(p.x, s * 0.95, p.z), W, H);
      const c = toScreen(camera, tmp.set(p.x, 0, p.z), W, H);
      if (c.behind || foot.behind || c.x < -2 || c.x > W + 2 || c.y < -2 || c.y > H + 2) return [];
      const { w, h } = n.size;
      const cx = v => THREE.MathUtils.clamp(v - w / 2, 4, W - w - 4);
      const side = Math.max(8, Math.abs(foot.y - c.y)) + 6;
      const out = [
        { x: cx(foot.x), y: foot.y + (n.kind === 'worker' ? 2 : 4), w, h },
        { x: cx(top.x), y: top.y - h - 6, w, h },
      ];
      // a busy desk out on the ring may also sit beside its pod, which keeps the space under a lead free
      if (n.kind === 'worker')
        out.push({ x: c.x + side, y: c.y - h / 2, w, h }, { x: c.x - side - w, y: c.y - h / 2, w, h });
      return out.filter(inside);
    };
    const list = order.map(id => nodes[id]).sort((a, b) => rank(a) - rank(b));
    for (const n of list) {
      const want =
        !n.away && (n.kind !== 'worker' || n.id === hand || n.lead === handLead || n.status !== 'idle' || close);
      if (!want) {
        if (!n.plate.hidden) n.plate.hidden = true;
        continue;
      }
      if (n.plate.hidden) n.plate.hidden = false;
      if (!n.size) n.size = { w: n.plate.offsetWidth, h: n.plate.offsetHeight };
    }
    // where the chief and the leads would like their names, so a worker placed before them leaves that room
    const reserved = list
      .filter(n => n.kind !== 'worker' && !n.plate.hidden)
      .map(n => spots(n)[0])
      .filter(Boolean);
    const placed = [];
    for (const n of list) {
      if (n.plate.hidden) continue;
      const opts = spots(n);
      const free = opts.filter(r => !hit(r, placed));
      const r = (n.kind === 'worker' && free.find(q => !hit(q, reserved))) || free[0];
      if (!r) {
        n.plate.hidden = true;
        continue;
      }
      placed.push(r);
      n.plate.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.y)}px)`;
    }
  }

  /* ---------- drawing on demand ---------- */
  let raf = 0,
    alive = true,
    frames = 0,
    quiet = false,
    idleT = 0;
  function frame() {
    quiet = false;
    if (alive && !raf) raf = requestAnimationFrame(tick);
  }
  // a frame only the sweep or a breathing halo asks for: nothing that casts a shadow has moved
  function idleFrame() {
    if (raf) return;
    frame();
    quiet = true;
  }
  function tick(now) {
    raf = 0;
    if (!alive) return;
    let more = stepGlide(now);
    if (controls.enableDamping) more = controls.update() || more;
    else controls.update();
    more = stepPulses(now) || more;
    const breathing = breathe(now);
    const idle = ambient(now);
    renderer.shadowMap.autoUpdate = !quiet;
    quiet = false;
    renderer.render(scene, camera);
    placeLabels();
    labels.dataset.frames = String(++frames); // how many draws so far: a check or a screenshot can wait for the next one
    if (more) frame();
    else if ((breathing || idle) && !idleT)
      idleT = setTimeout(
        () => {
          idleT = 0;
          idleFrame();
        },
        breathing ? 48 : 40,
      );
  }
  function resize() {
    W = Math.max(1, host.clientWidth);
    H = Math.max(1, host.clientHeight);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    for (const mt of lineMats) mt.resolution.set(W, H);
    if (!moved) goHome(false);
    else {
      const { keep, keepT } = computeHome();
      camera.position.copy(keep);
      controls.target.copy(keepT);
      camera.lookAt(keepT);
      controls.update();
    }
    frame();
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(host);
  resize();

  return {
    setData({ desks, departments }) {
      lastData = { desks, departments };
      build(desks, departments);
      setState({});
      goHome(false);
    },
    setState,
    pulse,
    focus,
    resetLayout() {
      try {
        localStorage.removeItem(LS);
      } catch {
        // no local storage: nothing to forget
      }
      if (lastData) {
        build(lastData.desks, lastData.departments);
        setState({});
        goHome(!reduced());
      }
    },
    home() {
      goHome(!reduced());
    },
    zoom(f) {
      const d = camera.position.distanceTo(controls.target);
      const nd = THREE.MathUtils.clamp(d * f, controls.minDistance, controls.maxDistance);
      moved = true;
      glideTo(controls.target.clone(), nd);
    },
    setReduced(on) {
      controls.enableDamping = !on;
      frame();
    },
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(idleT);
      ro.disconnect();
      controls.dispose();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('webglcontextlost', onLost);
      clear();
      disposeScene(scene);
      for (const t of Object.values(halo)) t.dispose();
      glintTex.dispose();
      sweep.material.map.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      el.remove();
    },
  };
}
