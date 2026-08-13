#!/usr/bin/env tsx
/**
 * scripts/silent-drop-guard/guard.ts
 *
 * Anti-Silent-Drop Build Guard — CLI entry (v26.7.3, G-1 / G-1b / G-1c).
 *
 * The "presence" analog of the sacred byte-check. It hard-fails the build when
 * PRIMARY FUNCTIONALITY present in the committed baseline has DISAPPEARED and
 * has NOT been explicitly approved for removal via the checked-in allow-list.
 *
 *   DISAPPEARED = baseline − current − allowlist
 *
 * TWO BASELINES, ON PURPOSE
 * -------------------------
 *   scripts/silent-drop-guard/baseline.json           PROTECTED — byte-identical,
 *     sha256 8e8b88569ca95ba8c4262fd6ba59f981985acf2489512a777959c096724a0d68.
 *     Holds the three original classes: routes, clientRoutes, nav. No item in
 *     CONSORTIUM_PARTNER_BUILD_v8.md modifies it, and this tool never writes it.
 *
 *   scripts/silent-drop-guard/baseline.route-targets.json   COMPANION (G-1c) —
 *     holds routeTargets plus the five new occurrence classes (tabs, buttons,
 *     events, copy, panels). It is generated ONLY from the immutable G-0
 *     snapshot (scripts/silent-drop-guard/snapshot.sh), and records that
 *     snapshot's manifest sha256, which is verified before AND after extraction.
 *     CI rejects a missing or manifest-mismatched companion baseline.
 *
 * `--update-baseline` is REMOVED from the approval path (V7 REVIEW B / G-1b):
 * a guard that can bless its own drift is not a guard. The companion baseline
 * is written by `--write-companion`, which refuses to run against anything but
 * a verified read-only G-0 snapshot.
 *
 * Flags:
 *   (none)                     verify the current tree against both baselines
 *   --write-companion          generate baseline.route-targets.json from the
 *                              G-0 snapshot (verifies the manifest twice)
 *   --snapshot <dir>           snapshot location (default <repo>/.g0-snapshot)
 *   --out <file>               companion output path (testing)
 *   --root <dir>               tree to inventory (testing / fixtures)
 *   --baseline <file>          protected baseline path (testing / fixtures)
 *   --companion <file>         companion baseline path (testing / fixtures)
 *   --no-companion             skip companion comparison (bootstrap only)
 *   --json                     machine-readable summary
 *
 * ESM only — no require().
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";
import {
  buildInventory,
  COMPANION_CLASSES,
  type CompanionClass,
  type Inventory,
} from "./extract-inventory.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BASELINE_PATH = path.join(__dirname, "baseline.json");
const COMPANION_PATH = path.join(__dirname, "baseline.route-targets.json");
const ALLOWLIST_PATH = path.join(__dirname, "allowlist.json");
/* WAVE 2B / BLOCKER 3 — the deferral register (see DeferralRegister below). */
const DEFERRALS_PATH = path.join(__dirname, "deferrals.json");
const SNAPSHOT_SH = path.join(__dirname, "snapshot.sh");
const DEFAULT_SNAPSHOT = path.join(REPO_ROOT, ".g0-snapshot");

export interface Baseline {
  generatedAt: string;
  gitHead: string;
  routes: string[];
  clientRoutes: string[];
  nav: string[];
}

export interface CompanionBaseline {
  version: 1;
  generatedAt: string;
  gitHead: string;
  /** Provenance: the G-0 snapshot this was extracted from. */
  source: "g0-snapshot";
  snapshotPath: string;
  snapshotManifestSha256: string;
  /** sha256 of the PROTECTED baseline at generation time — must not change. */
  protectedBaselineSha256: string;
  routeTargets: string[];
  /** WAVE 2B / BLOCKER 2 — reachable render surface per routed page. */
  routedSurfaces?: string[];
  tabs: string[];
  buttons: string[];
  events: string[];
  copy: string[];
  panels: string[];
}

interface AllowlistEntry {
  id: string;
  reason?: string;
  approvedBy?: string;
  date?: string;
}

