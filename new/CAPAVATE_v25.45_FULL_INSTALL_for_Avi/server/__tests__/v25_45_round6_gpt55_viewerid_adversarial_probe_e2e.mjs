import { describe, it, expect } from 'vitest';
import { resolveDisplayName } from '../lib/userPrivacyResolver.ts';

/**
 * v25.45 round 7 — Capavate counterparty privacy contract.
 *
 * (This file keeps the round-6 path so the regression history is intact, but it
 * now encodes the FINAL round-7 policy locked by Ozan on 2026-06-25.)
 *
 * Contract for a user with NO privacy row (or empty preferences):
 *   - externalCapTable + isCoMember=true   → LEGAL NAME   (counterparty default)
 *   - externalCapTable + isCoMember=false  → "Private Investor"
 *   - message          + isCoMember=true   → LEGAL NAME
 *   - message          + isCoMember=false  → "Private Investor"
 *   - collectiveDirectory (any isCoMember) → "Private Investor" (opt-in required)
 *   - chapterRoster       (any isCoMember) → "Private Investor" (opt-in required)
 *   - self-view (viewer === userId)        → LEGAL NAME
 *   - anonymous/null/empty/malformed viewer→ fail closed ("Private Investor"/"Private Investor")
 *   - explicit visibleToCoMembers:false    → "Private Investor"/screen name, EVEN IF isCoMember=true
 */
