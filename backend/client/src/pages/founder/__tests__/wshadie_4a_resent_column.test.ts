/**
 * W-SHADIE 4a — the invitations table gets a dedicated dated "Resent" column
 * between Sent and Viewed.
 *
 * `resentAt` was already returned by the API (roundInvitationsStore publicView)
 * and typed on the client Invitation, so this is display-only — no server
 * change. Previously a resent invite showed only a teal chip in State, with no
 * date anywhere.
 *
 * ANTI-VACUITY: containment alone would pass if the column were appended at the
 * END of the table. Both the header AND the cell row are asserted by ORDINAL
 * POSITION, because a header/cell order mismatch is the actual failure mode a
 * header-only test misses.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "../RoundDetail.tsx"), "utf8");

/** Narrow to the invitations table so ordinals cannot match another table. */
function invitationsTable(): string {
  const start = SRC.indexOf('data-testid="table-invitations"');
  expect(start, "invitations table not found").toBeGreaterThan(-1);
  const end = SRC.indexOf("</table>", start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("W-SHADIE 4a — Resent column position", () => {
  it("header places Resent BETWEEN Sent and Viewed", () => {
    const t = invitationsTable();
    const sent = t.indexOf(">Sent<");
    const resent = t.indexOf(">Resent<");
    const viewed = t.indexOf(">Viewed<");
    expect(sent, "Sent header missing").toBeGreaterThan(-1);
    expect(resent, "Resent header missing").toBeGreaterThan(-1);
    expect(viewed, "Viewed header missing").toBeGreaterThan(-1);
    expect(resent).toBeGreaterThan(sent);
    expect(resent).toBeLessThan(viewed);
  });

  it("cell row places inv-resent BETWEEN inv-sent and inv-viewed", () => {
    const t = invitationsTable();
    const sent = t.indexOf("inv-sent-");
    const resent = t.indexOf("inv-resent-");
    const viewed = t.indexOf("inv-viewed-");
    const expires = t.indexOf("inv-expires-");
    expect(sent, "inv-sent- cell missing").toBeGreaterThan(-1);
    expect(resent, "inv-resent- cell missing").toBeGreaterThan(-1);
    expect(viewed, "inv-viewed- cell missing").toBeGreaterThan(-1);
    expect(sent).toBeLessThan(resent);
    expect(resent).toBeLessThan(viewed);
    expect(viewed).toBeLessThan(expires);
  });

  it("header order and cell order AGREE", () => {
    const t = invitationsTable();
    const headers = ["Sent", "Resent", "Viewed"].map((h) => t.indexOf(`>${h}<`));
    const cells = ["inv-sent-", "inv-resent-", "inv-viewed-"].map((c) => t.indexOf(c));
    const rank = (a: number[]) => a.map((_, i) => i).sort((x, y) => a[x] - a[y]);
    expect(rank(headers)).toEqual(rank(cells));
  });
});

describe("W-SHADIE 4a — Resent cell rendering", () => {
  it("renders resentAt with the same fmtDate + timeAgo pattern as Sent", () => {
    const t = invitationsTable();
    const idx = t.indexOf("inv-resent-");
    const cell = t.slice(t.lastIndexOf("<td", idx), t.indexOf("</td>", idx) + 5);
    expect(cell).toContain("i.resentAt");
    expect(cell).toContain("fmtDate(i.resentAt)");
    expect(cell).toContain("timeAgo(i.resentAt)");
    expect(cell).toContain('"—"');
  });

  it("keeps the teal resent StateBadge chip (additive, not a replacement)", () => {
    expect(SRC).toContain('i.state === "sent" && i.resentAt ? "resent" : i.state');
  });
});

describe("W-SHADIE 4a — column count", () => {
  it("bumps the invitations empty-state colSpan to 7", () => {
    const t = invitationsTable();
    const idx = t.indexOf('data-testid="empty-invitations"');
    expect(idx).toBeGreaterThan(-1);
    const cell = t.slice(t.lastIndexOf("<td", idx), idx);
    expect(cell).toContain("colSpan={7}");
  });

  it("leaves the OTHER tables' colSpans alone", () => {
    // Soft-circles table (5) and the 3-wide spacer row are different tables.
    expect(SRC).toContain("colSpan={5}");
    expect(SRC).toContain("colSpan={3}");
  });

  it("header column count matches the bumped colSpan", () => {
    const t = invitationsTable();
    const head = t.slice(t.indexOf("<thead"), t.indexOf("</thead>"));
    // Note the trailing space: "<thead" would otherwise be counted as a <th>.
    expect(head.split("<th ").length - 1).toBe(7);
  });
});
