import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useActiveCompanyId } from "@/lib/useActiveCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { FileText } from "lucide-react";

const TEMPLATES = [
  { id: "monthly_kpi", label: "Monthly KPI", desc: "8 sections — highlights, KPIs, financials, asks, risks, roadmap, hiring, press" },
  { id: "quarterly_update", label: "Quarterly Update", desc: "8 sections — quarterly investor letter format" },
  { id: "annual", label: "Annual Letter", desc: "8 sections — yearly retrospective + outlook" },
  { id: "round_close", label: "Round Close", desc: "5 sections — round summary, terms, use of proceeds, lead, next steps" },
  { id: "adhoc", label: "Ad-hoc", desc: "3 sections — flexible quick update" },
];

export default function ReportNew() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const companyId = useActiveCompanyId();
  const [template, setTemplate] = useState("monthly_kpi");
  const [title, setTitle] = useState("");
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return d.toLocaleString("en-US", { month: "long", year: "numeric" });
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/founder/reports2`, { companyId, template, title: title || `${period} Update`, period });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/reports2", companyId] });
      toast({ title: "Draft created", description: "Edit, schedule, or send from the reports list." });
      navigate("/founder/reports");
    },
  });

  return (
    <>
      <PageHeader title="New investor report" breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { href: "/founder/reports", label: "Reports" }, { label: "New" }]} />
      <PageBody>
        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Template</CardTitle></CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplate(t.id)}
                  className={`text-left rounded-md border p-3 transition-colors ${template === t.id ? "border-[hsl(184_98%_22%)] bg-[hsl(184_98%_22%)]/5" : "border-border hover:bg-secondary/40"}`}
                  data-testid={`button-template-${t.id}`}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-[hsl(184_98%_22%)]" />
                    <div className="font-semibold text-sm">{t.label}</div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{t.desc}</div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Title</Label>
                <Input className="mt-1" value={title} onChange={e => setTitle(e.target.value)} placeholder={`${period} Update`} data-testid="input-title" />
              </div>
              <div>
                <Label>Period</Label>
                <Input className="mt-1" value={period} onChange={e => setPeriod(e.target.value)} placeholder="e.g. May 2026 / Q2 2026" data-testid="input-period" />
              </div>
              <div>
                <Label>Template</Label>
                <Select value={template} onValueChange={setTemplate}>
                  <SelectTrigger className="mt-1" data-testid="select-template"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TEMPLATES.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending}
                data-testid="button-create-report"
              >
                Create draft
              </Button>
              <Button variant="outline" className="w-full" onClick={() => navigate("/founder/reports")}>Cancel</Button>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
