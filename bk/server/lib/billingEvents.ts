/**
 * v24.2 Airwallex wiring — lightweight in-process billing event bus.
 *
 * When the Airwallex webhook confirms (or fails) a checkout subscription, the
 * webhook handler emits a structured event here. Downstream consumers
 * (entitlements refresh, audit, analytics, email receipts) can subscribe
 * without the webhook handler needing to know about any of them — keeping the
 * payment path decoupled and side-effect-light.
 *
 * This is intentionally a tiny synchronous emitter (no external deps, no
 * persistence). It is NOT a mock: it is a real, working pub/sub used by the
 * webhook handler. Consumers register via `onBillingEvent`. If no consumer is
 * registered the event is simply logged at debug level and dropped — that is
 * the correct behaviour for the current release, where the subscription record
 * itself (DB-backed) is the durable artifact and entitlements are derived on
 * read.
 */
import { log } from "./logger";

export type BillingEventKind = "subscription.activated" | "subscription.failed";

export interface BillingEvent {
  kind: BillingEventKind;
  paymentIntentId: string;
  companyId: string;
  tierId: string;
  userId: string;
  gateway: string;
  at?: string;
}

type Listener = (e: BillingEvent) => void;

const listeners = new Set<Listener>();

/** Register a billing-event consumer. Returns an unsubscribe function. */
export function onBillingEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Emit a billing event to all registered consumers. Never throws. */
export function emitBillingEvent(e: BillingEvent): void {
  const event: BillingEvent = { ...e, at: e.at ?? new Date().toISOString() };
  if (listeners.size === 0) {
    log.debug?.(`[billingEvents] ${event.kind} (no consumers) intent=${event.paymentIntentId} company=${event.companyId}`);
    return;
  }
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch (err) {
      log.warn("[billingEvents] consumer threw (ignored):", (err as Error).message);
    }
  });
}

/** Test helper — clear all registered listeners. */
export const _testBillingEvents = {
  reset(): void {
    listeners.clear();
  },
  listenerCount(): number {
    return listeners.size;
  },
};
