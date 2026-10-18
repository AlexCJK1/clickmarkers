// Small portraits of the pods for the executive suite's cards, rendered once per page from the same
// model the war room uses, so a card and its pod look alike. One short-lived renderer draws every variant,
// then is freed. Without WebGL the cards fall back to a drawn mark.
import { useEffect, useState } from 'react';
import { THREE, makeRenderer, envMap, SIZE, podMaterials, pod, dressPod, disposeScene, webglAvailable } from './kit.js';
import { T, hex } from '../lib/tokens.js';

const VARIANTS = { idle: { status: 'idle' }, hot: { status: 'idle', lit: true }, working: { status: 'working' }, waiting: { status: 'waiting' }, failed: { status: 'failed' }, paused: { status: 'paused' } };
let made = null;
function makeAll(px = 112) {
  if (!webglAvailable()) return Promise.resolve({});
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      const out = {}; const box = document.createElement('div'); box.style.cssText = `position:fixed;left:-9999px;top:0;width:${px}px;height:${px}px`; document.body.appendChild(box);
      let r = null; let scene = null;
      try {
        r = makeRenderer(box, { alpha: true, exposure: 1.15, ratio: 2, shadows: false }); r.setSize(px, px, false);
        scene = new THREE.Scene(); scene.environment = envMap(r, 0.05); scene.environmentIntensity = 0.5;
        const k = new THREE.DirectionalLight(hex(T.key), 3); k.position.set(-5, 8, 6); scene.add(k);
        const rim = new THREE.DirectionalLight(hex(T.rim), 1.6); rim.position.set(5, 3, -6); scene.add(rim); scene.add(new THREE.HemisphereLight(hex(T.sky), hex(T.ground), 0.6));
        const m = podMaterials();
        for (const kind of ['chief', 'lead']) {
          const g = pod(kind, m); scene.add(g); const s = SIZE[kind];
          const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 100); cam.position.set(0, s * 3.1, s * 4.6); cam.lookAt(0, s * 0.3, 0);
          for (const [v, o] of Object.entries(VARIANTS)) { dressPod(g, m, o); r.render(scene, cam); out[`${kind}-${v}`] = r.domElement.toDataURL('image/png'); }
          scene.remove(g);
        }
      } catch (e) { console.error('pod stills', e); }
      finally { if (scene) { disposeScene(scene); scene.environment?.dispose(); } if (r) { r.dispose(); r.forceContextLoss(); } box.remove(); }
      resolve(out);
    });
  });
}
/** The data URL of one pod portrait, or null while it renders (or without WebGL). */
export function usePodStill(kind, variant) {
  const [all, setAll] = useState(null);
  useEffect(() => { let on = true; (made ||= makeAll()).then(x => { if (on) setAll(x); }); return () => { on = false; }; }, []);
  return all?.[`${kind}-${variant}`] || null;
}
