import { useCallback, useEffect, useState } from 'react';

const read = (key, initialValue) => {
  try {
    const item = window.localStorage.getItem(key);
    return item === null ? initialValue : JSON.parse(item);
  } catch {
    // Corrupt JSON or storage disabled — fall back rather than crash the tree.
    return initialValue;
  }
};

/**
 * useState backed by localStorage. Stays in sync across tabs via the `storage`
 * event, so signing out in one tab doesn't leave a stale preference in another.
 *
 * @returns {[any, (value: any) => void, () => void]} [value, setValue, remove]
 */
export function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => read(key, initialValue));

  const setValue = useCallback(
    (value) => {
      setStoredValue((current) => {
        const next = value instanceof Function ? value(current) : value;
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Quota exceeded or private mode: keep the in-memory value working.
        }
        return next;
      });
    },
    [key],
  );

  const remove = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // no-op
    }
    setStoredValue(initialValue);
  }, [key, initialValue]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== key || event.storageArea !== window.localStorage) return;
      setStoredValue(event.newValue === null ? initialValue : JSON.parse(event.newValue));
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // `initialValue` is intentionally not a dep: a new object literal on every
    // render would resubscribe the listener endlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [storedValue, setValue, remove];
}

export default useLocalStorage;
