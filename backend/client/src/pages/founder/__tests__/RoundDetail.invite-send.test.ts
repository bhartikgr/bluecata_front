/**
 * v23.4.12 B-303 regression guard — RoundDetail invite-send mutation wiring.
 *
 * Bug B-303: on /founder/rounds/{id}, clicking "Send invitation"
 * (data-testid="button-send-invite") closed the modal silently — no POST to
 * /api/rounds/{id}/invitations was made. The sendInviteMut useMutation was
 * declared but its .mutate() call was never wired to the button's onClick.
 * Instead, the onClick fired only a local emit() + toast() + setInviteOpen(false).
 *
 * Fix (v23.4.12): replaced the dead inline onClick with
 * `onClick={() => sendInviteMut.mutate()}` and `disabled={sendInviteMut.isPending}`.
 *
 * These source-level assertions follow the repo convention (mirroring v23.4.11
 * Phase 1) and are strong regression guards: if anyone re-introduces a
 * disconnected onClick the tests fail loudly. Marker string for acceptance
 * grep: `button-send-invite-mutation-v23412`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "../RoundDetail.tsx"),
  "utf8",
);

describe("v23.4.12 B-303 — button-send-invite mutation wiring", () => {
  it("declares sendInviteMut via useMutation pointing at /api/rounds/{id}/invitations", () => {
    // The mutation must exist and target the correct endpoint
    expect(SRC).toContain("sendInviteMut = useMutation(");
    expect(SRC).toContain("/api/rounds/${id}/invitations");
    expect(SRC).toMatch(/apiRequest\(\s*"POST",\s*`\/api\/rounds\/\$\{id\}\/invitations`/);
  });

  it("button-send-invite onClick calls sendInviteMut.mutate()", () => {
    // The fixed button must call mutate(), not a stale local handler
    expect(SRC).toMatch(/onClick=\{\(\)\s*=>\s*sendInviteMut\.mutate\(\)/);
  });

  it("button-send-invite is disabled while mutation is pending", () => {
    // The button must reflect inflight state to prevent double-submit
    expect(SRC).toMatch(/disabled=\{sendInviteMut\.isPending\}/);
  });

  it("button-send-invite does NOT fire a local emit-only handler without mutate", () => {
    // The old broken pattern: onClick fired emit() + toast() but never mutate().
    // Verify the dead pattern is gone — the button's onClick section should not
    // contain the fake invitation.created emit without being paired to mutate().
    // We check that "invitation.created" only appears in the mutation's onSuccess
    // (via emitMutationLocal) — not in a standalone onClick.
    //
    // Strategy: find the button-send-invite testid and look at surrounding context.
    // The testid must appear near `sendInviteMut.mutate()`, not near `emit({`.
    const testidIdx = SRC.indexOf('data-testid="button-send-invite"');
    expect(testidIdx).toBeGreaterThan(-1);

    // 200 chars before the testid — must contain mutate(), not an inline emit({
    const beforeTestid = SRC.slice(Math.max(0, testidIdx - 200), testidIdx);
    expect(beforeTestid).toContain("sendInviteMut.mutate()");
    expect(beforeTestid).not.toMatch(/emit\(\{[^}]*invitation\.created/);
  });

  it("sendInviteMut.onSuccess resets modal state and invalidates invitations cache", () => {
    // Ensure post-success cleanup is intact
    expect(SRC).toContain("setInviteOpen(false)");
    expect(SRC).toContain('setInviteName("")');
    expect(SRC).toContain('setInviteEmail("")');
    expect(SRC).toContain("/invitations");
    expect(SRC).toContain("queryClient.invalidateQueries");
  });

  it("contains the v23.4.12 marker string", () => {
    // Acceptance grep marker required by the objective
    expect(SRC).toContain("button-send-invite-mutation-v23412");
  });

  it("mutation payload includes investorName, investorEmail, and note", () => {
    // Ensure all form fields are forwarded to the API
    expect(SRC).toContain("investorName: inviteName");
    expect(SRC).toContain("investorEmail: inviteEmail");
    expect(SRC).toContain("note: inviteNote");
  });
});
