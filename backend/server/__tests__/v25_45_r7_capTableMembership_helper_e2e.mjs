import { describe, it, expect } from 'vitest';
import { rawDb } from '../db/connection.ts';
import { areCoMembersOnAnyCapTable } from '../lib/capTableMembership.ts';

/**
 * v25.45 ROUND 7 — areCoMembersOnAnyCapTable() helper contract.
 *
 * Co-membership is derived from the SACRED captable_commits ledger (READ-only):
 * two users are co-members iff BOTH are committed holders on the SAME company.
 *   - same cap table        → true
 *   - different cap tables   → false
 *   - only one user seeded   → false
 *   - malformed / self pairs → false (fail-closed)
 */
describe('v25.45 r7 — areCoMembersOnAnyCapTable helper', () => {
  const stamp = Date.now();
  const db = rawDb();

  const insCommit = db.prepare(
    `INSERT INTO captable_commits (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id, amount, currency, shares, state, prev_hash, hash, reconcile_match, compliance_hold, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '1000', 'USD', '100', 'committed', '', ?, 1, 0, NULL)`,
  );
  const now = new Date().toISOString();
  let seq = 1;
  const commit = (companyId, investorId, tag) =>
    insCommit.run(`cc_${tag}_${stamp}`, `tenant_${stamp}`, seq++, now, `inv_${tag}_${stamp}`, `rnd_${tag}_${stamp}`, companyId, investorId, `h_${tag}_${stamp}`);

  it('two users on the SAME cap table → true', () => {
    const company = `co_same_${stamp}`;
    const a = `u_r7helper_same_a_${stamp}`;
    const b = `u_r7helper_same_b_${stamp}`;
    commit(company, a, 'same_a');
    commit(company, b, 'same_b');
    const result = areCoMembersOnAnyCapTable(a, b);
    console.log('R7_HELPER_SAME', JSON.stringify({ a, b, result }));
    expect(result).toBe(true);
    // Symmetric.
    expect(areCoMembersOnAnyCapTable(b, a)).toBe(true);
  });

  it('two users on DIFFERENT cap tables → false', () => {
    const a = `u_r7helper_diff_a_${stamp}`;
    const b = `u_r7helper_diff_b_${stamp}`;
    commit(`co_diff_a_${stamp}`, a, 'diff_a');
    commit(`co_diff_b_${stamp}`, b, 'diff_b');
    const result = areCoMembersOnAnyCapTable(a, b);
    console.log('R7_HELPER_DIFF', JSON.stringify({ a, b, result }));
    expect(result).toBe(false);
  });

  it('only ONE user seeded → false', () => {
    const a = `u_r7helper_solo_a_${stamp}`;
    const b = `u_r7helper_solo_b_${stamp}`;
    commit(`co_solo_${stamp}`, a, 'solo_a');
    // b has no commits at all.
    const result = areCoMembersOnAnyCapTable(a, b);
    console.log('R7_HELPER_SOLO', JSON.stringify({ a, b, result }));
    expect(result).toBe(false);
  });

  it('self-pair and malformed inputs fail closed → false', () => {
    const a = `u_r7helper_self_${stamp}`;
    commit(`co_self_${stamp}`, a, 'self_a');
    // A user is not their own counterparty.
    expect(areCoMembersOnAnyCapTable(a, a)).toBe(false);
    // Malformed / empty / non-string inputs.
    expect(areCoMembersOnAnyCapTable('', a)).toBe(false);
    expect(areCoMembersOnAnyCapTable(a, '   ')).toBe(false);
    expect(areCoMembersOnAnyCapTable(undefined, a)).toBe(false);
    expect(areCoMembersOnAnyCapTable(a, null)).toBe(false);
    expect(areCoMembersOnAnyCapTable(0, a)).toBe(false);
    expect(areCoMembersOnAnyCapTable(a, {})).toBe(false);
  });

  it('a non-committed (e.g. soft) commit does NOT establish co-membership', () => {
    const company = `co_state_${stamp}`;
    const a = `u_r7helper_state_a_${stamp}`;
    const b = `u_r7helper_state_b_${stamp}`;
    commit(company, a, 'state_a'); // committed
    // b is on the same company but in a non-committed state.
    db.prepare(
      `INSERT INTO captable_commits (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id, amount, currency, shares, state, prev_hash, hash, reconcile_match, compliance_hold, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '1000', 'USD', '100', 'soft', '', ?, 1, 0, NULL)`,
    ).run(`cc_state_b_${stamp}`, `tenant_${stamp}`, seq++, now, `inv_state_b_${stamp}`, `rnd_state_b_${stamp}`, company, b, `h_state_b_${stamp}`);
    const result = areCoMembersOnAnyCapTable(a, b);
    console.log('R7_HELPER_STATE', JSON.stringify({ a, b, result }));
    expect(result).toBe(false);
  });
});
