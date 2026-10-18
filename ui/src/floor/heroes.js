// The two lit 3D figures beside the numbers: the ledger's columns (yesterday and today, to scale, before
// an etched dollar plate) and the pipeline's glass marbles (one per lead, in its stage's bay). They are
// still lifes: drawn once, drawn again only when their box changes size, never animated. Each returns the
// screen points its labels hang from, so the figures stay HTML text.
import { THREE, makeRenderer, envMap, lights, fit, toScreen, fatLine, disposeScene } from './kit.js';
import { T, hex } from '../lib/tokens.js';
import { niceTicks } from '../lib/charts.js';

function roundedColumn(wd, ht, dp, rad = 0.12) {
  const sh = new THREE.Shape(); const x = -wd / 2, y = 0; const r = Math.min(rad, ht / 2.2);
  sh.moveTo(x + r, y); sh.lineTo(x + wd - r, y); sh.quadraticCurveTo(x + wd, y, x + wd, y + r); sh.lineTo(x + wd, y + ht - r); sh.quadraticCurveTo(x + wd, y + ht, x + wd - r, y + ht); sh.lineTo(x + r, y + ht); sh.quadraticCurveTo(x, y + ht, x, y + ht - r); sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(sh, { depth: dp, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4, curveSegments: 8 }); g.translate(0, 0, -dp / 2); return g;
}
const glassData = (color, ghost) => new THREE.MeshPhysicalMaterial({ color: hex(color), metalness: 0, roughness: 0.16, transmission: ghost ? 0.5 : 0.3, thickness: 1.2, ior: 1.45, clearcoat: 1, clearcoatRoughness: 0.08, attenuationColor: new THREE.Color(hex(T.columnDeep)), attenuationDistance: 0.9, emissive: new THREE.Color(hex(T.columnGlow)), emissiveIntensity: ghost ? 0 : 0.45, transparent: ghost, opacity: ghost ? 0.28 : 1 });

/** A hero stage: a transparent renderer in the box, studio light, neutral tone mapping (keeps the blues true). */
function stage(host, { exposure = 1.1, env = 0.55 } = {}) {
  const renderer = makeRenderer(host, { exposure, alpha: true, tone: THREE.NeutralToneMapping });
  const scene = new THREE.Scene(); scene.environment = envMap(renderer, 0.04); scene.environmentIntensity = env; lights(scene, { shadow: 14, key: 2.4, mapSize: 1024 });
  const lineMats = [];
  return {
    renderer, scene, lineMats,
    line(pts, o) { const l = fatLine(pts, { ...o, w: host.clientWidth, h: host.clientHeight }); lineMats.push(l.material); return l; },
    size() { const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight); renderer.setSize(w, h, false); for (const m of lineMats) m.resolution.set(w, h); return { w, h }; },
    dispose() { disposeScene(scene); scene.environment?.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); },
  };
}

/** Yesterday and today as frosted columns, heights to scale against an etched plate. */
export function ledgerHero(host, { yesterday = 0, today = 0 }) {
  const st = stage(host, { exposure: 0.95, env: 0.45 }); const { scene } = st;
  const max = Math.max(yesterday, today, 0.01); const ticks = niceTicks(max).slice(1); const top = ticks[ticks.length - 1]; const unit = 4 / top; // the top tick stands 4 units tall
  const plinth = new THREE.Mesh(roundedColumn(5.6, 0.34, 3.0, 0.16), new THREE.MeshPhysicalMaterial({ color: hex(T.plinth), metalness: 0.6, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3 })); plinth.position.y = -0.34; plinth.receiveShadow = true; plinth.castShadow = true; scene.add(plinth);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(5.0, 4.6, 0.06), new THREE.MeshPhysicalMaterial({ color: hex(T.plate), roughness: 0.5, transmission: 0.6, thickness: 0.2, transparent: true, opacity: 0.5, metalness: 0 })); plate.position.set(0, 2.3, -1.1); scene.add(plate);
  for (const v of ticks) scene.add(st.line([new THREE.Vector3(-2.4, v * unit, -1.06), new THREE.Vector3(2.4, v * unit, -1.06)], { color: T.etch, width: 1, opacity: 0.85 }));
  const col = (x, v, ghost) => {
    const ht = Math.max(0.06, v * unit); const geo = roundedColumn(1.3, ht, 1.3, 0.14); const mesh = new THREE.Mesh(geo, ghost ? glassData(T.marble, true) : glassData(T.column, false)); mesh.position.set(x, 0, 0); mesh.castShadow = !ghost; scene.add(mesh);
    if (ghost) { const e = new THREE.EdgesGeometry(geo, 25); const p = e.attributes.position; for (let i = 0; i < p.count; i += 2) { const l = st.line([new THREE.Vector3().fromBufferAttribute(p, i), new THREE.Vector3().fromBufferAttribute(p, i + 1)], { color: T.d1Cap, width: 1.5 }); l.position.x = x; scene.add(l); } e.dispose(); }
    return ht;
  };
  const hy = col(-1.05, yesterday, false), ht = col(1.05, today, true);
  const spot = new THREE.SpotLight(hex(T.spot), 28, 30, 0.5, 0.9, 1.5); spot.position.set(-3, 9, 6); spot.target.position.set(0, 1.5, 0); spot.castShadow = true; scene.add(spot, spot.target);
  const kl = new THREE.DirectionalLight(hex(T.key), 1.6); kl.position.set(-6, 9, 8); scene.add(kl);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const anchors = { y: new THREE.Vector3(-1.05, hy + 0.05, 0.65), t: new THREE.Vector3(1.05, ht + 0.05, 0.65) }; ticks.forEach((v, i) => { anchors[`k${i}`] = new THREE.Vector3(2.55, v * unit, -1.06); });
  return {
    ticks,
    render() {
      const { w, h } = st.size(); cam.position.set(6.2, 3.6, 12.0);
      fit(cam, [new THREE.Vector3(-2.8, -0.34, 1.5), new THREE.Vector3(2.8, -0.34, 1.5), new THREE.Vector3(-2.8, -0.34, -1.5), new THREE.Vector3(2.8, -0.34, -1.5), new THREE.Vector3(-2.5, 4.6, -1.1), new THREE.Vector3(2.5, 4.6, -1.1)], w, h, { margin: 22, marginTop: 30, marginBottom: 14, target: new THREE.Vector3(0.2, 1.9, 0), centre: true });
      st.renderer.render(scene, cam);
      return Object.fromEntries(Object.entries(anchors).map(([k, v]) => [k, toScreen(cam, v, w, h)]));
    },
    dispose: st.dispose,
  };
}

