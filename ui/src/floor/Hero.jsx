// A lit 3D figure that costs nothing until it is seen: it is built when its box first scrolls into view,
// drawn again only when the box changes size while visible, and freed when it goes away. Without WebGL,
// or if the scene fails, the 2D fallback is shown instead. Labels are HTML placed on the scene's points.
import React, { useEffect, useRef, useState } from 'react';
import { webglAvailable } from './kit.js';

/** make(host) returns { render() -> points, dispose() }. children(points) draws the labels. */
export default function Hero({ make, deps = [], children, fallback = null, className = '', label }) {
  const box = useRef(null);
  const host = useRef(null);
  const [pts, setPts] = useState(null);
  const [failed, setFailed] = useState(() => !webglAvailable());
  useEffect(() => {
    if (failed || !host.current) return undefined;
    let hero = null;
    let visible = false;
    let dirty = true;
    let t = 0;
    let alive = true;
    const draw = () => {
      if (!alive || !visible || !dirty) return;
      dirty = false;
      try {
        if (!hero) hero = make(host.current);
        setPts(hero.render());
      } catch (e) {
        console.error('hero', e);
        setFailed(true);
      }
    };
    const io = new IntersectionObserver(
      es => {
        visible = es.some(e => e.isIntersecting);
        if (visible) draw();
      },
      { rootMargin: '120px' },
    );
    const ro = new ResizeObserver(() => {
      dirty = true;
      clearTimeout(t);
      t = setTimeout(draw, 120);
    });
    io.observe(box.current);
    ro.observe(box.current);
    return () => {
      alive = false;
      clearTimeout(t);
      io.disconnect();
      ro.disconnect();
      hero?.dispose();
    };
  }, [failed, ...deps]);
  if (failed) return <div className={`hero-box ${className}`}>{fallback}</div>;
  return (
    <div ref={box} className={`hero-box ${className}`} role="img" aria-label={label}>
      <div ref={host} className="hero3d" aria-hidden="true" />
      <div className="hero-labels" aria-hidden="true">
        {pts && children(pts)}
      </div>
    </div>
  );
}
