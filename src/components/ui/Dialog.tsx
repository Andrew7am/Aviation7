import React, { useEffect, useRef } from 'react';

/**
 * The frame every modal sits in.
 *
 * Each dialog used to draw its own backdrop, and on a phone each one was a
 * desktop box shrunk to fit: a card floating mid-screen with a sliver of page
 * round it, its close button a 16px cross, and no way to dismiss it from the
 * keyboard. Here it is one thing everywhere:
 *
 *  - on a phone a sheet that rises from the bottom edge, full width, its top
 *    corners rounded, capped at the visible height (dvh, so the browser's own
 *    bars never cover its last row);
 *  - from sm up the centred card it always was;
 *  - Escape closes it, a tap on the backdrop closes it, focus moves into it
 *    when it opens and back to whatever opened it when it closes;
 *  - it says what it is to a screen reader (role="dialog", aria-modal).
 *
 * The panel's own look - width, padding, scrolling - stays with each dialog,
 * passed in as `className`, so nothing inside any of them moves.
 */
export const Dialog: React.FC<{
  onClose: () => void;
  /** What the dialog is, for a screen reader. */
  label: string;
  /** The panel's classes: its max width, overflow, flex layout. */
  className?: string;
  children: React.ReactNode;
}> = ({ onClose, label, className = '', children }) => {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close.current(); } };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 sm:p-4
                    motion-safe:animate-[fade-in_150ms_ease-out]"
         onClick={onClose}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className={`bg-white w-full rounded-t-2xl sm:rounded-xl shadow-2xl max-h-[92dvh] sm:max-h-[90vh]
                    outline-none pb-[env(safe-area-inset-bottom)] sm:pb-0
                    motion-safe:animate-[sheet-in_200ms_cubic-bezier(0.2,0.8,0.2,1)] ${className}`}>
        {children}
      </div>
    </div>
  );
};

/** The close button a dialog's header carries: a finger-sized target with a name. */
export const DialogClose: React.FC<{ onClick: () => void; className?: string }> = ({ onClick, className = '' }) => (
  <button type="button" onClick={onClick} aria-label="Close"
    className={`-mr-2 p-2 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100
                focus-visible:outline-2 focus-visible:outline-blue-500 ${className}`}>
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  </button>
);

export default Dialog;
