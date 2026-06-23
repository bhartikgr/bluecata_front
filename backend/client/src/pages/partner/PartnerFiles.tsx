/**
 * Foundation Build — Partner Files page.
 * Reuses the existing dataroom storage layer (no new S3). Lists workspace files
 * scoped to /api/partner/me/files.
 */
import { useState } from "react";
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
};

export default function PartnerFiles() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const { data, isLoading, isError } = useQuery<{ files: PartnerFile[] }>({
    /* v25.12 NL1 — explicit queryFn for robustness. */
    /* v25.15 NM5b — isError surfaced for explicit error UI. */
    queryKey: ["/api/partner/me/files"],
    enabled: role.ready && !!role.identity,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/files")).json(),
  });

  /* v25.12 NH10 — toast helper. */
  const { toast } = useToast();

  const upload = useMutation({
    mutationFn: async (fileName: string) => {
      /* v25.33 — apiRequest() throws ApiError on non-2xx (validation/seat/auth),
         so the former `if (!res.ok)` guard (here, in deleteFile, and in viewFile
         below) was unreachable dead code. The thrown ApiError reaches the
         respective onError / catch unchanged, preserving the failure toast. */
      const res = await apiRequest("POST", "/api/partner/me/files", {
        fileName,
        sizeBytes: 0,
        mimeType: "application/octet-stream",
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/files"] });
      setName("");
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

  /* v25.23 NM-P / FINDING-05 — open the file detail/URL. The server returns a
     short-TTL pre-signed URL; we resolve it then open in a new tab. */
  const viewFile = async (id: string) => {
    try {
      const res = await apiRequest("GET", `/api/partner/me/files/${id}/url`);
      const { url } = (await res.json()) as { url: string };
      if (url) window.open(url, "_blank", "noopener,noreferrer");
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
        <div className="flex gap-2 mb-4">
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
        </div>
      )}

      {isLoading && <div className="text-sm text-slate-500" data-testid="files-loading">Loading…</div>}
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
                <div className="text-xs text-slate-500">{/* v25.16 NL5 — format uploadedAt as a human date (consistent with other partner pages). */}
                {f.mimeType} · {f.sizeBytes} bytes · {f.uploadedAt ? new Date(f.uploadedAt).toLocaleDateString() : "—"}</div>
              </div>
              {/* v25.23 NM-P / FINDING-05 — View + Delete controls wire the
                 previously-unreachable file detail/URL and soft-delete endpoints. */}
              <div className="flex gap-3 items-center shrink-0">
                <button
                  type="button"
                  className="text-blue-600 text-xs hover:underline"
                  data-testid={`file-view-${f.id}`}
                  onClick={() => viewFile(f.id)}
                >
                  View
                </button>
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
