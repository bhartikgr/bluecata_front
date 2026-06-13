import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  // v23.4.7 Phase 14 / BUG 011 — founder can opt-in to sending the investor a
  // unique-email invite with a redemption link. Default OFF so existing add
  // flows don't suddenly start sending email.
  const [sendInvite, setSendInvite] = useState(false);
  function update<K extends keyof typeof form>(k: K, v: string) { setForm(f => ({ ...f, [k]: v })); }

  /* ---- v23.4.9 Phase 3 — frontend required-field gating ----
   * Mirrors the missingRequired() pattern from Company.tsx (v23.4.5 Phase 7).
   * Shadie (BUGs 007 + 008): "Created New Investor Contact and could save it
   * without any input." The server already returns VALIDATION_FAILED, but the
   * frontend must block submission too. Firm name + email are the minimum
   * required fields (email also gives the investor a usable contact channel
   * and a target for the opt-in invite). */
  const missingRequired = (): string[] => {
    const missing: string[] = [];
    if (!form.name || !form.name.trim()) missing.push("Firm name");
    if (!form.email || !form.email.trim()) missing.push("Email");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) missing.push("a valid email");
    return missing;
  };
  const requiredMissingList = missingRequired();
  const isCrmValid = requiredMissingList.length === 0;

  // v23.8 W-4 — Clear button resets the form (matches the v23.7 investor CRM
  // pattern). Also clears the opt-in invite toggle so a fresh entry starts clean.
  const clearForm = () => {
    setForm({ name: "", contact: "", email: "", stageFocus: "", checkSize: "", notes: "" });
    setSendInvite(false);
  };

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
        // v23.4.7 Phase 14 / BUG 011 — opt-in invite email.
        sendInvite,
      });
      return res.json();
    },
    onSuccess: (data: { existingUser?: boolean; inviteSent?: boolean }) => {
      // v23.4.7 Phase 14 / BUG 011 — surface a more informative toast when
      // the server detected an existing user or successfully sent the invite
      // email.
      if (data?.existingUser) {
        toast({
          title: "Contact saved",
          description: "This investor already has a Capavate account. Send them a connection invite from the CRM list when you're ready.",
        });
      } else if (data?.inviteSent) {
        toast({ title: "Contact saved", description: "Invitation email sent." });
      } else {
        toast({ title: "Contact saved", description: "Added to your investor CRM." });
      }
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
              <div><Label className="flex items-center gap-1">Firm name <span className="text-rose-500">*</span></Label><Input className="mt-1" value={form.name} onChange={e => update("name", e.target.value)} placeholder="Firm name" data-testid="input-firm" /></div>
              <div><Label>Primary contact</Label><Input className="mt-1" value={form.contact} onChange={e => update("contact", e.target.value)} placeholder="Contact name" data-testid="input-contact" /></div>
              <div><Label className="flex items-center gap-1">Email <span className="text-rose-500">*</span></Label><Input className="mt-1" type="email" value={form.email} onChange={e => update("email", e.target.value)} placeholder="contact@firm.com" data-testid="input-email" /></div>
              <div><Label>Stage focus</Label><Input className="mt-1" value={form.stageFocus} onChange={e => update("stageFocus", e.target.value)} placeholder="Seed–Series A" data-testid="input-stage" /></div>
              <div className="md:col-span-2"><Label>Typical check size</Label><Input className="mt-1" value={form.checkSize} onChange={e => update("checkSize", e.target.value)} placeholder="$1M–$3M" data-testid="input-check" /></div>
              <div className="md:col-span-2"><Label>Notes</Label><Textarea rows={4} className="mt-1" value={form.notes} onChange={e => update("notes", e.target.value)} placeholder="What signal makes this investor a good fit?" data-testid="input-notes" /></div>
            </div>
            {/* v23.4.7 Phase 14 / BUG 011 — opt-in invitation email. */}
            <label htmlFor="crm-send-invite" className="flex items-start gap-2 text-xs cursor-pointer pt-1">
              <Checkbox
                id="crm-send-invite"
                checked={sendInvite}
                onCheckedChange={(v) => setSendInvite(!!v)}
                data-testid="checkbox-send-invite"
              />
              <span className="leading-relaxed">
                Also send this investor an invitation email with a unique
                redemption link to log in or register.
              </span>
            </label>
            {/* v23.4.9 Phase 3 — inline required-field message, shadcn-style. */}
            {!isCrmValid && (
              <p className="text-xs text-rose-500" data-testid="crm-required-msg">
                Please fill in: {requiredMissingList.join(", ")}.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <Button variant="ghost" onClick={() => navigate("/founder/crm")}>Cancel</Button>
              <Button variant="outline" onClick={clearForm} data-testid="button-clear-crm">Clear</Button>
              <Button
                onClick={() => {
                  // v23.4.9 Phase 3 — guard submission even if the button is
                  // somehow reached while invalid (mirrors Company.tsx).
                  const missing = missingRequired();
                  if (missing.length) {
                    toast({ title: "Missing required fields", description: `Please fill in: ${missing.join(", ")}.`, variant: "destructive" });
                    return;
                  }
                  saveMut.mutate();
                }}
                disabled={saveMut.isPending || !isCrmValid}
                className="bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white"
                data-testid="button-save-crm"
              >{saveMut.isPending ? "Saving…" : "Save contact"}</Button>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
