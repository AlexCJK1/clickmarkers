// A searchable picker for the job bar (who, model, effort) and anywhere a native select would be too
// plain: a trigger button, then a popup with a search box and a grouped list. Keyboard: Enter, Space or
// the arrows open it; type to filter; Up and Down move; Enter picks; Esc closes and returns focus. The
// search box is the ARIA combobox and the list its listbox, so a screen reader hears the active option.
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui.jsx';
import { useLayer } from './Sheet.jsx';

const norm = s => String(s || '').toLowerCase();
function Hi({ text, q }) {
  if (!q) return text;
  const i = norm(text).indexOf(norm(q));
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/**
 * groups: [{ label?, items: [{ value, label, meta?, icon?, keywords? }] }]. value '' is a real choice
 * (the default). label is the trigger's key word ("Who"); valueLabel overrides what the trigger shows.
 */
export default function Combobox({
  label,
  value,
  onChange,
  groups,
  placeholder = 'Type to filter',
  width = 340,
  className = '',
  valueLabel,
  tipText,
  disabled = false,
  align = 'left',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const trigger = useRef(null);
  const search = useRef(null);
  const listRef = useRef(null);
  const pop = useRef(null);
  const id = useId();
  const listId = `${id}-list`;
  const all = useMemo(() => groups.flatMap(g => g.items), [groups]);
  const current = all.find(x => x.value === value) || all[0];
  const filtered = useMemo(() => {
    const k = norm(q).trim();
    return groups
      .map(g => ({
        ...g,
        items: k
          ? g.items.filter(x => norm(`${x.label} ${x.meta || ''} ${x.keywords || ''} ${g.label || ''}`).includes(k))
          : g.items,
      }))
      .filter(g => g.items.length);
  }, [groups, q]);
  const flat = useMemo(() => filtered.flatMap(g => g.items), [filtered]);

  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const vh = window.innerHeight,
      vw = window.innerWidth;
    const w = Math.min(width, vw - 16);
    const below = vh - r.bottom - 12,
      above = r.top - 12;
    const up = below < 320 && above > below;
    const maxH = Math.max(200, Math.min(470, up ? above : below));
    const left =
      align === 'right' ? Math.min(vw - 8 - w, Math.max(8, r.right - w)) : Math.max(8, Math.min(vw - 8 - w, r.left));
    setPos({ left, w, maxH, ...(up ? { bottom: vh - r.top + 6 } : { top: r.bottom + 6 }) });
  };
  const show = (seed = '') => {
    if (disabled) return;
    place();
    setQ(seed);
    const i = flat.findIndex(x => x.value === value);
    setActive(seed ? 0 : Math.max(0, i));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    setQ('');
    if (refocus) trigger.current?.focus();
  };
  const pick = item => {
    if (!item) return;
    onChange(item.value);
    close();
  };

  useLayoutEffect(() => {
    if (open) search.current?.focus();
  }, [open]);
  useEffect(() => {
    setActive(a => Math.min(a, Math.max(0, flat.length - 1)));
  }, [flat.length]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);
  useEffect(() => {
    if (!open) return undefined;
    const down = e => {
      if (!pop.current?.contains(e.target) && !trigger.current?.contains(e.target)) close(false);
    };
    const re = () => place();
    window.addEventListener('mousedown', down);
    window.addEventListener('resize', re);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('resize', re);
    };
  }, [open]);
  useLayer(open, () => close());

  const onSearchKey = e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => Math.min(flat.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(0, a - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(flat.length - 1);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      setActive(a => Math.min(flat.length - 1, a + 8));
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      setActive(a => Math.max(0, a - 8));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(flat[active]);
    }
    // The list lives in a portal at the end of the page, so a plain Tab would leave the dialog. Close it
    // and hand focus back to the button; the next Tab then moves on from there, inside the dialog.
    else if (e.key === 'Tab') {
      e.preventDefault();
      close();
    }
  };
  const onTriggerKey = e => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      show();
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      show(e.key);
    }
  };

  let i = -1;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`combo-trigger ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${valueLabel || current?.label || ''}`}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onTriggerKey}
        data-tip={tipText}
      >
        <span className="k">{label}</span>
        <span className="v">{valueLabel || current?.label}</span>
        <Icon name={open ? 'chevronUp' : 'chevron'} size={16} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={pop}
            className="pop"
            style={{ left: pos.left, width: pos.w, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}
          >
            <div className="pop-search">
              <Icon name="search" size={16} />
              <input
                ref={search}
                value={q}
                onChange={e => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKey}
                placeholder={placeholder}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={flat[active] ? `${id}-o-${active}` : undefined}
                aria-label={`${label}: filter`}
              />
            </div>
            <div ref={listRef} className="pop-list" id={listId} role="listbox" aria-label={label}>
              {filtered.length === 0 && <div className="pop-empty">Nothing matches "{q}".</div>}
              {filtered.map((g, gi) => (
                <div key={g.label || gi} role="group" aria-labelledby={g.label ? `${id}-g-${gi}` : undefined}>
                  {g.label && (
                    <div className="pop-group" id={`${id}-g-${gi}`} role="presentation">
                      {g.label}
                    </div>
                  )}
                  {g.items.map(x => {
                    i += 1;
                    const n = i;
                    const sel = x.value === value;
                    return (
                      <div
                        key={String(x.value)}
                        id={`${id}-o-${n}`}
                        data-i={n}
                        role="option"
                        aria-selected={sel}
                        data-active={n === active}
                        className="pop-row"
                        onMouseMove={() => {
                          if (active !== n) setActive(n);
                        }}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => pick(x)}
                      >
                        <span className={`chk ${sel ? '' : 'icon'}`}>
                          {sel ? (
                            <Icon name="check" size={16} sw={2.2} />
                          ) : x.icon ? (
                            <Icon name={x.icon} size={15} />
                          ) : null}
                        </span>
                        <span className="pop-name">
                          <Hi text={x.label} q={q.trim()} />
                        </span>
                        {x.meta && <span className="m">{x.meta}</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="pop-foot">
              <span>{flat.length === all.length ? `${all.length} choices` : `${flat.length} of ${all.length}`}</span>
              <span className="pop-keys">
                <span className="kbd">↑</span>
                <span className="kbd">↓</span> move <span className="kbd">Enter</span> pick{' '}
                <span className="kbd">Esc</span> close
              </span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
