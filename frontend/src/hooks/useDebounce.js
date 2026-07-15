import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Debounced mirror of `value` — the classic search-box hook. */
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * A stable debounced callback with `.cancel()` and `.flush()`.
 *
 * The identity never changes across renders, so it is safe in a dependency
 * array and won't re-subscribe effects on every keystroke. The latest `fn` is
 * kept in a ref so the deferred call still closes over fresh props/state
 * instead of the render that happened to schedule it.
 */
export function useDebouncedCallback(fn, delay = 300) {
  const fnRef = useRef(fn);
  const timerRef = useRef(null);
  const argsRef = useRef([]);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const debounced = useMemo(() => {
    const invoke = (...args) => {
      argsRef.current = args;
      clear();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        fnRef.current(...argsRef.current);
      }, delay);
    };

    invoke.cancel = () => clear();

    /** Runs the pending call immediately, if there is one. */
    invoke.flush = () => {
      if (timerRef.current === null) return undefined;
      clear();
      return fnRef.current(...argsRef.current);
    };

    invoke.isPending = () => timerRef.current !== null;

    return invoke;
  }, [delay, clear]);

  // Unmounting mid-debounce must not fire a callback into a dead tree.
  useEffect(() => clear, [clear]);

  return debounced;
}

export default useDebounce;
