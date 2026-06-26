import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupFounder } from './v25_45_helpers.mjs';
import { rawDb } from '../db/connection.ts';
let h;
beforeAll(async () => { h = await setupFounder('gpt55archbypass'); }, 60000);
afterAll(async () => { await h.teardown(); });
describe('GPT-5.5 archive bypass probe', () => {
  it('archived workspace still accepts non-/api/founder profile PATCH', async () => {
    rawDb().prepare(`UPDATE companies SET archive_status='archived', archived_at=?, archive_retention_until=? WHERE id=?`)
      .run(new Date().toISOString(), new Date(Date.now()+8*365.25*864e5).toISOString(), h.ids.COMPANY);
    const founderBlocked = await h.req('POST', '/api/founder/workspace/archive', { userId: h.ids.FOUNDER, body: { companyId: h.ids.COMPANY } });
    const profileBypass = await h.patchProfile({ contact: { companyEmail: 'stillwrites@example.com' } });
    const persisted = h.readDurable()?.contact?.companyEmail;
    console.log('GPT55_ARCHIVE_BYPASS', JSON.stringify({ founderBlocked: { status: founderBlocked.status, error: founderBlocked.body?.error }, profileBypass: { status: profileBypass.status, email: profileBypass.body?.contact?.companyEmail }, persisted }));
    expect(founderBlocked.status).toBe(403);
    expect(profileBypass.status).toBe(403);
  });
});
