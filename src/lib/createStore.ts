import { useSyncExternalStore } from 'react';

/**
 * A ~40-line observable store. This app has one source list and one auth status;
 * a state library would be more ceremony than the problem needs.
 */
export type Store<T> = {
  get(): T;
  set(next: T | ((previous: T) => T)): void;
  subscribe(listener: () => void): () => void;
  /** React binding. Safe under concurrent rendering via useSyncExternalStore. */
  use(): T;
  /**
   * Select a slice. The selector MUST return a primitive or a stable reference —
   * useSyncExternalStore compares snapshots with Object.is, so returning a fresh
   * object or array on every call causes an infinite render loop.
   */
  useSelector<S>(selector: (state: T) => S): S;
};

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  const get = () => state;

  const set = (next: T | ((previous: T) => T)) => {
    const value = typeof next === 'function' ? (next as (previous: T) => T)(state) : next;
    if (Object.is(value, state)) return;
    state = value;
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    get,
    set,
    subscribe,
    // Third arg is the server snapshot; expo-router can statically render, so
    // returning the same value keeps hydration consistent.
    use: () => useSyncExternalStore(subscribe, get, get),
    useSelector: <S,>(selector: (state: T) => S) =>
      useSyncExternalStore(
        subscribe,
        () => selector(get()),
        () => selector(get()),
      ),
  };
}
