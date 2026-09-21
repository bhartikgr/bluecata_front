/**
 * Notification destination classifier — SHARED, PURE, ISOMORPHIC.
 *
 * 2026-09-19 · persona notification repair (slide 13a).
 *
 * One function decides, for a stored notification `link`, (a) whether the link
 * is safe to act on at all, (b) which product surface (shell) it belongs to,
 * and (c) the href the client should actually navigate to. The server uses it
 * to scope list / count / read-all / archive per surface; the client uses the
 * SAME module to decide where a bell or inbox click lands. There is therefore
 * exactly one notion of "which workspace does this notice belong to", and the
 * count a persona sees is computed from the same rule as the rows they see.
 *
 * DESIGN RULES (final reconciled spec, §classifier):
 *   · LINK-FIRST. The stored `link` decides. The `kind` string is NOT used to
 *     infer a surface (a `partner.*` kind is not evidence of a partner page —
 *     history holds partner-kind rows whose link is a founder route).
 *   · EXACT LEGACY ALIASES ONLY. `/partner/pipeline` — the historical producer
 *     target that is not mounted — is repaired to `/collective/partner/pipeline`
 *     preserving query and hash. No global `/partner/*` rewrite.
 *   · STRICT REFUSAL. Anything that is not a single-leading-slash, same-origin,
 *     control-character-free, dot-segment-free app path with well-formed
 *     percent escapes is `unclassified` with reason `unsafe`. Schemes, `//`,
 *     backslashes, credentials, `..` and malformed `%` escapes (`%zz`, `%2`)
 *     are all refused; nothing is ever decoded or rewritten to make a link fit. Refused links are still LISTED in the account view (history is
 *     never rewritten) but are never navigated to.
 *   · NARROW DOCUMENT CONTRACT. The ONLY non-shell link that classifies is the
 *     audited data-room grant contract emitted by
 *     server/track1Routes.ts (`/api/public/data-room/files/:id?grant=…`), and
 *     ONLY when the row's `kind` is `dataroom.access_granted` — kind AND exact
 *     path AND a single `grant` parameter must all match. It is classified as
 *     a `document` (a same-origin download, opened outside the SPA router),
 *     never as a surface. No other `/api/` path is ever a destination. The grant token is carried in `href`
 *     only so the download can work; callers MUST NOT log or render it.
 *   · MOUNTED ROUTES ONLY. A path is attributed to a persona shell ONLY when
 *     it matches a route pattern actually mounted in client/src/App.tsx
 *     (generated manifest shared/notificationRouteManifest.ts, parity-tested).
 *     A shell-PREFIXED path that no route mounts (e.g. `/collective/resources/:id`,
 *     `/founder/collective/interest/:id`) falls, in the real app, to the
 *     app-level `NotFoundOrLogin` OUTSIDE every shell — a persona sent there
 *     loses their navigation, which is the slide-13a defect itself. Such paths
 *     are therefore `unclassified` / `unknown_path`, exactly like paths under
 *     no shell at all (`/rounds/:id/updates/:id`, `/posts/:id`).
 *   · UNKNOWN IS RETAINED, NOT GUESSED. `unknown_path` rows appear in the
 *     account-wide history labelled "Workspace not identified", readable, with
 *     no navigation action, and are excluded from every persona-scoped list
 *     and count. History is never rewritten or deleted.
 *   · NO-LINK ROWS. A notification without a link classifies as `missing`
 *     (account-wide only). No producer-backed no-link → surface mapping has been
 *     audited as safe for this build, so none is applied. See BUILD.md.
 *
 * This module must stay free of `window`, `document`, React, Express and any
 * store import so it can be imported by both server tests and client code.
 */

import { CLIENT_ROUTE_PATTERNS } from "./notificationRouteManifest";

export type NotificationSurface =
  | "partner"
  | "collective"
  | "founder"
  | "investor"
  | "admin"
  | "account";

/** Surfaces a scoped query may ask for. `account` = everything the owner holds. */
export const NOTIFICATION_SURFACES: readonly NotificationSurface[] = [
  "partner",
  "collective",
  "founder",
  "investor",
  "admin",
  "account",
] as const;

export function isNotificationSurface(v: unknown): v is NotificationSurface {
  return typeof v === "string" && (NOTIFICATION_SURFACES as readonly string[]).includes(v);
}

