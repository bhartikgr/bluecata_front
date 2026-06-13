import { describe, it, expect } from "vitest";
import {
  DEFAULT_VISIBILITY,
  validateScreenName,
  resolveCoMemberLabel,
  canMessage,
  applyVisibilityUpdate,
  SCREEN_NAME_MIN,
  SCREEN_NAME_MAX,
} from "../src/visibility";

describe("privacy / visibility (Sprint 7 / R200.gating §6)", () => {
  it("default visibility is privacy-by-default", () => {
    expect(DEFAULT_VISIBILITY.screenNameSet).toBe(false);
    expect(DEFAULT_VISIBILITY.visibleToCoMembers).toBe(false);
    expect(DEFAULT_VISIBILITY.visibleToCollectiveNetwork).toBe(false);
    expect(DEFAULT_VISIBILITY.screenName).toBe("");
  });

  it("screen-name length boundaries", () => {
    expect(SCREEN_NAME_MIN).toBe(3);
    expect(SCREEN_NAME_MAX).toBe(30);
    expect(validateScreenName("ab")).toEqual({ ok: false, reason: "too_short" });
    expect(validateScreenName("a".repeat(SCREEN_NAME_MAX + 1))).toEqual({ ok: false, reason: "too_long" });
  });

  it("rejects names with disallowed characters", () => {
    expect(validateScreenName("with spaces")).toEqual({ ok: false, reason: "invalid_chars" });
    expect(validateScreenName("at@sign")).toEqual({ ok: false, reason: "invalid_chars" });
    expect(validateScreenName("has.dot")).toEqual({ ok: false, reason: "invalid_chars" });
  });

  it("accepts alphanumeric + underscore + dash", () => {
    expect(validateScreenName("maya_chen")).toEqual({ ok: true });
    expect(validateScreenName("GreenwoodCap")).toEqual({ ok: true });
    expect(validateScreenName("a-b-c")).toEqual({ ok: true });
  });

  it("flags case-insensitive uniqueness collisions", () => {
    const existing = ["maya_chen", "GreenwoodCap"];
    expect(validateScreenName("Maya_Chen", existing)).toEqual({ ok: false, reason: "taken" });
    expect(validateScreenName("greenwoodcap", existing)).toEqual({ ok: false, reason: "taken" });
    expect(validateScreenName("aisha-vc", existing)).toEqual({ ok: true });
  });

  it("self-view always shows legal name", () => {
    const label = resolveCoMemberLabel(
      { id: "u1", legalName: "Hydra", visibility: { ...DEFAULT_VISIBILITY } },
      { id: "u1" },
    );
    expect(label).toBe("Hydra");
  });

  it("opt-out yields '[Anonymous Holder]'", () => {
    const label = resolveCoMemberLabel(
      { id: "u1", legalName: "Hydra", visibility: { ...DEFAULT_VISIBILITY } },
      { id: "u2" },
    );
    expect(label).toBe("[Anonymous Holder]");
  });

  it("opt-in without screen name still yields anonymous", () => {
    const label = resolveCoMemberLabel(
      { id: "u1", legalName: "Hydra", visibility: { ...DEFAULT_VISIBILITY, visibleToCoMembers: true } },
      { id: "u2" },
    );
    expect(label).toBe("[Anonymous Holder]");
  });

  it("opt-in with screen name yields the screen name", () => {
    const label = resolveCoMemberLabel(
      {
        id: "u1",
        legalName: "Hydra",
        visibility: {
          screenName: "hydra_vc",
          screenNameSet: true,
          visibleToCoMembers: true,
          visibleToCollectiveNetwork: false,
        },
      },
      { id: "u2" },
    );
    expect(label).toBe("hydra_vc");
  });

  it("canMessage requires both sides opted in on the cap-table path", () => {
    const off = { ...DEFAULT_VISIBILITY };
    const on = { ...DEFAULT_VISIBILITY, visibleToCoMembers: true };
    expect(canMessage(off, off, { capTable: true, collectiveSurface: true })).toBe(false);
    expect(canMessage(on, off, { capTable: true, collectiveSurface: false })).toBe(false);
    expect(canMessage(on, on, { capTable: true, collectiveSurface: false })).toBe(true);
  });

  it("Collective network path is independent of cap-table path", () => {
    const onNet = { ...DEFAULT_VISIBILITY, visibleToCollectiveNetwork: true };
    expect(canMessage(onNet, onNet, { capTable: false, collectiveSurface: true })).toBe(true);
    expect(canMessage(onNet, onNet, { capTable: false, collectiveSurface: false })).toBe(false);
  });

  it("applyVisibilityUpdate derives screenNameSet from screenName", () => {
    const a = applyVisibilityUpdate(DEFAULT_VISIBILITY, { screenName: "maya_chen" });
    expect(a.screenNameSet).toBe(true);
    const b = applyVisibilityUpdate(a, { screenName: "" });
    expect(b.screenNameSet).toBe(false);
  });

  it("applyVisibilityUpdate flips toggles independently of the screen name", () => {
    const next = applyVisibilityUpdate(DEFAULT_VISIBILITY, {
      visibleToCoMembers: true,
    });
    expect(next.visibleToCoMembers).toBe(true);
    expect(next.screenName).toBe(""); // unchanged
    expect(next.screenNameSet).toBe(false); // not auto-flipped
  });

  it("applyVisibilityUpdate ignores whitespace-only screen names", () => {
    const next = applyVisibilityUpdate(DEFAULT_VISIBILITY, { screenName: "   " });
    expect(next.screenNameSet).toBe(false);
  });

  it("resolveCoMemberLabel never leaks legal name to a different viewer", () => {
    // Even if the holder has visibleToCoMembers=true but no screen name,
    // the legal name must never appear in another viewer's frame.
    const holder = {
      id: "u1",
      legalName: "Hydra Capital Partners II, L.P.",
      visibility: { ...DEFAULT_VISIBILITY, visibleToCoMembers: true },
    };
    const label = resolveCoMemberLabel(holder, { id: "u2" });
    expect(label).not.toContain("Hydra Capital");
  });

  it("canMessage allows EITHER cap-table OR collective path independently", () => {
    const dual = {
      ...DEFAULT_VISIBILITY,
      visibleToCoMembers: true,
      visibleToCollectiveNetwork: true,
    };
    expect(canMessage(dual, dual, { capTable: true, collectiveSurface: false })).toBe(true);
    expect(canMessage(dual, dual, { capTable: false, collectiveSurface: true })).toBe(true);
    expect(canMessage(dual, dual, { capTable: false, collectiveSurface: false })).toBe(false);
  });
});
