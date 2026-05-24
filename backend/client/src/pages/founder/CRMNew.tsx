import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveCompanyId } from "@/lib/useActiveCompany";

export default function CRMNew() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const companyId = useActiveCompanyId();
  // B-V11-2 fix: rename free-text "stage" form field to "stageFocus" to avoid
  // collision with the pipeline-stage enum. "Stage focus" describes the
  // investor's preferred investment stage (e.g. "Seed-Series A") and is
  // distinct from the CRM pipeline stage (lead/engaged/.../longterm). New
  // contacts always start in the "lead" pipeline stage on the server.
  const [form, setForm] = useState({ name: "", contact: "", email: "", stageFocus: "", checkSize: "", notes: "" });
  function update<K extends keyof typeof form>(k: K, v: string) { setForm(f => ({ ...f, [k]: v })); }

  const saveMut = useMutation({
    mutationFn: async () => {
      // B-V11-2 fix: always send pipeline stage as "lead" (the canonical
      // initial stage). The free-text descriptor goes in `stageFocus` /
      // appended to notes so the pipeline-stage enum stays valid.
      const stageFocusLine = form.stageFocus.trim() ? `Stage focus: ${form.stageFocus.trim()}` : "";
      const composedNotes = [form.notes.trim(), stageFocusLine].filter(Boolean).join("\n\n");
      const res = await apiRequest("POST", "/api/founder/investor-crm", {
        companyId,
        firmName: form.name,
        primaryContact: form.contact,
        email: form.email,
        stage: "lead",
        stageFocus: form.stageFocus,
        checkSize: form.checkSize,
        notes: composedNotes,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Contact saved", description: "Added to your investor CRM." });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/investor-crm", companyId] });
      navigate("/founder/crm");
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <PageHeader title="Add investor contact" breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { href: "/founder/crm", label: "CRM" }, { label: "Add" }]} />
      <PageBody>
        <Card>
          <CardHeader><CardTitle className="text-base">New contact</CardTitle></CardHeader>
          <CardContent className="space-y-4 max-w-2xl">
            <div className="grid md:grid-cols-2 gap-4">
              <div><Label>Firm name</Label><Input className="mt-1" value={form.name} onChange={e => update("name", e.target.value)} placeholder="Hydra Capital" data-testid="input-firm" /></div>
              <div><Label>Primary contact</Label><Input className="mt-1" value={form.contact} onChange={e => update("contact", e.target.value)} placeholder="Aisha Rahman" data-testid="input-contact" /></div>
              <div><Label>Email</Label><Input className="mt-1" type="email" value={form.email} onChange={e => update("email", e.target.value)} placeholder="aisha@hydracapital.com" data-testid="input-email" /></div>
              <div><Label>Stage focus</Label><Input className="mt-1" value={form.stageFocus} onChange={e => update("stageFocus", e.target.value)} placeholder="Seed–Series A" data-testid="input-stage" /></div>
              <div className="md:col-span-2"><Label>Typical check size</Label><Input className="mt-1" value={form.checkSize} onChange={e => update("checkSize", e.target.value)} placeholder="$1M–$3M" data-testid="input-check" /></div>
              <div className="md:col-span-2"><Label>Notes</Label><Textarea rows={4} className="mt-1" value={form.notes} onChange={e => update("notes", e.target.value)} placeholder="What signal makes this investor a good fit?" data-testid="input-notes" /></div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <Button variant="ghost" onClick={() => navigate("/founder/crm")}>Cancel</Button>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white" data-testid="button-save-crm">{saveMut.isPending ? "Saving…" : "Save contact"}</Button>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