export type ClassifiedDestination =
  | {
      class: "surface";
      surface: Exclude<NotificationSurface, "account">;
      /** The href the client should navigate to (already alias-repaired). */
      href: string;
      /** True when an exact legacy alias was rewritten to its canonical route. */
      repairedLegacy: boolean;
    }
  | {
      class: "document";
      /** Same-origin protected download. Open outside the SPA router. */
      href: string;
      /**
       * The audited recipient workspace of the contract's producer
       * (server/track1Routes.ts data-room grant → `investorId`). The row is
       * listed/counted in THAT persona view; navigation stays a download.
       */
      surface: Exclude<NotificationSurface, "account">;
    }
  | {
      class: "unclassified";
      reason: "missing" | "unsafe" | "unknown_path";
    };

/* ─────────────────────────── structural safety ─────────────────────────── */

/** Fixed dummy origin used ONLY to run the WHATWG URL parser over a path. */
const PARSE_ORIGIN = "https://capavate.invalid";

/**
 * A path segment that the URL parser would treat as a dot segment, in any
 * literal / percent-encoded / mixed / mixed-case spelling (`..`, `.%2e`,
 * `%2E.`, `%2e%2e`, `.`, `%2e`). Rejected outright — the classifier never
 * relies on normalization to make such a link safe.
 */
const DOT_SEGMENT_RE = /^(?:\.|%2e)+$/i;

/**
 * Parse a stored link ONCE against the fixed origin and return its normalized
 * `pathname` / `search` / `hash`, or `null` when the value cannot be trusted.
 * Every later decision (alias, document contract, shell prefix, returned href)
 * is made on this normalized value, never on the raw string.
 */
export function parseSafeAppLink(link: unknown): { path: string; search: string; hash: string; href: string } | null {
  if (typeof link !== "string") return null;
  if (link.length === 0 || link.length > 2048) return null;
  if (link[0] !== "/") return null; // relative or scheme-bearing
  if (link[1] === "/") return null; // protocol-relative `//evil`
  if (link.includes("\\")) return null;
  // control characters and whitespace (incl. tab/newline used to smuggle schemes)
  for (let i = 0; i < link.length; i++) {
    const c = link.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return null;
  }
  // malformed percent escapes anywhere (path, query, hash): `%` must be
  // followed by exactly two hex digits. Never decoded or repaired — a grant
  // token or path with a broken escape is refused as written.
  if (/%(?![0-9A-Fa-f]{2})/.test(link)) return null;
  // credentials / authority markers anywhere before the query or hash
  const q = link.indexOf("?");
  const h = link.indexOf("#");
  const pathEnd = Math.min(q < 0 ? link.length : q, h < 0 ? link.length : h);
  const rawPath = link.slice(0, pathEnd);
  if (rawPath.includes("@") || rawPath.includes(":")) return null;
  // dot segments in any spelling; encoded separators; ANY encoded dot
  for (const seg of rawPath.split("/")) {
    if (DOT_SEGMENT_RE.test(seg)) return null;
    const lower = seg.toLowerCase();
    if (lower.includes("%2e") || lower.includes("%2f") || lower.includes("%5c")) return null;
  }
  let u: URL;
  try {
    u = new URL(link, PARSE_ORIGIN);
  } catch {
    return null;
  }
  if (u.origin !== PARSE_ORIGIN) return null;
  if (u.username || u.password) return null;
  // The parser must NOT have changed the path: any normalization (dot-segment
  // collapse, percent-encoding of stray characters, host-relative rewrite)
  // means the raw value and the browser's view of it disagree → refuse.
  if (u.pathname !== rawPath) return null;
  return { path: u.pathname, search: u.search, hash: u.hash, href: `${u.pathname}${u.search}${u.hash}` };
}

/** Refuse anything that could leave the origin or confuse the router. */
export function isSafeAppPath(link: unknown): link is string {
  return parseSafeAppLink(link) !== null;
}

/* ─────────────────────────── registered destinations ─────────────────────── */

/**
 * EXACT legacy aliases → canonical mounted route. Path-only keys (query/hash
 * are preserved from the original link). A single trailing slash is tolerated
 * because the historical producer emitted the bare path; nothing broader.
 */
export const LEGACY_LINK_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "/partner/pipeline": "/collective/partner/pipeline",
});