export interface Allowlist {
  removedRoutes: Array<string | AllowlistEntry>;
  removedClientRoutes: Array<string | AllowlistEntry>;
  removedNav: Array<string | AllowlistEntry>;
  removedRouteTargets?: Array<string | AllowlistEntry>;
  removedRoutedSurfaces?: Array<string | AllowlistEntry>;
  removedTabs?: Array<string | AllowlistEntry>;
  removedButtons?: Array<string | AllowlistEntry>;
  removedEvents?: Array<string | AllowlistEntry>;
  removedCopy?: Array<string | AllowlistEntry>;
  removedPanels?: Array<string | AllowlistEntry>;
  note?: string;
}

const ALLOWLIST_KEY: Record<CompanionClass, keyof Allowlist> = {
  routeTargets: "removedRouteTargets",
  routedSurfaces: "removedRoutedSurfaces",
  tabs: "removedTabs",
  buttons: "removedButtons",
  events: "removedEvents",
  copy: "removedCopy",
  panels: "removedPanels",
};

const CLASS_LABEL: Record<CompanionClass, string> = {
  routeTargets: "route TARGET signatures (page erased behind a live route)",
  routedSurfaces:
    "routed page SURFACE (page emptied while the export name survives)",
  tabs: "tabs",
  buttons: "buttons",
  events: "event handlers",
  copy: "copy strings",
  panels: "panel bodies",
};

/**
 * WAVE 2B / BLOCKER 3 — DEFERRAL REGISTER.
 *
 * An ALLOWLIST entry forgives a removal: "this is intended, stop reporting it".
 * A DEFERRAL does the opposite. It records a removal that is a REAL LOSS,
 * not yet restored, with a named owner and a review date. Deferred ids are
 * still counted and still printed, under their own UNRESOLVED REGRESSION
 * heading — they are simply not confused with a NEW silent drop, which stays
 * a hard failure.
 *
 * Without this split the gate had only two settings, both useless: allowlist
 * the real losses (and lose them), or leave the gate permanently red (and
 * have everyone learn to ignore it). Review B, BLOCKER 3.
 */
export interface DeferralEntry {
  id: string;
  /** Which inventory class the id belongs to. */
  class: "routes" | "clientRoutes" | "nav" | CompanionClass;
  ticket: string;
  reason: string;
  owner: string;
  openedOn?: string;
  reviewBy?: string;
}

export interface DeferralRegister {
  version: 1;
  note?: string;
  deferrals: DeferralEntry[];
}

const EMPTY_DEFERRALS: DeferralRegister = { version: 1, deferrals: [] };

