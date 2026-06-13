/**
 * Minimal subscribable state container with React hook bindings.
 * Provides a zustand-like API without the dependency.
 */
import { useEffect, useState } from "react";

type SetState<T> = (partial: Partial<T> | ((s: T) => Partial<T>)) => void;
type GetState<T> = () => T;
type Initializer<T> = (set: SetState<T>, get: GetState<T>) => T;

type StoreApi<T> = {
  (): T;
  <U>(selector: (s: T) => U): U;
  getState: () => T;
  setState: SetState<T>;
  subscribe: (fn: (s: T) => void) => () => void;
};

export function create<T>(init: Initializer<T>): StoreApi<T> {
  let state: T;
  const subs = new Set<(s: T) => void>();
  const getState: GetState<T> = () => state;
  const setState: SetState<T> = (partial) => {
    const next = typeof partial === "function" ? (partial as (s: T) => Partial<T>)(state) : partial;
    state = { ...state, ...next };
    subs.forEach((fn) => fn(state));
  };
  state = init(setState, getState);

  const useStore = (<U,>(selector?: (s: T) => U): T | U => {
    const [, force] = useState(0);
    useEffect(() => {
      const fn = () => force((n) => n + 1);
      subs.add(fn);
      return () => { subs.delete(fn); };
    }, []);
    return selector ? selector(state) : (state as unknown as U);
  }) as StoreApi<T>;

  useStore.getState = getState;
  useStore.setState = setState;
  useStore.subscribe = (fn) => { subs.add(fn); return () => { subs.delete(fn); }; };
  return useStore;
}
