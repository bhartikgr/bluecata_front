/**
 * WAVE 83 — partner-surface pins: internal language, the roster refresh, the
 * pre-fired validation, the mandate default and the two input defects.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = __dirname;
const PAGES = join(HERE, "..");
const CLIENT = join(PAGES, "..", "..");
const read = (p: string) => readFileSync(p, "utf8");
/** Comments stripped — see the founder-side test for why. */
const rendered = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");

describe("WAVE 83 · ITEM 1 — internal language is off the partner screens", () => {
  it("W83-I1 — the SPV overview no longer blames 'the engine'", () => {
    const s = rendered(join(CLIENT, "components", "partner", "SpvDetailTabs.tsx"));
    expect(s).not.toContain("not exposed by the engine yet");
    expect(s).not.toContain("NO_MANDATE");
    expect(s).toContain("A revision number and a link to the previous audit entry are not recorded");
    expect(s).toContain("Deployment and eligibility are both refused until a mandate is recorded");
  });

  it("W83-I1 — the audit receipt uses words, not column names", () => {
    for (const f of ["PartnerSpvDetail.tsx", "PartnerFundDetail.tsx"]) {
      const s = read(join(PAGES, f));
      expect(s).not.toContain("revision_hash:");
      expect(s).not.toContain("created_at:");
      expect(s).toContain("Revision fingerprint:");
    }
  });

  it("W83-I1 — the close statement is not described by its endpoint", () => {
    const s = read(join(CLIENT, "components", "partner", "SpvOperationsPanels.tsx"));
    expect(s).not.toContain("GET /close-summary");
    expect(s).toContain("Read live from Capavate's own closing statement");
  });
});

describe("WAVE 83 · ITEM 2.3 — the LP roster refreshes after an invite", () => {
  const s = read(join(PAGES, "PartnerSpvDetail.tsx"));
  /** The INVITE mutation's own onSuccess body — asserted in isolation, so a key
   *  present only in the neighbouring commit mutation cannot make this pass. */
  const inviteOnSuccess = (() => {
    const start = s.indexOf("const inviteMut = useMutation({");
    const end = s.indexOf("const commitMut = useMutation({");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return s.slice(start, end);
  })();
  it("W83-I2.3 — BOTH roster query keys are invalidated AND refetched by the invite itself", () => {
    expect(inviteOnSuccess).toContain('qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "lp-roster"] })');
    expect(inviteOnSuccess).toContain('qc.invalidateQueries({ queryKey: ["/api/spv", spvId, "lp-roster"] })');
    expect(inviteOnSuccess).toContain('qc.refetchQueries({ queryKey: ["/api/partner/me/spv", spvId, "lp-roster"] })');
    expect(inviteOnSuccess).toContain('qc.refetchQueries({ queryKey: ["/api/spv", spvId, "lp-roster"] })');
  });
  it("W83-I2.3 — and the confirmation tells the GP not to send it twice", () => {
    expect(s).toContain("Do not send it again");
  });
});

describe("WAVE 83 · ITEM 2.4 — validation no longer fires before the user acts", () => {
  const s = read(join(PAGES, "PartnerSpvDetail.tsx"));
  it("W83-I2.4 — both last-name messages are gated on touch", () => {
    expect(s).toContain("lpLastNameTouched && !lpLastName.trim()");
    expect(s).toContain("commitLastTouched && !commitLast.trim()");
    // the messages themselves are unchanged
    expect(s).toContain("Last name is required to commit an LP.");
    expect(s).toContain("Last name is required to invite an LP.");
  });
});

describe("WAVE 83 · ITEM 2.5 + ITEM 5 — the SPV wizard", () => {
  const s = read(join(PAGES, "PartnerSpvEngine.tsx"));
  it("W83-I2.5 — the mandate default follows the SPV type, and only the default", () => {
    expect(s).toContain("DEFAULT_MANDATE_FOR_TYPE");
    expect(s).toContain("onSpvTypeChange");
    expect(s).toContain("mandateModeTouched ? prev.mandateMode");
    expect(s).toContain('fund: "open"');
  });
  it("W83-I5.1 — the wizard puts focus on the SPV name field", () => {
    expect(s).toContain("autoFocus ref={spvNameRef}");
    expect(s).toContain("spvNameRef.current?.focus()");
  });
  it("W83-I5.2 — no numeric wizard field is initialised to the string '0'", () => {
    expect(s).toContain('targetRaiseMinor: "", minCheckMinor: "", capMinor: ""');
    expect(s).not.toContain('targetRaiseMinor: "0"');
    expect(s).not.toContain('minCheckMinor: "0"');
    expect(s).not.toContain('capMinor: "0"');
  });
});

describe("WAVE 83 · ITEM 3 — no raw key in a name column", () => {
  it("W83-I3 — the server labels the row, the client will not print a key either", () => {
    const srv = read(join(CLIENT, "..", "..", "server", "captableSnapshotsStore.ts"));
    expect(srv).toContain("function humanHolderLabel");
    expect(srv).toContain('"Redeemed holder"');
    expect(srv).not.toContain('String(s.holderName ?? s.investorId ?? "Holder")');
    const cli = read(join(CLIENT, "components", "founder", "CapTableSnapshots.tsx"));
    expect(cli).toContain("safePersonDisplayName");
    expect(cli).toContain("holderLabel(p.holderName");
  });
});
