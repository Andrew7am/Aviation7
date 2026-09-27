import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Copy } from 'lucide-react';

/**
 * A screen that fails should say so, not disappear.
 *
 * React unmounts the whole tree when a render throws, and with nothing to
 * catch it the page goes white — no header, no sidebar, no message, no clue
 * which click did it. That is what a user of this app photographed and sent
 * in: a blank tab at the production URL, after clicking a cell.
 *
 * A blank page is the worst of both worlds. Nothing is broken in the data —
 * the ledger is untouched, the click changed nothing — but there is no way
 * to know that from looking, and no way to report it beyond "it went white".
 *
 * So the error is caught, named, and printed with the stack, and the ledger
 * is one reload away. The details are copyable because the person who sees
 * this is not the person who can fix it, and retyping a stack trace out of a
 * screenshot is how the useful half gets lost.
 */

interface Props { children: ReactNode }
interface State { error: Error | null; info: string }

export class ErrorBoundary extends Component<Props, State> {
  /* @types/react is not installed in this project, so React's own members
     are not typed and the compiler cannot see them on a subclass. Declared
     here rather than left as errors; `declare` emits nothing, so React still
     supplies them at run time. */
  declare props: Props;
  declare setState: (s: Partial<State>) => void;

  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept for the console too: the boundary swallows it otherwise, and the
    // browser's own stack is better than the one React hands us.
    console.error('screen crashed', error, info.componentStack);
    this.setState({ info: info.componentStack ?? '' });
  }

  private report() {
    const { error, info } = this.state;
    return [
      error?.message ?? 'unknown error',
      '',
      error?.stack ?? '',
      '',
      info,
      '',
      `page: ${location.pathname}${location.search}`,
      `time: ${new Date().toISOString()}`,
      `browser: ${navigator.userAgent}`,
    ].join('\n');
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-start justify-center bg-slate-50 p-6">
        <div className="max-w-2xl w-full mt-16 bg-white border border-red-200 rounded-xl overflow-hidden">
          <div className="flex items-start gap-3 px-5 py-4 border-b border-red-100 bg-red-50">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h1 className="font-bold text-slate-800">This screen stopped</h1>
              <p className="text-[12px] text-slate-600 mt-1">
                Nothing was saved and nothing was changed — the ledger is exactly as it
                was. Reload to carry on.
              </p>
            </div>
          </div>

          <div className="px-5 py-4 space-y-3">
            <div className="font-mono text-[11px] text-red-700 bg-red-50/60 border border-red-100
                            rounded px-3 py-2 break-words">
              {this.state.error.message || String(this.state.error)}
            </div>

            <details className="text-[11px]">
              <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
                What went wrong, in detail
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto bg-slate-50 border border-slate-200
                              rounded p-3 text-[10px] text-slate-600 whitespace-pre-wrap">
                {this.report()}
              </pre>
            </details>

            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => location.reload()}
                className="flex items-center gap-1.5 bg-slate-800 text-white text-[11px] font-bold
                           px-3 py-1.5 rounded hover:bg-slate-700">
                <RefreshCw className="w-3.5 h-3.5" /> Reload
              </button>
              <button
                onClick={() => { void navigator.clipboard?.writeText(this.report()); }}
                className="flex items-center gap-1.5 bg-white text-slate-600 text-[11px] font-bold
                           px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50">
                <Copy className="w-3.5 h-3.5" /> Copy the details
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
