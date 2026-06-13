/**
 * Pre-seed the in-process telemetry log with realistic mock events so the
 * /admin/telemetry page lights up immediately in the preview.
 *
 * Three companies × multiple rounds, each going through the full lifecycle.
 */
import { defaultTelemetryStore } from "@capavate/telemetry";

type SeedEvent = Parameters<typeof defaultTelemetryStore.recordEvent>;

let seeded = false;

export function seedSprint3Telemetry(): void {
  // Patch v4: this entire seed body is dev-only. In production builds, or when
  // VITE_ENABLE_DEMO_SEED is not "1", the function is a no-op so none of the
  // persona / company strings ship in the bundle.
  if (import.meta.env.MODE === "production" || import.meta.env.VITE_ENABLE_DEMO_SEED !== "1") {
    return;
  }
  if (seeded) return;
  seeded = true;

  const ts = (s: string) => `${s}T00:00:00Z`;

  // ---- Company A — fintech, Seed round (CLOSED) ----
  const aCtx = (rid: string, ts0: string, actor = "founder-avi") => ({
    companyId: "co-acme",
    roundId: rid,
    actorId: actor,
    actorRole: actor.startsWith("founder") ? "founder" as const : "admin" as const,
    timestamp: ts0,
    ipAddress: "203.0.113.42",
    location: { city: "San Francisco", region: "CA", country: "US" },
  });

  defaultTelemetryStore.recordEvent({ type: "round.created", payload: { roundId: "rnd-acme-seed", series: "Seed", targetRaise: "3000000", instrument: "safe" } }, aCtx("rnd-acme-seed", ts("2026-01-15")));
  defaultTelemetryStore.recordEvent({ type: "round.terms_set", payload: { roundId: "rnd-acme-seed", preMoney: "12000000", cap: "15000000", discount: "0.20" } }, aCtx("rnd-acme-seed", ts("2026-01-18")));

  // 12 invitations, 9 viewed, 7 soft-circled, 6 signed, 5 funded
  const investorIds = ["inv-andreessen", "inv-sequoia", "inv-foundersfund", "inv-gv", "inv-bessemer", "inv-spark", "inv-firstround", "inv-uncork", "inv-precursor", "inv-haystack", "inv-floodgate", "inv-emergence"];
  for (let i = 0; i < 12; i++) {
    const invId = `inv-acme-seed-${i}`;
    defaultTelemetryStore.recordEvent({ type: "invitation.created", payload: { invitationId: invId, roundId: "rnd-acme-seed", investorId: investorIds[i] } }, aCtx("rnd-acme-seed", ts(`2026-01-${20 + Math.floor(i / 4)}`)));
  }
  defaultTelemetryStore.recordEvent({ type: "round.invitations_sent", payload: { roundId: "rnd-acme-seed", count: 12 } }, aCtx("rnd-acme-seed", ts("2026-01-25")));

  for (let i = 0; i < 9; i++) {
    defaultTelemetryStore.recordEvent({ type: "invitation.viewed", payload: { invitationId: `inv-acme-seed-${i}` } }, { ...aCtx("rnd-acme-seed", ts(`2026-01-${27 + Math.floor(i / 3)}`)), actorId: investorIds[i], actorRole: "investor" });
  }
  for (let i = 0; i < 7; i++) {
    defaultTelemetryStore.recordEvent({ type: "invitation.soft_circled", payload: { invitationId: `inv-acme-seed-${i}`, amount: "300000" } }, { ...aCtx("rnd-acme-seed", ts(`2026-02-${1 + i}`)), actorId: investorIds[i], actorRole: "investor" });
    defaultTelemetryStore.recordEvent({ type: "softcircle.created", payload: { softCircleId: `sc-acme-seed-${i}`, roundId: "rnd-acme-seed", investorId: investorIds[i], amount: "300000" } }, { ...aCtx("rnd-acme-seed", ts(`2026-02-${1 + i}`)) });
  }
  // 1 declined
  defaultTelemetryStore.recordEvent({ type: "invitation.declined", payload: { invitationId: "inv-acme-seed-7", reason: "stage mismatch" } }, { ...aCtx("rnd-acme-seed", ts("2026-02-04")), actorId: investorIds[7], actorRole: "investor" });

  defaultTelemetryStore.recordEvent({ type: "round.soft_circle_opened", payload: { roundId: "rnd-acme-seed" } }, aCtx("rnd-acme-seed", ts("2026-01-26")));
  defaultTelemetryStore.recordEvent({ type: "round.soft_circle_closed", payload: { roundId: "rnd-acme-seed", circledAmount: "2100000" } }, aCtx("rnd-acme-seed", ts("2026-02-15")));
  defaultTelemetryStore.recordEvent({ type: "round.docs_generated", payload: { roundId: "rnd-acme-seed", docCount: 7 } }, aCtx("rnd-acme-seed", ts("2026-02-18")));
  for (let i = 0; i < 7; i++) {
    defaultTelemetryStore.recordEvent({ type: "document.generated", payload: { documentId: `doc-acme-seed-${i}`, roundId: "rnd-acme-seed", kind: "safe_doc" } }, aCtx("rnd-acme-seed", ts("2026-02-18")));
    defaultTelemetryStore.recordEvent({ type: "document.sent", payload: { documentId: `doc-acme-seed-${i}`, recipientId: investorIds[i] } }, aCtx("rnd-acme-seed", ts("2026-02-19")));
  }
  defaultTelemetryStore.recordEvent({ type: "round.signing_opened", payload: { roundId: "rnd-acme-seed" } }, aCtx("rnd-acme-seed", ts("2026-02-19")));
  for (let i = 0; i < 6; i++) {
    defaultTelemetryStore.recordEvent({ type: "document.signed", payload: { documentId: `doc-acme-seed-${i}`, signerId: investorIds[i] } }, { ...aCtx("rnd-acme-seed", ts(`2026-02-${21 + i}`)), actorId: investorIds[i], actorRole: "investor" });
    defaultTelemetryStore.recordEvent({ type: "softcircle.signed", payload: { softCircleId: `sc-acme-seed-${i}` } }, { ...aCtx("rnd-acme-seed", ts(`2026-02-${21 + i}`)), actorId: investorIds[i], actorRole: "investor" });
  }
  defaultTelemetryStore.recordEvent({ type: "round.signed", payload: { roundId: "rnd-acme-seed", signedAmount: "1800000" } }, aCtx("rnd-acme-seed", ts("2026-02-27")));

  for (let i = 0; i < 5; i++) {
    defaultTelemetryStore.recordEvent({ type: "softcircle.funded", payload: { softCircleId: `sc-acme-seed-${i}`, amount: "300000" } }, { ...aCtx("rnd-acme-seed", ts(`2026-03-${5 + i}`)) });
  }
  defaultTelemetryStore.recordEvent({ type: "round.funds_received", payload: { roundId: "rnd-acme-seed", amount: "1500000" } }, aCtx("rnd-acme-seed", ts("2026-03-10")));

  defaultTelemetryStore.recordEvent({ type: "reconciliation.run", payload: { runId: "recon-acme-1", companyId: "co-acme", status: "match", durationMs: 142, primaryHash: "a1b2c3d4e5f6", referenceHash: "a1b2c3d4e5f6" } }, aCtx("rnd-acme-seed", ts("2026-03-12"), "admin-platform"));
  defaultTelemetryStore.recordEvent({ type: "signoff.requested", payload: { signoffId: "so-acme-1-f", roundId: "rnd-acme-seed", signerRole: "founder" } }, aCtx("rnd-acme-seed", ts("2026-03-12")));
  defaultTelemetryStore.recordEvent({ type: "signoff.granted", payload: { signoffId: "so-acme-1-f", roundId: "rnd-acme-seed", signerRole: "founder", identityHash: "fhash-avi-001" } }, aCtx("rnd-acme-seed", ts("2026-03-12")));
  defaultTelemetryStore.recordEvent({ type: "signoff.requested", payload: { signoffId: "so-acme-1-a", roundId: "rnd-acme-seed", signerRole: "admin" } }, aCtx("rnd-acme-seed", ts("2026-03-13"), "admin-platform"));
  defaultTelemetryStore.recordEvent({ type: "signoff.granted", payload: { signoffId: "so-acme-1-a", roundId: "rnd-acme-seed", signerRole: "admin", identityHash: "ahash-platform-001" } }, aCtx("rnd-acme-seed", ts("2026-03-13"), "admin-platform"));
  defaultTelemetryStore.recordEvent({ type: "round.closed", payload: { roundId: "rnd-acme-seed", primaryHash: "a1b2c3d4e5f6", referenceHash: "a1b2c3d4e5f6", finalAmount: "1500000" } }, aCtx("rnd-acme-seed", ts("2026-03-13")));
  defaultTelemetryStore.recordEvent({ type: "cap_table.mutated", payload: { beforeHash: "before-acme-1", afterHash: "after-acme-1", reason: "round close: rnd-acme-seed" } }, aCtx("rnd-acme-seed", ts("2026-03-13")));

  // ---- Company B — saas, Series A (CLOSED) ----
  const bCtx = (rid: string, ts0: string, actor = "founder-jamie") => ({
    companyId: "co-fluxform",
    roundId: rid,
    actorId: actor,
    actorRole: actor.startsWith("founder") ? "founder" as const : "admin" as const,
    timestamp: ts0,
    ipAddress: "198.51.100.7",
    location: { city: "New York", region: "NY", country: "US" },
  });
  const bInv = ["inv-a16z", "inv-accel", "inv-benchmark", "inv-greylock", "inv-iconiq", "inv-lightspeed", "inv-menlo"];
  defaultTelemetryStore.recordEvent({ type: "round.created", payload: { roundId: "rnd-flux-A", series: "Series A", targetRaise: "12000000", instrument: "preferred" } }, bCtx("rnd-flux-A", ts("2026-02-01")));
  defaultTelemetryStore.recordEvent({ type: "round.terms_set", payload: { roundId: "rnd-flux-A", preMoney: "55000000", pps: "3.20" } }, bCtx("rnd-flux-A", ts("2026-02-04")));
  for (let i = 0; i < 7; i++) {
    defaultTelemetryStore.recordEvent({ type: "invitation.created", payload: { invitationId: `inv-flux-A-${i}`, roundId: "rnd-flux-A", investorId: bInv[i] } }, bCtx("rnd-flux-A", ts(`2026-02-${5 + i}`)));
  }
  for (let i = 0; i < 6; i++) {
    defaultTelemetryStore.recordEvent({ type: "invitation.viewed", payload: { invitationId: `inv-flux-A-${i}` } }, { ...bCtx("rnd-flux-A", ts(`2026-02-${7 + i}`)), actorId: bInv[i], actorRole: "investor" });
  }
  for (let i = 0; i < 5; i++) {
    defaultTelemetryStore.recordEvent({ type: "invitation.soft_circled", payload: { invitationId: `inv-flux-A-${i}`, amount: "2400000" } }, { ...bCtx("rnd-flux-A", ts(`2026-02-${10 + i}`)), actorId: bInv[i], actorRole: "investor" });
    defaultTelemetryStore.recordEvent({ type: "softcircle.created", payload: { softCircleId: `sc-flux-A-${i}`, roundId: "rnd-flux-A", investorId: bInv[i], amount: "2400000" } }, bCtx("rnd-flux-A", ts(`2026-02-${10 + i}`)));
  }
  for (let i = 0; i < 4; i++) {
    defaultTelemetryStore.recordEvent({ type: "softcircle.signed", payload: { softCircleId: `sc-flux-A-${i}` } }, bCtx("rnd-flux-A", ts(`2026-03-${1 + i}`)));
    defaultTelemetryStore.recordEvent({ type: "softcircle.funded", payload: { softCircleId: `sc-flux-A-${i}`, amount: "2400000" } }, bCtx("rnd-flux-A", ts(`2026-03-${10 + i}`)));
  }
  defaultTelemetryStore.recordEvent({ type: "reconciliation.run", payload: { runId: "recon-flux-1", companyId: "co-fluxform", status: "match", durationMs: 188, primaryHash: "b9c8d7e6f5", referenceHash: "b9c8d7e6f5" } }, bCtx("rnd-flux-A", ts("2026-03-15"), "admin-platform"));
  defaultTelemetryStore.recordEvent({ type: "round.closed", payload: { roundId: "rnd-flux-A", primaryHash: "b9c8d7e6f5", referenceHash: "b9c8d7e6f5", finalAmount: "9600000" } }, bCtx("rnd-flux-A", ts("2026-03-16")));

  // ---- Company C — deeptech, Pre-seed (OPEN) ----
  const cCtx = (rid: string, ts0: string, actor = "founder-priya") => ({
    companyId: "co-helio",
    roundId: rid,
    actorId: actor,
    actorRole: "founder" as const,
    timestamp: ts0,
    ipAddress: "192.0.2.99",
    location: { city: "London", region: "ENG", country: "UK" },
  });
  defaultTelemetryStore.recordEvent({ type: "round.created", payload: { roundId: "rnd-helio-preseed", series: "Pre-Seed", targetRaise: "1500000", instrument: "safe" } }, cCtx("rnd-helio-preseed", ts("2026-04-01")));
  for (let i = 0; i < 8; i++) {
    defaultTelemetryStore.recordEvent({ type: "invitation.created", payload: { invitationId: `inv-helio-${i}`, roundId: "rnd-helio-preseed", investorId: `inv-angel-${i}` } }, cCtx("rnd-helio-preseed", ts(`2026-04-${10 + i}`)));
  }
  for (let i = 0; i < 5; i++) {
    defaultTelemetryStore.recordEvent({ type: "invitation.viewed", payload: { invitationId: `inv-helio-${i}` } }, { ...cCtx("rnd-helio-preseed", ts(`2026-04-${15 + i}`)), actorId: `inv-angel-${i}`, actorRole: "investor" });
  }
  for (let i = 0; i < 3; i++) {
    defaultTelemetryStore.recordEvent({ type: "invitation.soft_circled", payload: { invitationId: `inv-helio-${i}`, amount: "200000" } }, { ...cCtx("rnd-helio-preseed", ts(`2026-04-${20 + i}`)), actorId: `inv-angel-${i}`, actorRole: "investor" });
    defaultTelemetryStore.recordEvent({ type: "softcircle.created", payload: { softCircleId: `sc-helio-${i}`, roundId: "rnd-helio-preseed", investorId: `inv-angel-${i}`, amount: "200000" } }, cCtx("rnd-helio-preseed", ts(`2026-04-${20 + i}`)));
  }

  // Some scattered formula registry + lifecycle events for variety
  defaultTelemetryStore.recordEvent({ type: "formula.published", payload: { formulaId: "safe.postmoney.conversion", version: "1.0.0", region: "US" } }, { companyId: "platform", actorId: "admin-platform", actorRole: "admin", timestamp: ts("2026-01-01") });
  defaultTelemetryStore.recordEvent({ type: "lifecycle_policy.changed", payload: { policy: "softCircleExpiryDays", oldValue: 14, newValue: 21 } }, { companyId: "platform", actorId: "admin-platform", actorRole: "admin", timestamp: ts("2026-01-15") });

  /* ====================================================================
   * Sprint 9 — Communications telemetry seed (32 events)
   *   Demonstrates the full lifecycle of:
   *     - cap-table channel + soft-circle channel creation + member changes
   *     - DM open + DM blocked (anonymous holder)
   *     - message.sent / .starred / .reaction.added
   *     - post.created / .liked / .commented / .shared / .followed
   *     - visibility.unmasked_message (mid-thread opt-in)
   * ==================================================================== */
  const cm = (id: string, t: string, actor = "u_aisha_patel", actorRole: "founder" | "investor" | "admin" = "investor") => ({
    companyId: "co_novapay",
    actorId: actor,
    actorRole,
    timestamp: ts(t),
    ipAddress: actor === "u_maya_chen" ? "203.0.113.10" : "198.51.100.55",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2)",
    location: actor === "u_maya_chen"
      ? { city: "San Francisco", region: "CA", country: "US" }
      : { city: "Toronto", region: "ON", country: "CA" },
  });
  const CT_CH = "captable__co_novapay";
  const SC_CH = "softcircle__rnd_novapay_seed";

  // Cap-table channel — founder + 5 visible holders + 2 anonymous (Avocado, Northstar).
  defaultTelemetryStore.recordEvent({ type: "cap_table_channel.member_added", payload: { channelId: CT_CH, userId: "u_maya_chen", reason: "founder" } }, cm("a01", "2024-09-01", "u_maya_chen", "founder"));
  defaultTelemetryStore.recordEvent({ type: "cap_table_channel.member_added", payload: { channelId: CT_CH, userId: "u_daniel_okafor", reason: "founder" } }, cm("a02", "2024-09-01", "u_maya_chen", "founder"));
  defaultTelemetryStore.recordEvent({ type: "cap_table_channel.member_added", payload: { channelId: CT_CH, userId: "u_forge_ventures", reason: "issuance" } }, cm("a03", "2024-09-01", "u_maya_chen", "founder"));
  defaultTelemetryStore.recordEvent({ type: "cap_table_channel.member_added", payload: { channelId: CT_CH, userId: "u_avocado_angels", reason: "issuance" } }, cm("a04", "2024-09-01", "u_maya_chen", "founder"));
  defaultTelemetryStore.recordEvent({ type: "cap_table_channel.member_added", payload: { channelId: CT_CH, userId: "u_hydra_capital", reason: "issuance" } }, cm("a05", "2025-01-15", "u_maya_chen", "founder"));
  defaultTelemetryStore.recordEvent({ type: "cap_table_channel.member_added", payload: { channelId: CT_CH, userId: "u_northstar_angels", reason: "issuance" } }, cm("a06", "2024-11-01", "u_maya_chen", "founder"));
  defaultTelemetryStore.recordEvent({ type: "cap_table_channel.member_added", payload: { channelId: CT_CH, userId: "u_aisha_patel", reason: "issuance" } }, cm("a07", "2026-04-25", "u_maya_chen", "founder"));

  // Soft-circle channel created + members added.
  defaultTelemetryStore.recordEvent({ type: "soft_circle_channel.created", payload: { channelId: SC_CH, roundId: "rnd_novapay_seed" } }, cm("a10", "2026-04-19", "u_maya_chen", "founder"));
  defaultTelemetryStore.recordEvent({ type: "soft_circle_channel.member_added", payload: { channelId: SC_CH, userId: "u_maya_chen", role: "founder" } }, cm("a11", "2026-04-19", "u_maya_chen", "founder"));
  defaultTelemetryStore.recordEvent({ type: "soft_circle_channel.member_added", payload: { channelId: SC_CH, userId: "u_hydra_capital", role: "soft_circler" } }, cm("a12", "2026-04-19", "u_hydra_capital", "investor"));
  defaultTelemetryStore.recordEvent({ type: "soft_circle_channel.member_added", payload: { channelId: SC_CH, userId: "u_forge_ventures", role: "soft_circler" } }, cm("a13", "2026-04-25", "u_forge_ventures", "investor"));
  defaultTelemetryStore.recordEvent({ type: "soft_circle_channel.member_added", payload: { channelId: SC_CH, userId: "u_bluepoint_angels", role: "soft_circler" } }, cm("a14", "2026-05-04", "u_bluepoint_angels", "investor"));

  // Messages sent in cap-table + soft-circle channels (5).
  defaultTelemetryStore.recordEvent({ type: "message.sent", payload: { messageId: "msg_ct_1", channelId: CT_CH, channelKind: "cap_table", authorUserId: "u_maya_chen", recipientCount: 6 } }, cm("a20", "2024-09-02", "u_maya_chen", "founder"));
  defaultTelemetryStore.recordEvent({ type: "message.sent", payload: { messageId: "msg_ct_5", channelId: CT_CH, channelKind: "cap_table", authorUserId: "u_aisha_patel", recipientCount: 6 } }, cm("a21", "2026-05-08"));
  defaultTelemetryStore.recordEvent({ type: "message.sent", payload: { messageId: "msg_sc_1", channelId: SC_CH, channelKind: "soft_circle", authorUserId: "u_maya_chen", recipientCount: 3 } }, cm("a22", "2026-04-19", "u_maya_chen", "founder"));
  defaultTelemetryStore.recordEvent({ type: "message.starred", payload: { messageId: "msg_ct_1", channelId: CT_CH, userId: "u_aisha_patel" } }, cm("a23", "2024-09-02"));
  defaultTelemetryStore.recordEvent({ type: "message.reaction.added", payload: { messageId: "msg_sc_1", channelId: SC_CH, userId: "u_hydra_capital", emoji: "\uD83D\uDE80" } }, cm("a24", "2026-04-19", "u_hydra_capital", "investor"));

  // DMs (open + blocked).
  defaultTelemetryStore.recordEvent({ type: "dm.channel.opened", payload: { channelId: "dm__u_aisha_patel__u_maya_chen", fromUserId: "u_maya_chen", toUserId: "u_aisha_patel", sharedContext: { capTables: ["co_novapay"], chapters: [] } } }, cm("a30", "2026-04-25", "u_maya_chen", "founder"));
  defaultTelemetryStore.recordEvent({ type: "dm.channel.opened", payload: { channelId: "dm__u_aisha_patel__u_hydra_capital", fromUserId: "u_hydra_capital", toUserId: "u_aisha_patel", sharedContext: { capTables: ["co_novapay"], chapters: ["chap_toronto"] } } }, cm("a31", "2026-04-19", "u_hydra_capital", "investor"));
  defaultTelemetryStore.recordEvent({ type: "dm.channel.blocked", payload: { fromUserId: "u_aisha_patel", toUserId: "u_avocado_angels", reason: "no_visibility" } }, cm("a32", "2026-05-08"));

  // Visibility unmasked (mid-thread opt-in).
  defaultTelemetryStore.recordEvent({ type: "visibility.unmasked_message", payload: { userId: "u_avocado_angels", channelId: CT_CH, previousLabel: "[Anonymous Holder]", newLabel: "AvocadoAngels" } }, cm("a33", "2026-05-08", "u_avocado_angels", "investor"));

  // Posts — founder posts + investor posts + likes + comments + share + follow.
  defaultTelemetryStore.recordEvent({ type: "post.created", payload: { postId: "post_n_1", channelId: "network__u_maya_chen", authorUserId: "u_maya_chen", authorKind: "user", visibility: "network" } }, cm("a40", "2026-05-08", "u_maya_chen", "founder"));
  defaultTelemetryStore.recordEvent({ type: "post.created", payload: { postId: "post_f_1", channelId: "followers__co_novapay", authorUserId: "u_maya_chen", authorKind: "company", companyId: "co_novapay", visibility: "followers" } }, cm("a41", "2026-04-12", "u_maya_chen", "founder"));
  defaultTelemetryStore.recordEvent({ type: "post.liked", payload: { postId: "post_n_1", userId: "u_aisha_patel" } }, cm("a42", "2026-05-08"));
  defaultTelemetryStore.recordEvent({ type: "post.commented", payload: { postId: "post_n_1", userId: "u_aisha_patel", commentId: "c_2" } }, cm("a43", "2026-05-08"));
  defaultTelemetryStore.recordEvent({ type: "post.shared", payload: { postId: "post_f_3", userId: "u_aisha_patel" } }, cm("a44", "2026-04-25"));
  defaultTelemetryStore.recordEvent({ type: "post.followed", payload: { postId: "post_f_2", userId: "u_aisha_patel", companyId: "co_novapay" } }, cm("a45", "2026-04-18"));
}
