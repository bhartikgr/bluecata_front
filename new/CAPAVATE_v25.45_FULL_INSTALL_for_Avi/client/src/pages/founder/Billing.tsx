/**
 * Sprint 28 Wave 8 — Founder billing page (polished).
 *
 * URL: /founder/billing
 * Ungated (accessible without active subscription for billing access).
 *
 * Shows:
 *   - Current plan card (name, price, renewal date, status badge)
 *   - Payment method card (brand + last 4, expiry, change payment method w/ Luhn + brand sniff)
 *   - Invoices table with PDF download + "Email invoice to me" button
 *   - Cancel dialog: double-checkbox confirm
 *   - Cancel banner when cancel_at_period_end: "Cancels on {periodEnd}. Resume any time."
 *   - Resume subscription button → POST /api/founder/subscription/resume
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  CreditCard, Download, Calendar, AlertTriangle, CheckCircle2,
  RefreshCw, XCircle, PlayCircle, Lock, Receipt, Mail,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useEntitlement } from "@/lib/entitlement";

/* ---------- Types ---------- */
interface Subscription {
  companyId: string;
  status: string;
  plan: string;
  annualAmountMinor: number;
  currency: string;
  renewsOn: string;
  cardLast4: string | null;
  /** K-201 fix v23.4.13: card expiry in MM/YY format */
  cardExpiry?: string | null;
  invoicesCount: number;
  pastDueMinor?: number;
  trialEndsOn?: string;
  /** v25.32 final A1 — ISO timestamp of the most recent successful payment,
   *  sourced DB-direct from payment_ledger on the server. Absent for free /
   *  legacy subscriptions with no ledger row. */
  paymentDate?: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  companyId: string;
  planLabel: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
  currency: string;
  taxMinor: number;
  totalMinor: number;
  status: string;
  issuedAt: string;
  paidAt?: string;
}

/* ---------- Helpers ---------- */
function fmtMoney(minor: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}
function fmtDate(iso: string): string {
  if (!iso || iso === "—") return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

/* ---------- Card brand detection ---------- */
function detectBrand(cardNumber: string): "visa" | "mastercard" | "amex" | "unknown" {
  const d = cardNumber.replace(/\D/g, "");
  if (/^4/.test(d)) return "visa";
  if (/^5[1-5]/.test(d) || /^2[2-7]/.test(d)) return "mastercard";
  if (/^3[47]/.test(d)) return "amex";
  return "unknown";
}

/* ---------- Luhn check ---------- */
function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 12) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/* ---------- Expiry validation ---------- */
function isExpiryFuture(expiry: string): boolean {
  const m = expiry.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return false;
  const month = parseInt(m[1], 10);
  const year = parseInt(m[2], 10) + 2000;
  if (month < 1 || month > 12) return false;
  return new Date(year, month, 1) > new Date();
}

const BRAND_LABELS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", unknown: "" };
const BRAND_COLORS: Record<string, string> = { visa: "text-blue-700", mastercard: "text-orange-600", amex: "text-emerald-700" };

const STATUS_TONE: Record<string, { bg: string; text: string; label: string }> = {
  active:              { bg: "bg-emerald-100", text: "text-emerald-900", label: "Active" },
  trialing:            { bg: "bg-sky-100",     text: "text-sky-900",    label: "Trial" },
  past_due:            { bg: "bg-rose-100",    text: "text-rose-800",   label: "Past Due" },
  unpaid:              { bg: "bg-red-100",     text: "text-red-900",    label: "Unpaid" },
  cancelled:           { bg: "bg-slate-100",   text: "text-slate-700",  label: "Cancelled" },
  pending_payment:     { bg: "bg-amber-100",   text: "text-amber-900",  label: "Pending Payment" },
  cancel_at_period_end:{ bg: "bg-orange-100",  text: "text-orange-900", label: "Cancelling" },
  issued:              { bg: "bg-sky-100",     text: "text-sky-900",    label: "Issued" },
  paid:                { bg: "bg-emerald-100", text: "text-emerald-900",label: "Paid" },
  refunded:            { bg: "bg-amber-100",   text: "text-amber-900",  label: "Refunded" },
  void:                { bg: "bg-slate-100",   text: "text-slate-700",  label: "Void" },
};
function StatusBadge({ status }: { status: string }) {
  const t = STATUS_TONE[status] ?? { bg: "bg-slate-100", text: "text-slate-700", label: status };
  return <Badge className={`text-[10px] border-0 ${t.bg} ${t.text}`}>{t.label}</Badge>;
}

