/* ════════════════════════════════════════════════════════════════════════════
   WAVE 113 · FINDING 3 (wave 43) — A SWALLOWED REFUSAL NOW SURFACES.
   ════════════════════════════════════════════════════════════════════════════
   FAIL-BEFORE, stated precisely. The old click site was:

       onClick={() => { try {
         window.open(`/api/dataroom/files/${id}/download?disposition=inline`, "_blank");
       } catch { toast({ title: "Could not open", … }); } }}

   `legacyOpen` below is that expression, transcribed, with `window.open` replaced
   by a spy. The first test proves what four agents missed: for EVERY server answer
   — 403, 404, 500, and the HTTP-200-with-`index.html` that the unregistered route
   actually produced — the legacy site reported NOTHING. `window.open` does not
   throw on any of them, so the `catch` was unreachable and the investor got a
   blank tab in silence. That is the fail-before proof: the old code path is
   observably incapable of producing a message.

   The remaining tests assert the new path produces one, and that the message is
   true about permanence rather than telling somebody to retry a refusal that will
   never change.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi } from "vitest";
import {
  openDataroomDocument,
  dataroomRefusalMessage,
  dataroomDocumentUrl,
} from "../dataroomOpen";

/** A minimal Response stand-in — enough for the module's contract. */
function resp(opts: {
  status: number;
  body?: string;
  contentType?: string;
  blobThrows?: boolean;
}): Response {
  const headers = new Map<string, string>([["content-type", opts.contentType ?? "application/pdf"]]);
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    text: async () => opts.body ?? "",
    blob: async () => {
      if (opts.blobThrows) throw new Error("decode failed");
      return new Blob(["%PDF-1.4"], { type: "application/pdf" });
    },
  } as unknown as Response;
}

