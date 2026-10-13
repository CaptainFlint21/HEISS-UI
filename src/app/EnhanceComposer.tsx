import React, { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { RotateCcw, Sparkles, Undo2, X } from 'lucide-react';
import { Tip } from './components';
import { cn } from './format';
import type { EnhancePhase, PromptEnhance } from './usePromptEnhance';

/**
 * Prompt enhance in the composer (usePromptEnhance.ts): the button, the warm
 * aura that runs round the prompt while the model writes, the new words
 * developing in over the old ones, and the small island above the prompt
 * that says what it is doing and, once done, offers Undo and Try again.
 */

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);
export const enhanceShortcut = isMac ? '⌘E' : 'Ctrl+E';

/** The composer button: a spark that glints on hover and turns slowly while it works. Pressing it again stops. */
export function EnhanceButton({ phase, verb, onClick, className }: { phase: EnhancePhase; verb: string; onClick: () => void; className?: string }) {
  const busy = phase === 'queued' || phase === 'loading' || phase === 'writing';
  return (
    <Tip content={busy ? 'Stop (Esc)' : `${verb} (${enhanceShortcut})`}>
      <button
        type="button"
        data-enhance-trigger
        className={cn('negative-toggle is-density-mini enhance-toggle', busy && 'is-busy', className)}
        aria-label={busy ? 'Stop enhancing' : verb}
        aria-busy={busy || undefined}
        onClick={onClick}
      >
        <Sparkles size={14} />
      </button>
    </Tip>
  );
}

/** The new prompt so far, word by word; each word develops in as it arrives. */
function Words({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  return <>{parts.map((part, index) => /^\s+$/.test(part) ? part : <span key={index} className="enhance-word">{part}</span>)}</>;
}

/**
 * Over the prompt while it works: the aura, and in the textarea's own box the
 * person's words shimmering until the model's start to arrive.
 */
export function EnhanceOverlay({ enhance, field, original }: { enhance: PromptEnhance; field: React.RefObject<HTMLTextAreaElement | null>; original: string }) {
  const reduced = useReducedMotion();
  const ghost = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<React.CSSProperties | null>(null);
  const { busy, text, phase } = enhance;

  // The ghost sits exactly on the textarea, with its type, so the words land where they will stay.
  useLayoutEffect(() => {
    const area = field.current;
    if (!busy || !area) return;
    const place = () => {
      const style = getComputedStyle(area);
      setBox({
        top: area.offsetTop, left: area.offsetLeft, width: area.offsetWidth, height: Math.max(area.offsetHeight, 44),
        padding: style.padding, font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, textAlign: style.textAlign as React.CSSProperties['textAlign']
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(area);
    return () => observer.disconnect();
  }, [busy, field]);

  // Newest words in view, as a textarea would scroll.
  useLayoutEffect(() => {
    if (ghost.current) ghost.current.scrollTop = ghost.current.scrollHeight;
  }, [text]);

  return (
    <AnimatePresence>
      {busy ? (
        <motion.div
          key="aura"
          className="enhance-aura"
          data-phase={phase}
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: reduced ? 1 : 1.012, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="enhance-glow"><i /></div>
          <i className="enhance-edge" />
        </motion.div>
      ) : null}
      {busy && box ? (
        <motion.div
          key="ghost"
          ref={ghost}
          className={cn('enhance-ghost', text ? 'is-writing' : 'is-waiting')}
          style={box}
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.2 }}
        >
          {text ? <Words text={text} /> : <span className="enhance-shimmer">{original.trim() || ' '}</span>}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * Above the prompt's top edge: what it is doing while it works, then Undo and
 * Try again once it is done. One island that changes shape between the two.
 */
export function EnhanceIsland({ enhance }: { enhance: PromptEnhance }) {
  const reduced = useReducedMotion();
  const { busy, settled, working } = enhance;
  const spring = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 520, damping: 38, mass: 0.7 };
  return (
    <AnimatePresence>
      {busy || settled ? (
        <motion.div
          key="island"
          layout
          className={cn('enhance-island', busy ? 'is-busy' : 'is-settled')}
          role="status"
          initial={{ opacity: 0, y: 8, scale: 0.96, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 6, scale: 0.97, filter: 'blur(3px)', transition: { duration: 0.18 } }}
          transition={spring}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {busy ? (
              <motion.span key="working" className="enhance-island-working" layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Sparkles size={12} className="enhance-island-spark" />
                <span className="enhance-shimmer">{working}</span>
                <button type="button" className="enhance-island-stop" onClick={enhance.stop} aria-label="Stop enhancing"><X size={12} /></button>
              </motion.span>
            ) : (
              <motion.span key="done" className="enhance-island-done" layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <button type="button" onClick={enhance.undo}><Undo2 size={13} /> Undo</button>
                <button type="button" onClick={enhance.again}><RotateCcw size={13} /> Try again</button>
                <button type="button" className="enhance-island-close" onClick={enhance.dismiss} aria-label="Keep it"><X size={12} /></button>
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
