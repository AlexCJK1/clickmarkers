// Voice in the browser: a mic that types into a box (the browser's own speech recognition, Chrome and
// Edge, online, no key; the office never receives audio) and a speaker that reads a reply aloud with
// the browser's voices. Both are optional: where the browser lacks them the buttons say so and stay off.
import React, { useEffect, useRef, useState } from 'react';
import { Icon, Tip } from '../components/ui.jsx';

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const canListen = !!Recognition;
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

// one live mic at a time, so the M shortcut and a button never fight
let active = null;
const listeners = new Set();
const announce = () => {
  for (const fn of listeners) fn(active);
};

/** Start listening; onText(text, final) gets the words so far. Returns a stop function. */
export function listen(onText, onEnd, onError) {
  if (!Recognition) {
    onError?.('This browser has no speech recognition (use Chrome or Edge).');
    return () => {};
  }
  if (active) active.stop();
  const rec = new Recognition();
  rec.lang = navigator.language || 'en-GB';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let text = '';
  rec.onresult = e => {
    let s = '';
    for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
    text = s;
    onText(s.trim(), e.results[e.results.length - 1].isFinal);
  };
  rec.onerror = e =>
    onError?.(
      e.error === 'not-allowed'
        ? 'The microphone is blocked for this page: allow it in the address bar.'
        : e.error === 'no-speech'
          ? 'Heard nothing. Try again.'
          : `Mic error: ${e.error}`,
    );
  rec.onend = () => {
    if (active === rec) {
      active = null;
      announce();
    }
    onEnd?.(text.trim());
  };
  try {
    rec.start();
    active = rec;
    announce();
  } catch (e) {
    onError?.(String(e.message || e));
  }
  return () => {
    try {
      rec.stop();
    } catch {
      // the recogniser had already stopped
    }
  };
}

/**
 * A mic button for a text box. base is the text already in the box: speech is appended to it.
 * Exposes start() through ref so a keyboard shortcut can press it.
 */
export const MicButton = React.forwardRef(function MicButton(
  { value = '', onChange, onDone, className = '', large = false },
  ref,
) {
  const [on, setOn] = useState(false);
  const [err, setErr] = useState('');
  const stop = useRef(null);
  const base = useRef('');
  useEffect(() => {
    const fn = a => {
      if (!a) setOn(false);
    };
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  const toggle = () => {
    if (on) {
      stop.current?.();
      return;
    }
    setErr('');
    base.current = value ? value.replace(/\s*$/, ' ') : '';
    stop.current = listen(
      t => onChange(base.current + t),
      t => {
        setOn(false);
        if (t) onDone?.(base.current + t);
      },
      e => {
        setErr(e);
        setOn(false);
      },
    );
    setOn(true);
  };
  React.useImperativeHandle(ref, () => ({ toggle }), [on, value]);
  const tip = !canListen
    ? 'Voice needs Chrome or Edge'
    : err || (on ? 'Listening: click or pause to stop' : 'Speak instead of typing (M)');
  return (
    <Tip text={tip}>
      <button
        type="button"
        onClick={toggle}
        disabled={!canListen}
        aria-pressed={on}
        aria-label={on ? 'Stop listening' : 'Speak instead of typing'}
        className={`btn btn-secondary btn-icon ${large ? 'btn-lg' : ''} mic ${on ? 'on' : ''} ${err ? 'err' : ''} ${className}`}
      >
        <Icon name={on ? 'micOn' : 'mic'} size={large ? 17 : 15} />
      </button>
    </Tip>
  );
});

/** Plain words for reading aloud: no markdown, no paths, links said as "link". */
export function speakable(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[A-Za-z]:\\[^\s]+|\/[\w./-]{12,}/g, 'a file')
    .replace(/[#*_>`|~]+/g, ' ')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 4000);
}
let speaking = null;
export function SpeakButton({ text, className = '' }) {
  const [on, setOn] = useState(false);
  useEffect(
    () => () => {
      if (speaking === setOn) {
        speechSynthesis.cancel();
        speaking = null;
      }
    },
    [],
  );
  if (!canSpeak) return null;
  const toggle = e => {
    e.stopPropagation();
    if (on) {
      speechSynthesis.cancel();
      setOn(false);
      return;
    }
    speechSynthesis.cancel();
    if (speaking) speaking(false);
    const u = new SpeechSynthesisUtterance(speakable(text));
    const lang = navigator.language || 'en-GB';
    u.lang = lang;
    const voices = speechSynthesis
      .getVoices()
      .filter(v => v.lang?.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
    u.voice =
      voices.find(v => /natural|neural|google uk|online/i.test(v.name) && v.lang === lang) ||
      voices.find(v => v.lang === lang) ||
      voices[0] ||
      null;
    u.onend = u.onerror = () => {
      setOn(false);
      if (speaking === setOn) speaking = null;
    };
    speaking = setOn;
    setOn(true);
    speechSynthesis.speak(u);
  };
  return (
    <Tip text={on ? 'Stop reading' : 'Read aloud'}>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        aria-label={on ? 'Stop reading' : 'Read aloud'}
        className={`btn btn-ghost btn-icon btn-sm speak ${on ? 'on' : ''} ${className}`}
      >
        <Icon name={on ? 'speakerOn' : 'speaker'} size={14} />
      </button>
    </Tip>
  );
}
