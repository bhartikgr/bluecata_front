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

  const { data, isLoading } = useQuery<{ files: PartnerFile[] }>({
    queryKey: ["/api/partner/me/files"],
    enabled: role.ready && !!role.identity,
  });

  const upload = useMutation({
    mutationFn: async (fileName: string) => {
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
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const canWrite = me.subRole !== "viewer";
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

      {isLoading && <div className="text-sm text-slate-500">Loading…</div>}
      {!isLoading && files.length === 0 && (
        <PartnerEmptyState
          title="No files yet"
          description="Register files associated with this workspace."
        />
      )}

      {files.length > 0 && (
        <div className="space-y-2" data-testid="partner-files-list">
          {files.map((f) => (
            <Card key={f.id} className="p-3 flex justify-between" data-testid={`partner-file-${f.id}`}>
              <div>
                <div className="font-medium">{f.fileName}</div>
                <div className="text-xs text-slate-500">{f.mimeType} · {f.sizeBytes} bytes · {f.uploadedAt}</div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </PartnerShell>
  );
}