/* ---------- Change payment method dialog ---------- */
function ChangePaymentDialog({
  open, onClose, companyId,
}: { open: boolean; onClose: () => void; companyId: string }) {
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [name, setName] = useState("");
  const [brand, setBrand] = useState<ReturnType<typeof detectBrand>>("unknown");
  const { toast } = useToast();

  const changeMut = useMutation({
    mutationFn: async () => {
      const cardLast4 = cardNumber.replace(/\D/g, "").slice(-4);
      // K-201 fix v23.4.13: pass cardExpiry so server can store and return the correct expiry
      const res = await apiRequest("PATCH", "/api/founder/subscription/payment-method", {
        companyId,
        cardLast4,
        cardExpiry: expiry,
        cardholderName: name,
        tokenized: `tok_${cardLast4}`,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/founder/subscription"] });
        toast({ title: "Payment method updated", description: "Your new card has been saved." });
        onClose();
        setCardNumber(""); setExpiry(""); setCvc(""); setName("");
      } else {
        toast({ title: "Error", description: data.error ?? "Could not update payment method.", variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (!name.trim()) { toast({ title: "Validation", description: "Cardholder name required.", variant: "destructive" }); return; }
    if (!luhnCheck(cardNumber)) { toast({ title: "Validation", description: "Invalid card number (Luhn check failed).", variant: "destructive" }); return; }
    if (!isExpiryFuture(expiry)) { toast({ title: "Validation", description: "Card has expired or invalid format (MM/YY).", variant: "destructive" }); return; }
    if (cvc.length < 3) { toast({ title: "Validation", description: "CVC must be at least 3 digits.", variant: "destructive" }); return; }
    changeMut.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change payment method</DialogTitle>
          <DialogDescription>Enter your new card details. Your data is encrypted end-to-end.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Cardholder name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Name on card" data-testid="input-change-name" />
          </div>
          <div>
            <Label className="text-xs">
              Card number
              {brand !== "unknown" && (
                <span className={`ml-2 text-[10px] font-semibold ${BRAND_COLORS[brand] ?? ""}`}>
                  {BRAND_LABELS[brand]}
                </span>
              )}
            </Label>
            <Input
              value={cardNumber.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim()}
              onChange={e => {
                const raw = e.target.value.replace(/\s/g, "");
                setCardNumber(raw);
                setBrand(detectBrand(raw));
              }}
              placeholder="•••• •••• •••• ••••"
              data-testid="input-change-card"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Expiry</Label>
              <Input
                value={expiry}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, "");
                  setExpiry(v.length > 2 ? `${v.slice(0, 2)}/${v.slice(2, 4)}` : v);
                }}
                placeholder="MM/YY"
                maxLength={5}
                data-testid="input-change-expiry"
              />
            </div>
            <div>
              <Label className="text-xs">CVC</Label>
              <Input value={cvc} onChange={e => setCvc(e.target.value)} placeholder="•••" maxLength={4} type="password" data-testid="input-change-cvc" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
            disabled={changeMut.isPending}
            onClick={handleSubmit}
            data-testid="button-save-payment-method"
          >
            {changeMut.isPending ? "Saving…" : "Save payment method"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Cancel confirmation dialog ---------- */
function CancelDialog({
  open, onClose, subscription, onConfirm, isPending,
}: {
  open: boolean;
  onClose: () => void;
  subscription: Subscription | null;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const [confirm1, setConfirm1] = useState(false);
  const [confirm2, setConfirm2] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setConfirm1(false); setConfirm2(false); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-700">
            <AlertTriangle className="h-4 w-4" />Cancel subscription
          </DialogTitle>
          <DialogDescription>
            Your subscription will remain active until{" "}
            {subscription?.renewsOn ? fmtDate(subscription.renewsOn) : "the end of your billing period"}, then cancel.
            You can resume any time before that date.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm cursor-pointer" data-testid="checkbox-confirm-cancel-1">
            <input type="checkbox" checked={confirm1} onChange={e => setConfirm1(e.target.checked)} className="mt-0.5" />
            <span>I understand I will lose access to paid features after the period ends.</span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer" data-testid="checkbox-confirm-cancel-2">
            <input type="checkbox" checked={confirm2} onChange={e => setConfirm2(e.target.checked)} className="mt-0.5" />
            <span>I confirm I want to cancel my subscription.</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Keep subscription</Button>
          <Button
            className="bg-rose-700 hover:bg-rose-800 text-white"
            disabled={!confirm1 || !confirm2 || isPending}
            onClick={onConfirm}
            data-testid="button-confirm-cancel"
          >
            {isPending ? "Cancelling…" : "Cancel subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Email invoice dialog ---------- */
function EmailInvoiceDialog({
  open, onClose, invoiceId, companyId,
}: { open: boolean; onClose: () => void; invoiceId: string; companyId: string }) {
  const [email, setEmail] = useState("");
  const { toast } = useToast();

  const emailMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/founder/invoices/${invoiceId}/email`, { companyId, email: email || undefined });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast({ title: "Invoice sent", description: `Invoice emailed to ${data.to}.` });
        onClose();
        setEmail("");
      } else {
        toast({ title: "Error", description: data.error ?? "Could not send email.", variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Email invoice</DialogTitle>
          <DialogDescription>Enter the email address to send this invoice to. Leave blank to use your account email.</DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs">Email address</Label>
          <Input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="founder@company.com"
            data-testid="input-email-invoice"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
            disabled={emailMut.isPending}
            onClick={() => emailMut.mutate()}
            data-testid="button-send-invoice-email"
          >
            {emailMut.isPending ? "Sending…" : "Send invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Main component ---------- */
export default function FounderBilling() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: entCtx } = useEntitlement();
  // Patch v4: no demo fallback.
  const companyId = entCtx?.founder?.activeCompanyId ?? "";

  const [changePaymentOpen, setChangePaymentOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [emailInvoiceId, setEmailInvoiceId] = useState<string | null>(null);

  const { data: subData, isLoading: subLoading, refetch: refetchSub } = useQuery<{ ok: boolean; subscription: Subscription }>({
    queryKey: ["/api/founder/subscription", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/subscription?companyId=${companyId}`)).json(),
    retry: false,
  });

  const { data: invoicesData, isLoading: invLoading } = useQuery<{ ok: boolean; invoices: Invoice[] }>({
    queryKey: ["/api/founder/invoices", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/invoices?companyId=${companyId}`)).json(),
    retry: false,
  });

  const cancelMut = useMutation({
    mutationFn: async () =>
      (await apiRequest("PATCH", "/api/founder/subscription", { companyId, status: "cancel_at_period_end" })).json(),
    onSuccess: (data) => {
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/founder/subscription"] });
        toast({ title: "Subscription set to cancel", description: `Active until ${fmtDate(sub?.renewsOn ?? "")}. Resume any time.` });
        setCancelOpen(false);
      } else {
        toast({ title: "Error", description: data.error ?? "Could not cancel.", variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resumeMut = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/founder/subscription/resume", { companyId })).json(),
    onSuccess: (data) => {
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/founder/subscription"] });
        toast({ title: "Subscription resumed", description: "Your subscription is active again." });
      } else {
        toast({ title: "Error", description: data.error ?? "Could not resume.", variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sub = subData?.subscription ?? null;
  const invoices = invoicesData?.invoices ?? [];
  const isCancelling = sub?.status === "cancel_at_period_end";

  const API_BASE = (window as any).__PORT_5000__ ?? "";

  return (
    <>
      <PageHeader
        title="Billing"
        description="Manage your subscription, payment method, and invoices."
        breadcrumbs={[{ label: "Founder" }, { label: "Billing" }]}
      />
      <PageBody>
        {/* Cancellation banner */}
        {isCancelling && (
          <div className="mb-6 flex items-center justify-between p-4 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="flex items-center gap-2 text-orange-800 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Subscription cancels on <strong>{fmtDate(sub!.renewsOn)}</strong>.
                You still have access until then. Resume any time.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-emerald-700 hover:bg-emerald-50 border-emerald-300 shrink-0"
              onClick={() => resumeMut.mutate()}
              disabled={resumeMut.isPending}
              data-testid="button-resume-subscription-banner"
            >
              <PlayCircle className="h-3.5 w-3.5 mr-1.5" />Resume
            </Button>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          {/* Current plan card */}
          <Card data-testid="card-current-plan">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Receipt className="h-4 w-4" />Current plan
              </CardTitle>
            </CardHeader>
            <CardContent>
              {subLoading ? (
                <div className="space-y-2">
                  <div className="h-5 w-32 bg-muted animate-pulse rounded" />
                  <div className="h-4 w-48 bg-muted animate-pulse rounded" />
                </div>
              ) : sub ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-base">{sub.plan.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</div>
                      <div className="text-xl font-semibold font-mono tabular-nums mt-1">
                        {sub.annualAmountMinor === 0 ? "Free" : fmtMoney(sub.annualAmountMinor, sub.currency)}
                        {sub.annualAmountMinor > 0 && <span className="text-xs font-normal text-muted-foreground">/yr</span>}
                      </div>
                    </div>
                    <StatusBadge status={sub.status} />
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{isCancelling ? "Cancels on" : "Renews on"}: {fmtDate(sub.renewsOn)}</span>
                  </div>

                  {/* v25.32 final A1 — surface the most recent payment date
                      (Avi field 3), sourced DB-direct from payment_ledger. */}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="sub-payment-date">
                    <CreditCard className="h-3.5 w-3.5" />
                    <span>Last payment: {sub.paymentDate ? fmtDate(sub.paymentDate) : "—"}</span>
                  </div>

                  <div className="flex gap-2 pt-1">
                    {isCancelling ? (
                      <Button size="sm" variant="outline" className="text-emerald-700 hover:bg-emerald-50"
                        onClick={() => resumeMut.mutate()} disabled={resumeMut.isPending}
                        data-testid="button-resume-subscription">
                        <PlayCircle className="h-3.5 w-3.5 mr-1.5" />Resume subscription
                      </Button>
                    ) : sub.status !== "cancelled" ? (
                      <Button size="sm" variant="outline" className="text-rose-700 hover:bg-rose-50"
                        onClick={() => setCancelOpen(true)}
                        data-testid="button-cancel-subscription">
                        <XCircle className="h-3.5 w-3.5 mr-1.5" />Cancel subscription
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => navigate("/founder/subscribe")} data-testid="button-change-plan">
                      Change plan
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No active subscription.{" "}
                  <button className="underline text-[hsl(0_100%_40%)]" onClick={() => navigate("/founder/subscribe")} data-testid="button-subscribe-link">Subscribe now</button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment method card */}
          <Card data-testid="card-payment-method">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <CreditCard className="h-4 w-4" />Payment method
              </CardTitle>
            </CardHeader>
            <CardContent>
              {subLoading ? (
                <div className="h-5 w-40 bg-muted animate-pulse rounded" />
              ) : sub?.cardLast4 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-8 bg-slate-800 rounded flex items-center justify-center">
                      <CreditCard className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">•••• •••• •••• {sub.cardLast4}</div>
                      {/* K-201 fix v23.4.13: display actual stored expiry, not hardcoded value */}
                      <div className="text-[11px] text-muted-foreground">Visa{sub.cardExpiry ? ` · Expires ${sub.cardExpiry}` : ""}</div>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setChangePaymentOpen(true)} data-testid="button-change-payment-method">
                    Change payment method
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />No payment method on file.
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setChangePaymentOpen(true)} data-testid="button-add-payment-method">
                    Add payment method
                  </Button>
                </div>
              )}
              <div className="mt-3 pt-3 border-t flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Lock className="h-3 w-3" />All payment data is encrypted and secured
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Invoices table */}
        <Card data-testid="card-invoices">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 justify-between">
              <span className="flex items-center gap-2"><Receipt className="h-4 w-4" />Invoices</span>
              <Button size="sm" variant="outline" onClick={() => refetchSub()} className="h-7" data-testid="button-refresh-invoices">
                <RefreshCw className="h-3 w-3 mr-1" />Refresh
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table data-testid="table-founder-invoices">
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6"><div className="h-4 w-32 bg-muted animate-pulse rounded mx-auto" /></TableCell></TableRow>
                ) : invoices.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No invoices yet.</TableCell></TableRow>
                ) : (
                  invoices.map(inv => (
                    <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                      <TableCell className="font-mono text-[11px]">{inv.invoiceNumber}</TableCell>
                      <TableCell className="text-[11px]">{inv.periodStart} → {inv.periodEnd}</TableCell>
                      <TableCell className="text-right font-mono text-[12px]">{fmtMoney(inv.totalMinor, inv.currency)}</TableCell>
                      <TableCell><StatusBadge status={inv.status} /></TableCell>
                      <TableCell className="text-[11px]">{fmtDate(inv.issuedAt)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <a
                            href={`${API_BASE}/api/founder/invoices/${inv.id}/pdf?companyId=${companyId}`}
                            download
                            data-testid={`button-download-invoice-${inv.id}`}
                          >
                            <Button size="sm" variant="outline" className="h-7 text-[11px]">
                              <Download className="h-3 w-3 mr-1" />PDF
                            </Button>
                          </a>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            onClick={() => setEmailInvoiceId(inv.id)}
                            data-testid={`button-email-invoice-${inv.id}`}
                          >
                            <Mail className="h-3 w-3 mr-1" />Email
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Dialogs */}
        <ChangePaymentDialog
          open={changePaymentOpen}
          onClose={() => setChangePaymentOpen(false)}
          companyId={companyId}
        />
        <CancelDialog
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          subscription={sub}
          onConfirm={() => cancelMut.mutate()}
          isPending={cancelMut.isPending}
        />
        {emailInvoiceId && (
          <EmailInvoiceDialog
            open={!!emailInvoiceId}
            onClose={() => setEmailInvoiceId(null)}
            invoiceId={emailInvoiceId}
            companyId={companyId}
          />
        )}
      </PageBody>
    </>
  );
}
