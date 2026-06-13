/**
 * RoundCarryForwardPanel — Patch 2
 *
 * Read-only React component that presents carry-forward suggestions for a
 * new round. The founder CONSCIOUSLY accepts or overrides each suggestion.
 * Nothing is auto-populated.
 *
 * Props:
 *   companyId  — the company this new round is for
 *   roundType  — "safe" | "note" | "priced_equity"
 *   roundId    — the id of the round being created (for the accept POST endpoint)
 *   onAccept   — callback invoked with { fieldName, value } when "Use suggested" is clicked
 *   onOverride — callback invoked with { fieldName, value } when a manual value is entered
 *
 * NOTE: This component is INTENDED to be embedded into RoundNew.tsx by a
 * future patch. It is NOT inserted into RoundNew.tsx in Patch 2.
 *
 * Design:
 *   - Light-mode only
 *   - All numbers formatted via Intl.NumberFormat (no hand-rolled formatting)
 *   - Unrealized instruments shown in an expandable accordion
 *   - Audit digest shown in monospace at the bottom
 */
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown, ChevronRight, ShieldCheck, AlertTriangle, Info,
  CheckCircle2, Edit3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types mirrored from server (no shared import to keep Patch 2 self-contained) ──

type SuggestionSource = "prev_round" | "company_profile" | "platform_default" | "market_standard";
type Confidence = "high" | "medium" | "low";

interface CarryForwardSuggestion {
  fieldName: string;
  suggestedValue: unknown;
  source: SuggestionSource;
  sourceRoundId?: string;
  sourceRoundName?: string;
  sourceRoundClosedAt?: string;
  confidence: Confidence;
  rationale: string;
  warnings: string[];
}

interface UnrealizedInstrument {
  instrumentId: string;
  holderName: string;
  instrumentType: "safe" | "note";
  principal: string;
  cap: string | null;
  discount: string | null;
  mfn: boolean;
  currency: string;
  sourceRoundId: string;
  sourceRoundName: string;
  projectedConversionPriceUsd: string | null;
  projectedShares: string | null;
  effectivePricePerShare: string | null;
  rationale: string;
}

interface CarryForwardResult {
  companyId: string;
  proposedRoundType: string;
  computedAt: string;
  fields: Record<string, CarryForwardSuggestion>;
  unrealizedInstruments: UnrealizedInstrument[];
  warnings: string[];
  auditDigest: string;
}

// ─── Props ────────────────────────────────────────────────────────────────

interface AcceptEvent {
  fieldName: string;
  suggestedValue: unknown;
}

interface OverrideEvent {
  fieldName: string;
  suggestedValue: unknown;
  acceptedValue: unknown;
  overrideReason: string;
}

interface RoundCarryForwardPanelProps {
  companyId: string;
  roundType: "safe" | "note" | "priced_equity";
  roundId: string;
  onAccept?: (event: AcceptEvent) => void;
  onOverride?: (event: OverrideEvent) => void;
}

// ─── Formatting helpers ───────────────────────────────────────────────────

const currencyFmt = (amount: string | number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount));

const pctFmt = (value: string | number) =>
  new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));

const numFmt = (value: string | number) =>
  new Intl.NumberFormat("en-US").format(Number(value));

function formatSuggestedValue(fieldName: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const f = fieldName.toLowerCase();
  if (
    f.includes("amount") || f.includes("principal") || f.includes("cap") ||
    f.includes("money") || f.includes("size") || f.includes("valuation")
  ) {
    const n = Number(value);
    if (!isNaN(n) && n > 100) return currencyFmt(n);
  }
  if (f.includes("rate") || f.includes("pct") || f.includes("percent") || f.includes("discount")) {
    const n = Number(value);
    if (!isNaN(n) && n > 0 && n <= 1) return pctFmt(n);
    if (!isNaN(n) && n > 1 && n <= 100) return pctFmt(n / 100);
  }
  if (f.includes("shares")) {
    const n = Number(value);
    if (!isNaN(n)) return numFmt(n);
  }
  return String(value);
}

// ─── Sub-components ───────────────────────────────────────────────────────

