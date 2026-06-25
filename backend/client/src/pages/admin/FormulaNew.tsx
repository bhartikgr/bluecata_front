import { useState } from "react";
import { useLocation } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, ArrowLeft } from "lucide-react";
import { listFormulas, type FormulaRecord, type Region } from "@capavate/cap-table-engine";
import { useAdminStore } from "@/lib/adminStore";
import { useToast } from "@/hooks/use-toast";

export default function AdminFormulaNew() {
  const [, navigate] = useLocation();
  const { registerFormula, appendAudit } = useAdminStore();
  const { toast } = useToast();

  const [cloneFrom, setCloneFrom] = useState<string>("");
  const [id, setId] = useState("safe.postmoney.conversion");
  const [region, setRegion] = useState<Region>("Custom");
  const [version, setVersion] = useState("1.0.0");
  const [name, setName] = useState("");
  const [citationSource, setCitationSource] = useState("");
  const [citationUrl, setCitationUrl] = useState("");
  const [definition, setDefinition] = useState(`{
  "formula": "Custom",
  "where": {}
}`);
  const [testCases, setTestCases] = useState(`[
  { "name": "happy-path", "description": "Replace with a golden-master fixture" }
]`);

  function loadClone(key: string) {
    const all = listFormulas();
    const f = all.find((x) => `${x.region}:${x.id}:${x.version}` === key);
    if (f) {
      setId(f.id);
      setName(f.name + " (variant)");
      setCitationSource(f.citation.source);
      setCitationUrl(f.citation.url);
      setDefinition(JSON.stringify(f.definition, null, 2));
      setRegion("Custom");
    }
  }

  function save() {
    let def: Record<string, unknown> = {};
    try { def = JSON.parse(definition); } catch (e) {
      toast({ title: "Invalid JSON definition", description: String(e), variant: "destructive" });
      return;
    }
    const record: FormulaRecord = {
      id, name: name || id, region, version, status: "draft",
      category: "safe_conversion",
      citation: { source: citationSource || "Custom", url: citationUrl },
      definition: def,
      test: { name: "custom", description: "Admin-defined" },
    };
    registerFormula(record);
    appendAudit({ actor: "ops@capavate.com", action: "formula.created", target: id, payload: { region, version } });
    toast({ title: "Formula registered", description: `${name || id} v${version} added as draft.` });
    navigate("/admin/formulas");
  }

  return (
    <>
      <PageHeader
        title="New formula variant"
        description="Clone an existing formula or define a new variant from scratch. Drafts run alongside built-ins until promoted."
        breadcrumbs={[{ label: "Admin" }, { href: "/admin/formulas", label: "Formulas" }, { label: "New" }]}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/admin/formulas")} data-testid="button-cancel"><ArrowLeft className="h-4 w-4 mr-2" /> Cancel</Button>
            <Button onClick={save} data-testid="button-save" className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"><Save className="h-4 w-4 mr-2" /> Save draft</Button>
          </>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Identity</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Field label="Clone from existing">
                <Select value={cloneFrom} onValueChange={(v) => { setCloneFrom(v); loadClone(v); }}>
                  <SelectTrigger data-testid="select-clone-from"><SelectValue placeholder="Pick a formula to clone…" /></SelectTrigger>
                  <SelectContent>
                    {listFormulas().map((f) => (
                      <SelectItem key={`${f.region}:${f.id}:${f.version}`} value={`${f.region}:${f.id}:${f.version}`}>
                        {f.region} · {f.id} v{f.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Formula ID">
                <Input value={id} onChange={(e) => setId(e.target.value)} data-testid="input-id" />
              </Field>
              <Field label="Display name">
                <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-name" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Region">
                  <Select value={region} onValueChange={(v) => setRegion(v as Region)}>
                    <SelectTrigger data-testid="select-region"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="US">US</SelectItem>
                      <SelectItem value="CA">CA</SelectItem>
                      <SelectItem value="UK">UK</SelectItem>
                      <SelectItem value="SG">SG</SelectItem>
                      <SelectItem value="HK">HK</SelectItem>
                      <SelectItem value="CN">CN</SelectItem>
                      <SelectItem value="IN">IN</SelectItem>
                      <SelectItem value="JP">JP</SelectItem>
                      <SelectItem value="AU">AU</SelectItem>
                      <SelectItem value="Custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Version">
                  <Input value={version} onChange={(e) => setVersion(e.target.value)} data-testid="input-version" />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Citation</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Field label="Source (e.g. NVCA Model Charter §4.4)">
                <Input value={citationSource} onChange={(e) => setCitationSource(e.target.value)} data-testid="input-citation-source" />
              </Field>
              <Field label="URL">
                <Input value={citationUrl} onChange={(e) => setCitationUrl(e.target.value)} placeholder="https://…" data-testid="input-citation-url" />
              </Field>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-3"><CardTitle className="text-base">Definition (JSON)</CardTitle></CardHeader>
            <CardContent>
              <Textarea
                value={definition}
                onChange={(e) => setDefinition(e.target.value)}
                className="font-mono text-xs min-h-[220px] bg-secondary/40"
                data-testid="textarea-definition"
              />
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-3"><CardTitle className="text-base">Golden-master test cases</CardTitle></CardHeader>
            <CardContent>
              <Textarea
                value={testCases}
                onChange={(e) => setTestCases(e.target.value)}
                className="font-mono text-xs min-h-[140px] bg-secondary/40"
                data-testid="textarea-tests"
              />
              <p className="text-xs text-muted-foreground mt-2">Drafts must include at least one golden-master fixture pinned to a published reference before promotion to active.</p>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
