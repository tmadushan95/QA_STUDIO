/**
 * Data-loading hooks shared by every screen.
 *
 * `useResource` loads data, exposes loading and error states, reloads on demand, and ignores answers that arrive
 * after the screen moved on (so a slow response never overwrites a newer one).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api/http.js';

/** What `useResource` returns: the data, how loading went, and ways to refresh it. */
export interface Resource<T> {
  data: T | undefined;
  error: string;
  loading: boolean;
  /** Load again, keeping the current data on screen meanwhile. */
  reload: () => void;
  /** Replace the data locally, for example with the answer of a save. */
  set: (next: T) => void;
}

/** Loads data when the component mounts or `deps` change; a late answer to an old request is ignored. */
export function useResource<T>(load: () => Promise<T>, deps: unknown[] = []): Resource<T> {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    loader.current().then(
      (d) => {
        if (mine !== seq.current) return;
        setData(d);
        setError('');
        setLoading(false);
      },
      (e: unknown) => {
        if (mine !== seq.current) return;
        setError(errorMessage(e));
        setLoading(false);
      },
    );
  }, []);

  // `deps` are the caller's inputs to `load`: reload whenever one changes.
  useEffect(reload, deps);

  return { data, error, loading, reload, set: setData };
}

/** Wait `ms` after the last change of `value` before returning it, for search boxes. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
