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
          <Link href="/auth/login" className="text-[hsl(184_98%_22%)] hover:underline" data-testid="link-back-to-login">
            Back to sign in
          </Link>
        </div>
      }
    >
      {done ? (
        <div className="text-sm text-muted-foreground" data-testid="text-forgot-done">
          If an account exists for <span className="font-medium text-foreground">{email}</span>, a reset link is on its way.
          <p className="mt-3 text-xs">Magic links expire in 15 minutes. If your link expires you can <Link href="/auth/forgot" className="text-[hsl(184_98%_22%)] underline">request a new one</Link>.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-forgot">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-email" />
          </div>
          <Button type="submit" className="w-full" disabled={submitting} data-testid="button-submit-forgot">
            {submitting ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
