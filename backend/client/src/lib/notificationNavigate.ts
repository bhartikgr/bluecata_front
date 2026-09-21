/**
 * Notification click → destination, decided by the SHARED classifier.
 *
 * 2026-09-19 · persona notification repair (slide 13a).
 *
 * Both the bell and the inbox pages used `navigate(n.link)` — the stored string,
 * unexamined. That is how a historical `partner.promotion_approved` row whose
 * link is the never-mounted `/partner/pipeline` landed a Consortium Partner on
 * "Page not found", outside their shell. It is also how any unsafe stored value
 * (a scheme, a protocol-relative URL, an encoded traversal) would have been
 * handed straight to the router.
 *
 * Rules:
 *   · `surface` rows → wouter `navigate(href)` with the ALIAS-REPAIRED href.
 *   · `document` rows → NOT the SPA router. The audited data-room contract is a
 *     same-origin API download; it is opened in a new browsing context through a
 *     transient `target=_blank` anchor (no fallback to the current window), so
 *     the browser performs the download and the router never sees an `/api/`
 *     path.
 *   · a `surface` row whose workspace differs from the ACTIVE one is refused
 *     (`wrong_surface`) unless the hosting view is the labelled account-wide
 *     history, where each row names its workspace and the click is the intent.
 *   · `unclassified` rows → no navigation at all. The row is still visible in
 *     the account history; clicking it does nothing (returns "none"). Never
 *     fall back to the raw stored link.
 *
 * Returns what it did so components and tests can assert the decision.
 */
import {
  classifyNotificationDestination,
  type ClassifiedDestination,
  type NotificationSurface,
} from "@shared/notificationDestination";

export type NotificationNavigation =
  | { action: "navigate"; href: string; surface: NotificationSurface; repairedLegacy: boolean; crossWorkspace: boolean }
  | { action: "download"; href: string }
  | { action: "none"; reason: "missing" | "unsafe" | "unknown_path" | "wrong_surface" };

export type NavigationContext = {
  /** The workspace the hosting view is showing (`account` = account-wide view). */
  activeSurface: NotificationSurface;
  /**
   * Only the labelled account-wide view may leave the current workspace: every
   * row there is tagged with its workspace, so the click IS the intent. Ordinary
   * persona views must never navigate to another workspace's page — a row that
   * belongs elsewhere (server filter bypassed, stale cache, forged fixture) is
   * refused with `wrong_surface`.
   */
  allowCrossWorkspace?: boolean;
};

export function planNotificationNavigation(
  row: { link?: unknown; kind?: unknown; destination?: ClassifiedDestination },
  ctx: NavigationContext,
): NotificationNavigation {
  // The server's classification (row.destination) is advisory only: the client
  // ALWAYS re-classifies locally and never trusts an href it has not validated.
  const c: ClassifiedDestination = classifyNotificationDestination(row.link, row.kind);
  if (c.class === "surface") {
    const crossWorkspace = ctx.activeSurface !== "account" && c.surface !== ctx.activeSurface;
    if (crossWorkspace && !ctx.allowCrossWorkspace) return { action: "none", reason: "wrong_surface" };
    return { action: "navigate", href: c.href, surface: c.surface, repairedLegacy: c.repairedLegacy, crossWorkspace };
  }
  if (c.class === "document") return { action: "download", href: c.href };
  return { action: "none", reason: c.reason };
}

export function performNotificationNavigation(
  row: { link?: unknown; kind?: unknown; destination?: ClassifiedDestination },
  ctx: NavigationContext,
  navigate: (href: string) => void,
  openDocument: (href: string) => void = defaultOpenDocument,
): NotificationNavigation {
  const plan = planNotificationNavigation(row, ctx);
  if (plan.action === "navigate") navigate(plan.href);
  else if (plan.action === "download") openDocument(plan.href);
  return plan;
}

/**
 * Same-origin protected download, opened in a NEW browsing context through a
 * transient anchor (`target=_blank`, `rel=noopener noreferrer`). No fallback:
 * `window.open` returns null under `noopener` even when the tab DID open, so a
 * null there is not evidence of a blocker, and `location.assign` would replace
 * the app (losing the shell) or trigger a duplicate download. The current
 * window is never navigated by a document row.
 */
function defaultOpenDocument(href: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.setAttribute("data-notification-document", "true");
  a.style.display = "none";
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
  }
}
