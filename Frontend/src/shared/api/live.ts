/**
 * Live updates from the server (Server-Sent Events at /api/events). The server says what changed, never the data;
 * screens refetch through the normal API. One connection is shared by the whole page and closed when unused.
 */
import { useEffect, useRef, useState } from 'react';

/** Mirrors the server's event: a run moved on, data was saved, or a background job progressed. */
export type LiveEvent =
  | { type: 'run'; id: string; status: string }
  | { type: 'data'; path: string }
  | { type: 'job'; id: string; status: string };

type Listener = (e: LiveEvent) => void;

const listeners = new Set<Listener>();
const stateListeners = new Set<(up: boolean) => void>();
let source: EventSource | undefined;
let connected = false;

function setConnected(next: boolean) {
  if (connected === next) return;
  connected = next;
  stateListeners.forEach((fn) => fn(next));
}

function open() {
  if (source || typeof EventSource === 'undefined') return;
  const es = new EventSource('/api/events');
  source = es;
  es.onopen = () => setConnected(true);
  // EventSource reconnects by itself; until then screens fall back to polling.
  es.onerror = () => setConnected(false);
  for (const type of ['run', 'data', 'job'] as const) {
    es.addEventListener(type, (m) => {
      try {
        const e = JSON.parse((m as MessageEvent<string>).data) as LiveEvent;
        listeners.forEach((fn) => fn(e));
      } catch {
        /* a malformed event is ignored; the next one catches up */
      }
    });
  }
}

function closeIfIdle() {
  if (listeners.size > 0 || stateListeners.size > 0 || !source) return;
  source.close();
  source = undefined;
  setConnected(false);
}

/**
 * Call `handler` when the server reports a change, at most once per `settleMs` (a run can report many steps a
 * second). Returns whether the live connection is up, so a screen can poll while it is not.
 */
export function useLive(handler: Listener, settleMs = 250): boolean {
  const [up, setUp] = useState(connected);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: LiveEvent | undefined;
    const onEvent: Listener = (e) => {
      last = e;
      timer ??= setTimeout(() => {
        timer = undefined;
        if (last) latest.current(last);
      }, settleMs);
    };
    listeners.add(onEvent);
    stateListeners.add(setUp);
    open();
    return () => {
      clearTimeout(timer);
      listeners.delete(onEvent);
      stateListeners.delete(setUp);
      closeIfIdle();
    };
  }, [settleMs]);
  return up;
}
