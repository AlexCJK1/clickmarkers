// The parts the war room, the pod stills and the hero renders share: a renderer sized to its host, the
// soft studio light, a camera fit, screen-space lines, and the pod itself. Colours come from
// lib/tokens.js, never from here.
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { T, hex } from '../lib/tokens.js';
export { THREE };

/** Is WebGL there at all? Checked once, without keeping a context. */
let glOk = null;
export function webglAvailable() {
  if (glOk !== null) return glOk;
  try {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    glOk = !!g;
    g?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    glOk = false;
  }
  return glOk;
}

/** A renderer filling its host. Supersampled a little on 1x screens so edges stay clean. */
export function makeRenderer(
  host,
  { alpha = false, exposure = 1, tone = THREE.AgXToneMapping, clear = T.bg0, shadows = true, ratio } = {},
) {
  const r = new THREE.WebGLRenderer({
    antialias: true,
    alpha,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  r.setPixelRatio(ratio || Math.min(2, Math.max(1.5, window.devicePixelRatio || 1)));
  r.toneMapping = tone;
  r.toneMappingExposure = exposure;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(hex(clear), alpha ? 0 : 1);
  if (shadows) {
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.VSMShadowMap;
  }
  r.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  host.appendChild(r.domElement);
  return r;
}
export function envMap(renderer, sigma = 0.04) {
  const pm = new THREE.PMREMGenerator(renderer);
  const t = pm.fromScene(new RoomEnvironment(), sigma).texture;
  pm.dispose();
  return t;
}

/** Key light with soft shadows, a cool rim, a dim sky. */
export function lights(scene, { shadow = 30, key = 2.6, rim = 1.1, sky = 0.55, mapSize = 2048 } = {}) {
  const k = new THREE.DirectionalLight(hex(T.key), key);
  k.position.set(-16, 30, 14);
  k.castShadow = true;
  k.shadow.mapSize.set(mapSize, mapSize);
  k.shadow.radius = 9;
  k.shadow.blurSamples = 20;
  k.shadow.bias = -0.0004;
  Object.assign(k.shadow.camera, { left: -shadow, right: shadow, top: shadow, bottom: -shadow, near: 1, far: 90 });
  scene.add(k);
  const r = new THREE.DirectionalLight(hex(T.rim), rim);
  r.position.set(12, 9, -26);
  scene.add(r);
  scene.add(new THREE.HemisphereLight(hex(T.sky), hex(T.ground), sky));
  return k;
}

/**
 * Moves a perspective camera along its view line until every point fits the frame with margins in
 * pixels; with centre, shifts the view window so the content sits in the middle (keeps the perspective).
 */
export function fit(
  camera,
  points,
  w,
  h,
  { margin = 24, marginTop, marginBottom, target = new THREE.Vector3(), centre = false } = {},
) {
  camera.clearViewOffset();
  const dir = camera.position.clone().sub(target).normalize();
  let lo = 2,
    hi = 600;
  camera.far = Math.max(camera.far, 1000);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const mx = (margin / w) * 2,
    mt = ((marginTop ?? margin) / h) * 2,
    mb = ((marginBottom ?? margin) / h) * 2;
  const v = new THREE.Vector3();
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    camera.position.copy(target).addScaledVector(dir, mid);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    let ok = true;
    for (const p of points) {
      v.copy(p).project(camera);
      if (v.x < -1 + mx || v.x > 1 - mx || v.y > 1 - mt || v.y < -1 + mb || v.z > 1) {
        ok = false;
        break;
      }
    }
    if (ok) hi = mid;
    else lo = mid;
  }
  camera.position.copy(target).addScaledVector(dir, hi);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  let dy = 0;
  if (centre) {
    let y0 = Infinity,
      y1 = -Infinity;
    for (const p of points) {
      v.copy(p).project(camera);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
    }
    dy = (((y0 + y1) / 2 + (mt - mb) / 2) * h) / 2;
    camera.setViewOffset(w, h, 0, -dy, w, h);
    camera.updateProjectionMatrix();
  }
  return { distance: hi, dy };
}
export function toScreen(camera, v, w, h) {
  const p = v.clone().project(camera);
  return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, behind: p.z > 1 };
}