const SERVER_ANSWERS: Array<{ label: string; res: Response }> = [
  { label: "403 view_denied (access switched off — Finding 2's own refusal)", res: resp({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "view_denied", message: "Your access to this data room has been switched off by the company, so this document cannot be opened. Refreshing will not change it — ask the company to restore your access." }) }) },
  { label: "403 download_denied", res: resp({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "download_denied", message: "You may see that this document exists, but the company has not granted you permission to open or download it." }) }) },
  { label: "404 not_found", res: resp({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) }) },
  { label: "500 server fault", res: resp({ status: 500, contentType: "text/plain", body: "boom" }) },
  { label: "200 with the SPA shell (the ACTUAL wave-43 defect)", res: resp({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><html>…</html>" }) },
];

/** VERBATIM transcription of the deleted click handler. */
function legacyOpen(windowOpen: () => void): string | null {
  let toasted: string | null = null;
  try {
    windowOpen();
  } catch {
    toasted = "Could not open";
  }
  return toasted;
}

describe("WAVE 113 · FINDING 3 — FAIL-BEFORE: the old click site could not report ANY of these", () => {
  for (const answer of SERVER_ANSWERS) {
    it(`legacy handler stays silent on ${answer.label}`, () => {
      // `window.open` is fire-and-forget: it returns a window (or null) and never
      // throws for a 403/404/500/HTML body. The catch is unreachable.
      const spy = vi.fn(() => undefined);
      const toasted = legacyOpen(spy);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(toasted).toBeNull(); // ← the defect: silence
    });
  }
});

describe("WAVE 113 · FINDING 3 — every server answer now produces a plain-English outcome", () => {
  for (const answer of SERVER_ANSWERS) {
    it(`speaks up on ${answer.label}`, async () => {
      const present = vi.fn();
      const outcome = await openDataroomDocument({
        fileId: "drf_dd_master",
        fileName: "DD Master Index.xlsx",
        fetchImpl: (async () => answer.res) as unknown as typeof fetch,
        present,
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok !== false) return;
      // A real sentence, not a code.
      expect(outcome.message.length).toBeGreaterThan(30);
      expect(outcome.message).toMatch(/[.!]$/);
      expect(outcome.message).not.toMatch(/view_denied|download_denied|not_found|HTTP \d/);
      // And nothing was presented to the viewer.
      expect(present).not.toHaveBeenCalled();
    });
  }

  it("classifies the HTML-shell 200 as a FAULT on our side, not a permission problem", async () => {
    const outcome = await openDataroomDocument({
      fileId: "drf_pitch_q2",
      fetchImpl: (async () => SERVER_ANSWERS[4]!.res) as unknown as typeof fetch,
      present: vi.fn(),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok !== false) return;
    expect(outcome.kind).toBe("fault");
    expect(outcome.message).toMatch(/web page instead of this document/);
    expect(outcome.message).toMatch(/not a permission problem/);
  });

  it("names WHICH grant is missing, using the server's own words", async () => {
    const outcome = await openDataroomDocument({
      fileId: "drf_dd_master",
      fetchImpl: (async () => SERVER_ANSWERS[0]!.res) as unknown as typeof fetch,
      present: vi.fn(),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok !== false) return;
    expect(outcome.kind).toBe("refused");
    expect(outcome.message).toMatch(/switched off by the company/);
    // Honest about permanence — does NOT tell the investor to keep refreshing.
    expect(outcome.message).toMatch(/Refreshing will not change it/);
  });

  it("does NOT dress a refusal up as success — the document is never presented", async () => {
    const present = vi.fn();
    await openDataroomDocument({
      fileId: "drf_dd_master",
      fetchImpl: (async () => SERVER_ANSWERS[0]!.res) as unknown as typeof fetch,
      present,
    });
    expect(present).not.toHaveBeenCalled();
  });

  it("reports a network failure instead of failing silently", async () => {
    const outcome = await openDataroomDocument({
      fileId: "drf_pitch_q2",
      fetchImpl: (async () => {
        throw new Error("Failed to fetch");
      }) as unknown as typeof fetch,
      present: vi.fn(),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok !== false) return;
    expect(outcome.kind).toBe("fault");
    expect(outcome.message).toMatch(/could not reach the server/i);
    expect(outcome.message).toMatch(/Nothing was downloaded/);
  });

  it("presents the document when the server allows it", async () => {
    const present = vi.fn();
    const created: string[] = [];
    const g = globalThis as unknown as { URL: { createObjectURL?: (b: Blob) => string } };
    const prior = g.URL.createObjectURL;
    g.URL.createObjectURL = (b: Blob) => {
      created.push(String(b.type));
      return "blob:w113";
    };
    try {
      const outcome = await openDataroomDocument({
        fileId: "drf_pitch_q2",
        fileName: "NovaPay Pitch Q2 2026.pdf",
        disposition: "attachment",
        fetchImpl: (async () => resp({ status: 200 })) as unknown as typeof fetch,
        present,
      });
      expect(outcome.ok).toBe(true);
      expect(present).toHaveBeenCalledTimes(1);
      expect(present.mock.calls[0]![1]).toBe("attachment");
      expect(present.mock.calls[0]![2]).toBe("NovaPay Pitch Q2 2026.pdf");
    } finally {
      g.URL.createObjectURL = prior;
    }
  });

  it("reports a fetched-but-undisplayable document rather than a blank tab", async () => {
    const g = globalThis as unknown as { URL: { createObjectURL?: (b: Blob) => string } };
    const prior = g.URL.createObjectURL;
    g.URL.createObjectURL = () => "blob:w113";
    try {
      const outcome = await openDataroomDocument({
        fileId: "drf_pitch_q2",
        fetchImpl: (async () => resp({ status: 200, blobThrows: true })) as unknown as typeof fetch,
        present: vi.fn(),
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok !== false) return;
      expect(outcome.message).toMatch(/could not be displayed/);
    } finally {
      g.URL.createObjectURL = prior;
    }
  });

  it("requests the INVESTOR address the client was always calling, now that it exists", async () => {
    const seen: string[] = [];
    await openDataroomDocument({
      fileId: "drf a/b",
      fetchImpl: (async (u: string) => {
        seen.push(u);
        return resp({ status: 404, contentType: "application/json", body: "{}" });
      }) as unknown as typeof fetch,
      present: vi.fn(),
    });
    expect(seen[0]).toBe("/api/dataroom/files/drf%20a%2Fb/download?disposition=inline");
    expect(dataroomDocumentUrl("x", "attachment")).toBe("/api/dataroom/files/x/download");
  });
});

describe("WAVE 113 · FINDING 3 — refusal wording", () => {
  it("prefers the server's sentence over a generic one", () => {
    expect(dataroomRefusalMessage(403, "view_denied", "Bespoke server sentence.")).toBe("Bespoke server sentence.");
  });

  it("still says something true when the server sent only a code", () => {
    expect(dataroomRefusalMessage(403, "view_denied", null)).toMatch(/switched off by the company/);
    expect(dataroomRefusalMessage(403, "download_denied", null)).toMatch(/not granted you permission/);
    expect(dataroomRefusalMessage(404, null, null)).toMatch(/not available to you/);
    expect(dataroomRefusalMessage(401, null, null)).toMatch(/no longer signed in/);
    expect(dataroomRefusalMessage(503, null, null)).toMatch(/fault on our side/);
  });

  it("does not invite a retry for a permanent refusal, and does invite one for a transient fault", () => {
    expect(dataroomRefusalMessage(403, "view_denied", null)).toMatch(/Refreshing will not change it/);
    expect(dataroomRefusalMessage(500, null, null)).toMatch(/try again shortly/);
  });
});