function deferralIds(reg: DeferralRegister | undefined, cls: string): Set<string> {
  const out = new Set<string>();
  for (const d of reg?.deferrals ?? []) if (d.class === cls) out.add(d.id);
  return out;
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

function sha256File(p: string): string {
  // Use the same tool the spec quotes, so the number is comparable by hand.
  return execFileSync("sha256sum", [p], { encoding: "utf-8" }).trim().split(/\s+/)[0];
}

function currentGitHead(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function toIds(entries: Array<string | AllowlistEntry> | undefined): Set<string> {
  const ids = new Set<string>();
  for (const e of entries ?? []) {
    if (typeof e === "string") ids.add(e);
    else if (e && typeof e.id === "string") ids.add(e.id);
  }
  return ids;
}

/** DISAPPEARED = baseline − current − allowlist (order-stable, sorted). */
function computeDisappeared(
  baseline: string[],
  current: string[],
  allowlisted: Set<string>,
): string[] {
  const currentSet = new Set(current);
  return baseline
    .filter((id) => !currentSet.has(id) && !allowlisted.has(id))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** ADDED = current − baseline (informational only). */
function computeAdded(baseline: string[], current: string[]): string[] {
  const baselineSet = new Set(baseline);
  return current
    .filter((id) => !baselineSet.has(id))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function fmt(id: string): string {
  return id.replace(/\t/g, "  |  ");
}

/* ==========================================================================
 * WAVE 11 — child-ORDER records.
 *
 * The occurrence classes are compared as SETS, which is what makes an addition
 * additive. Order, however, is not a set property, so a container emits one
 * extra `childorder=<a|b|c>` record which is compared positionally as a
 * SUBSEQUENCE of the current order:
 *
 *   baseline a|b|c  vs current a|b|x|c   -> PASS (insertion)
 *   baseline a|b|c  vs current a|c       -> FAIL (removal)
 *   baseline a|b|c  vs current a|c|b     -> FAIL (reorder)
 *
 * Comparing those records as plain set members instead would report every
 * insertion as a removal — the exact defect this wave was sent to fix. They are
 * therefore excluded from the set diff and handled here.
 * ======================================================================== */
const ORDER_MARK = "\tchildorder=";

export function isSubsequence(base: readonly string[], cur: readonly string[]): boolean {
  let i = 0;
  for (const c of cur) {
    if (i < base.length && base[i] === c) i++;
  }
  return i === base.length;
}

/** Split a class's records into plain set members and container -> order. */
export function splitOrderRecords(list: readonly string[]): {
  plain: string[];
  order: Map<string, string[]>;
} {
  const plain: string[] = [];
  const order = new Map<string, string[]>();
  for (const s of list) {
    const i = s.indexOf(ORDER_MARK);
    if (i < 0) {
      plain.push(s);
      continue;
    }
    const key = s.slice(0, i);
    const seq = s.slice(i + ORDER_MARK.length);
    order.set(key, seq === "" ? [] : seq.split("|"));
  }
  return { plain, order };
}

/**
 * Containers whose baseline child order is no longer a subsequence of the
 * current one. Containers absent from `cur` are NOT reported here: their child
 * membership records have already disappeared, so the set diff reports them
 * (reporting both would double-count one loss).
 */
export function orderRegressions(
  base: readonly string[],
  cur: readonly string[],
): string[] {
  const b = splitOrderRecords(base);
  const c = splitOrderRecords(cur);
  const out: string[] = [];
  for (const [key, seq] of b.order) {
    const now = c.order.get(key);
    if (now === undefined) continue;
    if (!isSubsequence(seq, now)) out.push(`${key}${ORDER_MARK}${seq.join("|")}`);
  }
  return out.sort();
}


/* ==========================================================================
 * WAVE 11 (second finding) — ORDINAL SURFACE BUCKETS.
 *
 * `routedSurfaces` records end in `surface=sN`, where sN is a BUCKET of the
 * reachable-surface count of the routed component (extract-inventory.ts
 * surfaceBucket: s0=0, s1<4, s2<16, s3<64, s4<256, s5>=256). The class exists to
 * catch a page being EMPTIED while its export name survives.
 *
 * Compared as plain set members, GROWING a page across a bucket boundary reports
 * `surface=s4` as REMOVED — an addition read as a removal. That is the same
 * defect this wave was sent to fix on child sets, one class over: EN-6's billing
 * panels pushed /collective/partner/billing from s4 to s5 and the guard blocked
 * the build for having added functionality.
 *
 * The buckets are ORDERED, so the comparison must be too. Keyed on
 * (routePath, target, module):
 *   • key gone entirely              -> reported by the set diff (route removed)
 *   • bucket DECREASED               -> REGRESSION, reported here (page emptied)
 *   • bucket increased or unchanged  -> fine
 *   • either side `surface=unknown`  -> REGRESSION, reported: an unresolvable
 *     module must never be able to launder an emptied page (the collector's
 *     silent-skip failure Wave 7B found on DA-3).
 * ======================================================================== */
const SURFACE_MARK = "\tsurface=";
const SURFACE_ORDER = ["s0", "s1", "s2", "s3", "s4", "s5"] as const;

export function surfaceRank(bucket: string): number {
  const i = (SURFACE_ORDER as readonly string[]).indexOf(bucket);
  return i; /* -1 for "unknown" or anything unrecognised */
}

/** Split a class's records into plain set members and key -> surface bucket. */
export function splitSurfaceRecords(list: readonly string[]): {
  plain: string[];
  surface: Map<string, string>;
} {
  const plain: string[] = [];
  const surface = new Map<string, string>();
  for (const s of list) {
    const i = s.lastIndexOf(SURFACE_MARK);
    if (i < 0) {
      plain.push(s);
      continue;
    }
    surface.set(s.slice(0, i), s.slice(i + SURFACE_MARK.length));
  }
  return { plain, surface };
}

/**
 * Routed surfaces whose bucket went DOWN (or became unresolvable). A rise is
 * additive and passes. Keys missing from `cur` are left to the set diff so one
 * loss is not counted twice.
 */
export function surfaceRegressions(
  base: readonly string[],
  cur: readonly string[],
): string[] {
  const b = splitSurfaceRecords(base);
  const c = splitSurfaceRecords(cur);
  const out: string[] = [];
  for (const [key, was] of b.surface) {
    const now = c.surface.get(key);
    if (now === undefined) continue; /* the whole route target is gone — set diff owns it */
    if (now === was) continue;
    const rWas = surfaceRank(was);
    const rNow = surfaceRank(now);
    /* An unknown on either side is never treated as "at least as good". */
    if (rWas < 0 || rNow < 0 || rNow < rWas) {
      out.push(`${key}${SURFACE_MARK}${was}`);
    }
  }
  return out.sort();
}

/**
 * Core guard logic. Pure: no fs, no process.exit, so tests can drive it with
 * synthetic baselines. `companion` is optional — when absent only the three
 * protected classes are compared (bootstrap / legacy callers).
 */
export function runGuard(opts: {
  baseline: Baseline;
  current: Inventory;
  allowlist: Allowlist;
  companion?: Pick<CompanionBaseline, CompanionClass>;
  /**
   * WAVE 2B / BLOCKER 2 — which companion classes to compare. Defaults to all
   * of them. The ONLY supported use of a narrower set is the mutation test,
   * which replays the pre-WAVE-2B guard to prove the bypass used to work.
   */
  classes?: readonly CompanionClass[];
  /** WAVE 2B / BLOCKER 3 — known, owned, dated real losses. */
  deferrals?: DeferralRegister;
  /** WAVE 2B / BLOCKER 3 — when true, deferred losses fail the gate too. */
  strict?: boolean;
}): { code: 0 | 1; report: string; dropped: number; deferred?: number } {
  const { baseline, current, allowlist, companion } = opts;
  const activeClasses = opts.classes ?? COMPANION_CLASSES;
  const deferrals = opts.deferrals ?? EMPTY_DEFERRALS;
  const strict = opts.strict === true;

  /* A deferral is a promise to fix, so it must expire. Split every class's
     disappearances into NEW (hard failure) and DEFERRED (reported, tracked).
     `stillDeferred` also lets us detect entries that were fixed and never
     removed from the register. */
  const deferredFound = new Set<string>();
  const deferredByClass: Record<string, string[]> = {};
  const splitDeferred = (cls: string, gone: string[]): string[] => {
    const ids = deferralIds(deferrals, cls);
    if (!ids.size) return gone;
    const fresh: string[] = [];
    for (const id of gone) {
      if (ids.has(id)) {
        (deferredByClass[cls] ??= []).push(id);
        deferredFound.add(`${cls}\u0000${id}`);
      } else {
        fresh.push(id);
      }
    }
    return fresh;
  };
  const lines: string[] = [];

  const disRoutes = computeDisappeared(baseline.routes, current.routes, toIds(allowlist.removedRoutes));
  const disClient = computeDisappeared(
    baseline.clientRoutes,
    current.clientRoutes,
    toIds(allowlist.removedClientRoutes),
  );
  const disNav = computeDisappeared(baseline.nav, current.nav, toIds(allowlist.removedNav));

  const disRoutesNew = splitDeferred("routes", disRoutes);
  const disClientNew = splitDeferred("clientRoutes", disClient);
  const disNavNew = splitDeferred("nav", disNav);

  const addRoutes = computeAdded(baseline.routes, current.routes);
  const addClient = computeAdded(baseline.clientRoutes, current.clientRoutes);
  const addNav = computeAdded(baseline.nav, current.nav);

  const disCompanion: Partial<Record<CompanionClass, string[]>> = {};
  const addCompanion: Partial<Record<CompanionClass, string[]>> = {};
  let companionDropped = 0;
  let companionAdded = 0;
  if (companion) {
    /* WAVE 2B / BLOCKER 2 — a companion baseline generated before the
       `routedSurfaces` class existed would silently disable it (`base ?? []`
       yields zero drops forever). Refuse rather than run half-blind. */
    if (
      activeClasses.includes("routedSurfaces") &&
      !Array.isArray((companion as Record<string, unknown>).routedSurfaces)
    ) {
      return {
        code: 1,
        dropped: 0,
        report:
          "STALE COMPANION BASELINE — build BLOCKED\n" +
          "The companion baseline predates the `routedSurfaces` class (WAVE 2B /\n" +
          "BLOCKER 2) and would leave emptied routed pages undetected.\n" +
          "Regenerate it from the G-0 snapshot: npm run guard:companion",
      };
    }
    for (const cls of activeClasses) {
      const baseRaw = companion[cls] ?? [];
      const curRaw = (current as Record<string, string[] | undefined>)[cls] ?? [];
      /* WAVE 11 — order records are positional and surface records are ordinal;
         neither is a set member. Both are pulled out of the set diff and
         compared by their own rule, so an ADDITION can never read as a removal. */
      const base = splitSurfaceRecords(splitOrderRecords(baseRaw).plain).plain;
      const cur = splitSurfaceRecords(splitOrderRecords(curRaw).plain).plain;
      const allowIds = toIds(allowlist[ALLOWLIST_KEY[cls]] as never);
      const orderGone = orderRegressions(baseRaw, curRaw).filter((id) => !allowIds.has(id));
      const surfaceGone = surfaceRegressions(baseRaw, curRaw).filter((id) => !allowIds.has(id));
      const gone = splitDeferred(
        cls,
        computeDisappeared(base, cur, allowIds).concat(orderGone).concat(surfaceGone),
      );
      const got = computeAdded(base, cur);
      disCompanion[cls] = gone;
      addCompanion[cls] = got;
      companionDropped += gone.length;
      companionAdded += got.length;
    }
  }

  const totalDropped =
    disRoutesNew.length + disClientNew.length + disNavNew.length + companionDropped;
  const totalAdded = addRoutes.length + addClient.length + addNav.length + companionAdded;
  const totalDeferred = Object.values(deferredByClass).reduce((n, a) => n + a.length, 0);

  /* A deferral that no longer corresponds to a live disappearance means the
     loss was RESTORED. Fail, so the register is pruned instead of rotting into
     a list of things nobody checks. */
  const staleDeferrals = (deferrals.deferrals ?? []).filter(
    (d) => !deferredFound.has(`${d.class}\u0000${d.id}`),
  );

  if (totalAdded > 0) {
    lines.push(`INFO: ${totalAdded} new item(s) added since baseline (informational, not a failure):`);
    if (addRoutes.length) {
      lines.push(`  + Server routes (${addRoutes.length}):`);
      for (const r of addRoutes) lines.push(`      ${r}`);
    }
    if (addClient.length) {
      lines.push(`  + Client routes/pages (${addClient.length}):`);
      for (const r of addClient) lines.push(`      ${r}`);
    }
    if (addNav.length) {
      lines.push(`  + Nav entries (${addNav.length}):`);
      for (const r of addNav) lines.push(`      ${fmt(r)}`);
    }
    for (const cls of COMPANION_CLASSES) {
      const got = addCompanion[cls] ?? [];
      if (!got.length) continue;
      lines.push(`  + ${CLASS_LABEL[cls]} (${got.length}):`);
      for (const r of got.slice(0, 25)) lines.push(`      ${fmt(r)}`);
      if (got.length > 25) lines.push(`      … and ${got.length - 25} more`);
    }
  }

  if (totalDropped > 0) {
    lines.push("");
    lines.push("=".repeat(72));
    lines.push("SILENT DROP DETECTED — build BLOCKED");
    lines.push("=".repeat(72));
    lines.push(
      `${totalDropped} primary-functionality item(s) present in the baseline have DISAPPEARED`,
    );
    lines.push("and are NOT in the allow-list. This is a hard failure (rule #8).");
    lines.push("");
    if (disRoutesNew.length) {
      lines.push(`REMOVED server routes (${disRoutesNew.length}):`);
      for (const r of disRoutesNew) lines.push(`   - ${r}`);
      lines.push("");
    }
    if (disClientNew.length) {
      lines.push(`REMOVED client routes/pages (${disClientNew.length}):`);
      for (const r of disClientNew) lines.push(`   - ${r}`);
      lines.push("");
    }
    if (disNavNew.length) {
      lines.push(`REMOVED nav entries (${disNavNew.length}):`);
      for (const r of disNavNew) lines.push(`   - ${fmt(r)}`);
      lines.push("");
    }
    for (const cls of COMPANION_CLASSES) {
      const gone = disCompanion[cls] ?? [];
      if (!gone.length) continue;
      lines.push(`REMOVED ${CLASS_LABEL[cls]} (${gone.length}):`);
      for (const r of gone.slice(0, 50)) lines.push(`   - ${fmt(r)}`);
      if (gone.length > 50) lines.push(`   … and ${gone.length - 50} more`);
      lines.push("");
    }
    lines.push("To resolve, either:");
    lines.push("  1. Restore the missing functionality (preferred), OR");
    lines.push("  2. If the removal is intentional AND Ozan-approved, add each id above to");
    lines.push("     scripts/silent-drop-guard/allowlist.json (with reason/approvedBy/date).");
    lines.push("     There is no --update-baseline escape hatch (G-1b).");
    lines.push("  3. If it is a REAL loss you are not fixing in this wave, it needs an owner");
    lines.push("     decision and an entry in scripts/silent-drop-guard/deferrals.json.");
    return { code: 1, report: lines.join("\n"), dropped: totalDropped, deferred: totalDeferred };
  }

  /* WAVE 2B / BLOCKER 3 — the register must not rot. */
  if (staleDeferrals.length > 0) {
    lines.push("");
    lines.push("=".repeat(72));
    lines.push("STALE DEFERRAL REGISTER — build BLOCKED");
    lines.push("=".repeat(72));
    lines.push(
      `${staleDeferrals.length} entr(y/ies) in scripts/silent-drop-guard/deferrals.json no longer`,
    );
    lines.push("correspond to a live disappearance. Either the loss was RESTORED (good — delete");
    lines.push("the entry) or the id was mistyped (fix it). A register nobody prunes is a");
    lines.push("register nobody reads.");
    lines.push("");
    for (const d of staleDeferrals) lines.push(`   - [${d.ticket}] ${d.class}: ${fmt(d.id)}`);
    return { code: 1, report: lines.join("\n"), dropped: 0, deferred: totalDeferred };
  }

  /* WAVE 2B / BLOCKER 3 — deferred losses: always printed, never silent. */
  if (totalDeferred > 0) {
    const byTicket = new Map<string, DeferralEntry[]>();
    for (const d of deferrals.deferrals) {
      if (!deferredFound.has(`${d.class}\u0000${d.id}`)) continue;
      const arr = byTicket.get(d.ticket) ?? [];
      arr.push(d);
      byTicket.set(d.ticket, arr);
    }
    lines.push("=".repeat(72));
    lines.push(
      `UNRESOLVED REGRESSION — ${totalDeferred} tracked loss(es), ${byTicket.size} ticket(s)`,
    );
    lines.push("=".repeat(72));
    lines.push("These are NOT allowlisted and NOT forgiven. They are real functionality that");
    lines.push("is gone, with a named owner and a review date. They do not block this deploy;");
    lines.push("they DO block `npm run guard -- --strict`.");
    lines.push("");
    for (const [ticket, entries] of byTicket) {
      const head = entries[0];
      lines.push(`[${ticket}] owner=${head.owner} opened=${head.openedOn ?? "-"} review-by=${head.reviewBy ?? "-"}`);
      for (const d of entries) lines.push(`   ! ${d.class}: ${fmt(d.id)}`);
      lines.push(`   ${head.reason}`);
      lines.push("");
    }
    if (strict) {
      lines.push("--strict: tracked losses are failures in this mode. Restore them or remove");
      lines.push("--strict from the invocation.");
      return { code: 1, report: lines.join("\n"), dropped: 0, deferred: totalDeferred };
    }
  }

  const extra = companion
    ? `, ${current.routeTargets?.length ?? 0} route targets, ${current.tabs?.length ?? 0} tabs, ` +
      `${current.buttons?.length ?? 0} buttons, ${current.events?.length ?? 0} events, ` +
      `${current.copy?.length ?? 0} copy, ${current.panels?.length ?? 0} panels`
    : "";
  lines.push(
    `OK: ${current.routes.length} routes, ${current.clientRoutes.length} pages, ` +
      `${current.nav.length} nav${extra} — no silent drops` +
      (totalDeferred > 0 ? ` (${totalDeferred} tracked loss(es) reported above)` : ""),
  );
  return { code: 0, report: lines.join("\n"), dropped: 0, deferred: totalDeferred };
}

// ===========================================================================
// G-1c — companion baseline generation, from the immutable G-0 snapshot only
// ===========================================================================

function snapshotManifestHash(snapshotDir: string): string {
  const p = path.join(snapshotDir, "G0_MANIFEST.sha256.hash");
  if (!fs.existsSync(p)) {
    throw new Error(`G-0 snapshot manifest hash missing at ${p}. Run snapshot.sh create first.`);
  }
  return fs.readFileSync(p, "utf-8").trim();
}

function verifySnapshot(snapshotDir: string, when: string): string {
  try {
    execFileSync("bash", [SNAPSHOT_SH, "verify", snapshotDir], { encoding: "utf-8" });
  } catch (e) {
    throw new Error(`G-0 snapshot verification FAILED (${when}): ${(e as Error).message}`);
  }
  return snapshotManifestHash(snapshotDir);
}

export function writeCompanionBaseline(opts: {
  snapshotDir: string;
  outPath: string;
  protectedBaselinePath: string;
}): CompanionBaseline {
  const { snapshotDir, outPath, protectedBaselinePath } = opts;

  // Verify BEFORE extraction …
  const before = verifySnapshot(snapshotDir, "before extraction");
  const inv = buildInventory(snapshotDir);
  // … and AFTER, so the bytes we read are provably the bytes we attested.
  const after = verifySnapshot(snapshotDir, "after extraction");
  if (before !== after) {
    throw new Error(`G-0 snapshot manifest changed during extraction: ${before} → ${after}`);
  }

  const companion: CompanionBaseline = {
    version: 1,
    generatedAt: new Date().toISOString(),
    gitHead: currentGitHead(),
    source: "g0-snapshot",
    snapshotPath: path.relative(REPO_ROOT, snapshotDir) || snapshotDir,
    snapshotManifestSha256: after,
    protectedBaselineSha256: sha256File(protectedBaselinePath),
    routeTargets: inv.routeTargets,
    routedSurfaces: inv.routedSurfaces,
    tabs: inv.tabs,
    buttons: inv.buttons,
    events: inv.events,
    copy: inv.copy,
    panels: inv.panels,
  };
  fs.writeFileSync(outPath, JSON.stringify(companion, null, 2) + "\n", "utf-8");
  return companion;
}

// ===========================================================================
// CLI
// ===========================================================================

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);

  if (argv.includes("--update-baseline")) {
    console.error(
      "REFUSED: --update-baseline was removed by G-1b. The protected baseline\n" +
        "         scripts/silent-drop-guard/baseline.json is not writable by this tool,\n" +
        "         and the companion baseline is generated only from the G-0 snapshot\n" +
        "         via --write-companion. Approve removals in allowlist.json instead.",
    );
    process.exit(2);
  }

  const baselinePath = argValue(argv, "--baseline") ?? BASELINE_PATH;
  const companionPath = argValue(argv, "--companion") ?? COMPANION_PATH;
  const root = argValue(argv, "--root") ?? REPO_ROOT;

  if (argv.includes("--write-companion")) {
    const snapshotDir = argValue(argv, "--snapshot") ?? DEFAULT_SNAPSHOT;
    const out = argValue(argv, "--out") ?? companionPath;
    const beforeProtected = sha256File(baselinePath);
    const c = writeCompanionBaseline({
      snapshotDir,
      outPath: out,
      protectedBaselinePath: baselinePath,
    });
    const afterProtected = sha256File(baselinePath);
    if (beforeProtected !== afterProtected) {
      console.error("FATAL: the protected baseline changed during companion generation.");
      process.exit(1);
    }
    console.log(
      `companion baseline written: ${out}\n` +
        `  from G-0 snapshot     : ${snapshotDir}\n` +
        `  snapshot manifest     : ${c.snapshotManifestSha256}\n` +
        `  protected baseline    : ${afterProtected} (unchanged)\n` +
        `  routeTargets=${c.routeTargets.length} routedSurfaces=${c.routedSurfaces?.length ?? 0} ` +
        `tabs=${c.tabs.length} buttons=${c.buttons.length} ` +
        `events=${c.events.length} copy=${c.copy.length} panels=${c.panels.length}`,
    );
    process.exit(0);
  }

  if (!fs.existsSync(baselinePath)) {
    console.error(`ERROR: baseline.json missing at ${baselinePath}.`);
    process.exit(1);
  }

  const baseline = readJson<Baseline>(baselinePath);
  const allowlist = fs.existsSync(ALLOWLIST_PATH)
    ? readJson<Allowlist>(ALLOWLIST_PATH)
    : { removedRoutes: [], removedClientRoutes: [], removedNav: [] };

  let companion: CompanionBaseline | undefined;
  if (!argv.includes("--no-companion")) {
    if (!fs.existsSync(companionPath)) {
      console.error(
        `ERROR: companion baseline missing at ${companionPath}.\n` +
          `       The route-TARGET and occurrence inventories have nothing to compare\n` +
          `       against, which is exactly the hole V7 REVIEW B BLOCKER 3 describes.\n` +
          `       Generate it from the G-0 snapshot:\n` +
          `         bash scripts/silent-drop-guard/snapshot.sh create\n` +
          `         npm run guard:companion`,
      );
      process.exit(1);
    }
    companion = readJson<CompanionBaseline>(companionPath);
    if (companion.source !== "g0-snapshot" || !companion.snapshotManifestSha256) {
      console.error("ERROR: companion baseline has no G-0 snapshot provenance. Regenerate it.");
      process.exit(1);
    }
    const protectedNow = sha256File(baselinePath);
    if (companion.protectedBaselineSha256 !== protectedNow) {
      console.error(
        "ERROR: the PROTECTED baseline.json has changed since the companion baseline\n" +
          `       was generated (${companion.protectedBaselineSha256} → ${protectedNow}).\n` +
          "       baseline.json is protected and must not change.",
      );
      process.exit(1);
    }
  }

  /* WAVE 2B / BLOCKER 3 — the deferral register. Absent file = empty register,
     which is the strictest reading (every drop is a new drop). */
  const deferralsPath = argValue(argv, "--deferrals") ?? DEFERRALS_PATH;
  const deferrals = fs.existsSync(deferralsPath)
    ? readJson<DeferralRegister>(deferralsPath)
    : EMPTY_DEFERRALS;

  const current = buildInventory(root);
  const { code, report, deferred } = runGuard({
    baseline,
    current,
    allowlist,
    companion,
    deferrals,
    strict: argv.includes("--strict"),
  });

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ exit: code, report, deferred }, null, 2));
  } else if (code === 0) {
    console.log(report);
  } else {
    console.error(report);
  }
  process.exit(code);
}

const isDirectRun = (() => {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return invoked === __filename;
})();
if (isDirectRun) {
  main();
}
