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
import {
  CONSORTIUM_AGREEMENT_TEXT,
  CONSORTIUM_AGREEMENT_VERSION,
  CONSORTIUM_AGREEMENT_ACK,
} from "@shared/consortiumAgreement"; /* W2-I — viewable agreement + typed sign-off at application */

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

/* v25.49.3 form polish — self-contained country reference (no new deps).
 * Each entry is [country display name, E.164 dial code]. Used to drive BOTH
 * the contact-phone country-code dropdown (2d) and the jurisdiction country
 * dropdown (2e). Sorted by name; dial codes are not unique (e.g. +1) which is
 * fine for a per-country selection. */
const COUNTRIES: Array<[string, string]> = [
  ["Afghanistan", "+93"], ["Albania", "+355"], ["Algeria", "+213"], ["Andorra", "+376"],
  ["Angola", "+244"], ["Argentina", "+54"], ["Armenia", "+374"], ["Australia", "+61"],
  ["Austria", "+43"], ["Azerbaijan", "+994"], ["Bahamas", "+1"], ["Bahrain", "+973"],
  ["Bangladesh", "+880"], ["Barbados", "+1"], ["Belarus", "+375"], ["Belgium", "+32"],
  ["Belize", "+501"], ["Benin", "+229"], ["Bhutan", "+975"], ["Bolivia", "+591"],
  ["Bosnia and Herzegovina", "+387"], ["Botswana", "+267"], ["Brazil", "+55"], ["Brunei", "+673"],
  ["Bulgaria", "+359"], ["Burkina Faso", "+226"], ["Burundi", "+257"], ["Cambodia", "+855"],
  ["Cameroon", "+237"], ["Canada", "+1"], ["Cape Verde", "+238"], ["Chad", "+235"],
  ["Chile", "+56"], ["China", "+86"], ["Colombia", "+57"], ["Comoros", "+269"],
  ["Congo (DRC)", "+243"], ["Congo (Republic)", "+242"], ["Costa Rica", "+506"], ["Croatia", "+385"],
  ["Cuba", "+53"], ["Cyprus", "+357"], ["Czech Republic", "+420"], ["Denmark", "+45"],
  ["Djibouti", "+253"], ["Dominican Republic", "+1"], ["Ecuador", "+593"], ["Egypt", "+20"],
  ["El Salvador", "+503"], ["Estonia", "+372"], ["Eswatini", "+268"], ["Ethiopia", "+251"],
  ["Fiji", "+679"], ["Finland", "+358"], ["France", "+33"], ["Gabon", "+241"],
  ["Gambia", "+220"], ["Georgia", "+995"], ["Germany", "+49"], ["Ghana", "+233"],
  ["Greece", "+30"], ["Guatemala", "+502"], ["Guinea", "+224"], ["Guyana", "+592"],
  ["Haiti", "+509"], ["Honduras", "+504"], ["Hong Kong", "+852"], ["Hungary", "+36"],
  ["Iceland", "+354"], ["India", "+91"], ["Indonesia", "+62"], ["Iran", "+98"],
  ["Iraq", "+964"], ["Ireland", "+353"], ["Israel", "+972"], ["Italy", "+39"],
  ["Jamaica", "+1"], ["Japan", "+81"], ["Jordan", "+962"], ["Kazakhstan", "+7"],
  ["Kenya", "+254"], ["Kuwait", "+965"], ["Kyrgyzstan", "+996"], ["Laos", "+856"],
  ["Latvia", "+371"], ["Lebanon", "+961"], ["Lesotho", "+266"], ["Liberia", "+231"],
  ["Libya", "+218"], ["Liechtenstein", "+423"], ["Lithuania", "+370"], ["Luxembourg", "+352"],
  ["Macau", "+853"], ["Madagascar", "+261"], ["Malawi", "+265"], ["Malaysia", "+60"],
  ["Maldives", "+960"], ["Mali", "+223"], ["Malta", "+356"], ["Mauritania", "+222"],
  ["Mauritius", "+230"], ["Mexico", "+52"], ["Moldova", "+373"], ["Monaco", "+377"],
  ["Mongolia", "+976"], ["Montenegro", "+382"], ["Morocco", "+212"], ["Mozambique", "+258"],
  ["Myanmar", "+95"], ["Namibia", "+264"], ["Nepal", "+977"], ["Netherlands", "+31"],
  ["New Zealand", "+64"], ["Nicaragua", "+505"], ["Niger", "+227"], ["Nigeria", "+234"],
  ["North Macedonia", "+389"], ["Norway", "+47"], ["Oman", "+968"], ["Pakistan", "+92"],
  ["Panama", "+507"], ["Papua New Guinea", "+675"], ["Paraguay", "+595"], ["Peru", "+51"],
  ["Philippines", "+63"], ["Poland", "+48"], ["Portugal", "+351"], ["Qatar", "+974"],
  ["Romania", "+40"], ["Russia", "+7"], ["Rwanda", "+250"], ["Saudi Arabia", "+966"],
  ["Senegal", "+221"], ["Serbia", "+381"], ["Sierra Leone", "+232"], ["Singapore", "+65"],
  ["Slovakia", "+421"], ["Slovenia", "+386"], ["Somalia", "+252"], ["South Africa", "+27"],
  ["South Korea", "+82"], ["Spain", "+34"], ["Sri Lanka", "+94"], ["Sudan", "+249"],
  ["Sweden", "+46"], ["Switzerland", "+41"], ["Syria", "+963"], ["Taiwan", "+886"],
  ["Tajikistan", "+992"], ["Tanzania", "+255"], ["Thailand", "+66"], ["Togo", "+228"],
  ["Trinidad and Tobago", "+1"], ["Tunisia", "+216"], ["Turkey", "+90"], ["Turkmenistan", "+993"],
  ["Uganda", "+256"], ["Ukraine", "+380"], ["United Arab Emirates", "+971"], ["United Kingdom", "+44"],
  ["United States", "+1"], ["Uruguay", "+598"], ["Uzbekistan", "+998"], ["Venezuela", "+58"],
  ["Vietnam", "+84"], ["Yemen", "+967"], ["Zambia", "+260"], ["Zimbabwe", "+263"],
];

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
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  /* 2d — phone is a country-code dropdown (+dial) plus a free-form number. The
     two combine into the submitted `contactPhone` string (e.g. "+1 4165551234"). */
  const [phoneCountryCode, setPhoneCountryCode] = useState("+1");
  const [contactPhone, setContactPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [partnerType, setPartnerType] = useState<PartnerType>("vc");
  const [aumRange, setAumRange] = useState<AumRange>("undisclosed");
  const [portfolioCompanyCount, setPortfolioCompanyCount] = useState<number>(0);
  /* 2g (v25.49.3) — the "Expected chapter" field was removed from the form (it
     is ambiguous for first-time applicants; admin assigns the real chapter on
     approval). The server schema still requires a non-empty expectedChapter
     (z.string().min(1)), so we submit a safe default silently. */
  const expectedChapter = "chap_keiretsu_canada";
  const [introMessage, setIntroMessage] = useState("");
  const [referredBy, setReferredBy] = useState("");
  /* W2-I — the applicant must read the Consortium Partner Agreement and type
     their full legal name to sign it AT APPLICATION. The server persists the
     signature name, version, timestamp and integrity hash on the hash-chained
     application row and carries them to the partner contact at approval. */
  const [agreementSignedName, setAgreementSignedName] = useState("");
  const [agreementAccepted, setAgreementAccepted] = useState(false);

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
          contactName: [contactFirstName.trim(), contactLastName.trim()]
            .filter(Boolean)
            .join(" "),
          contactFirstName: contactFirstName.trim() || null,
          contactLastName: contactLastName.trim() || null,
          contactEmail,
          contactPhone: contactPhone.trim()
            ? `${phoneCountryCode} ${contactPhone.trim()}`
            : null,
          website: website || null,
          jurisdiction,
          partnerType,
          aumRange,
          portfolioCompanyCount,
          expectedChapter,
          introMessage,
          referredBy: referredBy || null,
          agreementSignedName: agreementSignedName.trim(),
          agreementVersion: CONSORTIUM_AGREEMENT_VERSION,
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
        <Field label="First name" required>
          <input
            value={contactFirstName}
            onChange={(e) => setContactFirstName(e.target.value)}
            required
          />
        </Field>
        <Field label="Last name" required>
          <input
            value={contactLastName}
            onChange={(e) => setContactLastName(e.target.value)}
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
          <div className="flex flex-row gap-2">
            <select
              aria-label="Country calling code"
              value={phoneCountryCode}
              onChange={(e) => setPhoneCountryCode(e.target.value)}
              style={{ maxWidth: 220 }}
              data-testid="select-consortium-phone-code"
            >
              {COUNTRIES.map(([name, dial]) => (
                <option key={`${name}-${dial}`} value={dial}>
                  {name} ({dial})
                </option>
              ))}
            </select>
            <input
              type="tel"
              inputMode="tel"
              placeholder="Phone number"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              data-testid="input-consortium-phone-number"
            />
          </div>
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
          <select
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            required
            data-testid="select-consortium-jurisdiction"
          >
            <option value="" disabled>
              Select a country…
            </option>
            {COUNTRIES.map(([name]) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
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
            <option value="undisclosed">Prefer not to say</option>
            <option value="<10M">Under $10M</option>
            <option value="10-50M">$10M – $50M</option>
            <option value="50-250M">$50M – $250M</option>
            <option value="250M-1B">$250M – $1B</option>
            <option value=">1B">Over $1B</option>
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

        {/* W2-I — Consortium Partner Agreement: read-only viewable text +
            typed-name electronic signature. Required before submit. */}
        <div className="cv-field" style={{ display: "block" }}>
          <div className="cv-field__label" style={{ marginBottom: 4 }}>
            Consortium Partner Agreement ({CONSORTIUM_AGREEMENT_VERSION})
            <span style={{ color: "var(--cv-color-primary)" }}> *</span>
          </div>
          <div
            data-testid="consortium-agreement-text"
            style={{
              maxHeight: 260,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              fontSize: 13,
              lineHeight: 1.5,
              background: "#f6f7f9",
              border: "1px solid #ddd9d3",
              borderRadius: 8,
              padding: 12,
            }}
          >
            {CONSORTIUM_AGREEMENT_TEXT}
          </div>
        </div>
        <label
          className="flex flex-row gap-2"
          style={{ alignItems: "flex-start", fontSize: 13 }}
        >
          <input
            type="checkbox"
            checked={agreementAccepted}
            onChange={(e) => setAgreementAccepted(e.target.checked)}
            data-testid="checkbox-consortium-agreement-accept"
            style={{ marginTop: 3 }}
          />
          <span>{CONSORTIUM_AGREEMENT_ACK}</span>
        </label>
        <Field label="Type your full legal name to sign" required>
          <input
            value={agreementSignedName}
            onChange={(e) => setAgreementSignedName(e.target.value)}
            placeholder="Full legal name"
            data-testid="input-consortium-agreement-signature"
            required
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
          disabled={submitting || !agreementAccepted || !agreementSignedName.trim()}
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
