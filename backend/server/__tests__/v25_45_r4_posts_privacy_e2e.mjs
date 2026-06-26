import { describe, it, expect } from 'vitest';
import { rawDb } from '../db/connection.ts';
import { writeUserPrivacy } from '../lib/userPrivacyResolver.ts';
import { getNetworkPosts } from '../collectiveWaveAStore.ts';

/**
 * v25.45 ROUND 4 (B1) — GET /api/collective/posts must route the author name
 * through the single privacy resolver with the "collectiveDirectory" posture.
 * An author who has NOT opted in to the Collective directory
 * (visibleInCollectiveDirectory: false) must render as "Private Investor",
 * NEVER as their raw users.name.
 */
describe('v25.45 r4 — Collective posts author-name privacy', () => {
  it('masks an opted-out author as "Private Investor" (never raw users.name)', () => {
    const stamp = Date.now();
    const hidden = `u_r4_posts_hidden_${stamp}`;
    const rawName = `R4 Posts Raw Name ${stamp}`;
    const post = `post_r4_posts_${stamp}`;
    const now = new Date().toISOString();
    const db = rawDb();

    db.prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
    ).run(hidden, `tenant_${stamp}`, `${hidden}@probe.test`, rawName);
    // Explicitly opted OUT of the Collective directory.
    writeUserPrivacy(hidden, {
      screenName: '',
      visibleToCoMembers: false,
      visibleInCollectiveDirectory: false,
    });

    db.prepare(
      `INSERT INTO network_posts (id, tenant_id, author_user_id, audience, body, content_json, likes, comments, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'all', ?, ?, 0, 0, ?, ?, NULL)`,
    ).run(post, `tenant_${stamp}`, hidden, 'r4 posts privacy probe body', JSON.stringify({ topics: ['probe'], chapterId: null }), now, now);

    const posts = getNetworkPosts(50, null).posts;
    const found = posts.find((p) => p.id === post);
    console.log('R4_POSTS_PRIVACY', JSON.stringify({ rawName, authorName: found?.authorName }));

    expect(found).toBeDefined();
    expect(found?.authorName).toBe('Private Investor');
    expect(found?.authorName).not.toBe(rawName);
  });

  it('renders an opted-in author with their resolved name to an AUTHENTICATED viewer', () => {
    const stamp = Date.now() + 1;
    const visible = `u_r4_posts_visible_${stamp}`;
    const rawName = `R4 Visible Author ${stamp}`;
    const viewer = `u_r4_posts_viewer_${stamp}`;
    const post = `post_r4_posts_vis_${stamp}`;
    const now = new Date().toISOString();
    const db = rawDb();

    db.prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
    ).run(visible, `tenant_${stamp}`, `${visible}@probe.test`, rawName);
    db.prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
    ).run(viewer, `tenant_${stamp}`, `${viewer}@probe.test`, `R4 Posts Viewer ${stamp}`);
    // Opted IN to the Collective directory.
    writeUserPrivacy(visible, {
      screenName: '',
      visibleToCoMembers: true,
      visibleInCollectiveDirectory: true,
    });

    db.prepare(
      `INSERT INTO network_posts (id, tenant_id, author_user_id, audience, body, content_json, likes, comments, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'all', ?, ?, 0, 0, ?, ?, NULL)`,
    ).run(post, `tenant_${stamp}`, visible, 'r4 posts visible body', JSON.stringify({ topics: ['probe'], chapterId: null }), now, now);

    // v25.45 ROUND 5 — pass an AUTHENTICATED viewer. After RB2, an anonymous
    // (null) viewer fails CLOSED for ALL contexts, so the opt-in render path is
    // verified against a legitimate authenticated viewer.
    const posts = getNetworkPosts(50, null, viewer).posts;
    const found = posts.find((p) => p.id === post);
    console.log('R4_POSTS_PRIVACY_VISIBLE', JSON.stringify({ rawName, authorName: found?.authorName }));

    expect(found).toBeDefined();
    expect(found?.authorName).toBe(rawName);
  });

  it('RB2 — an ANONYMOUS (null) viewer sees even an opted-in author as "Private Investor" (fail-closed)', () => {
    const stamp = Date.now() + 2;
    const visible = `u_r4_posts_anon_${stamp}`;
    const rawName = `R4 Anon-View Author ${stamp}`;
    const post = `post_r4_posts_anon_${stamp}`;
    const now = new Date().toISOString();
    const db = rawDb();

    db.prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
    ).run(visible, `tenant_${stamp}`, `${visible}@probe.test`, rawName);
    writeUserPrivacy(visible, {
      screenName: '',
      visibleToCoMembers: true,
      visibleInCollectiveDirectory: true,
    });
    db.prepare(
      `INSERT INTO network_posts (id, tenant_id, author_user_id, audience, body, content_json, likes, comments, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'all', ?, ?, 0, 0, ?, ?, NULL)`,
    ).run(post, `tenant_${stamp}`, visible, 'r4 posts anon-view body', JSON.stringify({ topics: ['probe'], chapterId: null }), now, now);

    const posts = getNetworkPosts(50, null, null).posts;
    const found = posts.find((p) => p.id === post);
    console.log('R4_POSTS_PRIVACY_ANON', JSON.stringify({ rawName, authorName: found?.authorName }));
    expect(found).toBeDefined();
    expect(found?.authorName).toBe('Private Investor');
    expect(found?.authorName).not.toBe(rawName);
  });
});
