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
 * W311 — THE WAVE FLOOR (additive; nothing above is weakened or removed)
 * ---------------------------------------------------------------------
 * The baseline diff above is a ONE-WAY RATCHET against the 2026-08-10 companion
 * snapshot. It answers "has anything that existed on 2026-08-10 gone?" It does
 * NOT answer "has anything gone during THIS wave?", and it never could:
 * `computeDisappeared` iterates the BASELINE, so an id that is in the current
 * tree and not in the baseline cannot enter DISAPPEARED. Deleting it moves it
 * out of `computeAdded`, which is informational only. At the time W311 was
 * built, 2572 of 8970 copy ids (28.7 %) and 5052 of 19319 panel ids (26.2 %)
 * were outside the baseline and therefore outside the gate's field of view.
 *
 * The FIX IS NOT TO RE-CUT THE BASELINE. The companion is a deterministic
 * function of the G-0 snapshot, and `.g0-snapshot/G0_MANIFEST.sha256` is a
 * SACRED manifest entry (ADDED_47). Re-cutting it would break a sacred entry and
 * would erase the evidence of everything already lost. The fix is an ADDITIVE
 * per-wave floor:
 *
 *   --emit-floor <file>   write the current inventory + per-file counts to an
 *                         arbitrary path, AT THE START OF A WAVE. It REFUSES to
 *                         write to either baseline, so it can never be mistaken
 *                         for a re-baseline.
 *   --floor <file>        compare the current tree against that file and FAIL on
 *                         ANY of: an id present in the floor and absent now; a
 *                         per-class count decrease; a per-file count decrease.
 *
 * THE ALLOWLIST AND THE DEFERRALS DO NOT APPLY TO THE FLOOR. They exist to
 * forgive HISTORICAL losses. A loss inside the current wave is not historical.
 * This is stated in the floor mode's own output on every run, not left to be
 * inferred from its absence.
 *
 * WHAT THE FLOOR STILL DOES NOT CATCH — printed by the gate itself, every run:
 * an id added and removed within the same wave (no diff-based instrument can
 * see it); copy that is not a bare JSX text node; a repeated string, because
 * every class is a Set.
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
    // stderr ignored: this tree is not a git repository, and letting git print
    // `fatal: not a git repository` into a SAFETY GATE's output teaches readers
    // to skim past gate output. The catch below already handles the failure.
    return execSync("git rev-parse HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
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
// W311 — THE WAVE FLOOR. Additive. Nothing above this line was weakened.
// ===========================================================================

/** Every class the floor tracks: the three protected ones plus all companion ones. */
export const FLOOR_CLASSES = [
  "routes",
  "clientRoutes",
  "nav",
  ...COMPANION_CLASSES,
] as const;
export type FloorClass = (typeof FLOOR_CLASSES)[number];

export interface WaveFloor {
  version: 1;
  kind: "w311-wave-floor";
  generatedAt: string;
  root: string;
  gitHead: string;
  /** Full id set per class, exactly as the inventory produced it. */
  classes: Record<string, string[]>;
  /** Per-class cardinality. Redundant with `classes` on purpose: it is the
   *  counter a human reads, and W311 exists because a printed counter that
   *  participates in no comparison is worse than no counter. */
  classCounts: Record<string, number>;
  /** file -> class -> count, for the classes whose ids are file-scoped. */
  perFile: Record<string, Record<string, number>>;
  /** Which classes contributed to `perFile`. Recorded so a class that is NOT
   *  per-file-covered can never be silently assumed to be. */
  perFileClasses: string[];
  /** Classes deliberately excluded from perFile, with the reason. */
  perFileExcluded: Record<string, string>;
}

/** True when a class's ids are `<relative file path>\t…`, so per-file counts
 *  are meaningful. Decided from the DATA, not from a hardcoded class list, so a
 *  future class is covered automatically instead of silently skipped. */
function idIsFileScoped(id: string): boolean {
  const head = id.split("\t", 1)[0] ?? "";
  return /\.(tsx|ts|jsx|js|mjs|cjs)$/.test(head) && !head.startsWith("/");
}

export function buildWaveFloor(current: Inventory, root: string): WaveFloor {
  const classes: Record<string, string[]> = {};
  const classCounts: Record<string, number> = {};
  const perFile: Record<string, Record<string, number>> = {};
  const perFileClasses: string[] = [];
  const perFileExcluded: Record<string, string> = {};

  for (const cls of FLOOR_CLASSES) {
    const ids = ((current as unknown as Record<string, string[] | undefined>)[cls] ?? []).slice();
    classes[cls] = ids;
    classCounts[cls] = ids.length;

    /* A class is per-file-covered only if EVERY id in it is file-scoped. A
       partially file-scoped class would give partial per-file floors, and a
       partial floor reads exactly like a complete one. */
    const fileScoped = ids.length > 0 && ids.every(idIsFileScoped);
    if (!fileScoped) {
      perFileExcluded[cls] =
        ids.length === 0
          ? "class is empty in this tree"
          : "ids are not file-scoped (route/nav-keyed); per-CLASS count floor applies instead";
      continue;
    }
    perFileClasses.push(cls);
    for (const id of ids) {
      const file = id.split("\t", 1)[0] as string;
      ((perFile[file] ??= {})[cls] ??= 0);
      perFile[file][cls] += 1;
    }
  }

  return {
    version: 1,
    kind: "w311-wave-floor",
    generatedAt: new Date().toISOString(),
    root,
    gitHead: currentGitHead(),
    classes,
    classCounts,
    perFile,
    perFileClasses,
    perFileExcluded,
  };
}

export interface FloorFailure {
  kind: "id-gone" | "class-count-fell" | "per-file-count-fell" | "file-missing";
  cls?: string;
  file?: string;
  id?: string;
  before?: number;
  after?: number;
}

/**
 * Compare the current tree against a wave floor.
 *
 * THREE INDEPENDENT SIGNATURES, ALL FAILING:
 *   1. an id present in the floor and absent now                  (`id-gone`)
 *   2. a per-CLASS count decrease                                 (`class-count-fell`)
 *   3. a per-FILE count decrease, or a floored file now missing    (`per-file-count-fell` / `file-missing`)
 *
 * (2) is not redundant with (1). (1) is a set diff and every class is a Set, so
 * removing the second of two identical strings in a file changes no id but does
 * change the underlying occurrence count. (3) catches the same thing localised.
 *
 * NO ALLOWLIST. NO DEFERRALS. Deliberately, and said out loud in the report.
 */
export function compareWaveFloor(
  floor: WaveFloor,
  current: Inventory,
): { code: 0 | 1; report: string; failures: FloorFailure[] } {
  const lines: string[] = [];
  const failures: FloorFailure[] = [];

  if (floor.kind !== "w311-wave-floor" || floor.version !== 1) {
    return {
      code: 1,
      failures: [],
      report:
        "WAVE FLOOR: REFUSED — the file given to --floor is not a w311-wave-floor v1 document.\n" +
        `  kind=${JSON.stringify(floor.kind)} version=${JSON.stringify(floor.version)}\n` +
        "  Emit one at the START of the wave:  npm run guard:floor:emit -- <file>",
    };
  }

  /* An empty or classless floor would pass everything. Refuse it rather than
     return a green that means nothing. This is the precondition that stops the
     floor from becoming an inert fence. */
  const flooredClasses = Object.keys(floor.classes ?? {});
  if (flooredClasses.length === 0) {
    return {
      code: 1,
      failures: [],
      report: "WAVE FLOOR: REFUSED — the floor file tracks zero classes. It would pass anything.",
    };
  }
  const totalFlooredIds = Object.values(floor.classes).reduce((n, a) => n + a.length, 0);
  if (totalFlooredIds === 0) {
    return {
      code: 1,
      failures: [],
      report: "WAVE FLOOR: REFUSED — the floor file contains zero ids across all classes. It would pass anything.",
    };
  }

  /* 1 + 2 — per class. */
  for (const cls of flooredClasses) {
    const base = floor.classes[cls] ?? [];
    const cur = ((current as unknown as Record<string, string[] | undefined>)[cls] ?? []);
    const curSet = new Set(cur);
    const gone = base.filter((id) => !curSet.has(id)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const id of gone) failures.push({ kind: "id-gone", cls, id });

    const before = floor.classCounts?.[cls] ?? base.length;
    if (cur.length < before) {
      failures.push({ kind: "class-count-fell", cls, before, after: cur.length });
    }
  }

  /* 3 — per file, only over the classes the floor recorded as file-scoped. */
  const perFileClasses = floor.perFileClasses ?? [];
  const nowPerFile: Record<string, Record<string, number>> = {};
  for (const cls of perFileClasses) {
    for (const id of ((current as unknown as Record<string, string[] | undefined>)[cls] ?? [])) {
      const file = id.split("\t", 1)[0] as string;
      ((nowPerFile[file] ??= {})[cls] ??= 0);
      nowPerFile[file][cls] += 1;
    }
  }
  for (const [file, counters] of Object.entries(floor.perFile ?? {})) {
    const now = nowPerFile[file];
    if (!now) {
      failures.push({ kind: "file-missing", file });
      continue;
    }
    for (const [cls, before] of Object.entries(counters)) {
      const after = now[cls] ?? 0;
      if (after < before) {
        failures.push({ kind: "per-file-count-fell", file, cls, before, after });
      }
    }
  }

  const header = [
    "WAVE FLOOR (W311) — per-wave comparison, additive to the baseline diff.",
    `  floor file generated : ${floor.generatedAt}`,
    `  floor tree root      : ${floor.root}`,
    `  classes floored      : ${flooredClasses.length} (${totalFlooredIds} ids)`,
    `  per-file floors      : ${Object.keys(floor.perFile ?? {}).length} file(s) over ${perFileClasses.length} class(es): ${perFileClasses.join(", ") || "none"}`,
    "  ALLOWLIST AND DEFERRALS ARE DELIBERATELY NOT APPLIED HERE. allowlist.json and",
    "  deferrals.json forgive HISTORICAL losses; a loss inside this wave is not",
    "  historical. An allowlisted id that disappears during the wave FAILS here.",
  ];
  for (const [cls, why] of Object.entries(floor.perFileExcluded ?? {})) {
    header.push(`  no per-file floor for ${cls}: ${why}`);
  }
  lines.push(...header);
  lines.push("");

  if (failures.length === 0) {
    lines.push(
      `WAVE FLOOR OK — 0 id(s) gone, 0 per-class decrease(s), 0 per-file decrease(s), ` +
        `relative to the floor emitted at ${floor.generatedAt}.`,
    );
    lines.push(...floorLimitations());
    return { code: 0, report: lines.join("\n"), failures };
  }

  const byKind = (k: FloorFailure["kind"]) => failures.filter((f) => f.kind === k);
  lines.push("=".repeat(72));
  lines.push(`WAVE FLOOR VIOLATION — ${failures.length} finding(s). BUILD BLOCKED.`);
  lines.push("=".repeat(72));

  const idGone = byKind("id-gone");
  if (idGone.length) {
    lines.push(`  ${idGone.length} id(s) present at the start of this wave and ABSENT NOW:`);
    for (const f of idGone) lines.push(`    GONE  ${f.cls}  ${fmt(f.id ?? "")}`);
  }
  const classFell = byKind("class-count-fell");
  if (classFell.length) {
    lines.push(`  ${classFell.length} per-CLASS count decrease(s):`);
    for (const f of classFell) lines.push(`    CLASS-COUNT-FELL  ${f.cls}: ${f.before} -> ${f.after}`);
  }
  const fileFell = byKind("per-file-count-fell");
  if (fileFell.length) {
    lines.push(`  ${fileFell.length} per-FILE count decrease(s):`);
    for (const f of fileFell) {
      lines.push(`    FILE-COUNT-FELL  ${f.file}  ${f.cls}: ${f.before} -> ${f.after}`);
    }
  }
  const missing = byKind("file-missing");
  if (missing.length) {
    lines.push(`  ${missing.length} file(s) that contributed ids at wave start and contribute none now:`);
    for (const f of missing) lines.push(`    FILE-MISSING  ${f.file}`);
  }
  lines.push("");
  lines.push("These are losses inside THIS wave. Restore them.");
  lines.push("DO NOT add them to allowlist.json — the allowlist is not read by this comparison,");
  lines.push("so adding them there will change nothing and will corrupt the historical record.");
  lines.push("DO NOT re-emit the floor to make this pass; that is the same act as re-baselining.");
  lines.push(...floorLimitations());
  return { code: 1, report: lines.join("\n"), failures };
}

/** W311 item 4 — the limitations, stated as a rule, on every floor run,
 *  in the green branch as well as the red one. */
function floorLimitations(): string[] {
  return [
    "",
    "WHAT THIS FLOOR CANNOT SEE (unchanged by W311, and not closed by it):",
    "  · an id ADDED AND REMOVED within this same wave. Both ends of the diff see",
    "    the same tree. No diff-based instrument can catch it. Only a test that",
    "    reads the rendered page can.",
    "  · copy that is not a bare JSX text node: anything inside {…}, any attribute",
    "    (title/aria-label/placeholder/alt), any toast, any exported constant, any",
    "    template literal. It is not in the `copy` class at all, so its removal",
    "    moves no counter here.",
    "  · a repeated string. Every class is a Set, so a second occurrence of a",
    "    string already present in the same file collapses into the existing id.",
    "    Removing one of two identical strings changes no id — the per-file and",
    "    per-class COUNT checks are what catch that, not the set diff.",
  ];
}

/**
 * W311 item 4 — the truth about the BASELINE diff, computed at run time from the
 * files themselves. Never a hardcoded number, never a bare "0 drops".
 */
export function baselineCoverageNotes(opts: {
  baseline: Baseline;
  companion?: CompanionBaseline;
  current: Inventory;
  floorInUse: boolean;
}): string[] {
  const { baseline, companion, current, floorInUse } = opts;
  const out: string[] = [];
  out.push("");
  out.push("-".repeat(72));
  out.push("WHAT THE ABOVE VERDICT IS RELATIVE TO (W311)");
  out.push("-".repeat(72));
  out.push(
    `  The pass/fail above is a diff against STORED BASELINES, not against the tree\n` +
      `  as it stood when this wave began. The counters printed on the OK line are\n` +
      `  CURRENT-TREE TOTALS and participate in no comparison.`,
  );
  out.push(`  protected baseline  generatedAt: ${baseline.generatedAt ?? "unknown"}`);
  if (companion) {
    out.push(`  companion baseline  generatedAt: ${companion.generatedAt ?? "unknown"}`);
  } else {
    out.push("  companion baseline  : NOT COMPARED (--no-companion)");
  }
  out.push(
    "  This comparison CANNOT DETECT THE REMOVAL OF ANYTHING ADDED SINCE THOSE DATES.",
  );

  /* The coverage gap, per class, computed here and now. */
  const rows: Array<[string, number, number, number]> = [];
  const push = (cls: string, base: string[] | undefined, cur: string[] | undefined) => {
    const b = new Set(base ?? []);
    const c = cur ?? [];
    rows.push([cls, b.size, c.length, c.filter((x) => !b.has(x)).length]);
  };
  push("routes", baseline.routes, current.routes);
  push("clientRoutes", baseline.clientRoutes, current.clientRoutes);
  push("nav", baseline.nav, current.nav);
  if (companion) {
    for (const cls of COMPANION_CLASSES) {
      push(cls, (companion as unknown as Record<string, string[] | undefined>)[cls], (current as unknown as Record<string, string[] | undefined>)[cls]);
    }
  }
  out.push("  MEASURED COVERAGE GAP (computed on this run, not typed in):");
  for (const [cls, bN, cN, gap] of rows) {
    const pct = cN > 0 ? ((100 * gap) / cN).toFixed(1) : "0.0";
    out.push(
      `    ${cls.padEnd(15)} ${String(gap).padStart(6)} of ${String(cN).padStart(6)} current ids ` +
        `(${pct.padStart(5)} %) are OUTSIDE the baseline of ${bN} — their removal WOULD NOT BE DETECTED here.`,
    );
  }
  out.push("  COVERAGE LIMITS OF THE `copy` CLASS, ALWAYS TRUE:");
  out.push("    copy is collected from JSX TEXT NODES ONLY. Copy in expressions, in");
  out.push("    attributes (title/aria-label/placeholder/alt), in toasts, and in exported");
  out.push("    constants is NOT COVERED. Appending such copy moves no counter, truthfully.");
  out.push("    Every class is a SET, so a repeated string does not move a counter either.");
  out.push("  NO DIFF-BASED MODE, INCLUDING THE WAVE FLOOR, CAN SEE A STRING ADDED AND");
  out.push("  REMOVED WITHIN THE SAME WAVE. Only a test that reads the rendered page can.");
  if (!floorInUse) {
    out.push("");
    out.push("  NO WAVE FLOOR WAS SUPPLIED ON THIS RUN. This run therefore says NOTHING about");
    out.push("  what this wave removed. To get that answer, emit a floor BEFORE editing:");
    out.push("      npm run guard:floor:emit -- /tmp/wave-floor.json");
    out.push("  and after editing:");
    out.push("      npm run guard:floor -- /tmp/wave-floor.json");
  }
  return out;
}

/**
 * W311 item 3 — print what is being FORGIVEN. A forgiveness channel nobody can
 * see is indistinguishable from a bug. Reports only entries that were actually
 * SUBTRACTED on this run (i.e. present in the baseline, absent now, allowlisted)
 * as well as the full register size, because those two numbers differing is
 * itself information.
 */
export function forgivenessNotes(opts: {
  baseline: Baseline;
  companion?: CompanionBaseline;
  current: Inventory;
  allowlist: Allowlist;
  deferrals: DeferralRegister;
}): string[] {
  const { baseline, companion, current, allowlist, deferrals } = opts;
  const out: string[] = [];
  const pairs: Array<[string, keyof Allowlist, string[] | undefined, string[] | undefined]> = [
    ["routes", "removedRoutes", baseline.routes, current.routes],
    ["clientRoutes", "removedClientRoutes", baseline.clientRoutes, current.clientRoutes],
    ["nav", "removedNav", baseline.nav, current.nav],
  ];
  if (companion) {
    for (const cls of COMPANION_CLASSES) {
      pairs.push([
        cls,
        ALLOWLIST_KEY[cls],
        (companion as unknown as Record<string, string[] | undefined>)[cls],
        (current as unknown as Record<string, string[] | undefined>)[cls],
      ]);
    }
  }

  let registerTotal = 0;
  let appliedTotal = 0;
  const applied: Array<[string, string]> = [];
  const byClass: Array<[string, number, number]> = [];
  for (const [cls, key, base, cur] of pairs) {
    const ids = toIds(allowlist[key] as never);
    registerTotal += ids.size;
    const curSet = new Set(cur ?? []);
    const hit = (base ?? []).filter((id) => !curSet.has(id) && ids.has(id));
    appliedTotal += hit.length;
    for (const id of hit) applied.push([cls, id]);
    byClass.push([cls, ids.size, hit.length]);
  }

  out.push("");
  out.push("-".repeat(72));
  out.push(
    `FORGIVEN ON THIS RUN (W311) — ${appliedTotal} baseline id(s) were absent from the ` +
      `tree and were SUBTRACTED from DISAPPEARED because allowlist.json forgives them.`,
  );
  out.push("-".repeat(72));
  out.push(`  allowlist.json register size: ${registerTotal} entr(y/ies) across ${byClass.length} class(es)`);
  out.push(`  deferrals.json register size: ${(deferrals.deferrals ?? []).length} entr(y/ies)`);
  for (const [cls, size, hit] of byClass) {
    if (size === 0 && hit === 0) continue;
    out.push(`    ${cls.padEnd(15)} register=${String(size).padStart(4)}  applied-this-run=${String(hit).padStart(4)}`);
  }
  if (applied.length) {
    out.push("  The ids that were forgiven on this run:");
    for (const [cls, id] of applied) out.push(`    FORGIVEN  ${cls}  ${fmt(id)}`);
  } else {
    out.push("  No allowlist entry was applied on this run: every forgiven id is either still");
    out.push("  present in the tree, or is not in the baseline the comparison iterates.");
  }
  out.push("  A register entry that is never applied is dead weight, not safety. Prune it.");
  out.push("  NOTE: the allowlist is NOT read by the wave-floor comparison (--floor).");
  return out;
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

  /* ===================================================================== *
   * W311 — --emit-floor. Writes a per-wave floor to an ARBITRARY path and
   * REFUSES to write to either baseline, so it can never be mistaken for a
   * re-baseline. The companion baseline is a deterministic function of the
   * SACRED G-0 snapshot and is written only by --write-companion.
   * ===================================================================== */
  if (argv.includes("--emit-floor")) {
    const dest = argValue(argv, "--emit-floor");
    if (!dest) {
      console.error("ERROR: --emit-floor requires a file path.");
      process.exit(2);
    }
    const resolved = path.resolve(dest);
    const forbidden: Array<[string, string]> = [
      [path.resolve(BASELINE_PATH), "the PROTECTED baseline"],
      [path.resolve(COMPANION_PATH), "the COMPANION baseline"],
      [path.resolve(baselinePath), "the baseline given by --baseline"],
      [path.resolve(companionPath), "the companion given by --companion"],
    ];
    for (const [p, what] of forbidden) {
      if (resolved === p) {
        console.error(
          `REFUSED: --emit-floor will not write to ${what}.\n` +
            `         ${resolved}\n` +
            "         A wave floor is a PER-WAVE artefact. Writing it over a baseline would\n" +
            "         be a re-baseline, which silently forgives every loss to date. The\n" +
            "         companion baseline is derived from the SACRED G-0 snapshot\n" +
            "         (.g0-snapshot/G0_MANIFEST.sha256) and must never be re-cut.",
        );
        process.exit(2);
      }
    }
    /* Belt and braces: a basename match anywhere is also refused, so a copy of a
       baseline sitting in another directory cannot be overwritten either. */
    const base = path.basename(resolved);
    if (base === "baseline.json" || base === "baseline.route-targets.json") {
      console.error(
        `REFUSED: --emit-floor will not write to a file named '${base}' anywhere.\n` +
          "         Pick a wave-scoped name, e.g. /tmp/w311-floor.json",
      );
      process.exit(2);
    }

    const inv = buildInventory(root);
    const floor = buildWaveFloor(inv, root);
    fs.writeFileSync(resolved, JSON.stringify(floor, null, 1) + "\n", "utf-8");
    const totalIds = Object.values(floor.classCounts).reduce((a, b) => a + b, 0);
    console.log(
      `wave floor written: ${resolved}\n` +
        `  tree root          : ${root}\n` +
        `  generatedAt        : ${floor.generatedAt}\n` +
        `  classes            : ${Object.keys(floor.classes).length} (${totalIds} ids total)\n` +
        `  per-class counts   : ` +
        Object.entries(floor.classCounts).map(([k, v]) => `${k}=${v}`).join(" ") +
        `\n  per-file floors    : ${Object.keys(floor.perFile).length} file(s) over ` +
        `${floor.perFileClasses.length} class(es): ${floor.perFileClasses.join(", ")}\n` +
        `  NOT a baseline. NOT sacred. Compare against it with:\n` +
        `      npm run guard:floor -- ${resolved}`,
    );
    process.exit(0);
  }

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

  /* ===================================================================== *
   * W311 — --floor. ADDITIVE. The baseline diff above ran unchanged, with
   * its allowlist and its deferrals intact, and its verdict is honoured in
   * full. The floor can only ever make the run STRICTER: the final exit code
   * is 1 if EITHER comparison failed.
   * ===================================================================== */
  let floorReport = "";
  let floorCode: 0 | 1 = 0;
  let floorFailures = 0;
  const floorPath = argValue(argv, "--floor");
  /* `--floor` with no value must NOT quietly degrade into a plain baseline run.
     The operator asked the per-wave question; answering the historical one and
     exiting 0 is precisely the false green W311 exists to remove. */
  if (argv.includes("--floor") && !floorPath) {
    console.error(
      "ERROR: --floor requires a file path (the wave floor emitted before the edits).\n" +
        "       Refusing to run: a --floor with no argument must not read as a clean floor.\n" +
        "         npm run guard:floor:emit -- /tmp/wave-floor.json    # before editing\n" +
        "         npm run guard:floor      -- /tmp/wave-floor.json    # after editing",
    );
    process.exit(2);
  }
  if (floorPath) {
    if (!fs.existsSync(floorPath)) {
      console.error(
        `ERROR: --floor given ${floorPath}, which does not exist.\n` +
          "       A wave floor must be emitted BEFORE the wave's edits:\n" +
          "         npm run guard:floor:emit -- <file>\n" +
          "       Refusing to run: a missing floor must not read as a clean floor.",
      );
      process.exit(2);
    }
    let floor: WaveFloor;
    try {
      floor = readJson<WaveFloor>(floorPath);
    } catch (e) {
      console.error(`ERROR: --floor file ${floorPath} is unreadable: ${(e as Error).message}`);
      process.exit(2);
    }
    const r = compareWaveFloor(floor, current);
    floorCode = r.code;
    floorReport = r.report;
    floorFailures = r.failures.length;
  }

  /* W311 items 3 and 4 — the forgiveness register and the truth about what the
     verdict is relative to. Printed on EVERY run of the CLI, in the green branch
     as well as the red one, because a green that overstates its own scope is the
     defect this wave exists to repair. */
  const notes = [
    ...forgivenessNotes({ baseline, companion, current, allowlist, deferrals }),
    ...baselineCoverageNotes({ baseline, companion, current, floorInUse: Boolean(floorPath) }),
  ].join("\n");

  const finalCode: 0 | 1 = code === 1 || floorCode === 1 ? 1 : 0;
  const combined = [report, floorReport, notes].filter((s) => s.length > 0).join("\n");

  if (argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          exit: finalCode,
          baselineDiffExit: code,
          floorExit: floorPath ? floorCode : null,
          floorFailures: floorPath ? floorFailures : null,
          floorPath: floorPath ?? null,
          report: combined,
          deferred,
        },
        null,
        2,
      ),
    );
  } else if (finalCode === 0) {
    console.log(combined);
  } else {
    console.error(combined);
  }
  process.exit(finalCode);
}

const isDirectRun = (() => {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return invoked === __filename;
})();
if (isDirectRun) {
  main();
}
