// Sheets and modals. Every drawer of the old page is a sheet now: it slides in from the right over a
// scrim (full screen on the phone), traps focus while it is open, gives it back to whatever opened it,
// and closes on Esc or a click on the scrim. Only the topmost dialog answers Esc, so a modal over a sheet
// closes on its own.
import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui.jsx';
import { useIsPhone } from '../lib/hooks.js';

const stack = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * One layer over the page (a dialog, a picker's popup). Only the topmost layer answers Esc, so a popup
 * inside a sheet closes on its own and the sheet stays. An input marked data-esc="local" that holds text
 * keeps its Esc (it clears itself).
 */
export function useLayer(active, onEsc, onKey) {
  const cb = useRef({ onEsc, onKey }); cb.current = { onEsc, onKey };
  useEffect(() => {
    if (!active) return undefined;
    const me = {}; stack.push(me);
    const handler = e => {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === 'Escape') {
        const t = e.target; if (t?.dataset?.esc === 'local' && t.value) return;
        e.preventDefault(); e.stopImmediatePropagation(); cb.current.onEsc?.(); return;
      }
      cb.current.onKey?.(e);
    };
    window.addEventListener('keydown', handler, true);
    return () => { window.removeEventListener('keydown', handler, true); const i = stack.indexOf(me); if (i >= 0) stack.splice(i, 1); };
  }, [active]);
}

/** Focus trap, Esc and focus return for one dialog element. */
function useDialog(ref, onClose, { initial } = {}) {
  useEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const back = document.activeElement;
    const first = initial?.current || el.querySelector('[data-autofocus]') || el;
    first.focus({ preventScroll: true });
    requestAnimationFrame(() => { if (!el.contains(document.activeElement)) first.focus({ preventScroll: true }); });
    return () => { if (back && document.contains(back) && typeof back.focus === 'function') back.focus({ preventScroll: true }); };
  }, []);
  useLayer(true, onClose, e => {
    const el = ref.current; if (!el || e.key !== 'Tab') return;
    const items = [...el.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) { e.preventDefault(); el.focus(); return; }
    const a = items[0], b = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === a || !el.contains(document.activeElement))) { e.preventDefault(); b.focus(); }
    else if (!e.shiftKey && (document.activeElement === b || !el.contains(document.activeElement))) { e.preventDefault(); a.focus(); }
  });
}

/**
 * A sheet from the right. size: 'md' (720), 'lg' (960), 'xl' (nearly the whole width). On the phone
 * every sheet is full screen. actions sit beside the close button.
 */
export function Sheet({ title, sub, size = 'md', onClose, actions, children, bodyClass = '', label }) {
  const ref = useRef(null); const id = useId(); const phone = useIsPhone();
  useDialog(ref, onClose);
  const width = phone ? '100vw' : size === 'xl' ? 'min(1600px, calc(100vw - 96px))' : size === 'lg' ? 'min(960px, calc(100vw - 64px))' : 'min(720px, calc(100vw - 48px))';
  return createPortal(
    <>
      <div className="scrim" onMouseDown={onClose} aria-hidden="true" />
      <section ref={ref} className={`sheet enter ${phone ? 'full' : ''}`} style={{ width }} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-label={label} tabIndex={-1}>
        <header className="sheet-hd">
          {phone && <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Back"><Icon name="chevronLeft" size={20} /></button>}
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 id={`${id}-t`} className="title-l">{title}</h2>
            {sub && !phone && <div className="meta sheet-sub">{sub}</div>}
          </div>
          <div className="sheet-actions">
            {actions}
            {!phone && <button type="button" className="btn btn-secondary" onClick={onClose}><Icon name="close" size={15} />Close<span className="kbd">Esc</span></button>}
          </div>
        </header>
        {sub && phone && <div className="meta sheet-sub-ph">{sub}</div>}
        <div className={`sheet-bd ${bodyClass}`}>{children}</div>
      </section>
    </>,
    document.body,
  );
}

/** A centred modal over everything (the big editor, the client brief). */
export function Modal({ title, sub, onClose, width = 760, children, footer, initial }) {
  const ref = useRef(null); const id = useId(); const phone = useIsPhone();
  useDialog(ref, onClose, { initial });
  return createPortal(
    <>
      <div className="scrim modal-scrim" onMouseDown={onClose} aria-hidden="true" />
      <section ref={ref} className={`modal ${phone ? 'full' : ''}`} style={phone ? undefined : { width }} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1}>
        <header className="sheet-hd">
          {phone && <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Back"><Icon name="chevronLeft" size={20} /></button>}
          <div style={{ minWidth: 0, flex: 1 }}><h2 id={`${id}-t`} className="title-l">{title}</h2>{sub && <div className="meta sheet-sub">{sub}</div>}</div>
          {!phone && <button type="button" className="btn btn-secondary" onClick={onClose}><Icon name="close" size={15} />Close<span className="kbd">Esc</span></button>}
        </header>
        <div className="modal-bd">{children}</div>
        {footer && <footer className="modal-ft">{footer}</footer>}
      </section>
    </>,
    document.body,
  );
}
