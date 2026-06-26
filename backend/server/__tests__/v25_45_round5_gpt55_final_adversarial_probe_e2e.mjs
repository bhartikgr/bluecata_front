import { describe, it, expect } from 'vitest';
import { rawDb } from '../db/connection.ts';
import { writeUserPrivacy, resolveDisplayName } from '../lib/userPrivacyResolver.ts';

const CONTEXTS = ['ownCapTable', 'externalCapTable', 'message', 'collectiveDirectory', 'chapterRoster'];
const privateLabelFor = (ctx) => (ctx === 'externalCapTable' || ctx === 'message' ? 'Private Investor' : 'Private Investor');

describe('v25.45 round 5 GPT-5.5 final adversarial resolver probe', () => {
  const stamp = Date.now();
  const db = rawDb();
  const optedOut = `u_gpt55_r5_opted_out_${stamp}`;
  const optedOutLegal = `GPT55 R5 Opted Out Legal ${stamp}`;
  const optedIn = `u_gpt55_r5_opted_in_${stamp}`;
  const optedInLegal = `GPT55 R5 Opted In Legal ${stamp}`;
  const optedInScreen = `GPT55R5Screen${stamp}`;
  const viewer = `u_gpt55_r5_viewer_${stamp}`;

  db.prepare(`INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`).run(optedOut, `tenant_${stamp}`, `${optedOut}@probe.test`, optedOutLegal);
  db.prepare(`INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`).run(optedIn, `tenant_${stamp}`, `${optedIn}@probe.test`, optedInLegal);
  db.prepare(`INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`).run(viewer, `tenant_${stamp}`, `${viewer}@probe.test`, `GPT55 R5 Viewer ${stamp}`);

  writeUserPrivacy(optedOut, { screenName: '', visibleToCoMembers: false, visibleInCollectiveDirectory: false });
  writeUserPrivacy(optedIn, { screenName: optedInScreen, visibleToCoMembers: true, visibleInCollectiveDirectory: true });

  it('self-view on all contexts returns legal name', () => {
    const results = {};
    for (const ctx of CONTEXTS) results[ctx] = resolveDisplayName(optedOut, optedOut, ctx, { legalName: optedOutLegal });
    console.log('GPT55_R5_SELFVIEW', JSON.stringify(results));
    for (const ctx of CONTEXTS) expect(results[ctx]).toBe(optedOutLegal);
  });

  it('anonymous null/undefined on all contexts never returns legal name and uses per-context private labels', () => {
    for (const anon of [null, undefined]) {
      const results = {};
      for (const ctx of CONTEXTS) results[ctx] = resolveDisplayName(optedIn, anon, ctx, { legalName: optedInLegal });
      console.log('GPT55_R5_ANON', JSON.stringify({ anon: String(anon), results }));
      for (const ctx of CONTEXTS) {
        expect(results[ctx]).toBe(privateLabelFor(ctx));
        expect(results[ctx]).not.toBe(optedInLegal);
      }
    }
  });

  it('opted-out user to opted-in viewer masks by context', () => {
    const ext = resolveDisplayName(optedOut, viewer, 'externalCapTable', { legalName: optedOutLegal });
    const dir = resolveDisplayName(optedOut, viewer, 'collectiveDirectory', { legalName: optedOutLegal });
    console.log('GPT55_R5_OPTOUT_OTHER', JSON.stringify({ ext, dir }));
    expect(ext).toBe('Private Investor');
    expect(dir).toBe('Private Investor');
  });

  it('opted-in CO-MEMBER user externalCapTable returns screenName preference (v25.45 r7 counterparty)', () => {
    // v25.45 r7 — counterparty default requires isCoMember:true; the screen name
    // preference is then returned in place of the legal name.
    const out = resolveDisplayName(optedIn, viewer, 'externalCapTable', { legalName: optedInLegal, isCoMember: true });
    console.log('GPT55_R5_OPTIN_EXTERNAL', JSON.stringify({ out }));
    expect(out).toBe(optedInScreen);
  });

  it('unknown userId remains graceful', () => {
    const unknown = `u_gpt55_unknown_${stamp}`;
    const results = {};
    let crashed = false;
    try {
      for (const ctx of CONTEXTS) results[ctx] = resolveDisplayName(unknown, viewer, ctx, { legalName: 'Unknown Legal Should Not Matter' });
    } catch (e) {
      crashed = true;
    }
    console.log('GPT55_R5_UNKNOWN_AUTH_VIEWER', JSON.stringify({ crashed, results }));
    expect(crashed).toBe(false);
    expect(results.collectiveDirectory).toBe('Private Investor');
    expect(results.chapterRoster).toBe('Private Investor');
  });

  it('edge: empty-string viewer should behave like anonymous and fail closed', () => {
    const noRowUser = `u_gpt55_empty_viewer_norow_${stamp}`;
    const noRowLegal = `GPT55 Empty Viewer NoRow Legal ${stamp}`;
    const results = {};
    for (const ctx of CONTEXTS) results[ctx] = resolveDisplayName(noRowUser, '', ctx, { legalName: noRowLegal });
    console.log('GPT55_R5_EMPTY_VIEWER', JSON.stringify({ noRowLegal, results }));
    for (const ctx of CONTEXTS) {
      expect(results[ctx]).toBe(privateLabelFor(ctx));
      expect(results[ctx]).not.toBe(noRowLegal);
    }
  });
});
