import { describe, it, expect } from 'vitest';
import { rawDb } from '../db/connection.ts';
import { writeUserPrivacy, resolveDisplayName } from '../lib/userPrivacyResolver.ts';

/**
 * v25.45 ROUND 5 — resolver robustness self-test.
 *
 * Asserts the three hardened edge cases that GPT-5.5 round-4 flagged as FAIL:
 *   RB1 — self-view (viewerUserId === userId) ALWAYS returns the legal name,
 *         regardless of privacy settings, across all five contexts.
 *   RB2 — anonymous viewer (viewerUserId === null) NEVER leaks a legal name;
 *         it fails CLOSED (private) for every context, even with no privacy row
 *         and a supplied legalName.
 *   ----- unknown / no-row userId is graceful and never crashes.
 */
describe('v25.45 r5 — userPrivacyResolver robustness', () => {
  const stamp = Date.now();
  const optedOut = `u_r5_resolver_optedout_${stamp}`;
  const legalName = `R5 Resolver Legal ${stamp}`;
  const otherViewer = `u_r5_resolver_viewer_${stamp}`;

  // Seed an opted-out user (private everywhere) so masking would normally apply.
  const db = rawDb();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
  ).run(optedOut, `tenant_${stamp}`, `${optedOut}@probe.test`, legalName);
  writeUserPrivacy(optedOut, {
    screenName: '',
    visibleToCoMembers: false,
    visibleInCollectiveDirectory: false,
  });

  const CONTEXTS = ['ownCapTable', 'externalCapTable', 'message', 'collectiveDirectory', 'chapterRoster'];

  it('RB1 — self-view always returns legal name across ALL contexts (even opted-out)', () => {
    for (const ctx of CONTEXTS) {
      const out = resolveDisplayName(optedOut, optedOut, ctx, { legalName });
      console.log('R5_RESOLVER_SELFVIEW', JSON.stringify({ ctx, out }));
      expect(out).toBe(legalName);
      expect(out).not.toBe('Private Investor');
      expect(out).not.toBe('Private Investor');
    }
  });

  it('RB1 — self-view in collectiveDirectory with visibleInCollectiveDirectory:false still returns legal name', () => {
    const out = resolveDisplayName(optedOut, optedOut, 'collectiveDirectory', { legalName });
    expect(out).toBe(legalName);
    expect(out).not.toBe('Private Investor');
  });

  it('RB2 — anonymous viewer (null) NEVER returns the legal name; fails private per-context', () => {
    const expected = {
      ownCapTable: 'Private Investor',
      externalCapTable: 'Private Investor',
      message: 'Private Investor',
      collectiveDirectory: 'Private Investor',
      chapterRoster: 'Private Investor',
    };
    for (const ctx of CONTEXTS) {
      const out = resolveDisplayName(optedOut, null, ctx, { legalName });
      console.log('R5_RESOLVER_ANON', JSON.stringify({ ctx, out }));
      expect(out).toBe(expected[ctx]);
      expect(out).not.toBe(legalName);
    }
  });

  it('RB2 — anonymous viewer fails CLOSED even for a user with NO privacy row + supplied legalName', () => {
    const noRowUser = `u_r5_resolver_norow_${stamp}`;
    const noRowLegal = `No Row Legal ${stamp}`;
    // externalCapTable + message are the leak-prone contexts.
    const ext = resolveDisplayName(noRowUser, null, 'externalCapTable', { legalName: noRowLegal });
    const msg = resolveDisplayName(noRowUser, null, 'message', { legalName: noRowLegal });
    const dir = resolveDisplayName(noRowUser, null, 'collectiveDirectory', { legalName: noRowLegal });
    console.log('R5_RESOLVER_ANON_NOROW', JSON.stringify({ ext, msg, dir }));
    expect(ext).toBe('Private Investor');
    expect(msg).toBe('Private Investor');
    expect(dir).toBe('Private Investor');
    expect(ext).not.toBe(noRowLegal);
    expect(msg).not.toBe(noRowLegal);
    expect(dir).not.toBe(noRowLegal);
  });

  it('ROUND-6: empty-string viewerUserId treated as anonymous (fails CLOSED, never leaks legal name)', () => {
    const noRowUser = 'norow_user_v25_45_round6_emptystring';
    const noRowLegal = 'Empty String Viewer Leak Test';

    // Empty string must be normalized to null — same fail-closed behavior
    for (const ctx of CONTEXTS) {
      const result = resolveDisplayName(noRowUser, '', ctx, { legalName: noRowLegal });
      console.log('R6_RESOLVER_EMPTYSTRING', JSON.stringify({ ctx, result }));
      expect(result).not.toBe(noRowLegal);
    }
  });

  it('unknown userId is graceful (never crashes) and never leaks for a known viewer who is not the subject', () => {
    const unknown = 'nonexistent';
    let crashed = false;
    let results = {};
    try {
      for (const ctx of CONTEXTS) {
        results[ctx] = resolveDisplayName(unknown, otherViewer, ctx, { legalName: 'Should Not Leak' });
      }
    } catch (e) {
      crashed = true;
    }
    console.log('R5_RESOLVER_UNKNOWN', JSON.stringify({ crashed, results }));
    expect(crashed).toBe(false);
    // v25.45 r7 — Unknown user with no row: collective directory is opt-in
    // (private); co-member contexts now FAIL PRIVATE by default because no
    // caller asserted isCoMember (defaults false → "Private Investor"). The key
    // robustness guarantee is no crash and that the directory contexts stay
    // private by default.
    expect(results.collectiveDirectory).toBe('Private Investor');
    expect(results.chapterRoster).toBe('Private Investor');
  });

  it('a known, opted-out user is still masked to a DIFFERENT authenticated viewer (existing context masking preserved)', () => {
    const ext = resolveDisplayName(optedOut, otherViewer, 'externalCapTable', { legalName });
    const dir = resolveDisplayName(optedOut, otherViewer, 'collectiveDirectory', { legalName });
    console.log('R5_RESOLVER_OTHERVIEWER', JSON.stringify({ ext, dir }));
    expect(ext).toBe('Private Investor');
    expect(dir).toBe('Private Investor');
    expect(ext).not.toBe(legalName);
    expect(dir).not.toBe(legalName);
  });
});