/**
 * POLICY — MOUNTED-ROUTE CLASSIFICATION (final spec; corrected 2026-09-19).
 * A link is attributed to a shell ONLY when (a) its path is under that shell's
 * prefix AND (b) the path matches a route pattern mounted in client/src/App.tsx
 * (`CLIENT_ROUTE_PATTERNS`, generated from the JSX by the TypeScript AST and
 * parity-tested). The earlier "shell-family" prefix policy was FALSE: the
 * app's `<Switch>` fallback (`NotFoundOrLogin`) renders bare, outside every
 * shell, so an unmounted `/collective/partner/whatever` shows a 404 WITHOUT the
 * partner navigation (parent browser control, unregistered-destination-control.png).
 * Prefix alone is therefore not evidence of a workspace; the shell prefixes
 * below only decide WHICH shell a mounted route belongs to. `/admin/:rest*` is
 * a real mounted catch-all (AdminNotFound inside admin chrome), so every
 * `/admin/…` path is mounted by definition. Order matters: partner before
 * collective.
 */
const SHELL_PREFIXES: ReadonlyArray<{ surface: Exclude<NotificationSurface, "account">; prefix: string }> = [
  { surface: "partner", prefix: "/collective/partner" },
  { surface: "collective", prefix: "/collective" },
  { surface: "founder", prefix: "/founder" },
  { surface: "investor", prefix: "/investor" },
  { surface: "admin", prefix: "/admin" },
];

/** Exact-or-child match on a shell prefix (`/founder` and `/founder/x`, not `/founderx`). */
function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path === `${prefix}/` || path.startsWith(`${prefix}/`);
}

/* ─────────────────────────── mounted route matcher ─────────────────────── */

/**
 * Match a normalized pathname against ONE wouter route pattern from the
 * generated manifest. Grammar supported (everything App.tsx uses):
 *   literal segment  — exact, case-sensitive
 *   `:name`          — exactly one non-empty segment
 *   `:name?`         — zero or one segment
 *   `:name*`         — zero or more remaining segments
 *   `:name+`         — one or more remaining segments
 * A single trailing slash on the path is tolerated (wouter does the same).
 * Nothing is decoded; segments are compared as written.
 */
export function matchRoutePattern(pattern: string, path: string): boolean {
  const norm = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  const ps = pattern.split("/");
  const ss = norm.split("/");
  let i = 0;
  for (; i < ps.length; i++) {
    const seg = ps[i];
    if (seg.startsWith(":")) {
      const mod = seg[seg.length - 1];
      if (mod === "*") return true; // rest, zero or more
      if (mod === "+") return i < ss.length && ss.slice(i).every((x) => x.length > 0);
      if (mod === "?") { if (i < ss.length && ss[i].length === 0) return false; continue; }
      if (i >= ss.length || ss[i].length === 0) return false;
      continue;
    }
    if (i >= ss.length || ss[i] !== seg) return false;
  }
  // optional params may have consumed nothing: allow path shorter only if the
  // remaining pattern segments were all optional (handled above by `continue`)
  return ss.length <= ps.length || ss.slice(ps.length).length === 0;
}

/** True when SOME mounted client route pattern matches the path. */
export function matchesMountedRoute(path: string): boolean {
  return CLIENT_ROUTE_PATTERNS.some((p) => matchRoutePattern(p, path));
}

/**
 * The single audited protected-document contract: same-origin API download
 * emitted by the data-room grant route. Nothing else under `/api/` classifies.
 */
const DATA_ROOM_FILE_RE = /^\/api\/public\/data-room\/files\/[A-Za-z0-9_.-]+$/;
/** The only kind whose producer emits that contract (server/track1Routes.ts). */
export const DATA_ROOM_GRANT_KIND = "dataroom.access_granted";
/** Exactly one query parameter, `grant=<opaque token>`, nothing else; no hash. */
const DATA_ROOM_GRANT_QUERY_RE = /^\?grant=[A-Za-z0-9_.~-]{8,512}$/;

/**
 * Narrow protected-document contract: BOTH the producer kind and the exact
 * same-origin API path + single grant parameter must match. A link that looks
 * like the contract but rides on another kind, or a data-room kind with any
 * other link, does NOT classify as a document. Nothing else under `/api/` is
 * ever a destination.
 */
export function isProtectedDocumentContract(link: string, kind: unknown): boolean {
  if (kind !== DATA_ROOM_GRANT_KIND) return false;
  const parsed = parseSafeAppLink(link);
  if (!parsed) return false;
  return DATA_ROOM_FILE_RE.test(parsed.path) && parsed.hash === "" && DATA_ROOM_GRANT_QUERY_RE.test(parsed.search);
}
/** Audited recipient of the data-room grant producer (server/track1Routes.ts: `userId: investorId`). */
export const DATA_ROOM_GRANT_SURFACE: Exclude<NotificationSurface, "account"> = "investor";

