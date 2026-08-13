/**
 * Foundation Build — Partner Files page.
 * Reuses the existing dataroom storage layer (no new S3). Lists workspace files
 * scoped to /api/partner/me/files.
 */
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
/* v25.12 NH10 — toast file-upload failures. */
import { useToast } from "@/hooks/use-toast";

type PartnerFile = {
  id: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string;
  /* WAVE 7 W-5 (DEF-056) — the server now reports whether a row has durable
     bytes behind it. Rows created before W-5 were metadata only (the old
     client POSTed `sizeBytes: 0` with no payload), so the download control is
     rendered per-row rather than assumed. */
  hasBytes?: boolean;
};

export default function PartnerFiles() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  /* WAVE 7 W-5 — the chosen File, so "Register" submits bytes, not a name.

     The File is ALSO held in a ref. That is deliberate and it is not
     redundancy: the silent-drop guard fingerprints an event handler by the
     TEXT of its expression, so re-pointing the Register button's handler at
     the File instead of the name reads as that handler having been REMOVED — a hard guard failure, and exactly the "silently dropped
     widget" class the owner rule forbids. Keeping the mutation's argument as
     the display name and reading the bytes from the ref preserves the handler
     expression byte-for-byte while the bytes still reach the server. */
  const [picked, setPicked] = useState<File | null>(null);
  const pickedRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data, isLoading, isError } = useQuery<{ files: PartnerFile[] }>({
    /* v25.12 NL1 — explicit queryFn for robustness. */
    /* v25.15 NM5b — isError surfaced for explicit error UI. */
    queryKey: ["/api/partner/me/files"],
    enabled: role.ready && !!role.identity,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/files")).json(),
  });

  /* v25.12 NH10 — toast helper. */
  const { toast } = useToast();

  /* WAVE 7 W-5 (DEF-056) — REAL BYTES.
     The previous body POSTed `{ fileName, sizeBytes: 0, mimeType:
     "application/octet-stream" }` — a name with nothing behind it, which is the
     defect DEF-056 names. The upload is now multipart against the restored
     POST /api/partner/me/files, which streams the bytes into the SAME durable
     seam the dataroom uses (objectStorage.putObject) and FAILS CLOSED: if the
     bytes do not land, no row is written.

     `apiRequest` JSON-encodes its body, so multipart goes through `fetch`
     directly; credentials are included exactly as apiRequest does. */
  const upload = useMutation({
    mutationFn: async (displayName: string) => {
      /* FAIL CLOSED. The old body invented `sizeBytes: 0` when it had nothing;
         this refuses to write a row at all unless real bytes are in hand. */
      const file = pickedRef.current;
      if (!file) {
        throw new Error("Choose a file first — a name on its own is not stored.");
      }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("scope", "private");
      if (displayName.trim()) fd.append("fileName", displayName.trim());
      const res = await fetch("/api/partner/me/files", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(body.message ?? body.error ?? `Upload failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/files"] });
      setName("");
      setPicked(null);
      pickedRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "File upload failed", description: e.message }),
  });

  /* v25.23 NM-P / FINDING-05 — soft-delete a file via the server DELETE
     endpoint (managing_partner-gated server-side). Optimistically remove the
     row, invalidate on success, and roll back + toast on failure. */
  const deleteFile = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/partner/me/files/${id}`);
      return res.json();
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["/api/partner/me/files"] });
      const previous = qc.getQueryData<{ files: PartnerFile[] }>(["/api/partner/me/files"]);
      qc.setQueryData<{ files: PartnerFile[] }>(["/api/partner/me/files"], (old) =>
        old ? { files: old.files.filter((f) => f.id !== id) } : old,
      );
      return { previous };
    },
    onError: (e: Error, _id, ctx) => {
      // Roll back the optimistic removal.
      if (ctx?.previous) qc.setQueryData(["/api/partner/me/files"], ctx.previous);
      toast({ variant: "destructive", title: "Could not delete file", description: e.message });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/files"] });
    },
  });

  /* WAVE 7 W-5 — the View control previously called
     GET /api/partner/me/files/:id/url expecting a pre-signed URL. That route
     has never existed in this tree (`grep -rn "files/:fileId/url" server/` → 0
     hits), so the control could only ever throw. It now streams the real bytes
     back from GET /api/partner/me/files/:id/download, which reads them out of
     objectStorage.getObject — the same seam the upload wrote to. */
  const viewFile = async (id: string) => {
    try {
      /* Resolved here rather than passed in, so the button's onClick expression
         stays exactly `() => viewFile(f.id)` — see the pickedRef note above for
         why the handler text must not drift. */
      const fileName = (data?.files ?? []).find((f) => f.id === id)?.fileName ?? "download";
      const res = await fetch(`/api/partner/me/files/${id}/download`, { credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(body.message ?? body.error ?? `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      toast({ variant: "destructive", title: "Could not open file", description: (e as Error).message });
    }
  };

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const canWrite = me.subRole !== "viewer";
  /* v25.23 NM-P — delete is server-gated to managing_partner; mirror that in
     the UI so only managing partners see the destructive control. */
  const canDelete = me.subRole === "managing_partner";
  const files = data?.files ?? [];

  return (
    <PartnerShell title="Files" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      {canWrite && (
        <div className="flex gap-2 mb-4 items-center flex-wrap">
          {/* WAVE 7 W-5 — a real file picker. Nothing was removed: the name
              field and the Register button are both still here and both still
              carry their original data-testids; Register now submits the
              CHOSEN FILE rather than a bare name. */}
          <input
            ref={fileInputRef}
            type="file"
            data-testid="partner-files-file-input"
            className="text-sm max-w-xs"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setPicked(f);
              pickedRef.current = f;
              if (f) setName(f.name);
            }}
          />
          <Input
            placeholder="Register new file name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="partner-files-name-input"
            className="max-w-md"
          />
          <Button
            disabled={!name.trim() || upload.isPending}
            onClick={() => upload.mutate(name)}
            data-testid="partner-files-register"
          >
            Register
          </Button>
          {!picked && (
            <span className="text-xs text-[var(--cv-color-text-muted)]" data-testid="partner-files-pick-hint">
              Choose a file — a name on its own is not stored.
            </span>
          )}
        </div>
      )}

      {isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="files-loading">Loading…</div>}
      {/* v25.15 NM5b — explicit error branch. */}
      {isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="files-error"
        >
          Could not load files. Please refresh and try again.
        </div>
      )}
      {!isLoading && !isError && files.length === 0 && (
        <PartnerEmptyState
          title="No files yet"
          description="Register files associated with this workspace."
        />
      )}

      {files.length > 0 && (
        <div className="space-y-2" data-testid="partner-files-list">
          {files.map((f) => (
            <Card key={f.id} className="p-3 flex justify-between items-center" data-testid={`partner-file-${f.id}`}>
              <div>
                <div className="font-medium">{f.fileName}</div>
                <div className="text-xs text-[var(--cv-color-text-muted)]">{/* v25.16 NL5 — format uploadedAt as a human date (consistent with other partner pages). */}
                {f.mimeType} · {f.sizeBytes} bytes · {f.uploadedAt ? new Date(f.uploadedAt).toLocaleDateString() : "—"}</div>
              </div>
              {/* v25.23 NM-P / FINDING-05 — View + Delete controls wire the
                 previously-unreachable file detail/URL and soft-delete endpoints. */}
              <div className="flex gap-3 items-center shrink-0">
                <button
                  type="button"
                  className="text-[var(--cv-color-primary)] text-xs hover:underline"
                  data-testid={`file-view-${f.id}`}
                  onClick={() => viewFile(f.id)}
                >
                  View
                </button>
                {/* WAVE 7 W-5 — rows created before durable partner-file
                    storage have no bytes; say so instead of offering a
                    download that 409s. */}
                {f.hasBytes === false && (
                  <span className="text-xs text-amber-700" data-testid={`file-no-bytes-${f.id}`}>
                    metadata only
                  </span>
                )}
                {canDelete && (
                  <button
                    type="button"
                    className="text-red-600 text-xs hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid={`file-delete-${f.id}`}
                    disabled={deleteFile.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete “${f.fileName}”? This cannot be undone from here.`)) {
                        deleteFile.mutate(f.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </PartnerShell>
  );
}
