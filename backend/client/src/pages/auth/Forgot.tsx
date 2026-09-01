/**
 * Sprint 15 D5 — Password reset (founder + investor).
 * SANDBOX-SAFE: no Web Storage APIs.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/pages/auth/AuthShell";
import { apiRequest } from "@/lib/queryClient";
/* WAVE 246 — THE SCREEN WAS THE LIAR, NOT THE EMAIL.

   This page said "Magic links expire in 15 minutes". The token that
   POST /api/auth/forgot actually mints lives for 24 hours
   (server/lib/authRoutes.ts), and the reset email says 24 hours. QA asked for
   the EMAIL to be changed to 15 minutes; owner ruling R218.1 established the
   opposite. There is no 15-minute link mechanism on this platform — every other
   magic link is 7, 14, 24 or 30 days — so the sentence was not misplaced copy
   about some other token, it was simply false about this one.

   The duration is no longer prose here. It is DERIVED from the same module the
   minting route imports, so the two can never diverge again, and no second
   literal for the number exists in this file. */
import { passwordResetLinkExpiryPhrase } from "@shared/passwordResetLinkExpiry";

export default function Forgot() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/auth/forgot", { email });
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll send you a magic link if an account exists."
      footer={
        <div>
          <Link href="/auth/login" className="text-[#cc0001] hover:underline" data-testid="link-back-to-login">
            Back to sign in
          </Link>
        </div>
      }
    >
      {done ? (
        <div className="text-sm text-muted-foreground" data-testid="text-forgot-done">
          If an account exists for <span className="font-medium text-foreground">{email}</span>, a reset link is on its way.
          <p className="mt-3 text-xs">Password reset links stay valid for {passwordResetLinkExpiryPhrase()} — the same window the email states. If your link expires you can <Link href="/auth/forgot" className="text-[#cc0001] underline">request a new one</Link>.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-forgot">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-email" />
          </div>
          {/* v25.43 R4-1 — capavate.com red pill CTA. The default Button variant
             now inherits the red --primary token; the pill shape + semibold are
             added to match the brand button. */}
          <Button type="submit" className="w-full rounded-full font-semibold" disabled={submitting} data-testid="button-submit-forgot">
            {submitting ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