describe('v25.45 round 7 — Capavate counterparty privacy contract', () => {
  const socialPrivate = {
    collectiveDirectory: 'Private Investor',
    chapterRoster: 'Private Investor',
  };

  it('no-row CO-MEMBER (isCoMember=true) sees the legal name in counterparty contexts', () => {
    const userId = `u_r7_subject_${Date.now()}`;
    const viewer = `u_r7_viewer_${Date.now()}`;
    const legalName = `R7 Legal ${Date.now()}`;
    for (const ctx of ['externalCapTable', 'message']) {
      const out = resolveDisplayName(userId, viewer, ctx, { legalName, isCoMember: true });
      console.log('R7_COMEMBER', JSON.stringify({ ctx, out }));
      expect(out).toBe(legalName);
    }
  });

  it('no-row NON-counterparty (isCoMember=false/undefined) is masked as "Private Investor"', () => {
    const userId = `u_r7_subject2_${Date.now()}`;
    const viewer = `u_r7_viewer2_${Date.now()}`;
    const legalName = `R7 Legal2 ${Date.now()}`;
    for (const ctx of ['externalCapTable', 'message']) {
      // isCoMember omitted (defaults false) AND explicit false both fail private.
      const omitted = resolveDisplayName(userId, viewer, ctx, { legalName });
      const explicitFalse = resolveDisplayName(userId, viewer, ctx, { legalName, isCoMember: false });
      console.log('R7_NONCOUNTERPARTY', JSON.stringify({ ctx, omitted, explicitFalse }));
      expect(omitted).toBe('Private Investor');
      expect(explicitFalse).toBe('Private Investor');
      expect(omitted).not.toBe(legalName);
    }
  });

  it('social surfaces always require opt-in → "Private Investor" REGARDLESS of isCoMember', () => {
    const userId = `u_r7_subject3_${Date.now()}`;
    const viewer = `u_r7_viewer3_${Date.now()}`;
    const legalName = `R7 Legal3 ${Date.now()}`;
    for (const ctx of ['collectiveDirectory', 'chapterRoster']) {
      for (const coMember of [true, false]) {
        const out = resolveDisplayName(userId, viewer, ctx, { legalName, isCoMember: coMember });
        console.log('R7_SOCIAL', JSON.stringify({ ctx, coMember, out }));
        expect(out).toBe(socialPrivate[ctx]);
        expect(out).not.toBe(legalName);
      }
    }
  });

  it('self-view returns the legal name (unchanged from round 5)', () => {
    const userId = `u_r7_self_${Date.now()}`;
    const legalName = `R7 Self Legal ${Date.now()}`;
    for (const ctx of ['ownCapTable', 'externalCapTable', 'message', 'collectiveDirectory', 'chapterRoster']) {
      const out = resolveDisplayName(userId, userId, ctx, { legalName });
      expect(out).toBe(legalName);
    }
  });

  it('null/blank/whitespace/non-string viewer IDs fail closed and never leak the no-row legal name (round 5/6 regression)', () => {
    const userId = `u_r7_subject4_${Date.now()}`;
    const legalName = `R7 Legal4 ${Date.now()}`;
    const expectedPrivate = {
      ownCapTable: 'Private Investor',
      externalCapTable: 'Private Investor',
      message: 'Private Investor',
      collectiveDirectory: 'Private Investor',
      chapterRoster: 'Private Investor',
    };
    // These ALL normalize to anonymous (typeof !== string OR trimmed empty).
    // Even with isCoMember:true, an unauthenticated viewer cannot resolve
    // identity. NOTE: string sentinels like "null"/"0"/"false" are NON-EMPTY
    // strings and are therefore treated as authenticated IDs (validated
    // upstream) — see the next test for their contract.
    const viewerCases = [
      { label: 'null', value: null },
      { label: 'undefined', value: undefined },
      { label: 'empty-string', value: '' },
      { label: 'whitespace-string', value: ' ' },
      { label: 'tab-newline-string', value: '\t\n ' },
      { label: 'number-zero', value: 0 },
      { label: 'number-one', value: 1 },
      { label: 'boolean-false', value: false },
      { label: 'boolean-true', value: true },
      { label: 'empty-object', value: {} },
      { label: 'array', value: [] },
    ];
    const failures = [];
    const matrix = {};
    for (const viewerCase of viewerCases) {
      matrix[viewerCase.label] = {};
      for (const ctx of Object.keys(expectedPrivate)) {
        const out = resolveDisplayName(userId, viewerCase.value, ctx, { legalName, isCoMember: true });
        matrix[viewerCase.label][ctx] = out;
        if (out !== expectedPrivate[ctx] || out === legalName) {
          failures.push({ viewer: viewerCase.label, ctx, expected: expectedPrivate[ctx], actual: out });
        }
      }
    }
    console.log('R7_VIEWERID_MATRIX', JSON.stringify(matrix, null, 2));
    expect(failures).toEqual([]);
  });

  it('non-empty string viewer IDs (incl. sentinels like "null"/"0") are treated as authenticated counterparties when isCoMember=true', () => {
    // The resolver contract: any non-empty string viewer that is NOT the subject
    // is an authenticated identity (callers MUST validate upstream). With
    // isCoMember=true and a no-row subject, the counterparty default applies.
    const userId = `u_r7_subject5_${Date.now()}`;
    const legalName = `R7 Legal5 ${Date.now()}`;
    for (const viewer of ['null', '0', 'false', 'viewer_real_123']) {
      // counterparty contexts reveal the legal name
      expect(resolveDisplayName(userId, viewer, 'externalCapTable', { legalName, isCoMember: true })).toBe(legalName);
      expect(resolveDisplayName(userId, viewer, 'message', { legalName, isCoMember: true })).toBe(legalName);
      // non-counterparty (isCoMember false) still masks
      expect(resolveDisplayName(userId, viewer, 'externalCapTable', { legalName })).toBe('Private Investor');
      // social contexts still require opt-in
      expect(resolveDisplayName(userId, viewer, 'collectiveDirectory', { legalName, isCoMember: true })).toBe('Private Investor');
    }
  });

  it('empty userId is handled gracefully and cannot be self-viewed by an empty viewer', () => {
    const legalName = 'R7 Empty User Legal';
    const expectedPrivate = {
      ownCapTable: 'Private Investor',
      externalCapTable: 'Private Investor',
      message: 'Private Investor',
      collectiveDirectory: 'Private Investor',
      chapterRoster: 'Private Investor',
    };
    const outputs = {};
    for (const ctx of Object.keys(expectedPrivate)) {
      outputs[ctx] = resolveDisplayName('', '', ctx, { legalName, isCoMember: true });
    }
    console.log('R7_EMPTY_USERID_MATRIX', JSON.stringify(outputs, null, 2));
    expect(outputs).toEqual(expectedPrivate);
    for (const out of Object.values(outputs)) {
      expect(out).not.toBe(legalName);
    }
  });
});
