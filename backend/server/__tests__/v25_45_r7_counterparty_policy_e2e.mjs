import { describe, it, expect } from 'vitest';
import { rawDb } from '../db/connection.ts';
import { writeUserPrivacy, resolveDisplayName } from '../lib/userPrivacyResolver.ts';

/**
 * v25.45 ROUND 7 — Capavate counterparty privacy contract (policy-grade).
 *
 * Ozan's locked policy (2026-06-25): if a user has no specific privacy setting
 * (or screen name), the FOUNDERS always see the investor's full name on the cap
 * table, and cap-table CO-MEMBERS (counterparties) see each other by default so
 * they can collaborate to help their portfolio companies. To EVERYONE ELSE the
 * investor is "Private Investor", including in social posting/messaging.
 *
 * Scenario:
 *   - Founder F owns Company Y.
 *   - Investors A and B both invest in Company Y (co-members on Y's cap table).
 *   - Outsider C is NOT on Y's cap table.
 */
describe('v25.45 round 7 — Capavate counterparty privacy contract', () => {
  const stamp = Date.now();
  const db = rawDb();

  const A = `u_r7cp_invA_${stamp}`;
  const B = `u_r7cp_invB_${stamp}`;
  const C = `u_r7cp_outsiderC_${stamp}`;
  const NAME_A = `Investor A Legal ${stamp}`;
  const NAME_B = `Investor B Legal ${stamp}`;

  it('co-investor A views co-investor B on the shared cap table → B legal name (counterparty default)', () => {
    // No privacy row for B → counterparty default reveals legal name.
    const out = resolveDisplayName(B, A, 'externalCapTable', { legalName: NAME_B, isCoMember: true });
    console.log('R7_CP_COMEMBER_EXTERNAL', JSON.stringify({ out }));
    expect(out).toBe(NAME_B);
  });

  it('co-investor A messages co-investor B → B legal name (counterparty default)', () => {
    const out = resolveDisplayName(B, A, 'message', { legalName: NAME_B, isCoMember: true });
    console.log('R7_CP_COMEMBER_MESSAGE', JSON.stringify({ out }));
    expect(out).toBe(NAME_B);
  });

  it('outsider C (not a counterparty) views A on a non-counterparty surface → "Private Investor"', () => {
    // No privacy row for A; isCoMember:false (default) → masked.
    const ext = resolveDisplayName(A, C, 'externalCapTable', { legalName: NAME_A });
    const msg = resolveDisplayName(A, C, 'message', { legalName: NAME_A });
    console.log('R7_CP_OUTSIDER', JSON.stringify({ ext, msg }));
    expect(ext).toBe('Private Investor');
    expect(msg).toBe('Private Investor');
    expect(ext).not.toBe(NAME_A);
  });

  it('founder viewing their OWN cap table → A legal name (hardcoded, never masked)', () => {
    const out = resolveDisplayName(A, `u_r7cp_founder_${stamp}`, 'ownCapTable', { legalName: NAME_A, isOwnCompany: true });
    console.log('R7_CP_OWN', JSON.stringify({ out }));
    expect(out).toBe(NAME_A);
  });

  it('social surfaces require explicit opt-in EVEN for co-members → "Private Investor"', () => {
    // No privacy row, isCoMember:true must NOT make a no-row user appear in
    // the Collective directory / chapter roster / network posts.
    const dir = resolveDisplayName(B, A, 'collectiveDirectory', { legalName: NAME_B, isCoMember: true });
    const roster = resolveDisplayName(B, A, 'chapterRoster', { legalName: NAME_B, isCoMember: true });
    console.log('R7_CP_SOCIAL', JSON.stringify({ dir, roster }));
    expect(dir).toBe('Private Investor');
    expect(roster).toBe('Private Investor');
  });

  it('explicit opt-out (visibleToCoMembers:false) ALWAYS wins, EVEN between co-members', () => {
    // Seed A with an explicit opt-out and no screen name.
    db.prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
    ).run(A, `tenant_${stamp}`, `${A}@probe.test`, NAME_A);
    writeUserPrivacy(A, { screenName: '', visibleToCoMembers: false, visibleInCollectiveDirectory: false });
    // Even though B is a co-member (isCoMember:true), A's explicit opt-out wins.
    const ext = resolveDisplayName(A, B, 'externalCapTable', { legalName: NAME_A, isCoMember: true });
    const msg = resolveDisplayName(A, B, 'message', { legalName: NAME_A, isCoMember: true });
    console.log('R7_CP_OPTOUT_WINS', JSON.stringify({ ext, msg }));
    expect(ext).toBe('Private Investor');
    expect(msg).toBe('Private Investor');
    expect(ext).not.toBe(NAME_A);
  });

  it('explicit opt-out WITH a screen name renders the screen name (not the legal name)', () => {
    const screen = `ScreenA${stamp}`;
    writeUserPrivacy(A, { screenName: screen, visibleToCoMembers: false, visibleInCollectiveDirectory: false });
    const ext = resolveDisplayName(A, B, 'externalCapTable', { legalName: NAME_A, isCoMember: true });
    console.log('R7_CP_OPTOUT_SCREEN', JSON.stringify({ ext }));
    expect(ext).toBe(screen);
    expect(ext).not.toBe(NAME_A);
  });

  it('self-view always returns the legal name regardless of opt-out', () => {
    const out = resolveDisplayName(A, A, 'externalCapTable', { legalName: NAME_A });
    console.log('R7_CP_SELFVIEW', JSON.stringify({ out }));
    expect(out).toBe(NAME_A);
  });

  it('anonymous/blank/non-string viewer fails closed → "Private Investor" (even with isCoMember:true)', () => {
    const noRow = `u_r7cp_norow_${stamp}`;
    // These all normalize to anonymous: null, undefined, empty, whitespace-only,
    // and any non-string runtime value (numbers, booleans, objects). They MUST
    // fail closed regardless of isCoMember.
    for (const viewer of [null, undefined, '', '   ', 0, false, {}]) {
      const out = resolveDisplayName(noRow, viewer, 'externalCapTable', { legalName: 'Should Not Leak', isCoMember: true });
      expect(out).toBe('Private Investor');
      expect(out).not.toBe('Should Not Leak');
    }
  });
});
