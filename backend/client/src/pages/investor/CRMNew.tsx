/**
 * Sprint 21 Wave D — Investor CRM New Contact page.
 *
 * Route: /investor/crm/new
 *
 * Mandatory fields: name, role/title, email, affiliation (company or fund)
 * Optional: stage, tags, notes
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { INVESTOR_STAGES, type InvestorCrmStage } from "./CRM";

export default function InvestorCRMNew() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [form, setForm] = useState({
    name: "",
    role: "",
    email: "",
    affiliation: "",
    stage: "cold" as InvestorCrmStage,
    notes: "",
  });
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  // Sprint 22 Wave 1 — DEF-001 fix: platformUserId optional field.
  const [platformUserId, setPlatformUserId] = useState("");
  const [showPlatformLink, setShowPlatformLink] = useState(false);

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) return;
    setTags((prev) => [...prev, t]);
    setTagInput("");
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/investor/crm", {
        name: form.name.trim(),
        role: form.role.trim() || undefined,
        email: form.email.trim() || undefined,
        affiliation: form.affiliation.trim() || undefined,
        stage: form.stage,
        tags,
        notes: form.notes.trim() || undefined,
        platformUserId: platformUserId.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Contact saved", description: `${form.name} added to your CRM.` });
      queryClient.invalidateQueries({ queryKey: ["/api/investor/crm"] });
      navigate("/investor/crm");
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const canSave = form.name.trim().length > 0 && form.affiliation.trim().length > 0;

  return (
    <>
      <PageHeader
        title="Add contact"
        description="Add a founder, investor, or advisor to your CRM."
        breadcrumbs={[
          { href: "/investor/dashboard", label: "Workspace" },
          { href: "/investor/crm", label: "CRM" },
          { label: "Add" },
        ]}
      />
      <PageBody>
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">New contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Required fields */}
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  className="mt-1"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="Sarah Chen"
                  data-testid="input-name"
                />
              </div>
              <div>
                <Label>Role / Title</Label>
                <Input
                  className="mt-1"
                  value={form.role}
                  onChange={(e) => update("role", e.target.value)}
                  placeholder="CEO, Partner, Advisor…"
                  data-testid="input-role"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  className="mt-1"
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="sarah@example.com"
                  data-testid="input-email"
                />
              </div>
              <div>
                <Label>
                  Primary Affiliation <span className="text-destructive">*</span>
                </Label>
                <Input
                  className="mt-1"
                  value={form.affiliation}
                  onChange={(e) => update("affiliation", e.target.value)}
                  placeholder="Company name"
                  data-testid="input-affiliation"
                />
              </div>
            </div>

            {/* Stage */}
            <div>
              <Label>Stage</Label>
              <Select value={form.stage} onValueChange={(v) => update("stage", v)}>
                <SelectTrigger className="mt-1 max-w-xs" data-testid="select-stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVESTOR_STAGES.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div>
              <Label>Tags</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  placeholder="Series A, fintech, introductions…"
                  data-testid="input-tag"
                />
                <Button type="button" variant="outline" onClick={addTag} data-testid="button-add-tag">
                  Add
                </Button>
              </div>
              {!!tags.length && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tags.map((t) => (
                    <Badge
                      key={t}
                      variant="secondary"
                      className="cursor-pointer"
                      onClick={() => setTags(tags.filter((x) => x !== t))}
                      data-testid={`tag-${t}`}
                    >
                      {t} ×
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <Label>Notes</Label>
              <Textarea
                rows={4}
                className="mt-1"
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder="How did you meet? What's the signal?"
                data-testid="input-notes"
              />
            </div>

            {/* Sprint 22 Wave 1 — DEF-001 fix: Platform account link (optional / advanced) */}
            <div className="border border-border rounded-md">
              <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-left hover:bg-muted/50 rounded-md"
                onClick={() => setShowPlatformLink((v) => !v)}
                data-testid="button-toggle-platform-link"
              >
                Link to platform account
                <span className="text-xs text-muted-foreground">{showPlatformLink ? "▲" : "▼"}</span>
              </button>
              {showPlatformLink && (
                <div className="px-4 pb-4">
                  <Label>Platform user ID (optional)</Label>
                  <Input
                    className="mt-1"
                    value={platformUserId}
                    onChange={(e) => setPlatformUserId(e.target.value)}
                    placeholder="e.g. usr_abc123 (from Capavate profile)"
                    data-testid="input-platform-user-id"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    If this contact is also a Capavate user, link their platform account to enable direct messaging.
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <Button variant="ghost" onClick={() => navigate("/investor/crm")} data-testid="button-cancel">
                Cancel
              </Button>
              <Button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending || !canSave}
                className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
                data-testid="button-save"
              >
                {saveMut.isPending ? "Saving…" : "Save contact"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