/** Every lead as a glass marble in its stage's bay along a frosted rail; an empty stage is an empty bay. */
export function pipelineHero(host, stages, { maxPerBay = 16 } = {}) {
  const st = stage(host, { exposure: 1.1, env: 0.9 }); const { scene } = st;
  const n = stages.length; const gap = 1.42; const x0 = -((n - 1) * gap) / 2; const bay = 1.22;
  const rail = new THREE.Mesh(roundedColumn(n * gap + 0.5, 0.36, 1.7, 0.16), new THREE.MeshPhysicalMaterial({ color: hex(T.rail), metalness: 0.3, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.5 })); rail.position.y = -0.36; rail.receiveShadow = true; scene.add(rail);
  const wellMat = new THREE.MeshStandardMaterial({ color: hex(T.bayWell), roughness: 0.92 });
  const marble = new THREE.MeshPhysicalMaterial({ color: hex(T.marble), metalness: 0, roughness: 0.06, transmission: 0.9, thickness: 0.5, ior: 1.5, attenuationColor: new THREE.Color(hex(T.marbleDeep)), attenuationDistance: 0.35, clearcoat: 1, specularIntensity: 1 });
  const geo = new THREE.SphereGeometry(0.145, 40, 20); const anchors = {};
  stages.forEach((s, i) => {
    const x = x0 + i * gap; const count = Math.min(maxPerBay, s.n);
    const well = new THREE.Mesh(new THREE.PlaneGeometry(bay, bay), wellMat); well.rotation.x = -Math.PI / 2; well.position.set(x, 0.056, 0); well.receiveShadow = true; scene.add(well);
    const q = bay / 2; scene.add(st.line([[-q, -q], [q, -q], [q, q], [-q, q], [-q, -q]].map(([a, b]) => new THREE.Vector3(x + a, 0.06, b)), { color: s.n ? T.bay : T.bayEmpty, width: 1.3 }));
    const per = count > 6 ? 4 : 3; const rows = Math.ceil(count / per);
    for (let j = 0; j < count; j++) { const cx = j % per, cz = Math.floor(j / per); const inRow = Math.min(per, count - cz * per); const mm = new THREE.Mesh(geo, marble); mm.position.set(x + (cx - (inRow - 1) / 2) * 0.3, 0.2, (cz - (rows - 1) / 2) * 0.3); mm.castShadow = true; scene.add(mm); }
    anchors[s.key] = new THREE.Vector3(x, -0.36, 0.9);
  });
  scene.fog = new THREE.Fog(hex(T.bg1), 11.5, 17);
  const cam = new THREE.PerspectiveCamera(20, 1, 0.1, 200);
  return {
    render() {
      const { w, h } = st.size(); const span = n * gap + 0.6;
      cam.position.set(0, 6.8, 10.6); cam.lookAt(0, -0.15, 0.1);
      const { distance } = fit(cam, [new THREE.Vector3(-span / 2, -0.36, 0.9), new THREE.Vector3(span / 2, -0.36, 0.9), new THREE.Vector3(-span / 2, 0.3, -0.85), new THREE.Vector3(span / 2, 0.3, -0.85)], w, h, { margin: 12, marginTop: 16, marginBottom: 48, target: new THREE.Vector3(0, -0.15, 0.1), centre: true });
      // the fog only softens the back of the rail: it follows the camera, or a narrow box (camera further
      // back) would sink the marbles in it
      scene.fog.near = distance - 1.1; scene.fog.far = distance + 4.4;
      st.renderer.render(scene, cam);
      return Object.fromEntries(Object.entries(anchors).map(([k, v]) => [k, toScreen(cam, v, w, h)]));
    },
    dispose: st.dispose,
  };
}
