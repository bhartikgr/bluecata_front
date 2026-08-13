/**
 * WAVE 38 · ROW 5 — the expiry banner renders only from a real server timestamp.
 *
 * `SoftCircleExpiryBanner` shipped with ZERO call sites outside release zips.
 * It is now mounted on the investor Invitation-detail decision tab. The open
 * question was where the timestamp comes from: the obvious candidate,
 * `mySig.signature.timestamp`, is client zustand — in-memory, which the owner's
 * standing rule forbids everywhere. The banner is instead fed the server
 * decision record's derived `softCircledAt`.
 *
 * A banner is only worth mounting if it is HONEST, so this file asserts the
 * refusal poles as hard as the happy pole:
 *
 *   POLE A — a real server timestamp renders the countdown and the verbatim copy.
 *   POLE B — `null` / `undefined` (server could not supply one) renders NOTHING.
 *            "Show an approximate date" is the failure mode being prevented.
 *   POLE C — an unparseable timestamp renders NOTHING, not `NaN days`.
 *   POLE D — an already-expired timestamp renders NOTHING (the runner owns that).
 *
 * Plus a STRUCTURAL assertion that the page mount exists and is not wired to
 * the in-memory value — read off the real page source, so deleting the mount
 * fails this file rather than passing silently.
 *
 * Static imports; no `process.env` read decides anything.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { SoftCircleExpiryBanner } from "../SoftCircleExpiryBanner";
import { SOFT_CIRCLE_EXPIRY_DAYS } from "@shared/softCircleExpiry";

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDaysAgo = (d: number) => new Date(Date.now() - d * DAY_MS).toISOString();

const PAGE = path.resolve(
  __dirname,
  "../../pages/investor/InvitationDetail.tsx",
);

afterEach(() => cleanup());

describe("Wave 38 · Row 5 — SoftCircleExpiryBanner render poles", () => {
  it("POLE A — renders the countdown and verbatim copy from a server timestamp", () => {
    render(<SoftCircleExpiryBanner softCircledAtIso={isoDaysAgo(2)} readOnly />);
    const el = screen.getByTestId("soft-circle-expiry-banner");
    expect(el).toBeTruthy();
    expect(el.getAttribute("data-days-left")).toBe(String(SOFT_CIRCLE_EXPIRY_DAYS - 2));
    expect(screen.getByTestId("text-expiry-copy").textContent).toBe(
      "Your soft-circle expires in 12 days — confirm or release",
    );
    // Singular pole, in the same render path.
    cleanup();
    render(<SoftCircleExpiryBanner softCircledAtIso={isoDaysAgo(13.2)} readOnly />);
    expect(screen.getByTestId("text-expiry-copy").textContent).toBe(
      "Your soft-circle expires in 1 day — confirm or release",
    );
  });

  it("POLE B — renders NOTHING when the server supplies no timestamp", () => {
    const { container } = render(<SoftCircleExpiryBanner softCircledAtIso={null} readOnly />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("soft-circle-expiry-banner")).toBeNull();
    cleanup();
    const u = render(<SoftCircleExpiryBanner softCircledAtIso={undefined} readOnly />);
    expect(u.container.innerHTML).toBe("");
  });

  it("POLE C — renders NOTHING for an unparseable timestamp (never 'NaN days')", () => {
    const { container } = render(
      <SoftCircleExpiryBanner softCircledAtIso={"not-a-date"} readOnly />,
    );
    expect(container.innerHTML).toBe("");
    expect(container.textContent ?? "").not.toContain("NaN");
  });

  it("POLE D — renders NOTHING once the soft-circle has already lapsed", () => {
    const { container } = render(
      <SoftCircleExpiryBanner softCircledAtIso={isoDaysAgo(SOFT_CIRCLE_EXPIRY_DAYS + 1)} readOnly />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows the action buttons only when handlers are supplied and readOnly is off", () => {
    const { rerender } = render(
      <SoftCircleExpiryBanner softCircledAtIso={isoDaysAgo(1)} readOnly />,
    );
    expect(screen.queryByTestId("button-expiry-confirm")).toBeNull();
    rerender(
      <SoftCircleExpiryBanner
        softCircledAtIso={isoDaysAgo(1)}
        onConfirm={() => {}}
        onRelease={() => {}}
      />,
    );
    expect(screen.getByTestId("button-expiry-confirm")).toBeTruthy();
    expect(screen.getByTestId("button-expiry-release")).toBeTruthy();
  });
});

describe("Wave 38 · Row 5 — the mount exists and is DB-driven", () => {
  const src = fs.readFileSync(PAGE, "utf8");

  it("InvitationDetail imports and renders the banner", () => {
    expect(src).toContain('import { SoftCircleExpiryBanner } from "@/components/SoftCircleExpiryBanner";');
    expect(src).toContain("<SoftCircleExpiryBanner");
    // Anti-vacuity: the file really is the investor invitation-detail page.
    expect(src).toContain('data-testid="card-softcircle-recorded"');
  });

  it("the mount is fed the server-derived timestamp, never the zustand signature", () => {
    const mount = src.slice(src.indexOf("<SoftCircleExpiryBanner"));
    const props = mount.slice(0, mount.indexOf("/>"));
    expect(props).toContain("softCircledAtIso={decision?.softCircledAt ?? null}");
    expect(props).not.toContain("mySig");
    expect(props).not.toContain("Date.now");
    expect(props).not.toContain("new Date(");
  });

  it("the dead `.record` unwrap is gone — the GET shape is read correctly", () => {
    // GET …/decision answers with the record itself; only PATCH wraps it.
    // Every `decisionRecord.data?.record?.state` read was permanently undefined.
    expect(src).not.toContain("decisionRecord.data?.record?.state");
    expect(src).toContain("decision?.state");
  });
});
