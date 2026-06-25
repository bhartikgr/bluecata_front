/**
 * Sprint 28 Wave 5 — Admin Region Extension Detail Editor
 *
 * Full 4-tab workflow editor: Research | Draft | Review | History
 * Stepper shows current workflow stage.
 * Every mutation sends x-confirm: true after explicit user confirmation dialog.
 * The "Go live" action is irreversible — requires typed confirmation (region code).
 */

import { useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Circle,
  Link2,
  Plus,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type {
  RegionExtension,
  RegionResearch,
  RegionDraft,
  RegionHistoryResponse,
  ProposedFormula,
  RegionStatus,
} from "./types/regionExtension";

/* ============================================================
 * Constants
 * ============================================================ */

const WORKFLOW_STEPS: Array<{ status: RegionStatus; label: string }> = [
  { status: "research", label: "Research" },
  { status: "draft", label: "Draft" },
  { status: "review", label: "Review" },
  { status: "approved", label: "Approved" },
  { status: "live", label: "Live" },
];

const STATUS_COLORS: Record<RegionStatus, string> = {
  research: "bg-slate-100 text-slate-700 border-slate-200",
  draft: "bg-blue-100 text-blue-800 border-blue-200",
  review: "bg-amber-100 text-amber-800 border-amber-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  live: "bg-green-100 text-green-900 border-green-200",
  rejected: "bg-rose-100 text-rose-800 border-rose-200",
  archived: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

const STATUS_LABELS: Record<RegionStatus, string> = {
  research: "Research",
  draft: "Draft",
  review: "In Review",
  approved: "Approved",
  live: "Live",
  rejected: "Rejected",
  archived: "Archived",
};

const TERMINAL_STATUSES = new Set<RegionStatus>(["live", "rejected", "archived"]);

/* ============================================================
 * API helpers
 * ============================================================ */

async function confirmedFetch(url: string, method: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-confirm": "true",
    },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
}

/* ============================================================
 * Sub-components
 * ============================================================ */

function StepperBar({ currentStatus }: { currentStatus: RegionStatus }) {
  const currentIdx = WORKFLOW_STEPS.findIndex((s) => s.status === currentStatus);
  const isTerminal = TERMINAL_STATUSES.has(currentStatus);

  return (
    <div className="flex items-center gap-0 mb-6 p-3 bg-secondary/30 rounded-lg border border-border">
      {WORKFLOW_STEPS.map((step, idx) => {
        const done = currentIdx > idx && !isTerminal;
        const active = currentIdx === idx && !isTerminal;
        const future = currentIdx < idx;
        return (
          <div key={step.status} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div
                className={[
                  "h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold border-2",
                  done ? "border-emerald-500 bg-emerald-500 text-white" : "",
                  active ? "border-[hsl(0_100%_40%)] bg-[hsl(0_100%_40%)] text-white" : "",
                  future ? "border-zinc-300 bg-white text-zinc-400" : "",
                  isTerminal && currentStatus === "rejected" ? "border-rose-300 bg-rose-50 text-rose-400" : "",
                  isTerminal && currentStatus === "archived" ? "border-zinc-200 bg-zinc-50 text-zinc-300" : "",
                ].filter(Boolean).join(" ")}
              >
                {done ? "✓" : idx + 1}
              </div>
              <span className={`text-[10px] mt-1 font-medium ${active ? "text-[hsl(0_100%_40%)]" : done ? "text-emerald-600" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </div>
            {idx < WORKFLOW_STEPS.length - 1 && (
              <div className={`h-0.5 flex-none w-6 sm:w-10 mx-1 ${done ? "bg-emerald-400" : "bg-zinc-200"}`} />
            )}
          </div>
        );
      })}
      {isTerminal && (
        <div className="ml-3 flex-none">
          <Badge
            variant="outline"
            className={`text-[10px] ${STATUS_COLORS[currentStatus]}`}
          >
            {STATUS_LABELS[currentStatus]}
          </Badge>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * Research tab
 * ============================================================ */

function ResearchTab({
  ext,
  onSave,
  saving,
  isReadOnly,
}: {
  ext: RegionExtension;
  onSave: (patch: { research: Partial<RegionResearch> }) => void;
  saving: boolean;
  isReadOnly: boolean;
}) {
  const [research, setResearch] = useState<RegionResearch>({ ...ext.research });
  const [dirty, setDirty] = useState(false);

  const update = useCallback(<K extends keyof RegionResearch>(key: K, val: RegionResearch[K]) => {
    setResearch((r) => ({ ...r, [key]: val }));
    setDirty(true);
  }, []);

  function addSource() {
    update("primarySources", [...research.primarySources, { label: "", url: "" }]);
  }

  function removeSource(i: number) {
    const next = research.primarySources.filter((_, idx) => idx !== i);
    update("primarySources", next);
  }

  function updateSource(i: number, field: "label" | "url", val: string) {
    const next = research.primarySources.map((s, idx) => idx === i ? { ...s, [field]: val } : s);
    update("primarySources", next);
  }

  return (
    <div className="space-y-5">
      {dirty && (
        <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg" data-testid="banner-unsaved-changes">
          <span className="text-xs text-amber-800 flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" /> Unsaved changes
          </span>
          <Button
            size="sm"
            className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => { onSave({ research }); setDirty(false); }}
            disabled={saving || isReadOnly}
            data-testid="button-save-research"
          >
            Save
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Legal Basis Summary <span className="text-muted-foreground text-xs">(Markdown)</span></Label>
        <Textarea
          value={research.legalBasisSummary}
          onChange={(e) => update("legalBasisSummary", e.target.value)}
          placeholder="Summarise the legal basis for this jurisdiction. Include laws, statutes, and key regulatory bodies."
          rows={6}
          disabled={isReadOnly}
          data-testid="textarea-legal-basis-summary"
          className="font-mono text-xs"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Primary Sources <span className="text-xs text-muted-foreground">(≥3 required to advance)</span></Label>
          {!isReadOnly && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addSource} data-testid="button-add-source">
              <Plus className="h-3 w-3 mr-1" /> Add source
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {research.primarySources.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No sources yet. Add at least 3 to advance to Draft.</p>
          )}
          {research.primarySources.map((src, i) => (
            <div key={i} className="flex items-center gap-2" data-testid={`source-row-${i}`}>
              <Input
                placeholder="Label"
                value={src.label}
                onChange={(e) => updateSource(i, "label", e.target.value)}
                className="h-8 text-xs w-1/3"
                disabled={isReadOnly}
                data-testid={`input-source-label-${i}`}
              />
              <div className="relative flex-1">
                <Link2 className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="https://…"
                  value={src.url}
                  onChange={(e) => updateSource(i, "url", e.target.value)}
                  className="h-8 text-xs pl-7"
                  disabled={isReadOnly}
                  data-testid={`input-source-url-${i}`}
                />
              </div>
              {!isReadOnly && (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-rose-600" onClick={() => removeSource(i)} data-testid={`button-remove-source-${i}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
        {research.primarySources.length < 3 && (
          <p className="text-xs text-amber-700 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> {3 - research.primarySources.length} more source(s) needed
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Recommended Instruments</Label>
        <div className="flex gap-4">
          {[
            { key: "recommendedSAFE", label: "SAFE" },
            { key: "recommendedConvertibleNote", label: "Convertible Note" },
            { key: "recommendedEquity", label: "Equity" },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm cursor-pointer" data-testid={`checkbox-${key}`}>
              <Checkbox
                checked={research[key as keyof RegionResearch] as boolean}
                onCheckedChange={(v) => update(key as keyof RegionResearch, Boolean(v) as any)}
                disabled={isReadOnly}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Vesting Default (months)</Label>
          <Input
            type="number"
            value={research.vestingDefaultMonths}
            onChange={(e) => update("vestingDefaultMonths", parseInt(e.target.value, 10) || 0)}
            min={1}
            disabled={isReadOnly}
            className="h-8 text-sm"
            data-testid="input-vesting-default-months"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Cliff (months)</Label>
          <Input
            type="number"
            value={research.vestingCliffMonths}
            onChange={(e) => update("vestingCliffMonths", parseInt(e.target.value, 10) || 0)}
            min={0}
            disabled={isReadOnly}
            className="h-8 text-sm"
            data-testid="input-vesting-cliff-months"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Filing Agency Name</Label>
        <Input
          value={research.filingAgencyName}
          onChange={(e) => update("filingAgencyName", e.target.value)}
          placeholder="e.g. Bundesanzeiger, Companies House, ACRA"
          disabled={isReadOnly}
          className="h-8 text-sm"
          data-testid="input-filing-agency"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Signature Law Name</Label>
        <Input
          value={research.signatureLawName}
          onChange={(e) => update("signatureLawName", e.target.value)}
          placeholder="e.g. eIDAS, ESIGN Act, Electronic Transactions Act"
          disabled={isReadOnly}
          className="h-8 text-sm"
          data-testid="input-signature-law"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Tax Residency Notes</Label>
        <Textarea
          value={research.taxResidencyNotes}
          onChange={(e) => update("taxResidencyNotes", e.target.value)}
          rows={3}
          disabled={isReadOnly}
          data-testid="textarea-tax-residency"
          className="text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label>ESOP Framework Notes</Label>
        <Textarea
          value={research.esopFrameworkNotes}
          onChange={(e) => update("esopFrameworkNotes", e.target.value)}
          rows={3}
          disabled={isReadOnly}
          data-testid="textarea-esop-framework"
          className="text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Anti-Dilution Notes</Label>
        <Textarea
          value={research.antiDilutionNotes}
          onChange={(e) => update("antiDilutionNotes", e.target.value)}
          rows={3}
          disabled={isReadOnly}
          data-testid="textarea-anti-dilution"
          className="text-xs"
        />
      </div>

      {!isReadOnly && dirty && (
        <Button
          className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
          onClick={() => { onSave({ research }); setDirty(false); }}
          disabled={saving}
          data-testid="button-save-research-bottom"
        >
          Save research
        </Button>
      )}
    </div>
  );
}

/* ============================================================
 * Draft tab
 * ============================================================ */

function DraftTab({
  ext,
  onSave,
  saving,
  isReadOnly,
}: {
  ext: RegionExtension;
  onSave: (patch: { draft: Partial<RegionDraft> }) => void;
  saving: boolean;
  isReadOnly: boolean;
}) {
  const emptyDraft: RegionDraft = {
    code: ext.code,
    name: ext.name,
    jurisdictionLabel: "",
    currency: "",
    flag: "",
    defaultLegalEntityType: "",
    defaultIncorporationDocs: [],
    proposedFormulas: [],
    pricingMultiplier: 1.0,
    defaultSubscriptionCurrency: "",
    termSheetTemplateRefs: [],
  };

  const [draft, setDraft] = useState<RegionDraft>(ext.draft ?? emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [formulaDialogOpen, setFormulaDialogOpen] = useState(false);
  const [editingFormula, setEditingFormula] = useState<ProposedFormula | null>(null);
  const [editingFormulaIdx, setEditingFormulaIdx] = useState<number | null>(null);
  const [newDoc, setNewDoc] = useState("");

  const update = useCallback(<K extends keyof RegionDraft>(key: K, val: RegionDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: val }));
    setDirty(true);
  }, []);

  function openFormulaEdit(f: ProposedFormula | null, idx: number | null) {
    setEditingFormula(f ? { ...f } : { id: "", category: "", name: "", definition: "", citationSource: "", citationUrl: "" });
    setEditingFormulaIdx(idx);
    setFormulaDialogOpen(true);
  }

  function saveFormula() {
    if (!editingFormula) return;
    const formulas = [...draft.proposedFormulas];
    if (editingFormulaIdx !== null) {
      formulas[editingFormulaIdx] = editingFormula;
    } else {
      formulas.push(editingFormula);
    }
    update("proposedFormulas", formulas);
    setFormulaDialogOpen(false);
  }

  function removeFormula(i: number) {
    update("proposedFormulas", draft.proposedFormulas.filter((_, idx) => idx !== i));
  }

  function addIncorporationDoc() {
    if (!newDoc.trim()) return;
    update("defaultIncorporationDocs", [...draft.defaultIncorporationDocs, newDoc.trim()]);
    setNewDoc("");
  }

  return (
    <div className="space-y-5">
      {dirty && (
        <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg" data-testid="banner-unsaved-draft">
          <span className="text-xs text-amber-800 flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" /> Unsaved changes
          </span>
          <Button
            size="sm"
            className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => { onSave({ draft }); setDirty(false); }}
            disabled={saving || isReadOnly}
            data-testid="button-save-draft"
          >
            Save
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>ISO Code</Label>
          <Input
            value={draft.code}
            onChange={(e) => update("code", e.target.value.toUpperCase().slice(0, 2))}
            className="font-mono uppercase h-8"
            maxLength={2}
            disabled={isReadOnly}
            data-testid="input-draft-code"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Flag Emoji</Label>
          <Input
            value={draft.flag}
            onChange={(e) => update("flag", e.target.value)}
            placeholder="🇩🇪"
            className="text-lg h-8"
            disabled={isReadOnly}
            data-testid="input-draft-flag"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Region Name</Label>
        <Input
          value={draft.name}
          onChange={(e) => update("name", e.target.value)}
          disabled={isReadOnly}
          data-testid="input-draft-name"
          className="h-8"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Jurisdiction Label</Label>
        <Input
          value={draft.jurisdictionLabel}
          onChange={(e) => update("jurisdictionLabel", e.target.value)}
          placeholder="e.g. GmbHG / BaFin / KAGB"
          disabled={isReadOnly}
          data-testid="input-jurisdiction-label"
          className="h-8"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Currency (ISO 4217)</Label>
          <Input
            value={draft.currency}
            onChange={(e) => update("currency", e.target.value.toUpperCase().slice(0, 3))}
            placeholder="EUR"
            className="font-mono uppercase h-8"
            maxLength={3}
            disabled={isReadOnly}
            data-testid="input-draft-currency"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Subscription Currency (ISO 4217)</Label>
          <Input
            value={draft.defaultSubscriptionCurrency}
            onChange={(e) => update("defaultSubscriptionCurrency", e.target.value.toUpperCase().slice(0, 3))}
            placeholder="EUR"
            className="font-mono uppercase h-8"
            maxLength={3}
            disabled={isReadOnly}
            data-testid="input-subscription-currency"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Default Legal Entity Type</Label>
        <Input
          value={draft.defaultLegalEntityType}
          onChange={(e) => update("defaultLegalEntityType", e.target.value)}
          placeholder="e.g. GmbH, BV, Pte. Ltd."
          disabled={isReadOnly}
          data-testid="input-entity-type"
          className="h-8"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Pricing Multiplier (PPP)</Label>
        <Input
          type="number"
          step={0.01}
          min={0.1}
          max={3.0}
          value={draft.pricingMultiplier}
          onChange={(e) => update("pricingMultiplier", parseFloat(e.target.value) || 1.0)}
          disabled={isReadOnly}
          data-testid="input-pricing-multiplier"
          className="h-8 text-sm"
        />
      </div>

      {/* Incorporation docs */}
      <div className="space-y-2">
        <Label>Default Incorporation Docs</Label>
        {draft.defaultIncorporationDocs.map((doc, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={doc} disabled className="h-8 text-xs flex-1" />
            {!isReadOnly && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                onClick={() => update("defaultIncorporationDocs", draft.defaultIncorporationDocs.filter((_, idx) => idx !== i))}
                data-testid={`button-remove-doc-${i}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
        {!isReadOnly && (
          <div className="flex gap-2">
            <Input
              value={newDoc}
              onChange={(e) => setNewDoc(e.target.value)}
              placeholder="Document name (e.g. Gesellschaftsvertrag)"
              className="h-8 text-xs flex-1"
              data-testid="input-new-doc"
              onKeyDown={(e) => { if (e.key === "Enter") addIncorporationDoc(); }}
            />
            <Button variant="outline" size="sm" className="h-8" onClick={addIncorporationDoc} data-testid="button-add-doc">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Proposed formulas */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Proposed Formulas <span className="text-xs text-muted-foreground">(≥1 required to submit for review)</span></Label>
          {!isReadOnly && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => openFormulaEdit(null, null)}
              data-testid="button-add-formula"
            >
              <Plus className="h-3 w-3 mr-1" /> Add formula
            </Button>
          )}
        </div>
        {draft.proposedFormulas.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No formulas yet.</p>
        )}
        {draft.proposedFormulas.map((f, i) => (
          <div key={i} className="flex items-center gap-2 p-2 bg-secondary/40 rounded-md" data-testid={`formula-row-${i}`}>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono font-medium truncate">{f.id || "(no id)"}</div>
              <div className="text-[10px] text-muted-foreground truncate">{f.name} · {f.category}</div>
            </div>
            {!isReadOnly && (
              <div className="flex gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => openFormulaEdit(f, i)}
                  data-testid={`button-edit-formula-${i}`}
                >
                  <Circle className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-rose-600"
                  onClick={() => removeFormula(i)}
                  data-testid={`button-remove-formula-${i}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {!isReadOnly && dirty && (
        <Button
          className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
          onClick={() => { onSave({ draft }); setDirty(false); }}
          disabled={saving}
          data-testid="button-save-draft-bottom"
        >
          Save draft
        </Button>
      )}

      {/* Formula Dialog */}
      <Dialog open={formulaDialogOpen} onOpenChange={setFormulaDialogOpen}>
        <DialogContent className="max-w-lg" data-testid="dialog-formula-proposal">
          <DialogHeader>
            <DialogTitle>{editingFormulaIdx !== null ? "Edit formula" : "Add proposed formula"}</DialogTitle>
          </DialogHeader>
          {editingFormula && (
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label>Formula ID</Label>
                <Input
                  value={editingFormula.id}
                  onChange={(e) => setEditingFormula({ ...editingFormula, id: e.target.value })}
                  placeholder="safe.postmoney.conversion.DE"
                  className="h-8 font-mono text-xs"
                  data-testid="input-formula-id"
                />
              </div>
              <div className="space-y-1">
                <Label>Category</Label>
                <Input
                  value={editingFormula.category}
                  onChange={(e) => setEditingFormula({ ...editingFormula, category: e.target.value })}
                  placeholder="safe_conversion | note_conversion | esop_topup | …"
                  className="h-8 text-xs"
                  data-testid="input-formula-category"
                />
              </div>
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  value={editingFormula.name}
                  onChange={(e) => setEditingFormula({ ...editingFormula, name: e.target.value })}
                  className="h-8 text-xs"
                  data-testid="input-formula-name"
                />
              </div>
              <div className="space-y-1">
                <Label>Definition (JSON / BNF)</Label>
                <Textarea
                  value={editingFormula.definition}
                  onChange={(e) => setEditingFormula({ ...editingFormula, definition: e.target.value })}
                  rows={4}
                  className="font-mono text-xs"
                  data-testid="textarea-formula-definition"
                />
              </div>
              <div className="space-y-1">
                <Label>Citation Source</Label>
                <Input
                  value={editingFormula.citationSource}
                  onChange={(e) => setEditingFormula({ ...editingFormula, citationSource: e.target.value })}
                  className="h-8 text-xs"
                  data-testid="input-formula-citation-source"
                />
              </div>
              <div className="space-y-1">
                <Label>Citation URL</Label>
                <Input
                  value={editingFormula.citationUrl}
                  onChange={(e) => setEditingFormula({ ...editingFormula, citationUrl: e.target.value })}
                  placeholder="https://…"
                  className="h-8 text-xs"
                  data-testid="input-formula-citation-url"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormulaDialogOpen(false)} data-testid="button-formula-cancel">Cancel</Button>
            <Button
              onClick={saveFormula}
              disabled={!editingFormula?.id || !editingFormula?.name}
              data-testid="button-formula-save"
              className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
            >
              Save formula
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================================================
 * Review tab
 * ============================================================ */

function ReviewTab({
  ext,
  onTransition,
  isAdmin,
}: {
  ext: RegionExtension;
  onTransition: (to: RegionStatus, notes?: string) => void;
  isAdmin: boolean;
}) {
  const [notes, setNotes] = useState(ext.reviewerNotes);
  const [liveConfirmOpen, setLiveConfirmOpen] = useState(false);
  const [liveCodeInput, setLiveCodeInput] = useState("");
  const [liveConfirmStage2, setLiveConfirmStage2] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState<RegionStatus | null>(null);
  const [transitionDialogOpen, setTransitionDialogOpen] = useState(false);

  const isTerminal = TERMINAL_STATUSES.has(ext.status);

  function startTransition(to: RegionStatus) {
    if (to === "live") {
      setLiveConfirmOpen(true);
      setLiveCodeInput("");
      setLiveConfirmStage2(false);
      return;
    }
    setTransitionTarget(to);
    setTransitionDialogOpen(true);
  }

  function confirmLive() {
    if (liveCodeInput !== ext.code) return;
    setLiveConfirmOpen(false);
    onTransition("live", notes);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>Reviewer Notes</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          placeholder="Document your review findings, concerns, and rationale for approval or rejection."
          disabled={isTerminal}
          data-testid="textarea-reviewer-notes"
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">Notes are required before approval.</p>
      </div>

      {!isTerminal && (
        <div className="space-y-3">
          <Separator />
          <div className="flex flex-wrap gap-2">
            {ext.status === "research" && (
              <Button
                variant="outline"
                className="border-blue-300 text-blue-700 hover:bg-blue-50"
                onClick={() => onTransition("draft", notes)}
                data-testid="button-transition-to-draft"
              >
                Advance to Draft
              </Button>
            )}
            {ext.status === "draft" && (
              <Button
                variant="outline"
                className="border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={() => onTransition("review", notes)}
                data-testid="button-submit-for-review"
              >
                Submit for Review
              </Button>
            )}
            {ext.status === "review" && isAdmin && (
              <Button
                variant="outline"
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                onClick={() => onTransition("approved", notes)}
                disabled={!notes.trim()}
                data-testid="button-approve"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" /> Approve
              </Button>
            )}
            {ext.status === "approved" && isAdmin && (
              <Button
                className="bg-green-700 hover:bg-green-800 text-white"
                onClick={() => startTransition("live")}
                data-testid="button-go-live"
              >
                <ShieldAlert className="h-4 w-4 mr-2" /> Go live system-wide
              </Button>
            )}
            {["research", "draft", "review", "approved"].includes(ext.status) && (
              <>
                <Button
                  variant="outline"
                  className="border-rose-300 text-rose-700 hover:bg-rose-50 ml-auto"
                  onClick={() => startTransition("rejected")}
                  data-testid="button-reject"
                >
                  <XCircle className="h-4 w-4 mr-2" /> Reject
                </Button>
                <Button
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => startTransition("archived")}
                  data-testid="button-archive"
                >
                  Archive
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {isTerminal && (
        <div className="p-3 bg-secondary/50 rounded-lg border border-border text-sm text-muted-foreground">
          This region is in a terminal state ({STATUS_LABELS[ext.status]}) and cannot be modified.
          {ext.status === "live" && ext.liveAt && (
            <span> Went live: {new Date(ext.liveAt).toLocaleString()}</span>
          )}
        </div>
      )}

      {/* Go Live confirmation dialog — 2-stage */}
      <Dialog open={liveConfirmOpen} onOpenChange={setLiveConfirmOpen}>
        <DialogContent data-testid="dialog-go-live-confirm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <ShieldAlert className="h-5 w-5" /> This action is irreversible
            </DialogTitle>
            <DialogDescription>
              Marking this region as <strong>Live</strong> will make it permanently available system-wide
              via <code className="text-xs bg-secondary px-1 rounded">/api/regions</code>.
              It cannot be reverted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!liveConfirmStage2 ? (
              <>
                <p className="text-sm">
                  You are about to promote region <strong>{ext.name} ({ext.code})</strong> to live status.
                  This is a permanent, system-wide change.
                </p>
                <Button
                  className="w-full bg-green-700 hover:bg-green-800 text-white"
                  onClick={() => setLiveConfirmStage2(true)}
                  data-testid="button-live-stage1-confirm"
                >
                  I understand — continue
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                  Type the region code <strong>{ext.code}</strong> to confirm.
                </p>
                <Input
                  value={liveCodeInput}
                  onChange={(e) => setLiveCodeInput(e.target.value.toUpperCase())}
                  placeholder={ext.code}
                  className="font-mono text-center text-lg uppercase tracking-widest"
                  data-testid="input-live-code-confirm"
                />
                <Button
                  className="w-full bg-green-700 hover:bg-green-800 text-white"
                  onClick={confirmLive}
                  disabled={liveCodeInput !== ext.code}
                  data-testid="button-live-final-confirm"
                >
                  Promote {ext.code} to live system-wide
                </Button>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLiveConfirmOpen(false)} data-testid="button-live-cancel">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generic transition confirm dialog */}
      <Dialog open={transitionDialogOpen} onOpenChange={setTransitionDialogOpen}>
        <DialogContent data-testid="dialog-transition-confirm">
          <DialogHeader>
            <DialogTitle>Confirm transition</DialogTitle>
            <DialogDescription>
              Move region <strong>{ext.name}</strong> from <strong>{STATUS_LABELS[ext.status]}</strong> to{" "}
              <strong>{transitionTarget ? STATUS_LABELS[transitionTarget] : ""}</strong>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransitionDialogOpen(false)} data-testid="button-transition-cancel">
              Cancel
            </Button>
            <Button
              className={transitionTarget === "rejected" ? "bg-rose-600 hover:bg-rose-700 text-white" : "bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"}
              onClick={() => {
                if (transitionTarget) onTransition(transitionTarget, notes);
                setTransitionDialogOpen(false);
              }}
              data-testid="button-transition-confirm"
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================================================
 * History tab
 * ============================================================ */

function HistoryTab({ id }: { id: string }) {
  const query = useQuery<RegionHistoryResponse>({
    queryKey: ["/api/admin/regions/extensions", id, "history"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/regions/extensions/${id}/history`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
  });

  if (query.isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading history…</div>;
  if (query.isError) return (
    <div className="py-8 text-center text-sm text-rose-600 flex items-center justify-center gap-2">
      <AlertCircle className="h-4 w-4" /> Failed to load history.
    </div>
  );

  const { chainVerify, revisions } = query.data!;

  return (
    <div className="space-y-4">
      {/* Chain verify banner */}
      <div
        className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium ${
          chainVerify.ok
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-rose-50 border-rose-200 text-rose-800"
        }`}
        data-testid="banner-chain-verify"
      >
        {chainVerify.ok ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <AlertCircle className="h-4 w-4" />
        )}
        Hash chain: {chainVerify.ok ? `Verified — ${chainVerify.totalLinks} links intact` : `BROKEN at revision ${chainVerify.brokenAt}`}
      </div>

      {/* Revision list */}
      <div className="space-y-2">
        {revisions.map((rev, i) => (
          <div
            key={i}
            className="p-3 border border-border rounded-lg bg-secondary/20"
            data-testid={`revision-row-${rev.version}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold font-mono">v{rev.version}</span>
              <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[rev.snapshot.status]}`}>
                {STATUS_LABELS[rev.snapshot.status]}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(rev.changedAt).toLocaleString()} by <span className="font-mono">{rev.changedBy}</span>
            </div>
            <div className="mt-1.5 font-mono text-[9px] text-muted-foreground break-all">
              <span className="text-foreground/50">hash:</span> {rev.revisionHash.slice(0, 32)}…
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * Main component
 * ============================================================ */

export default function AdminRegionExtensionDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const query = useQuery<RegionExtension>({
    queryKey: ["/api/admin/regions/extensions", id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/regions/extensions/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: Boolean(id),
  });

  const ext = query.data;
  const isReadOnly = !ext || TERMINAL_STATUSES.has(ext.status);

  /* ---------- PATCH mutation ---------- */
  async function handleSave(patch: { research?: Partial<RegionResearch>; draft?: Partial<RegionDraft> | null }) {
    if (!ext) return;
    setSaving(true);
    try {
      const res = await confirmedFetch(`/api/admin/regions/extensions/${id}`, "PATCH", patch);
      const body = await res.json();
      if (!res.ok) {
        toast({ title: "Save failed", description: body.reason ?? body.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      qc.setQueryData(["/api/admin/regions/extensions", id], body);
      qc.invalidateQueries({ queryKey: ["/api/admin/regions/extensions"] });
      toast({ title: "Saved" });
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  /* ---------- Transition mutation ---------- */
  async function handleTransition(to: RegionStatus, reviewerNotes?: string) {
    if (!ext) return;
    setSaving(true);
    try {
      const res = await confirmedFetch(`/api/admin/regions/extensions/${id}/transition`, "POST", {
        to,
        reviewerNotes,
      });
      const body = await res.json();
      if (!res.ok) {
        toast({
          title: `Transition to '${to}' failed`,
          description: body.reason ?? body.error ?? "Unknown error",
          variant: "destructive",
        });
        return;
      }
      qc.setQueryData(["/api/admin/regions/extensions", id], body);
      qc.invalidateQueries({ queryKey: ["/api/admin/regions/extensions"] });
      qc.invalidateQueries({ queryKey: ["/api/regions"] });
      if (to === "live") {
        toast({
          title: `${ext.name} (${ext.code}) is now live system-wide`,
          description: "The region is now included in /api/regions and available across the platform.",
        });
      } else {
        toast({ title: `Region moved to ${STATUS_LABELS[to]}` });
      }
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (query.isLoading) {
    return (
      <>
        <PageHeader
          title="Region Extension"
          breadcrumbs={[{ label: "Admin" }, { label: "Regions", href: "/admin/regions" }, { label: "Loading…" }]}
        />
        <PageBody>
          <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
        </PageBody>
      </>
    );
  }

  if (query.isError || !ext) {
    return (
      <>
        <PageHeader
          title="Region Extension"
          breadcrumbs={[{ label: "Admin" }, { label: "Regions", href: "/admin/regions" }, { label: "Not found" }]}
        />
        <PageBody>
          <div className="py-16 text-center text-sm text-rose-600 flex items-center justify-center gap-2">
            <AlertCircle className="h-4 w-4" /> Region extension not found.
          </div>
        </PageBody>
      </>
    );
  }

  const tabForStatus: Record<RegionStatus, string> = {
    research: "research",
    draft: "draft",
    review: "review",
    approved: "review",
    live: "review",
    rejected: "review",
    archived: "review",
  };

  return (
    <>
      <PageHeader
        title={`${ext.flag ? ext.flag + " " : ""}${ext.name} (${ext.code})`}
        description={`Region extension · v${ext.version} · ${ext.id}`}
        breadcrumbs={[
          { label: "Admin" },
          { label: "Regions", href: "/admin/regions" },
          { label: ext.name },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`${STATUS_COLORS[ext.status]} text-xs`}
              data-testid="badge-current-status"
            >
              {STATUS_LABELS[ext.status]}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/admin/regions")}
              data-testid="button-back-to-regions"
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Regions
            </Button>
          </div>
        }
      />

      <PageBody>
        <StepperBar currentStatus={ext.status} />

        <Tabs defaultValue={tabForStatus[ext.status]} className="w-full" data-testid="tabs-region-detail">
          <TabsList className="mb-4">
            <TabsTrigger value="research" data-testid="tab-research">Research</TabsTrigger>
            <TabsTrigger value="draft" data-testid="tab-draft">Draft</TabsTrigger>
            <TabsTrigger value="review" data-testid="tab-review">Review</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="research">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Research</CardTitle>
              </CardHeader>
              <CardContent>
                <ResearchTab
                  ext={ext}
                  onSave={handleSave}
                  saving={saving}
                  isReadOnly={isReadOnly}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="draft">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Draft</CardTitle>
              </CardHeader>
              <CardContent>
                <DraftTab
                  ext={ext}
                  onSave={handleSave}
                  saving={saving}
                  isReadOnly={isReadOnly || ext.status === "research"}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="review">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Review &amp; Transitions</CardTitle>
              </CardHeader>
              <CardContent>
                <ReviewTab
                  ext={ext}
                  onTransition={handleTransition}
                  isAdmin
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Revision History</CardTitle>
              </CardHeader>
              <CardContent>
                <HistoryTab id={id} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
