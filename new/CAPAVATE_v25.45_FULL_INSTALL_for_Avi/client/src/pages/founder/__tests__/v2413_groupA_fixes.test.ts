/**
 * v23.4.13 GROUP A regression guards
 *
 * A.1 — B-302: Round name included in create payload
 * A.2 — select-invite-expiry: expiryDays wired into sendInviteMut
 * A.3 — K-201: Card expiry display uses stored value, not hardcoded 12/28
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUND_NEW_SRC = readFileSync(
  resolve(__dirname, "../RoundNew.tsx"),
  "utf8",
);

const ROUND_DETAIL_SRC = readFileSync(
  resolve(__dirname, "../RoundDetail.tsx"),
  "utf8",
);

const BILLING_SRC = readFileSync(
  resolve(__dirname, "../Billing.tsx"),
  "utf8",
);

// ---- A.1 B-302: round name in create payload --------------------------------

describe("v23.4.13 A.1 — B-302: round name in create payload", () => {
  it("has marker comment B-302 fix v23.4.13", () => {
    expect(ROUND_NEW_SRC).toContain("B-302 fix v23.4.13");
  });

  it("payload includes name field from form state", () => {
    // The payload object must include 'name: form.name'
    expect(ROUND_NEW_SRC).toMatch(/name:\s*form\.name/);
  });

  it("form state has a name field (input-round-name wired)", () => {
    expect(ROUND_NEW_SRC).toContain(`data-testid="input-round-name"`);
    // The input must be bound to form.name via update("name", ...)
    expect(ROUND_NEW_SRC).toMatch(/update\("name",/);
  });

  it("payload object appears inside createRoundMut mutationFn", () => {
    // Confirm the payload const is inside the mutation function
    const mutIdx = ROUND_NEW_SRC.indexOf("createRoundMut = useMutation(");
    const payloadIdx = ROUND_NEW_SRC.indexOf("B-302 fix v23.4.13");
    expect(mutIdx).toBeGreaterThan(-1);
    expect(payloadIdx).toBeGreaterThan(mutIdx);
  });
});

// ---- A.2 select-invite-expiry fix -------------------------------------------

describe("v23.4.13 A.2 — select-invite-expiry wired into sendInviteMut", () => {
  it("has marker comment select-invite-expiry fix v23.4.13", () => {
    expect(ROUND_DETAIL_SRC).toContain("select-invite-expiry fix v23.4.13");
  });

  it("inviteExpiry state is declared", () => {
    expect(ROUND_DETAIL_SRC).toMatch(/inviteExpiry.*useState/);
    expect(ROUND_DETAIL_SRC).toContain('"30"');
  });

  it("select-invite-expiry element is wired to inviteExpiry state", () => {
    expect(ROUND_DETAIL_SRC).toContain('value={inviteExpiry}');
    expect(ROUND_DETAIL_SRC).toContain('onChange={e => setInviteExpiry(e.target.value)}');
  });

  it("sendInviteMut includes expiryDays in request body", () => {
    expect(ROUND_DETAIL_SRC).toContain("expiryDaysVal");
    expect(ROUND_DETAIL_SRC).toContain("expiryDays: expiryDaysVal");
  });

  it("select has numeric value options (not bare text)", () => {
    expect(ROUND_DETAIL_SRC).toContain('value="14"');
    expect(ROUND_DETAIL_SRC).toContain('value="30"');
    expect(ROUND_DETAIL_SRC).toContain('value="60"');
    expect(ROUND_DETAIL_SRC).toContain('value="never"');
  });

  it("inviteExpiry is reset in onSuccess handler", () => {
    expect(ROUND_DETAIL_SRC).toContain("setInviteExpiry(\"30\")");
  });
});

// ---- A.3 K-201: card expiry display -----------------------------------------

describe("v23.4.13 A.3 — K-201: card expiry display fix", () => {
  it("has marker comment K-201 fix v23.4.13", () => {
    expect(BILLING_SRC).toContain("K-201 fix v23.4.13");
  });

  it("does NOT contain hardcoded Expires 12/28", () => {
    expect(BILLING_SRC).not.toContain("Expires 12/28");
  });

  it("uses sub.cardExpiry for display", () => {
    expect(BILLING_SRC).toContain("sub.cardExpiry");
  });

  it("Subscription type includes cardExpiry field", () => {
    expect(BILLING_SRC).toMatch(/cardExpiry\??\s*:\s*string\s*\|\s*null/);
  });

  it("changeMut sends cardExpiry in the PATCH body", () => {
    expect(BILLING_SRC).toContain("cardExpiry: expiry");
  });
});
