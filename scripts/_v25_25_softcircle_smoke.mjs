// v25.25 Avi-7 runtime smoke (read-only, throwaway DB).
// Proves that the Drizzle insert with the now-declared columns persists
// investor_user_id and amount_minor (the columns that were silently dropped).
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { softCircles } from '../shared/schema.ts';

const sqlite = new Database(':memory:');
// Build the table with the same physical columns the prod DB has.
sqlite.exec(`CREATE TABLE soft_circles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  round_id TEXT NOT NULL,
  company_id TEXT,
  invitation_id TEXT,
  investor_user_id TEXT,
  investor_email TEXT,
  investor_name TEXT NOT NULL,
  amount REAL NOT NULL,
  amount_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL,
  collective_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT,
  chapter_id TEXT
);`);

const db = drizzle(sqlite);
db.insert(softCircles).values({
  id: 'sc_test_v2525',
  roundId: 'rnd_x',
  invitationId: 'inv_x',
  investorName: 'Test Investor',
  amount: 50000,
  status: 'confirmed',
  createdAt: new Date().toISOString(),
  tenantId: 't1',
  companyId: 'c1',
  investorUserId: 'u_investor_42',
  investorEmail: 'inv@example.com',
  amountMinor: 5000000,
  currency: 'USD',
  collectiveVisible: 1,
  updatedAt: new Date().toISOString(),
}).run();

const row = sqlite.prepare('SELECT investor_user_id, amount_minor, company_id, tenant_id FROM soft_circles WHERE id = ?').get('sc_test_v2525');
console.log(JSON.stringify(row));
const pass = row.investor_user_id === 'u_investor_42' && row.amount_minor === 5000000;
console.log('SMOKE_RESULT:', pass ? 'PASS' : 'FAIL');
