/* ════════════════════════════════════════════════════════════════════════════
   WAVE 113 · FINDING 3 (wave 43) — AN INVESTOR CLICKS A DOCUMENT AND SOMETHING
   HAPPENS. IF THE ANSWER IS NO, THE INVESTOR IS TOLD SO, IN PLAIN ENGLISH.

   DIAGNOSED FIRST, THEN FIXED. The click did nothing because all four investor
   call sites requested `/api/dataroom/files/:id/download`, an address that had no
   handler: only `/api/founder/dataroom/…` was ever registered. The request fell
   through to the SPA catch-all and came back as `index.html` with HTTP 200, so
   `window.open` opened a tab holding the application shell. The `catch { }` around
   it never fired — nothing threw. Wave 113 registers the investor addresses
   (`server/dataroomStore.ts`), but registering them is only half the defect:

   THE OTHER HALF IS THE SILENCE. `window.open` is fire-and-forget. It cannot see a
   403, it cannot see a 404, and it cannot tell an HTML error page from a PDF. So
   ANY refusal — including the correct, deliberate refusal a revoked investor is now
   given by Finding 2 — arrived as a blank tab. This module fetches first, reads the
   status, and hands the caller a message to render.

   IT DOES NOT MAKE THE CLICK SUCCEED. Where the server refuses, this reports the
   refusal. That is the whole intent: silence was the defect, not the refusal.
   ════════════════════════════════════════════════════════════════════════════ */

/** What the click produced. Exactly one of these, never a silent nothing. */
export type DataroomOpenOutcome =
  | { ok: true; disposition: "inline" | "attachment" }
  | { ok: false; kind: "refused" | "not_found" | "fault"; message: string };

/**
 * The plain-English sentence for a data-room refusal.
 *
 * The server's own `message` is preferred when it sent one — it knows WHICH grant
 * is missing (`view_denied` vs `download_denied`) and says so. These fallbacks
 * cover a server that answered with a bare code, and they are deliberately
 * specific about PERMANENCE: telling somebody to "try again" when the answer will
 * never change is the same dishonesty Wave 42 removed from the cap-table refusal.
 */
export function dataroomRefusalMessage(status: number, code: string | null, serverMessage: string | null): string {
  if (serverMessage && serverMessage.trim() !== "" && serverMessage.trim() !== code) return serverMessage;
  if (code === "view_denied") {
    return "Your access to this data room has been switched off by the company, so this document cannot be opened. Refreshing will not change it — ask the company to restore your access.";
  }
  if (code === "download_denied") {
    return "The company has not granted you permission to open or download this document. Refreshing will not change it — ask the company if you need access.";
  }
  if (status === 404) {
    return "This document is not available to you. Either it has been removed, or it is not shared with you — refreshing will not change it.";
  }
  if (status === 401) return "Your session is no longer signed in, so this document cannot be opened. Sign in again and re-open it.";
  if (status === 403) return "You do not have permission to open this document. Refreshing will not change it — ask the company if you need access.";
  if (status >= 500) return "We could not fetch this document because of a fault on our side. Nothing is wrong with your access — please try again shortly.";
  return `This document could not be opened (server responded ${status}). Nothing was downloaded.`;
}

/** The one URL shape for an investor data-room document, so no caller re-spells it. */
export function dataroomDocumentUrl(fileId: string, disposition: "inline" | "attachment"): string {
  const base = `/api/dataroom/files/${encodeURIComponent(fileId)}/download`;
  return disposition === "inline" ? `${base}?disposition=inline` : base;
}

/**
 * Fetch a data-room document and either present it or return the refusal.
 *
 * `open` and `revoke` are injected so this is testable in a plain node/jsdom
 * environment without stubbing globals — the production callers pass nothing.
 */
export async function openDataroomDocument(args: {
  fileId: string;
  fileName?: string | null;
  disposition?: "inline" | "attachment";
  fetchImpl?: typeof fetch;
  present?: (url: string, disposition: "inline" | "attachment", fileName: string) => void;
}): Promise<DataroomOpenOutcome> {
  const disposition = args.disposition ?? "inline";
  const doFetch = args.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) {
    return { ok: false, kind: "fault", message: "This browser could not start the request, so nothing was downloaded." };
  }

  let res: Response;
  try {
    res = await doFetch(dataroomDocumentUrl(args.fileId, disposition), { credentials: "include" });
  } catch (err) {
    return {
      ok: false,
      kind: "fault",
      message: `We could not reach the server to fetch this document (${
        (err as Error)?.message ?? "network error"
      }). Nothing was downloaded.`,
    };
  }

  if (!res.ok) {
    let code: string | null = null;
    let serverMessage: string | null = null;
    try {
      const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
      if (typeof parsed.error === "string") code = parsed.error;
      if (typeof parsed.message === "string") serverMessage = parsed.message;
    } catch {
      /* Not JSON. The status-based sentence below still says something true. */
    }
    return {
      ok: false,
      kind: res.status === 404 ? "not_found" : res.status >= 500 ? "fault" : "refused",
      message: dataroomRefusalMessage(res.status, code, serverMessage),
    };
  }

  /* THE HTML-SHELL TRAP, CAUGHT EXPLICITLY. The original defect returned HTTP 200
     with `index.html`. If a future route regression reintroduces it, a blob of HTML
     would be handed to the viewer and the investor would be back to staring at a
     blank tab. An HTML content type on a document endpoint is a fault, and is
     reported as one. */
  const contentType = (res.headers?.get?.("content-type") ?? "").toLowerCase();
  if (contentType.includes("text/html")) {
    return {
      ok: false,
      kind: "fault",
      message:
        "The server returned a web page instead of this document, so it could not be opened. This is a fault on our side, not a permission problem — please report it.",
    };
  }

  const present =
    args.present ??
    ((url: string, disp: "inline" | "attachment", name: string) => {
      if (disp === "inline") {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

  try {
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    present(objectUrl, disposition, args.fileName || "document");
    return { ok: true, disposition };
  } catch (err) {
    return {
      ok: false,
      kind: "fault",
      message: `The document was fetched but could not be displayed (${
        (err as Error)?.message ?? "unknown error"
      }). Nothing was downloaded.`,
    };
  }
}
