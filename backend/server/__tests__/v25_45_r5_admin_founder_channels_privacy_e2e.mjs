import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { registerRoutes } from '../routes.ts';
import { rawDb } from '../db/connection.ts';
import { writeUserPrivacy } from '../lib/userPrivacyResolver.ts';

/**
 * v25.45 ROUND 5 — RB3 / SWEEP-2 dedicated privacy test.
 *
 * GET /api/admin/founder-channels/:companyId aggregates collective soft-circle
 * sources and projects each member name through
 * resolveDisplayName(..., "externalCapTable", ...). This test seeds an
 * OPTED-OUT collective member as the source of a soft circle and asserts the
 * member name is masked as "Private Investor" in `byCollectiveMember` —
 * NEVER the raw users.name.
 */

let app;
let server;
let port;

function call(method, path, { body, userId } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = {};
    if (data) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(data));
    }
    if (userId) headers['x-user-id'] = userId;
    const r = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null }); }
        catch { resolve({ status: res.statusCode ?? 0, body: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const stamp = Date.now();
const COMPANY = `co_r5_fc_${stamp}`;
const ROUND = `rnd_r5_fc_${stamp}`;
const HIDDEN = `u_r5_fc_hidden_${stamp}`;
const HIDDEN_RAW = `R5 FC Hidden Member ${stamp}`;
const SC_ID = `sc_r5_fc_${stamp}`;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));

  const now = new Date().toISOString();
  const db = rawDb();

  // Opted-out collective member (private to co-members).
  db.prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
  ).run(HIDDEN, `tenant_${stamp}`, `${HIDDEN}@probe.test`, HIDDEN_RAW);
  writeUserPrivacy(HIDDEN, { screenName: '', visibleToCoMembers: false, visibleInCollectiveDirectory: false });

  // A round for the company so the SC -> company linkage resolves via the join.
  db.prepare(
    `INSERT OR IGNORE INTO rounds (id, tenant_id, company_id, name, type, state, target_amount, raised_amount, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'seed', 'open', ?, ?, ?, ?)`,
  ).run(ROUND, `tenant_${stamp}`, COMPANY, 'R5 FC Round', 1000000, 0, now, now);

  // A collective-attributed soft circle whose SOURCE is the opted-out member.
  db.prepare(
    `INSERT INTO soft_circles
       (id, tenant_id, round_id, company_id, investor_user_id, investor_email, investor_name,
        amount, amount_minor, currency, status, collective_visible, source_type, source_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', 'confirmed', 1, 'collective', ?, ?, ?, NULL)`,
  ).run(
    SC_ID, `tenant_${stamp}`, ROUND, COMPANY, HIDDEN, `${HIDDEN}@probe.test`, HIDDEN_RAW,
    50000, 5000000, HIDDEN, now, now,
  );
}, 30_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe('v25.45 r5 — Admin founder-channels member-name privacy (SWEEP-2)', () => {
  it('masks an opted-out collective member as "Private Investor" (never raw users.name)', async () => {
    // Admin owns access to any company's founder-channels view.
    const res = await call('GET', `/api/admin/founder-channels/${COMPANY}`, { userId: 'u_admin' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const members = res.body.byCollectiveMember || [];
    const mine = members.find((m) => m.userId === HIDDEN);
    console.log('R5_ADMIN_FOUNDER_CHANNELS_PRIVACY', JSON.stringify({ rawName: HIDDEN_RAW, name: mine?.name }));

    expect(mine).toBeDefined();
    expect(mine.name).toBe('Private Investor');
    expect(mine.name).not.toBe(HIDDEN_RAW);
  });
});