function ConfidencePill({ confidence }: { confidence: Confidence }) {
  const map: Record<Confidence, { label: string; className: string }> = {
    high: { label: "High confidence", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    medium: { label: "Medium confidence", className: "bg-amber-50 text-amber-700 border-amber-200" },
    low: { label: "Low confidence", className: "bg-red-50 text-red-700 border-red-200" },
  };
  const { label, className } = map[confidence];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
      {label}
    </span>
  );
}

function SourcePill({ source }: { source: SuggestionSource }) {
  const map: Record<SuggestionSource, { label: string; className: string }> = {
    prev_round: { label: "Prior round", className: "bg-blue-50 text-blue-700 border-blue-200" },
    company_profile: { label: "Company profile", className: "bg-purple-50 text-purple-700 border-purple-200" },
    platform_default: { label: "Platform default", className: "bg-slate-50 text-slate-700 border-slate-200" },
    market_standard: { label: "Market standard", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  };
  const { label, className } = map[source];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
      {label}
    </span>
  );
}

interface SuggestionRowProps {
  suggestion: CarryForwardSuggestion;
  onAccept: (value: unknown) => void;
  onOverride: (value: unknown, reason: string) => void;
}

function SuggestionRow({ suggestion, onAccept, onOverride }: SuggestionRowProps) {
  const [mode, setMode] = useState<"idle" | "accepted" | "overriding">("idle");
  const [manualValue, setManualValue] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const displayValue = formatSuggestedValue(suggestion.fieldName, suggestion.suggestedValue);

  return (
    <div className="py-4 border-b border-slate-100 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-slate-800 capitalize">
              {suggestion.fieldName.replace(/([A-Z])/g, " $1").trim()}
            </span>
            <ConfidencePill confidence={suggestion.confidence} />
            <SourcePill source={suggestion.source} />
          </div>

          {/* Suggested value */}
          <div className="text-base font-mono text-slate-900 mb-1">
            {displayValue}
          </div>

          {/* Provenance */}
          {suggestion.sourceRoundName && (
            <div className="text-xs text-slate-500 mb-1">
              Derived from: <span className="font-medium">{suggestion.sourceRoundName}</span>
              {suggestion.sourceRoundClosedAt && (
                <span>, closed {suggestion.sourceRoundClosedAt}</span>
              )}
            </div>
          )}

          {/* Rationale */}
          <div className="text-xs text-slate-500 mb-2 flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-slate-400" />
            <span>{suggestion.rationale}</span>
          </div>

          {/* Field-level warnings */}
          {suggestion.warnings.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {suggestion.warnings.map((w, i) => (
                <div key={i} className="text-xs text-amber-700 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-500" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Override form */}
          {mode === "overriding" && (
            <div className="mt-3 space-y-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <label className="block text-xs font-medium text-slate-700">
                Your value for <span className="text-slate-900">{suggestion.fieldName}</span>
              </label>
              <input
                type="text"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                placeholder={`Enter ${suggestion.fieldName}`}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <label className="block text-xs font-medium text-slate-700">
                Reason for override <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Why are you using a different value?"
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMode("idle")}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!manualValue.trim() || !overrideReason.trim()}
                  onClick={() => {
                    onOverride(manualValue.trim(), overrideReason.trim());
                    setMode("idle");
                  }}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  Confirm override
                </Button>
              </div>
            </div>
          )}

          {/* Accepted confirmation */}
          {mode === "accepted" && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Suggestion accepted and recorded in audit log.</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        {mode === "idle" && (
          <div className="flex-shrink-0 flex flex-col gap-2">
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs whitespace-nowrap"
              onClick={() => {
                onAccept(suggestion.suggestedValue);
                setMode("accepted");
              }}
            >
              Use suggested
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs whitespace-nowrap border-slate-300"
              onClick={() => setMode("overriding")}
            >
              <Edit3 className="w-3 h-3 mr-1" />
              Different value
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function UnrealizedInstrumentRow({ instrument }: { instrument: UnrealizedInstrument }) {
  const [expanded, setExpanded] = useState(false);
  const principalFormatted = currencyFmt(instrument.principal, instrument.currency);

  return (
    <div className="border border-slate-200 rounded-lg mb-2 bg-white">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 rounded-lg"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-medium uppercase">
            {instrument.instrumentType}
          </span>
          <span className="text-sm font-medium text-slate-800">{instrument.holderName}</span>
          <span className="text-sm text-slate-600">{principalFormatted}</span>
          {instrument.mfn && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">MFN</span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-slate-500 font-medium mb-0.5">Principal</div>
              <div className="font-mono text-slate-800">{principalFormatted}</div>
            </div>
            {instrument.cap && (
              <div>
                <div className="text-xs text-slate-500 font-medium mb-0.5">Valuation cap</div>
                <div className="font-mono text-slate-800">{currencyFmt(instrument.cap, instrument.currency)}</div>
              </div>
            )}
            {instrument.discount && (
              <div>
                <div className="text-xs text-slate-500 font-medium mb-0.5">Discount</div>
                <div className="font-mono text-slate-800">{pctFmt(instrument.discount)}</div>
              </div>
            )}
            {instrument.projectedConversionPriceUsd ? (
              <div>
                <div className="text-xs text-slate-500 font-medium mb-0.5">Projected conv. price</div>
                <div className="font-mono text-slate-800">
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 6 }).format(
                    parseFloat(instrument.projectedConversionPriceUsd),
                  )}
                </div>
              </div>
            ) : (
              <div>
                <div className="text-xs text-slate-500 font-medium mb-0.5">Projected conv. price</div>
                <div className="text-xs text-slate-400 italic">Requires round price</div>
              </div>
            )}
            {instrument.projectedShares ? (
              <div>
                <div className="text-xs text-slate-500 font-medium mb-0.5">Projected shares</div>
                <div className="font-mono text-slate-800">{numFmt(instrument.projectedShares)}</div>
              </div>
            ) : null}
            {instrument.effectivePricePerShare ? (
              <div>
                <div className="text-xs text-slate-500 font-medium mb-0.5">Effective PPS</div>
                <div className="font-mono text-slate-800">
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 6 }).format(
                    parseFloat(instrument.effectivePricePerShare),
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="text-xs text-slate-500 bg-slate-50 rounded p-2 border border-slate-100">
            <span className="font-medium text-slate-600">Conversion rationale: </span>
            {instrument.rationale}
          </div>

          <div className="text-xs text-slate-500">
            Source: <span className="font-medium text-slate-700">{instrument.sourceRoundName}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export default function RoundCarryForwardPanel({
  companyId,
  roundType,
  roundId,
  onAccept,
  onOverride,
}: RoundCarryForwardPanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CarryForwardResult | null>(null);
  const [showInstruments, setShowInstruments] = useState(false);

  // Accumulate accepted / overridden decisions for the final audit POST
  const [accepted, setAccepted] = useState<
    Array<{ fieldName: string; suggestedValue: unknown; acceptedValue: unknown }>
  >([]);
  const [overridden, setOverridden] = useState<
    Array<{ fieldName: string; suggestedValue: unknown; acceptedValue: unknown; overrideReason: string }>
  >([]);

  const fetchSuggestion = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/founder/companies/${encodeURIComponent(companyId)}/carry-forward?roundType=${encodeURIComponent(roundType)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      const body = await res.json() as { ok: boolean; result: CarryForwardResult };
      setResult(body.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load carry-forward suggestions.");
    } finally {
      setLoading(false);
    }
  }, [companyId, roundType]);

  useEffect(() => {
    void fetchSuggestion();
  }, [fetchSuggestion]);

  const handleAccept = useCallback(
    (fieldName: string, suggestedValue: unknown) => {
      setAccepted((prev) => {
        const filtered = prev.filter((a) => a.fieldName !== fieldName);
        return [...filtered, { fieldName, suggestedValue, acceptedValue: suggestedValue }];
      });
      onAccept?.({ fieldName, suggestedValue });
    },
    [onAccept],
  );

  const handleOverride = useCallback(
    (
      fieldName: string,
      suggestedValue: unknown,
      acceptedValue: unknown,
      overrideReason: string,
    ) => {
      setOverridden((prev) => {
        const filtered = prev.filter((o) => o.fieldName !== fieldName);
        return [...filtered, { fieldName, suggestedValue, acceptedValue, overrideReason }];
      });
      onOverride?.({ fieldName, suggestedValue, acceptedValue, overrideReason });
    },
    [onOverride],
  );

  const handleSubmitAudit = async () => {
    if (!result) return;
    try {
      const res = await fetch(
        `/api/founder/rounds/${encodeURIComponent(roundId)}/carry-forward/accept`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            auditDigest: result.auditDigest,
            acceptedFields: accepted,
            overriddenFields: overridden,
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { ok: boolean; auditEntryId: string };
      toast({
        title: "Audit record saved",
        description: `Carry-forward decisions recorded. Entry ID: ${body.auditEntryId.slice(0, 8)}…`,
      });
    } catch {
      toast({
        title: "Could not save audit record",
        description: "Your decisions were not recorded. Please try again.",
        variant: "destructive",
      });
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Card className="bg-white border border-slate-200 shadow-sm">
        <CardContent className="py-8 text-center text-sm text-slate-400">
          Loading carry-forward suggestions…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-white border border-red-200 shadow-sm">
        <CardContent className="py-6 text-center text-sm text-red-600">
          <AlertTriangle className="w-4 h-4 mx-auto mb-1" />
          {error}
          <Button size="sm" variant="outline" className="mt-3 mx-auto block" onClick={() => void fetchSuggestion()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!result) return null;

  const fieldEntries = Object.entries(result.fields);
  const hasDecisions = accepted.length > 0 || overridden.length > 0;

  return (
    <Card className="bg-white border border-slate-200 shadow-sm">
      <CardHeader className="pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-blue-600" />
          <CardTitle className="text-base font-semibold text-slate-900">
            Carry-forward suggestions
          </CardTitle>
          <Badge className="ml-auto bg-blue-50 text-blue-700 border-blue-200 text-xs font-normal">
            {fieldEntries.length} suggestions
          </Badge>
        </div>
        <p className="text-xs text-slate-500 mt-1.5">
          These values are derived from your previous rounds. Review each carefully and either
          use the suggested value or enter a different one. Nothing is pre-filled automatically.
        </p>
      </CardHeader>

      <CardContent className="pt-2 pb-4">
        {/* Global warnings */}
        {result.warnings.length > 0 && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Items requiring manual review
            </div>
            <ul className="space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                  <span className="mt-0.5 flex-shrink-0">•</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Suggestion rows */}
        {fieldEntries.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">
            No carry-forward suggestions available.
          </div>
        ) : (
          <div>
            {fieldEntries.map(([fieldName, suggestion]) => (
              <SuggestionRow
                key={fieldName}
                suggestion={suggestion}
                onAccept={(val) => handleAccept(fieldName, val)}
                onOverride={(val, reason) => handleOverride(fieldName, suggestion.suggestedValue, val, reason)}
              />
            ))}
          </div>
        )}

        {/* Unrealized instruments (priced equity only) */}
        {result.unrealizedInstruments.length > 0 && (
          <div className="mt-4">
            <button
              className="w-full flex items-center justify-between py-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
              onClick={() => setShowInstruments((v) => !v)}
            >
              <span>
                Instruments converting in this round ({result.unrealizedInstruments.length})
              </span>
              {showInstruments ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {showInstruments && (
              <div className="mt-2">
                <p className="text-xs text-slate-500 mb-3">
                  The following instruments will convert when this priced round closes. Conversion
                  prices are projections — they will be finalized once you set your round price.
                  All calculations use the existing cap-table engine formulas.
                </p>
                {result.unrealizedInstruments.map((inst) => (
                  <UnrealizedInstrumentRow key={inst.instrumentId} instrument={inst} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Submit audit log */}
        {hasDecisions && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {accepted.length > 0 && (
                  <span className="text-emerald-700 font-medium">{accepted.length} accepted</span>
                )}
                {accepted.length > 0 && overridden.length > 0 && (
                  <span className="text-slate-400 mx-1">·</span>
                )}
                {overridden.length > 0 && (
                  <span className="text-amber-700 font-medium">{overridden.length} overridden</span>
                )}
              </div>
              <Button
                size="sm"
                className="bg-slate-800 hover:bg-slate-900 text-white text-xs"
                onClick={() => void handleSubmitAudit()}
              >
                Record decisions in audit log
              </Button>
            </div>
          </div>
        )}

        {/* Audit digest */}
        <div className="mt-4 pt-3 border-t border-slate-100">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-300" />
            <span>
              Audit digest:{" "}
              <span className="font-mono text-slate-600">
                {result.auditDigest.slice(0, 12)}…
              </span>
              <span className="ml-1 text-slate-400">
                (SHA-256 of suggestion payload shown at {result.computedAt})
              </span>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
