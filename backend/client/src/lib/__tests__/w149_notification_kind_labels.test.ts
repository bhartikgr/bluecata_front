// @vitest-environment node
/**
 * WAVE 149 · ITEM 4 — THE LABEL MAP MUST NOT FALL BEHIND THE SACRED UNION.
 *
 * `server/notificationsStore.ts` is SACRED (manifest row 9) and is the single source
 * of truth for `NotificationKind`. `client/src/lib/notificationKindLabels.ts` mirrors
 * those keys by hand, because the client cannot import from a server module. A hand
 * mirror rots silently: a future wave appends a 39th kind, the map does not grow, and
 * a member reads the generic fallback where a specific label was owed.
 *
 * This test reads the SACRED file at test time (read only — never written, never
 * edited) and fails if the mirror is incomplete. That turns a silent regression into
 * a build failure, which is the only reason a hand mirror is acceptable at all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  NOTIFICATION_KIND_LABELS,
  NOTIFICATION_KIND_FALLBACK_LABEL,
  notificationKindLabel,
} from "../notificationKindLabels";

/** Parse `ALL_NOTIFICATION_KINDS` out of the sacred store. */
function sacredKinds(): string[] {
  const src = readFileSync(resolve(process.cwd(), "server/notificationsStore.ts"), "utf8");
  const m = /export const ALL_NOTIFICATION_KINDS: NotificationKind\[\] = \[([\s\S]*?)\n\];/.exec(src);
  if (!m) throw new Error("ALL_NOTIFICATION_KINDS not found — the parse, not the map, is stale");
  /* Strip comments first: the array carries a multi-line WAVE 136 note whose prose
     contains quoted words, and counting those as kinds would inflate the list.
     This is the standing comment-stripping rule, applied before any conclusion. */
  const body = m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [...body.matchAll(/"([^"]+)"/g)].map(x => x[1]);
}

describe("W149 · every canonical notification kind has a written human label", () => {
  it("the sacred union parses to a non-trivial list (anti-vacuity)", () => {
    const kinds = sacredKinds();
    expect(kinds.length).toBeGreaterThanOrEqual(38);
    expect(kinds).toContain("round.invitation_received");
    expect(kinds).toContain("dataroom.access_revoked");
    /* No duplicates — `kind` is persisted and order is significant. */
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("no canonical kind falls through to the generic fallback", () => {
    const missing = sacredKinds().filter(k => !(k in NOTIFICATION_KIND_LABELS));
    expect(missing, `these kinds have no written label: ${missing.join(", ")}`).toEqual([]);
  });

  it("the map defines no kind the server does not emit (no invented vocabulary)", () => {
    const canonical = new Set(sacredKinds());
    const extra = Object.keys(NOTIFICATION_KIND_LABELS).filter(k => !canonical.has(k));
    expect(extra, `these labels name kinds that do not exist: ${extra.join(", ")}`).toEqual([]);
  });

  it("no label is empty, a dash, or the machine key itself", () => {
    for (const [key, label] of Object.entries(NOTIFICATION_KIND_LABELS)) {
      expect(label.trim().length, key).toBeGreaterThan(0);
      expect(label).not.toBe(key);
      expect(label).not.toContain(".");
      expect(label).not.toContain("_");
      expect(label.trim()).not.toBe("—");
      expect(label.trim()).not.toBe("-");
      /* Sentence case, no trailing punctuation — this is chrome, not prose. */
      expect(label[0]).toBe(label[0].toUpperCase());
      expect(label.endsWith(".")).toBe(false);
    }
  });

  it("the resolver never returns a raw key, an empty string or a dash", () => {
    for (const bad of ["", "   ", "not.a.real.kind", "WEIRD_CODE", "a.b.c.d.e"]) {
      const out = notificationKindLabel(bad);
      expect(out).toBe(NOTIFICATION_KIND_FALLBACK_LABEL);
      expect(out).not.toContain(bad.trim() || "\u0000");
    }
    expect(notificationKindLabel(null)).toBe(NOTIFICATION_KIND_FALLBACK_LABEL);
    expect(notificationKindLabel(undefined)).toBe(NOTIFICATION_KIND_FALLBACK_LABEL);
    /* And the fallback is a human phrase, not "Unknown" and not R111 Q13's
       "Not on record" — the value is present, it is simply unnamed here. */
    expect(NOTIFICATION_KIND_FALLBACK_LABEL).toBe("Platform update");
  });

  it("a known kind resolves to its written label, not to the fallback", () => {
    expect(notificationKindLabel("partner.attribution_revoked")).toBe("Attribution withdrawn");
    expect(notificationKindLabel("soft_circle.lapsed")).toBe("Soft commitment lapsed");
    expect(notificationKindLabel("dsc.company_assigned")).toBe("Company assigned for screening");
  });
});