/* ─────────────────────────────── classifier ─────────────────────────────── */

export function classifyNotificationDestination(link: unknown, kind?: unknown): ClassifiedDestination {
  if (link === undefined || link === null || link === "") {
    return { class: "unclassified", reason: "missing" };
  }
  const parsed = parseSafeAppLink(link);
  if (!parsed) {
    return { class: "unclassified", reason: "unsafe" };
  }
  // From here on ONLY the parsed/normalized value is used — never `link`.
  const { path } = parsed;
  const suffix = `${parsed.search}${parsed.hash}`;

  // 1) exact legacy alias (path-only; tolerate one trailing slash)
  const aliasKey = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  const alias = LEGACY_LINK_ALIASES[aliasKey];
  if (alias) {
    const repaired = `${alias}${suffix}`;
    const surface = SHELL_PREFIXES.find((s) => underPrefix(alias, s.prefix))?.surface;
    if (surface && matchesMountedRoute(alias)) return { class: "surface", surface, href: repaired, repairedLegacy: true };
  }

  // 2) protected document contract (kind + exact path + single grant param)
  if (isProtectedDocumentContract(parsed.href, kind)) {
    return { class: "document", href: parsed.href, surface: DATA_ROOM_GRANT_SURFACE };
  }
  // Anything else under /api/ is an API endpoint, never a page: retained, unclassified.
  if (path === "/api" || path.startsWith("/api/")) {
    return { class: "unclassified", reason: "unknown_path" };
  }

  // 3) registered shells — ONLY when a mounted route pattern matches the path
  for (const s of SHELL_PREFIXES) {
    if (underPrefix(path, s.prefix)) {
      if (matchesMountedRoute(path)) {
        return { class: "surface", surface: s.surface, href: parsed.href, repairedLegacy: false };
      }
      // shell-prefixed but unmounted → would render the bare app 404 without
      // this persona's navigation: retained in account history, no action.
      return { class: "unclassified", reason: "unknown_path" };
    }
  }

  // 4) structurally fine, but no shell owns it — retained, never guessed
  return { class: "unclassified", reason: "unknown_path" };
}

/**
 * Does a row with this link belong in a `surface`-scoped view?
 *   · `account`   → every row of the owner (classified or not).
 *   · any shell   → only rows whose destination classifies to that shell.
 * Document rows belong to their audited recipient surface; unclassified rows
 * are account-only.
 */
export function notificationMatchesSurface(
  row: { link?: unknown; kind?: unknown },
  surface: NotificationSurface,
): boolean {
  if (surface === "account") return true;
  const c = classifyNotificationDestination(row.link, row.kind);
  if (c.class === "surface") return c.surface === surface;
  if (c.class === "document") return c.surface === surface;
  return false;
}

/** Human label for the account view when a row has no identified workspace. */
export const WORKSPACE_NOT_IDENTIFIED_LABEL = "Workspace not identified";

/** Human label for the shell of a classified row (account view only). */
export function surfaceLabel(surface: NotificationSurface): string {
  switch (surface) {
    case "partner": return "Consortium Partner";
    case "collective": return "Collective";
    case "founder": return "Founder";
    case "investor": return "Investor";
    case "admin": return "Admin";
    case "account": return "Across your account";
  }
}

/** Route-derived surface for the mounted shell (client helper; pure). */
export function surfaceForPathname(pathname: string): NotificationSurface {
  if (underPrefix(pathname, "/collective/partner")) return "partner";
  if (underPrefix(pathname, "/collective")) return "collective";
  if (underPrefix(pathname, "/founder")) return "founder";
  if (underPrefix(pathname, "/investor")) return "investor";
  if (underPrefix(pathname, "/admin")) return "admin";
  return "account";
}

/** The full inbox route for a surface. */
export function inboxHrefForSurface(surface: NotificationSurface): string {
  switch (surface) {
    case "partner": return "/collective/partner/notifications";
    case "collective": return "/collective/notifications";
    case "founder": return "/founder/notifications";
    case "investor": return "/investor/notifications";
    case "admin": return "/admin/inbox";
    case "account": return "/notifications";
  }
}