/** A screen-space line in CSS pixels (WebGL's own lines are one device pixel, too thin when supersampled). */
export function fatLine(points, { color = T.link, width = 1, opacity = 1, w = 1, h = 1 } = {}) {
  const g = new LineGeometry();
  g.setPositions(points.flatMap(p => [p.x, p.y, p.z]));
  const m = new LineMaterial({
    color: hex(color),
    linewidth: width,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
  m.resolution.set(w, h);
  const l = new Line2(g, m);
  l.computeLineDistances();
  return l;
}
export function circlePoints(r, y = 0, n = 160) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  return out;
}

/** A soft radial texture for halos and pools of light. stops: [[offset, hex, alpha]]. */
export function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col, a] of stops) {
    const n = hex(col);
    r.addColorStop(o, `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`);
  }
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- the pod ---------- */
export const SIZE = { chief: 2.1, lead: 1.32, worker: 0.7 };
const brandLit = f => new THREE.Color(hex(T.brand)).multiplyScalar(f);
/** The pod materials: graphite body, a neutral ring, frosted glass, and the lit variants for each state. */
export function podMaterials() {
  return {
    body: new THREE.MeshPhysicalMaterial({
      color: hex(T.graphite),
      metalness: 0.72,
      roughness: 0.34,
      clearcoat: 0.5,
      clearcoatRoughness: 0.35,
    }),
    bodyPaused: new THREE.MeshPhysicalMaterial({ color: hex(T.graphiteDark), metalness: 0.5, roughness: 0.6 }),
    base: new THREE.MeshPhysicalMaterial({ color: hex(T.graphiteDark), metalness: 0.6, roughness: 0.5 }),
    ring: new THREE.MeshStandardMaterial({
      color: hex(T.ring),
      emissive: hex(T.ring),
      emissiveIntensity: 0.18,
      metalness: 0.4,
      roughness: 0.35,
    }),
    ringDim: new THREE.MeshStandardMaterial({ color: hex(T.graphiteDark), metalness: 0.4, roughness: 0.6 }),
    ringHot: new THREE.MeshBasicMaterial({ color: brandLit(1.6), toneMapped: false }),
    ringWarn: new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex(T.warn)).multiplyScalar(1.25),
      toneMapped: false,
    }),
    ringCrit: new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex(T.crit)).multiplyScalar(1.3),
      toneMapped: false,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: hex(T.glass),
      metalness: 0,
      roughness: 0.28,
      transmission: 0.92,
      thickness: 0.6,
      ior: 1.42,
      transparent: true,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      attenuationColor: new THREE.Color(hex(T.glassTint)),
      attenuationDistance: 2.5,
    }),
    core: new THREE.MeshStandardMaterial({ color: hex(T.core), metalness: 0.5, roughness: 0.45 }),
    coreHot: new THREE.MeshBasicMaterial({ color: brandLit(1.2), toneMapped: false }),
  };
}
/** One pod: a bevelled graphite puck, a thin status ring, a frosted dome over a small core. */
export function pod(kind, m) {
  const s = SIZE[kind];
  const g = new THREE.Group();
  const prof = [
    [0, 0],
    [1.0, 0],
    [1.06, 0.05],
    [1.08, 0.2],
    [1.02, 0.3],
    [0.9, 0.36],
    [0.62, 0.4],
    [0, 0.4],
  ].map(([x, y]) => new THREE.Vector2(x * s, y * s));
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, kind === 'worker' ? 48 : 72), m.body);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(s * 1.1, s * 1.12, s * 0.06, 64), m.base);
  skirt.position.y = s * 0.03;
  skirt.receiveShadow = true;
  g.add(skirt);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(s * 0.8, s * (kind === 'worker' ? 0.04 : 0.032), 12, 96), m.ring);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = s * 0.405;
  g.add(ring);
  if (kind === 'chief') {
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(s * 0.95, s * 0.018, 10, 96), m.ring);
    r2.rotation.x = Math.PI / 2;
    r2.position.y = s * 0.33;
    g.add(r2);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(s * 0.2, 32, 16), m.core);
  core.position.y = s * 0.5;
  g.add(core);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(s * 0.5, kind === 'worker' ? 40 : 64, 20, 0, Math.PI * 2, 0, Math.PI / 2),
    m.glass,
  );
  dome.position.y = s * 0.4;
  dome.castShadow = true;
  g.add(dome);
  if (kind !== 'worker') {
    const n = kind === 'chief' ? 12 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.BoxGeometry(s * 0.03, s * 0.08, s * 0.14), m.base);
      p.position.set(Math.cos(a) * s * 1.075, s * 0.16, Math.sin(a) * s * 1.075);
      p.rotation.y = -a;
      g.add(p);
    }
  }
  g.userData = { body, ring, core, dome, kind };
  return g;
}
/** Put a pod in a state: the ring and core say it, the body dims when paused. */
export function dressPod(g, m, { status = 'idle', lit = false }) {
  const { body, ring, core } = g.userData;
  ring.material =
    status === 'waiting'
      ? m.ringWarn
      : status === 'failed'
        ? m.ringCrit
        : lit || status === 'working'
          ? m.ringHot
          : status === 'paused'
            ? m.ringDim
            : m.ring;
  core.material = lit || status === 'working' ? m.coreHot : m.core;
  body.material = status === 'paused' ? m.bodyPaused : m.body;
}

/** Free a scene's GPU memory. */
export function disposeScene(scene) {
  scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const mt of mats) {
      for (const k of Object.keys(mt)) {
        const v = mt[k];
        if (v && v.isTexture) v.dispose();
      }
      mt.dispose();
    }
  });
}
