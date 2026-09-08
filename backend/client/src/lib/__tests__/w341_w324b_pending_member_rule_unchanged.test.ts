/**
 * WAVE 341 (productgaps2) · ITEM 11 · W324b —
 * THE "Pending member" RULE IS UNCHANGED. THE OWNER RULED: LEAVE IT.
 * ════════════════════════════════════════════════════════════════════════════
 * This wave builds NOTHING for W324b. This file exists so that the ruling is
 * ASSERTED rather than merely written down, and so a later wave that quietly
 * changes the placeholder trips a red test instead of shipping.
 *
 * It also pins the SECOND half of the ruling, which is easy to break by
 * accident while "cleaning up engineering language": the partner Team screen
 * shows "Name not on file" for an ACTIVE member whose name did not resolve,
 * NOT "Pending member". That is the W-V44 FIX N8 / WAVE 126 FINDING 5 rule —
 * an active member must never be described as pending. Anyone who "fixes" the
 * two strings into one breaks it.
 *
 * Assertions are on RETURNED TEXT, not on variable names.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { safeMemberName } from "../investorLabels";

const REPO = resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(REPO, p), "utf8");

describe("W341 W324b §1 — the client-side placeholder still reads exactly 'Pending member'", () => {
  it("§1a an unresolvable member falls back to the exact words", () => {
    expect(safeMemberName(null, null, "u_redeemed_1783181835779")).toBe("Pending member");
    expect(safeMemberName("", "", null)).toBe("Pending member");
  });

  it("§1b a raw u_… id is never rendered as a name", () => {
    expect(safeMemberName("u_redeemed_1783181835779", null, null)).toBe("Pending member");
    expect(safeMemberName("u_founder_42", "u_founder_42", null)).toBe("Pending member");
  });

  it("§1c CONTROL — a real name and a real email still win, so §1a is not vacuous", () => {
    expect(safeMemberName("Ada Lovelace", "ada@example.com", null)).toBe("Ada Lovelace");
    expect(safeMemberName(null, "ada@example.com", null)).toBe("ada@example.com");
  });
});

describe("W341 W324b §2 — the server placeholders are unchanged", () => {
  const src = read("server/lib/displayNameResolver.ts");

  it("§2a the three humanised fallbacks are exactly as ruled", () => {
    expect(src).toContain('if (/^u_redeemed_/.test(userId)) return "Invited member";');
    expect(src).toContain('if (userId === "u_public") return "Public applicant";');
    expect(src).toContain('return "Pending member";');
  });

  it("§2b CONTROL — the file really is the resolver, not an empty read", () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain("export function resolveDisplayName");
  });
});

describe("W341 W324b §3 — an ACTIVE member is never called pending (W-V44 FIX N8)", () => {
  const team = read("client/src/pages/partner/PartnerTeam.tsx");

  it("§3a the Team screen keeps the two DIFFERENT fallbacks, split on status", () => {
    /* active → "Name not on file"; anything else → "Invitation pending". The
       brief listed "Name not on file" as engineering language to remove. It is
       not: it is the deliberate other half of this ruling. Collapsing the two
       strings into "Pending member" would re-break N8. */
    expect(team).toContain('m.status === "active" ? "Name not on file" : "Invitation pending"');
  });

  it("§3b CONTROL — the file really is the Team page", () => {
    expect(team.length).toBeGreaterThan(1000);
    expect(team).toContain("safePersonDisplayName");
  });
});
