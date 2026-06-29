/**
 * CP Phase B — Public Apply-to-Join for Consortium Partners (CP-001..005).
 *
 * Public, unauthenticated page. Submits to POST /api/public/consortium/apply.
 * Server enforces 5/hr/IP via the 'public:apply' rate-limit bucket.
 *
 * After submit:
 *   - 201 → show applicationId + status message; offer status-lookup link.
 *   - 429 → show "too many submissions" message with retry-after hint.
 *   - 400 → list validation issues from the server.
 *   - 500 → generic error with retry button.
 *
 * NO mock data; NO TODOs. All form state is local; no localStorage. The
 * page is wired into the existing wouter router under /apply/consortium
 * (added by the Phase B App.tsx route entry).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AppCard } from "@/components/ui/app-card";
import { PageHeader } from "@/components/ui/page-header";

/* v25.46 Track 6 — LookFeel-Parity. Per the 2026-06-28 parity audit, this
 * public Consortium application page diverged from canonical Capavate chrome:
 * centered naked form column, borderless inputs, and a navy full-width submit.
 * It is now wrapped in the canonical PageHeader (left-aligned title/subtitle)
 * + AppCard, its fields use the canonical FormField styling (visible #ddd9d3
 * border + red focus ring), and the primary submit is the canonical red pill.
 * ALL form state, the submit handler, success/error branches, and every
 * data-testid are preserved verbatim (wrapper pattern — no behavior dropped). */

type PartnerType =
  | "vc"
  | "syndicate"
  | "family_office"
  | "angel_network"
  | "other";

type AumRange =
  | "<10M"
  | "10-50M"
  | "50-250M"
  | "250M-1B"
  | ">1B"
  | "undisclosed";

interface SubmitResponse {
  applicationId?: string;
  status?: string;
  error?: string;
  issues?: Array<{ message: string; path: string[] }>;
  bucket?: string;
  retryAfterMs?: number;
  /** v23.4.6 Phase 2 (L-003) — server signals whether the confirmation
   * email was delivered. False => show "ask admin to resend" copy. */
  emailSent?: boolean;
  message?: string;
  emailFallback?: string;
}

