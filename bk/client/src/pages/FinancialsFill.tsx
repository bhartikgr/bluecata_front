/**
 * Wave C-1 — Magic-link "Fill one financial field" page.
 *
 * Route: /financials-fill/:token (no auth required — token IS the auth)
 * Used by accountants to fill a single financial field on behalf of a founder.
 */
import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { getFieldCopy } from "@/lib/financialFieldCopy";

/* ============================================================
 * Types
 * ============================================================ */
interface TokenContext {
  ok: boolean;
  companyId: string;
  companyName: string;
  fieldKey: string;
  requestId: string;
  expiresAt: string;
  note: string;
  error?: string;
}

interface FillResult {
  ok: boolean;
  fieldKey: string;
  version: number;
  error?: string;
}

/* ============================================================
 * Component
 * ============================================================ */
export default function FinancialsFill() {
  const { token } = useParams<{ token: string }>();
  const [value, setValue] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch token context (GET — no auth)
  const contextQ = useQuery<TokenContext>({
    queryKey: ["/api/financials-fill", token],
    queryFn: async () => {
      const r = await fetch(`/api/financials-fill/${token}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "token_error");
      return data;
    },
    retry: false,
    enabled: !!token,
  });

  const ctx = contextQ.data;
  const fieldCopy = ctx?.fieldKey ? getFieldCopy(ctx.fieldKey) : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !value.trim()) return;
    setSubmitError(null);

    try {
      // Parse value depending on field type
      let parsedValue: unknown = value.trim();
      if (fieldCopy?.minorUnits) {
        // Convert dollar amount to minor units (cents)
        const n = parseFloat(parsedValue as string);
        if (isNaN(n) || n < 0) {
          setSubmitError("Please enter a valid positive number");
          return;
        }
        parsedValue = Math.round(n * 100);
      } else if (fieldCopy?.unit === "count" || fieldCopy?.unit === "months") {
        const n = parseInt(parsedValue as string, 10);
        if (isNaN(n) || n < 0) {
          setSubmitError("Please enter a valid non-negative integer");
          return;
        }
        parsedValue = n;
      } else if (fieldCopy?.unit === "pct") {
        const n = parseFloat(parsedValue as string);
        if (isNaN(n)) {
          setSubmitError("Please enter a valid number");
          return;
        }
        // Store pct × 100 as integer
        parsedValue = Math.round(n * 100);
      }

      const r = await fetch(`/api/financials-fill/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: parsedValue }),
      });
      const result: FillResult = await r.json();

      if (!r.ok || !result.ok) {
        const errMap: Record<string, string> = {
          token_not_found: "This link is invalid or has expired.",
          token_consumed: "This link has already been used. Each link can only be used once.",
          token_expired: "This link has expired (links are valid for 7 days).",
        };
        setSubmitError(errMap[result.error ?? ""] ?? result.error ?? "Submission failed");
        return;
      }

      setSubmitted(true);
    } catch (err) {
      setSubmitError("A network error occurred. Please try again.");
    }
  }

  /* Success screen */
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full" data-testid="card-fill-success">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" data-testid="icon-success" />
            <div>
              <h2 className="text-xl font-semibold">Thank you!</h2>
              <p className="text-sm text-muted-foreground mt-2">
                The <strong>{ctx?.fieldKey}</strong> field has been saved to{" "}
                <strong>{ctx?.companyName ?? ctx?.companyId}</strong>&apos;s profile.
                The founder has been notified.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              You can now close this tab.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* Error states from token fetch */
  if (contextQ.isError) {
    const err = (contextQ.error as Error)?.message ?? "";
    const errMap: Record<string, { title: string; body: string }> = {
      token_not_found: { title: "Link not found", body: "This link is invalid. Please contact the founder for a new link." },
      token_consumed: { title: "Already used", body: "This fill link has already been used. Each link can only be used once." },
      token_expired: { title: "Link expired", body: "This link expired after 7 days. Please ask the founder to send a new request." },
    };
    const msg = errMap[err] ?? { title: "Invalid link", body: "This link is invalid or has already expired." };

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full" data-testid="card-fill-error">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto" data-testid="icon-error" />
            <div>
              <h2 className="text-xl font-semibold">{msg.title}</h2>
              <p className="text-sm text-muted-foreground mt-2">{msg.body}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* Loading */
  if (contextQ.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full" data-testid="card-fill-loading">
          <CardContent className="pt-8 pb-8 space-y-4">
            <Skeleton className="h-8 w-3/4 mx-auto" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  /* Fill form */
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-lg w-full" data-testid="card-fill-form">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-lg" data-testid="text-company-name">
                {ctx?.companyName ?? ctx?.companyId}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                A founder has requested you fill in one financial field.
              </p>
            </div>
            <Badge variant="secondary" className="flex-shrink-0">
              <Clock className="h-3 w-3 mr-1" />
              Expires {new Date(ctx?.expiresAt ?? "").toLocaleDateString()}
            </Badge>
          </div>
        </CardHeader>

        <CardContent>
          {/* Field info */}
          <div className="bg-muted/40 rounded-lg p-4 mb-6 space-y-2" data-testid="section-field-info">
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Field</span>
              <p className="font-semibold mt-0.5" data-testid="text-field-key">{fieldCopy?.label ?? ctx?.fieldKey}</p>
            </div>
            {fieldCopy && (
              <>
                <p className="text-sm" data-testid="text-field-description">{fieldCopy.description}</p>
                <div className="bg-background rounded p-3 border text-sm">
                  <span className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Example: </span>
                  <span data-testid="text-field-example">{fieldCopy.example}</span>
                </div>
              </>
            )}
          </div>

          {/* Founder note */}
          {ctx?.note && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6" data-testid="section-founder-note">
              <p className="text-xs font-medium text-blue-700 mb-1">Note from founder:</p>
              <p className="text-sm text-blue-800">{ctx.note}</p>
            </div>
          )}

          {/* Input form */}
          <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-fill">
            <div className="space-y-1.5">
              <Label htmlFor="fill-value" className="text-sm font-medium" data-testid="label-fill-value">
                {fieldCopy?.label ?? ctx?.fieldKey}
                {fieldCopy?.minorUnits && <span className="text-muted-foreground ml-1">(in USD)</span>}
                {fieldCopy?.unit === "pct" && <span className="text-muted-foreground ml-1">(%)</span>}
                {fieldCopy?.unit === "months" && <span className="text-muted-foreground ml-1">(months)</span>}
              </Label>
              <Input
                id="fill-value"
                type={fieldCopy?.unit === "usd_minor" || fieldCopy?.unit === "count" || fieldCopy?.unit === "months" || fieldCopy?.unit === "pct" ? "number" : "text"}
                step={fieldCopy?.unit === "pct" ? "0.01" : "1"}
                min="0"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder={fieldCopy?.minorUnits ? "Enter amount in USD (e.g. 600000)" : "Enter value"}
                required
                data-testid="input-fill-value"
                className="text-lg"
              />
            </div>

            {submitError && (
              <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-submit-error">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                {submitError}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={!value.trim()}
              data-testid="button-submit-fill"
            >
              Submit — save to profile
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              This link can only be used once. By submitting you confirm this is accurate financial data.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
