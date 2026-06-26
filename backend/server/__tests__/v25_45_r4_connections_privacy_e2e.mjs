import { describe, it, expect } from 'vitest';
import { rawDb } from '../db/connection.ts';
import { writeUserPrivacy } from '../lib/userPrivacyResolver.ts';
import { getMyConnections } from '../collectiveWaveAStore.ts';

/**
 * v25.45 ROUND 7 — GET /api/collective/me/connections routes the co-investor
 * name through the single privacy resolver with the "externalCapTable" posture.
 * Per the round-7 counterparty contract, a connection is SOCIAL by default
 * (isCoMember=false → "Private Investor") UNLESS the two users are PROVEN to be
 * on a shared cap table (captable_commits), in which case the counterparty
 * principle applies (isCoMember=true → legal name). An explicit opt-out
 * (visibleToCoMembers: false) ALWAYS wins and renders as "Private Investor".
 */
describe('v25.45 r4 — Collective connections name privacy', () => {
  it('masks an opted-out connection as "Private Investor" (never raw users.name)', () => {
    const stamp = Date.now();
    const viewer = `u_r4_conn_viewer_${stamp}`;
    const hidden = `u_r4_conn_hidden_${stamp}`;
    const rawName = `R4 Conn Raw Name ${stamp}`;
    const round = `rnd_r4_conn_${stamp}`;
    const now = new Date().toISOString();
    const db = rawDb();

    db.prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
    ).run(viewer, `tenant_${stamp}`, `${viewer}@probe.test`, `Viewer ${stamp}`);
    db.prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
    ).run(hidden, `tenant_${stamp}`, `${hidden}@probe.test`, rawName);
    // Co-investor opted OUT of co-member visibility.
    writeUserPrivacy(hidden, {
      screenName: '',
      visibleToCoMembers: false,
      visibleInCollectiveDirectory: false,
    });

    // Both viewer and hidden redeemed an invitation on the same round => co-investors.
    db.prepare(
      `INSERT INTO round_invitations (id, tenant_id, round_id, company_id, investor_email, investor_name, state, redeemed_by_user_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, 'redeemed', ?, ?, ?, NULL)`,
    ).run(`ri_viewer_${stamp}`, `tenant_${stamp}`, round, `co_${stamp}`, `${viewer}@probe.test`, `Viewer ${stamp}`, viewer, now, now);
    db.prepare(
      `INSERT INTO round_invitations (id, tenant_id, round_id, company_id, investor_email, investor_name, state, redeemed_by_user_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, 'redeemed', ?, ?, ?, NULL)`,
    ).run(`ri_hidden_${stamp}`, `tenant_${stamp}`, round, `co_${stamp}`, `${hidden}@probe.test`, rawName, hidden, now, now);

    const connections = getMyConnections(viewer).connections;
    const found = connections.find((c) => c.userId === hidden);
    console.log('R4_CONN_PRIVACY', JSON.stringify({ rawName, name: found?.name }));

    expect(found).toBeDefined();
    expect(found?.name).toBe('Private Investor');
    expect(found?.name).not.toBe(rawName);
  });

  it('renders a PROVEN cap-table co-member connection with their legal name (v25.45 r7 counterparty)', () => {
    const stamp = Date.now() + 1;
    const viewer = `u_r4_conn_viewer2_${stamp}`;
    const visible = `u_r4_conn_visible_${stamp}`;
    const rawName = `R4 Visible Conn ${stamp}`;
    const round = `rnd_r4_conn2_${stamp}`;
    const company = `co_r4_conn2_${stamp}`;
    const now = new Date().toISOString();
    const db = rawDb();

    db.prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
    ).run(viewer, `tenant_${stamp}`, `${viewer}@probe.test`, `Viewer2 ${stamp}`);
    db.prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
    ).run(visible, `tenant_${stamp}`, `${visible}@probe.test`, rawName);
    writeUserPrivacy(visible, {
      screenName: '',
      visibleToCoMembers: true,
      visibleInCollectiveDirectory: true,
    });

    db.prepare(
      `INSERT INTO round_invitations (id, tenant_id, round_id, company_id, investor_email, investor_name, state, redeemed_by_user_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, 'redeemed', ?, ?, ?, NULL)`,
    ).run(`ri_viewer2_${stamp}`, `tenant_${stamp}`, round, company, `${viewer}@probe.test`, `Viewer2 ${stamp}`, viewer, now, now);
    db.prepare(
      `INSERT INTO round_invitations (id, tenant_id, round_id, company_id, investor_email, investor_name, state, redeemed_by_user_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, 'redeemed', ?, ?, ?, NULL)`,
    ).run(`ri_visible_${stamp}`, `tenant_${stamp}`, round, company, `${visible}@probe.test`, rawName, visible, now, now);

    // v25.45 r7 — to be a counterparty (legal name), the two MUST be on a shared
    // cap table. Seed committed captable_commits for both on the same company.
    const ins = db.prepare(
      `INSERT INTO captable_commits (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id, amount, currency, shares, state, prev_hash, hash, reconcile_match, compliance_hold, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '1000', 'USD', '100', 'committed', '', ?, 1, 0, NULL)`,
    );
    ins.run(`cc_viewer2_${stamp}`, `tenant_${stamp}`, 1, now, `ri_viewer2_${stamp}`, round, company, viewer, `h_v2_${stamp}`);
    ins.run(`cc_visible_${stamp}`, `tenant_${stamp}`, 2, now, `ri_visible_${stamp}`, round, company, visible, `h_vis_${stamp}`);

    const connections = getMyConnections(viewer).connections;
    const found = connections.find((c) => c.userId === visible);
    console.log('R4_CONN_PRIVACY_VISIBLE', JSON.stringify({ rawName, name: found?.name }));

    expect(found).toBeDefined();
    expect(found?.name).toBe(rawName);
  });
});