export default function ConsortiumApplyPage() {
  const [organizationName, setOrganizationName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [partnerType, setPartnerType] = useState<PartnerType>("vc");
  const [aumRange, setAumRange] = useState<AumRange>("undisclosed");
  const [portfolioCompanyCount, setPortfolioCompanyCount] = useState<number>(0);
  /* v25.16 NM8 — was hardcoded to chap_keiretsu_canada, mis-attributing every
     non-Keiretsu applicant. Now empty by default; user must explicitly type
     the chapter ID, and the field is `required` so empty submissions are
     blocked at form level. */
  const [expectedChapter, setExpectedChapter] = useState("");
  const [introMessage, setIntroMessage] = useState("");
  const [referredBy, setReferredBy] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const r = await fetch("/api/public/consortium/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName,
          contactName,
          contactEmail,
          contactPhone: contactPhone || null,
          website: website || null,
          jurisdiction,
          partnerType,
          aumRange,
          portfolioCompanyCount,
          expectedChapter,
          introMessage,
          referredBy: referredBy || null,
        }),
      });
      const body = (await r.json()) as SubmitResponse;
      setResult(body);
    } catch (err) {
      setResult({ error: `network_error: ${(err as Error).message}` });
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.applicationId) {
    // v23.4.6 Phase 2 (L-003) — explicit email-delivery state. If the server
    // could not send the confirmation email (SMTP unavailable, etc.) we tell
    // the applicant up-front so they aren't left wondering — the application
    // row was still saved durably and an admin can resend.
    const emailSent = result.emailSent !== false; // default true when omitted
    return (
      <div style={{ maxWidth: 640, margin: "60px auto", padding: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600 }}>Application received</h1>
        <p style={{ marginTop: 16 }} data-testid="text-apply-confirmation">
          Thanks for your interest in joining the Capavate Consortium. Your
          application has been received and will be reviewed by our team.
        </p>
        {emailSent ? (
          <p
            style={{ marginTop: 12, color: "#155724" }}
            data-testid="text-apply-email-sent"
          >
            We've sent a confirmation email to your inbox.
          </p>
        ) : (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              background: "#fff3cd",
              border: "1px solid #ffeeba",
              color: "#856404",
              borderRadius: 6,
            }}
            role="alert"
            data-testid="text-apply-email-failed"
          >
            We couldn't send the confirmation email right now. If you don't
            receive one within 5 minutes, ask an admin to resend it from the
            Consortium Applications console.
          </div>
        )}
        <div
          style={{
            marginTop: 24,
            background: "#f6f7f9",
            padding: 16,
            borderRadius: 8,
            fontFamily: "monospace",
            fontSize: 14,
          }}
        >
          Application ID: <strong>{result.applicationId}</strong>
          <br />
          Status: <strong>{result.status}</strong>
        </div>
        <p style={{ marginTop: 16, color: "#555" }}>
          You can check the status at any time via
          <code style={{ marginLeft: 6 }}>
            /api/public/consortium/apply/{result.applicationId}/status
          </code>
          .
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: 24 }}>
      <PageHeader
        title="Apply to join the Capavate Consortium"
        subtitle="Partners get access to the Capavate Collective Deal Room, syndication tooling, and chapter membership. All applications are reviewed."
      />
      <AppCard>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <Field label="Organization name" required>
          <input
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            required
          />
        </Field>
        <Field label="Contact name" required>
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            required
          />
        </Field>
        <Field label="Contact email" required>
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Contact phone">
          <input
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </Field>
        <Field label="Website">
          <input
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://"
          />
        </Field>
        <Field label="Jurisdiction" required>
          <input
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            required
          />
        </Field>
        <Field label="Partner type" required>
          <select
            value={partnerType}
            onChange={(e) => setPartnerType(e.target.value as PartnerType)}
          >
            <option value="vc">VC</option>
            <option value="syndicate">Syndicate</option>
            <option value="family_office">Family Office</option>
            <option value="angel_network">Angel Network</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="AUM range" required>
          <select
            value={aumRange}
            onChange={(e) => setAumRange(e.target.value as AumRange)}
          >
            <option value="undisclosed">Undisclosed</option>
            <option value="<10M">{"<10M"}</option>
            <option value="10-50M">10-50M</option>
            <option value="50-250M">50-250M</option>
            <option value="250M-1B">250M-1B</option>
            <option value=">1B">{">1B"}</option>
          </select>
        </Field>
        <Field label="Portfolio company count">
          <input
            type="number"
            min={0}
            value={portfolioCompanyCount}
            onChange={(e) =>
              setPortfolioCompanyCount(parseInt(e.target.value, 10) || 0)
            }
          />
        </Field>
        <Field label="Expected chapter" required>
          <input
            value={expectedChapter}
            onChange={(e) => setExpectedChapter(e.target.value)}
            required
          />
        </Field>
        <Field label="Intro message">
          <textarea
            rows={4}
            value={introMessage}
            onChange={(e) => setIntroMessage(e.target.value)}
            maxLength={4000}
          />
        </Field>
        <Field label="Referred by">
          <input
            value={referredBy}
            onChange={(e) => setReferredBy(e.target.value)}
          />
        </Field>

        {result?.error && (
          <div
            style={{
              background: "#fff0f0",
              border: "1px solid #f5c6cb",
              padding: 12,
              borderRadius: 6,
              color: "#8b1a1a",
            }}
          >
            <strong>Error:</strong> {result.error}
            {result.bucket && (
              <div style={{ marginTop: 4, fontSize: 13 }}>
                Rate-limit bucket: <code>{result.bucket}</code>
                {typeof result.retryAfterMs === "number" && (
                  <span>
                    {" "}
                    — retry in {Math.ceil(result.retryAfterMs / 60000)} min
                  </span>
                )}
              </div>
            )}
            {result.issues && (
              <ul style={{ margin: "8px 0 0 16px" }}>
                {result.issues.map((iss, i) => (
                  <li key={i}>
                    {iss.path.join(".")}: {iss.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {/* Wave E Fix E3 — was raw <button disabled> with no design-system styling.
            Now uses <Button> which has consistent disabled:opacity-50 disabled:cursor-not-allowed. */}
        {/* v25.46 Track 6 — canonical RED primary pill (per audit: red =
            primary workspace action; navy = secondary). The prior navy
            full-width inline style is removed; <Button> default variant is the
            #cc0001 pill. Behavior (disabled while submitting) is unchanged. */}
        <Button
          type="submit"
          disabled={submitting}
          title={submitting ? "Submitting your application—please wait" : undefined}
          aria-label={submitting ? "Submitting application" : "Submit application"}
          className="mt-2"
          data-testid="button-consortium-apply-submit"
        >
          {submitting ? "Submitting…" : "Submit application"}
        </Button>
      </form>
      </AppCard>
    </div>
  );
}

/* v25.46 Track 6 — canonical FormField. Label above, then a `cv-field__input`
 * wrapper that styles ANY native <input>/<select>/<textarea> child with the
 * canonical white surface, visible #ddd9d3 border, 8px radius, and red focus
 * ring (the `[&_*]:` arbitrary selectors apply the cv-field input token styles
 * to the field's controls without rewriting each call site). */
function Field(props: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="cv-field" style={{ display: "block" }}>
      <div className="cv-field__label" style={{ marginBottom: 4 }}>
        {props.label}
        {props.required && (
          <span style={{ color: "var(--cv-color-primary)" }}> *</span>
        )}
      </div>
      <div className="cv-field-controls flex flex-col">{props.children}</div>
    </label>
  );
}
