/**
 * Sprint 16 hotfix — coerce any value to an array safely.
 * The deploy proxy can return non-array JSON (`{detail: "Not Found"}`) for
 * unmounted endpoints. `(x.data ?? [])` only guards null/undefined; this
 * also guards against object-shaped error payloads that crash on .map/.length.
 */
export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
