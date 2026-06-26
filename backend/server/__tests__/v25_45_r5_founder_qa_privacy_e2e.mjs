import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { registerRoutes } from '../routes.ts';
import { rawDb } from '../db/connection.ts';
import { writeUserPrivacy } from '../lib/userPrivacyResolver.ts';
import { storeCredential } from '../userCredentialsStore.ts';

/**
 * v25.45 ROUND 5 — RB3 / SWEEP-1 dedicated privacy test.
 *
 * GET /api/rounds/:roundId/founder-qa projects each message's `authorName`
 * through resolveDisplayName(..., "message", ...). This test posts a Q&A as an
 * OPTED-OUT author (visibleToCoMembers:false) and then reads the thread as a
 * DIFFERENT authenticated viewer, asserting the author is masked as
 * "Private Investor" — NEVER the raw users.name.
 *
 * A separate viewer is required because RB1 (self-view) intentionally returns
 * the legal name when the author reads their own message.
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
const ROUND = `rnd_r5_qa_${stamp}`;
const HIDDEN = `u_r5_qa_hidden_${stamp}`;
const HIDDEN_RAW = `R5 QA Hidden Author ${stamp}`;
const VIEWER = `u_r5_qa_viewer_${stamp}`;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));

  const now = new Date().toISOString();
  const db = rawDb();
  // Opted-out author (private to co-members).
  db.prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
  ).run(HIDDEN, `tenant_${stamp}`, `${HIDDEN}@probe.test`, HIDDEN_RAW);
  writeUserPrivacy(HIDDEN, { screenName: '', visibleToCoMembers: false, visibleInCollectiveDirectory: false });
  // A separate authenticated viewer.
  db.prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
  ).run(VIEWER, `tenant_${stamp}`, `${VIEWER}@probe.test`, `R5 QA Viewer ${stamp}`);
  // Register durable credentials so getUserContext authenticates these synthetic
  // users via the x-user-id test harness (a bare users row is not enough).
  storeCredential({ userId: HIDDEN, email: `${HIDDEN}@probe.test`, name: HIDDEN_RAW, password: 'probe-pw-12345' });
  storeCredential({ userId: VIEWER, email: `${VIEWER}@probe.test`, name: `R5 QA Viewer ${stamp}`, password: 'probe-pw-12345' });
}, 30_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe('v25.45 r5 — Founder Q&A authorName privacy (SWEEP-1)', () => {
  it('masks an opted-out Q&A author as "Private Investor" to another viewer (never raw users.name)', async () => {
    // POST a public Q&A as the opted-out author.
    const posted = await call('POST', `/api/rounds/${ROUND}/founder-qa`, {
      userId: HIDDEN,
      body: { body: 'r5 founder-qa privacy probe question', publicWithinRound: true },
    });
    expect(posted.status).toBe(201);

    // GET the thread as a DIFFERENT authenticated viewer.
    const res = await call('GET', `/api/rounds/${ROUND}/founder-qa`, { userId: VIEWER });
    expect(res.status).toBe(200);
    const mine = (res.body.messages || []).find((m) => m.authorId === HIDDEN);
    console.log('R5_FOUNDER_QA_PRIVACY', JSON.stringify({ rawName: HIDDEN_RAW, authorName: mine?.authorName }));

    expect(mine).toBeDefined();
    expect(mine.authorName).toBe('Private Investor');
    expect(mine.authorName).not.toBe(HIDDEN_RAW);
  });

  it('RB1 — the opted-out author sees THEIR OWN message with their legal name (self-view)', async () => {
    const res = await call('GET', `/api/rounds/${ROUND}/founder-qa`, { userId: HIDDEN });
    expect(res.status).toBe(200);
    const mine = (res.body.messages || []).find((m) => m.authorId === HIDDEN);
    console.log('R5_FOUNDER_QA_SELFVIEW', JSON.stringify({ authorName: mine?.authorName }));
    expect(mine).toBeDefined();
    // Self-view returns the legal name (stored authorName == users.name), never masked.
    expect(mine.authorName).not.toBe('Private Investor');
    expect(mine.authorName).not.toBe('Private Investor');
  });
});
