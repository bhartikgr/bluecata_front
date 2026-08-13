/**
 * WAVE 33 · CP-PIPE-10 — the admin surface that resolves OQ-5.
 *
 * `PUT /api/admin/lock-text/:key` is the whole resolution path for the missing
 * LOCK 1 wording: the owner pastes the exact string and it is live, verbatim,
 * with no code change and no redeploy. A route only an engineer can reach is
 * not a resolution path an owner can use, so it gets a surface.
 *
 * DESIGN NOTES THAT ARE LOAD-BEARING:
 *
 *  · The textarea starts EMPTY for an unsupplied lock, never seeded with a
 *    suggestion. There is nothing to suggest; anything shown there would be a
 *    paraphrase one Save away from becoming the lock.
 *  · For a SUPPLIED lock the textarea is seeded with the stored text exactly,
 *    so an edit is an edit of the real string rather than a re-typing of it.
 *  · The value is sent UNTRIMMED. Verbatim means verbatim — leading and
 *    trailing whitespace in a legal string is the owner's, not ours to strip.
 *    Emptiness is judged on a trimmed copy and refused by the server.
 *  · Outstanding locks are listed by the server (`outstanding`), not derived
 *    here, so the admin count cannot disagree with what the pipeline surface
 *    renders.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface LockRow {
  key: string;
  supplied: boolean;
  text: string | null;
  copy: string;
  setBy: string | null;
  setAt: string | null;
  revisions: number;
}

interface LockListResponse {
  locks: LockRow[];
  outstanding: string[];
}

export function LockTextAdminPanel() {
  const { toast } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const q = useQuery<LockListResponse>({
    queryKey: ["/api/admin/lock-text"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/lock-text")).json(),
    retry: false,
  });

  const save = useMutation({
    mutationFn: async (args: { key: string; text: string }) =>
      (await apiRequest("PUT", `/api/admin/lock-text/${encodeURIComponent(args.key)}`, {
        text: args.text,
      })).json(),
    onSuccess: () => {
      setEditing(null);
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/lock-text"] });
      toast({ title: "Lock wording recorded" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Lock wording not recorded",
        description: (err as Error)?.message ?? "The wording was not saved. Nothing has changed.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-4" data-testid="lock-text-admin-panel">
      <div>
        <h3 className="font-medium" data-testid="lock-text-admin-title">
          Lock wording register
        </h3>
        <p className="text-xs text-muted-foreground" data-testid="lock-text-admin-intro">
          Verbatim wording for platform locks. Text is stored exactly as entered and reproduced
          exactly where the lock is shown. A lock whose wording has not been supplied states that
          plainly on its surface; it is never summarised or approximated.
        </p>
      </div>

      {q.isLoading ? (
        <div className="text-sm" data-testid="lock-text-admin-loading">
          Reading the lock register…
        </div>
      ) : q.error || !q.data ? (
        <div className="text-sm" data-testid="lock-text-admin-unavailable">
          The lock register could not be read. No lock status is shown rather than one that may be
          wrong — nothing has been changed.
        </div>
      ) : (
        <>
          <div className="text-sm" data-testid="lock-text-admin-outstanding">
            {q.data.outstanding.length > 0
              ? `Wording outstanding for: ${q.data.outstanding.join(", ")}.`
              : q.data.locks.length > 0
                ? "Every lock in the register has wording supplied."
                : "No locks are registered."}
          </div>

          {q.data.locks.length > 0 ? (
            <ul className="space-y-3" data-testid="lock-text-admin-list">
              {q.data.locks.map((l) => (
                <li key={l.key} className="border-t pt-3" data-testid={`lock-text-row-${l.key}`}>
                  <div className="text-sm font-medium">{l.key}</div>
                  <div
                    className="text-xs whitespace-pre-wrap"
                    data-testid={`lock-text-current-${l.key}`}
                  >
                    {/* Supplied → the owner's text. Unsupplied → the server's
                        not-supplied notice. Never a locally authored default. */}
                    {l.copy}
                  </div>
                  <div className="text-xs text-muted-foreground" data-testid={`lock-text-meta-${l.key}`}>
                    {/* Nulls render as an em dash, never as a fabricated value. */}
                    {`Supplied by: ${l.setBy || "—"} · On: ${l.setAt || "—"} · Revisions: ${l.revisions}`}
                  </div>

                  {editing === l.key ? (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        rows={6}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        data-testid={`lock-text-input-${l.key}`}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={save.isPending || draft.trim().length === 0}
                          onClick={() => save.mutate({ key: l.key, text: draft })}
                          data-testid={`lock-text-save-${l.key}`}
                        >
                          Save wording
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(null);
                            setDraft("");
                          }}
                          data-testid={`lock-text-cancel-${l.key}`}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => {
                        setEditing(l.key);
                        /* Seeded with the stored text when there is one, and
                           with NOTHING when there is not. */
                        setDraft(l.text ?? "");
                      }}
                      data-testid={`lock-text-edit-${l.key}`}
                    >
                      {l.supplied ? "Replace wording" : "Supply wording"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

export default LockTextAdminPanel;
