import { describe, it, expect } from 'vitest';
import { rawDb } from '../db/connection.ts';
import { writeUserPrivacy } from '../lib/userPrivacyResolver.ts';
import { getNetworkPosts, getMyConnections } from '../collectiveWaveAStore.ts';

describe('GPT-5.5 round-3 adversarial Wave A privacy bypass probe', () => {
  it('shows opted-out user names bypass resolver in Collective posts and connections', () => {
    const stamp = Date.now();
    const viewer = `u_gpt55_wave_viewer_${stamp}`;
    const hidden = `u_gpt55_wave_hidden_${stamp}`;
    const rawName = `Hidden Raw Name ${stamp}`;
    const round = `rnd_gpt55_wave_${stamp}`;
    const post = `post_gpt55_wave_${stamp}`;
    const now = new Date().toISOString();
    const db = rawDb();

    db.prepare(`INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`).run(viewer, `tenant_${stamp}`, `${viewer}@probe.test`, `Viewer ${stamp}`);
    db.prepare(`INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`).run(hidden, `tenant_${stamp}`, `${hidden}@probe.test`, rawName);
    writeUserPrivacy(hidden, { screenName: '', visibleToCoMembers: false, visibleInCollectiveDirectory: false });

    db.prepare(`INSERT INTO network_posts (id, tenant_id, author_user_id, audience, body, content_json, likes, comments, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'all', ?, ?, 0, 0, ?, ?, NULL)`).run(post, `tenant_${stamp}`, hidden, 'privacy probe body', JSON.stringify({ topics: ['probe'], chapterId: null }), now, now);
    db.prepare(`INSERT INTO round_invitations (id, tenant_id, round_id, company_id, investor_email, investor_name, state, redeemed_by_user_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, 'redeemed', ?, ?, ?, NULL)`).run(`ri_viewer_${stamp}`, `tenant_${stamp}`, round, `co_${stamp}`, `${viewer}@probe.test`, `Viewer ${stamp}`, viewer, now, now);
    db.prepare(`INSERT INTO round_invitations (id, tenant_id, round_id, company_id, investor_email, investor_name, state, redeemed_by_user_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, 'redeemed', ?, ?, ?, NULL)`).run(`ri_hidden_${stamp}`, `tenant_${stamp}`, round, `co_${stamp}`, `${hidden}@probe.test`, rawName, hidden, now, now);

    const posts = getNetworkPosts(50, null).posts;
    const leakedPost = posts.find((p) => p.id === post)?.authorName === rawName;
    const connections = getMyConnections(viewer).connections;
    const leakedConnection = connections.find((c) => c.userId === hidden)?.name === rawName;
    console.log('GPT55_WAVEA_PRIVACY_BYPASS', JSON.stringify({ rawName, leakedPost, leakedConnection, postAuthor: posts.find((p) => p.id === post)?.authorName, connectionName: connections.find((c) => c.userId === hidden)?.name }));

    expect(leakedPost || leakedConnection).toBe(false);
  });
});
