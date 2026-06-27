import { describe, it, expect } from "vitest";
import {
  resolveDisplayIdentity,
  resolveDisplayIdentitiesForList,
  makeResolverFor,
  ANONYMOUS_LABEL,
} from "../visibility";
import type { Visibility } from "../types";

const VIS_OFF: Visibility = { visibleToCoMembers: false, visibleToCollectiveNetwork: false };
const VIS_CO_OPTED: Visibility = { screenName: "HydraCap", visibleToCoMembers: true, visibleToCollectiveNetwork: false };
const VIS_COLL_OPTED: Visibility = { screenName: "GlobalAngel", visibleToCoMembers: false, visibleToCollectiveNetwork: true };
const VIS_BOTH_NO_NAME: Visibility = { visibleToCoMembers: true, visibleToCollectiveNetwork: true };
const VIS_NAME_NO_OPT: Visibility = { screenName: "Greenwood", visibleToCoMembers: false, visibleToCollectiveNetwork: false };

describe("Sprint 9 — resolveDisplayIdentity (R200.gating §6 visibility model)", () => {
  it("self-view always returns the real legal name", () => {
    const r = resolveDisplayIdentity({
      viewerUserId: "u1", authorUserId: "u1", authorLegalName: "Alice", authorVisibility: VIS_OFF,
      context: { sharedCapTables: [], sharedCollectiveChapters: [] },
    });
    expect(r.displayName).toBe("Alice");
    expect(r.isAnonymous).toBe(false);
    expect(r.canSendDm).toBe(false); // can't DM yourself
    expect(r.reason).toBe("self");
  });

  it("founder pass-through always shows real name + canSendDm=true", () => {
    const r = resolveDisplayIdentity({
      viewerUserId: "u_investor", authorUserId: "u_founder",
      authorLegalName: "Maya Chen", authorVisibility: VIS_OFF,
      context: { sharedCapTables: ["co_x"], sharedCollectiveChapters: [], founderUserId: "u_founder" },
    });
    expect(r.displayName).toBe("Maya Chen");
    expect(r.isAnonymous).toBe(false);
    expect(r.canSendDm).toBe(true);
    expect(r.reason).toBe("founder_passthrough");
  });

  it("opt-in co-member with shared cap table → screen name + canSendDm", () => {
    const r = resolveDisplayIdentity({
      viewerUserId: "u_investor", authorUserId: "u_hydra",
      authorLegalName: "Hydra Capital", authorVisibility: VIS_CO_OPTED,
      context: { sharedCapTables: ["co_novapay"], sharedCollectiveChapters: [] },
    });
    expect(r.displayName).toBe("HydraCap");
    expect(r.isAnonymous).toBe(false);
    expect(r.canSendDm).toBe(true);
    expect(r.reason).toBe("co_member_visible");
  });

  it("opt-in co-member with NO shared cap table → anonymous fallback", () => {
    const r = resolveDisplayIdentity({
      viewerUserId: "u_investor", authorUserId: "u_hydra",
      authorLegalName: "Hydra Capital", authorVisibility: VIS_CO_OPTED,
      context: { sharedCapTables: [], sharedCollectiveChapters: [] },
    });
    expect(r.displayName).toBe(ANONYMOUS_LABEL);
    expect(r.isAnonymous).toBe(true);
    expect(r.canSendDm).toBe(false);
  });

  it("collective-only opt-in with shared chapter → screen name", () => {
    const r = resolveDisplayIdentity({
      viewerUserId: "u_a", authorUserId: "u_b",
      authorLegalName: "Bob", authorVisibility: VIS_COLL_OPTED,
      context: { sharedCapTables: [], sharedCollectiveChapters: ["chap_sf"] },
    });
    expect(r.displayName).toBe("GlobalAngel");
    expect(r.canSendDm).toBe(true);
    expect(r.reason).toBe("collective_visible");
  });

  it("collective-only opt-in WITHOUT shared chapter → anonymous", () => {
    const r = resolveDisplayIdentity({
      viewerUserId: "u_a", authorUserId: "u_b",
      authorLegalName: "Bob", authorVisibility: VIS_COLL_OPTED,
      context: { sharedCapTables: ["co_x"], sharedCollectiveChapters: [] },
    });
    expect(r.displayName).toBe(ANONYMOUS_LABEL);
    expect(r.isAnonymous).toBe(true);
    expect(r.canSendDm).toBe(false);
  });

  it("opt-in but NO screen name set → anonymous (consent without name)", () => {
    const r = resolveDisplayIdentity({
      viewerUserId: "u_a", authorUserId: "u_b",
      authorLegalName: "Bob", authorVisibility: VIS_BOTH_NO_NAME,
      context: { sharedCapTables: ["co_x"], sharedCollectiveChapters: ["chap_sf"] },
    });
    expect(r.displayName).toBe(ANONYMOUS_LABEL);
    expect(r.isAnonymous).toBe(true);
    expect(r.canSendDm).toBe(false);
  });

  it("screen name set but neither toggle on → anonymous", () => {
    const r = resolveDisplayIdentity({
      viewerUserId: "u_a", authorUserId: "u_b",
      authorLegalName: "Bob", authorVisibility: VIS_NAME_NO_OPT,
      context: { sharedCapTables: ["co_x"], sharedCollectiveChapters: ["chap_sf"] },
    });
    expect(r.displayName).toBe(ANONYMOUS_LABEL);
    expect(r.canSendDm).toBe(false);
    expect(r.reason).toBe("anonymous");
  });

  it("default (everything off, no shared context) → anonymous + cannot DM", () => {
    const r = resolveDisplayIdentity({
      viewerUserId: "u_a", authorUserId: "u_b",
      authorLegalName: "Bob", authorVisibility: VIS_OFF,
      context: { sharedCapTables: [], sharedCollectiveChapters: [] },
    });
    expect(r.displayName).toBe(ANONYMOUS_LABEL);
    expect(r.canSendDm).toBe(false);
    expect(r.reason).toBe("anonymous");
  });

  it("founder pass-through wins over anonymous fallback even with no shared cap table", () => {
    const r = resolveDisplayIdentity({
      viewerUserId: "u_investor", authorUserId: "u_founder",
      authorLegalName: "Maya Chen", authorVisibility: VIS_OFF,
      context: { sharedCapTables: [], sharedCollectiveChapters: [], founderUserId: "u_founder" },
    });
    expect(r.displayName).toBe("Maya Chen");
    expect(r.reason).toBe("founder_passthrough");
  });

  it("self-view wins over founder pass-through", () => {
    const r = resolveDisplayIdentity({
      viewerUserId: "u_founder", authorUserId: "u_founder",
      authorLegalName: "Maya Chen", authorVisibility: VIS_OFF,
      context: { sharedCapTables: ["co_x"], sharedCollectiveChapters: [], founderUserId: "u_founder" },
    });
    expect(r.reason).toBe("self");
    expect(r.canSendDm).toBe(false); // can't DM yourself
  });

  it("empty trimmed screen name does not unmask", () => {
    const r = resolveDisplayIdentity({
      viewerUserId: "u_a", authorUserId: "u_b",
      authorLegalName: "Bob", authorVisibility: { screenName: "   ", visibleToCoMembers: true, visibleToCollectiveNetwork: false },
      context: { sharedCapTables: ["co_x"], sharedCollectiveChapters: [] },
    });
    expect(r.displayName).toBe(ANONYMOUS_LABEL);
  });

  it("resolveDisplayIdentitiesForList resolves a batch", () => {
    const result = resolveDisplayIdentitiesForList(
      [
        { authorUserId: "u_self", authorLegalName: "Aisha", authorVisibility: VIS_CO_OPTED, context: { sharedCapTables: ["co_x"], sharedCollectiveChapters: [] } },
        { authorUserId: "u_anon", authorLegalName: "Anonymous Inc", authorVisibility: VIS_OFF, context: { sharedCapTables: ["co_x"], sharedCollectiveChapters: [] } },
        { authorUserId: "u_visible", authorLegalName: "Hydra", authorVisibility: VIS_CO_OPTED, context: { sharedCapTables: ["co_x"], sharedCollectiveChapters: [] } },
      ],
      "u_self",
    );
    expect(result.get("u_self")?.displayName).toBe("Aisha"); // self
    expect(result.get("u_anon")?.displayName).toBe(ANONYMOUS_LABEL);
    expect(result.get("u_visible")?.displayName).toBe("HydraCap");
  });

  it("makeResolverFor returns a curried resolver", () => {
    const r = makeResolverFor("u_a", { sharedCapTables: ["co_x"], sharedCollectiveChapters: [] });
    const visible = r("u_b", "Bob", VIS_CO_OPTED);
    expect(visible.displayName).toBe("HydraCap");
    const hidden = r("u_c", "Carol", VIS_OFF);
    expect(hidden.displayName).toBe(ANONYMOUS_LABEL);
  });

  it("anonymous result NEVER allows DM, even if other rules might allow it elsewhere", () => {
    const r = resolveDisplayIdentity({
      viewerUserId: "u_a", authorUserId: "u_b",
      authorLegalName: "Bob", authorVisibility: VIS_OFF,
      context: { sharedCapTables: ["co_x"], sharedCollectiveChapters: ["chap_sf"] },
    });
    expect(r.canSendDm).toBe(false);
  });

  it("co-member rule has priority over collective rule (cap-table is preferred surface)", () => {
    // Both rules would match — co_member should win because it's listed first.
    const r = resolveDisplayIdentity({
      viewerUserId: "u_a", authorUserId: "u_b",
      authorLegalName: "Bob",
      authorVisibility: { screenName: "Both", visibleToCoMembers: true, visibleToCollectiveNetwork: true },
      context: { sharedCapTables: ["co_x"], sharedCollectiveChapters: ["chap_sf"] },
    });
    expect(r.reason).toBe("co_member_visible");
  });
});
