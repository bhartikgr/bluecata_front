# Capavate v23.4.1 — E2E Persona Checklist

> For Avi and QA team. ~15-30 minutes per persona.  
> Each section covers: login → primary workflow → settings.  
> EXPECT annotations explain non-obvious behaviour.  
> File blockers using the template at the bottom.

---

## How to use this checklist

1. Start the server: `npm run dev`  (or point to staging)
2. Work through each persona in a **fresh incognito window** to avoid session bleed
3. Check each box as you go
4. If any step fails, fill in the blocker template at the bottom

Demo credentials (available when `ENABLE_DEMO_SEED=1`):
- Founder Maya: `maya@novapay.example` / `password123`
- Investor Aisha: `aisha@greenwood.capital` / `password123`
- Admin: `admin@capavate.io` / `adminpass`
- Partner: `partner@keiretsu.ca` / `password123`

Real (non-demo) login: use the account you created via signup or invite.

---

## Persona 1: Founder

**Login path:** `/login` or `/founder/subscribe` (new account) or `/auth/signup`

### 1.1 Authentication
- [ ] `/login` page loads without errors
- [ ] Enter `maya@novapay.example` + `password123` → redirects to `/founder/dashboard`
- [ ] EXPECT: Dashboard shows company list (NovaPay AI if demo data loaded)
- [ ] `/forgot-password` page loads, email field present
- [ ] Log out and back in — session persists correctly

### 1.2 Dashboard
- [ ] `/founder/dashboard` loads
- [ ] EXPECT: Company switcher visible if multiple companies
- [ ] `/select-company` works if multiple companies in account
- [ ] Activity feed shows recent events (may be empty for fresh accounts)

### 1.3 Cap Table
- [ ] `/founder/captable` loads, shows shareholder table
- [ ] EXPECT: If no rounds/securities exist, shows empty state (not error)
- [ ] Can add a new shareholder (test data — any name + email)
- [ ] Shareholder appears in table after save
- [ ] Cap table math checks out (% ownership sums to ~100%)

### 1.4 Rounds
- [ ] `/founder/rounds` loads
- [ ] "New round" button → `/founder/rounds/new` opens
- [ ] Fill in: round name, type (e.g. SAFE), target amount → save
- [ ] EXPECT: Round appears in list with status "open"
- [ ] `/founder/rounds/:id` detail page loads for the new round
- [ ] Term sheet tab opens at `/founder/rounds/:id/termsheet`

### 1.5 CRM
- [ ] `/founder/crm` loads contact list
- [ ] `/founder/crm/new` opens new contact form
- [ ] Add a contact (name + email) → appears in list

### 1.6 Data Room
- [ ] `/founder/dataroom` loads
- [ ] EXPECT: Upload button present; folders can be created

### 1.7 Reports
- [ ] `/founder/reports` loads
- [ ] `/founder/reports/new` opens report builder

### 1.8 Company Profile
- [ ] `/founder/company` loads company details
- [ ] Can edit company name, sector, stage → save persists on reload

### 1.9 Settings & Profile
- [ ] `/founder/settings` loads
- [ ] Can update timezone and notification preferences
- [ ] `/founder/profile/wizard` loads

### 1.10 Collective (if COLLECTIVE_ENABLED=1)
- [ ] `/founder/collective` loads (or redirects to apply if not member)
- [ ] `/founder/apply-to-collective` form loads

---

## Persona 2: Investor

**Login path:** `/investor/login`

### 2.1 Authentication
- [ ] `/investor/login` page loads
- [ ] Login as `aisha@greenwood.capital` / `password123` → redirects to `/investor/dashboard`
- [ ] EXPECT: Dashboard shows portfolio companies Aisha is invited to
- [ ] Token-based login (from email invite): click a `/auth/redeem?token=...` link → shows set-password form

### 2.2 Dashboard
- [ ] `/investor/dashboard` loads
- [ ] EXPECT: Shows soft circles and round invitations
- [ ] Portfolio companies visible

### 2.3 Invitations
- [ ] `/investor/invitations` loads invitation list
- [ ] `/investor/invitations/:id` detail page loads for a specific round

### 2.4 Portfolio
- [ ] `/investor/portfolio` loads
- [ ] EXPECT: Shows companies the investor has soft-circled or committed to

### 2.5 Company Detail
- [ ] `/investor/companies/:id` loads a company deal page
- [ ] EXPECT: Data room tab shows only permitted files

---

## Persona 3: Admin

**Login path:** `/admin/login` (or `/api/dev/admin-bypass` in dev with ALLOW_DEV_BYPASS=1)

### 3.1 Authentication
- [ ] `/admin/login` loads
- [ ] Login as `admin@capavate.io` / `adminpass` → redirects to `/admin/dashboard`
- [ ] EXPECT: Full admin sidebar visible

### 3.2 User Management
- [ ] `/admin/users` loads user list
- [ ] Can invite a new user (enters email → generates invite link)
- [ ] EXPECT: Invite link returned; copy to clipboard works
- [ ] Can reset password for an existing user

### 3.3 Consortium Applications (v23.4.1 — primary test for Avi)
- [ ] `/admin/consortium-applications` loads
- [ ] Open a new incognito window → submit an application at `/apply/consortium`
- [ ] EXPECT: Application appears in admin queue with status "approved" (CONSORTIUM_AUTO_APPROVE=1)
- [ ] Click on the application → detail panel opens
- [ ] EXPECT: Invite email status badge visible ("delivered", "failed", or "pending")
- [ ] If status is "failed": **"Copy invite link"** button is visible and clickable
  - [ ] Click "Copy invite link" → link is copied to clipboard (check notification)
  - [ ] Paste the link in a browser → lands on `/set-password?token=...`
  - [ ] Set a password → "Password set!" message → redirect to `/partner/login`
  - [ ] Login with the new password at `/partner/login` → partner dashboard loads
- [ ] **"Resend invite"** button visible → click → new email sent (or link available)
- [ ] After resend: invite status badge updates

### 3.4 Platform Config
- [ ] `/admin/pricing` loads founder tier list
- [ ] EXPECT: Tiers show billing_cycle column (monthly / annual) — this validates migration 0049 applied
- [ ] `/admin/pricing-models` loads
- [ ] `/admin/formulas` loads formula list

### 3.5 Audit Log
- [ ] `/admin/audit-log` loads
- [ ] EXPECT: Shows recent admin actions including consortium application approval
- [ ] `/admin/audit-chain-verify` loads hash-chain verifier

### 3.6 Reconciliation
- [ ] `/admin/reconciliation` loads
- [ ] EXPECT: Shows recon runs; no errors if data is consistent

### 3.7 Migration status
- [ ] Run `npm run db:doctor` in terminal
- [ ] EXPECT: All critical tables PASS, exit code 0

---

## Persona 4: Consortium Partner (v23.4.1 — NEW FLOW)

**This is the primary new flow for v23.4.1. Walk through every step.**

### 4.1 Application
- [ ] Navigate to `/apply/consortium` in a fresh incognito window
- [ ] Fill in all fields: org name, contact name, contact email, partner type, AUM, chapter, intro message
- [ ] Submit form → "Application received" confirmation shown
- [ ] EXPECT: With CONSORTIUM_AUTO_APPROVE=1, status should immediately be "approved"
- [ ] Check email (or server console if SMTP_MODE=console) for invite email

### 4.2 Set password via invite link
- [ ] Open the invite link from email (or server console output)
- [ ] EXPECT: Lands on `/set-password?token=...` page
- [ ] EXPECT: Page shows "Set your password" heading, password + confirm fields
- [ ] Enter a password ≥10 characters, confirm, submit
- [ ] EXPECT: "Password set!" message → redirect to `/partner/login`
- [ ] EXPECT: If expired token (24h+): shows "This invite link has expired. Contact your admin."
- [ ] EXPECT: If already used token: shows "This link has already been used."

### 4.3 Partner login & dashboard
- [ ] Navigate to `/partner/login`
- [ ] Login with the email + password set in 4.2
- [ ] EXPECT: Redirects to partner dashboard (not a blank page, not a 401)
- [ ] `/collective/partner/dashboard` or `/partner/dashboard` loads

### 4.4 Onboarding checklist
- [ ] `/collective/partner/onboarding` loads
- [ ] EXPECT: Onboarding steps visible

### 4.5 Admin fallback (if email failed)
- [ ] Admin goes to `/admin/consortium-applications`, selects the application
- [ ] EXPECT: Status badge shows "failed" if SMTP not configured
- [ ] "Copy invite link" button visible → click → link copies
- [ ] Share the copied link with the partner manually
- [ ] Partner opens link → can set password normally

---

## Persona 5: Collective Member

**Login path:** `/collective/preview` (teaser) or after membership invite

### 5.1 Preview
- [ ] `/collective/preview` loads for unauthenticated users
- [ ] EXPECT: Shows collective value prop, "Apply" or "Request invite" CTA

### 5.2 Dashboard (authenticated member)
- [ ] `/collective/dashboard` loads
- [ ] EXPECT: Shows deal room feed, activity, chapter info

### 5.3 Deal Room
- [ ] `/collective/dealroom` loads
- [ ] `/collective/dealroom/:companyId` loads for a specific deal
- [ ] EXPECT: Documents shown only if data room permission granted

### 5.4 Members
- [ ] `/collective/members` loads member directory

### 5.5 Soft Circles & DSC
- [ ] `/collective/soft-circles` loads
- [ ] `/collective/dsc/pipeline` loads DSC pipeline
- [ ] `/collective/dsc/scores` loads

### 5.6 Settings
- [ ] `/collective/settings` loads
- [ ] `/settings/privacy` loads GDPR/CCPA privacy settings

---

## How to file a blocker

If any step fails, file a blocker with this information:

```
## Blocker: [short description]

**Date/Time:** [e.g. 2026-05-27 09:15 AM EDT]
**Version:** v23.4.1
**Persona:** [founder / investor / admin / partner / collective]
**URL:** [exact URL where the issue occurred]
**Steps to reproduce:**
  1. [step 1]
  2. [step 2]
  3. [step 3]
**What I expected:** [what should have happened]
**What happened instead:** [actual behaviour]
**Screenshot:** [attach or paste console errors]
**Console errors:** [F12 → Console → paste any red errors]
**Network errors:** [F12 → Network → any failed requests (4xx/5xx)]
**Environment:**
  - NODE_ENV: [development / production]
  - CONSORTIUM_AUTO_APPROVE: [0 / 1]
  - SMTP_MODE: [console / smtp / dry_run]
  - DB: [fresh / migrated / which migration last applied]
```

Send to: Ozan (forward to dev team). P0 = blocks the demo. P1 = works but broken UX. P2 = cosmetic.

---

## Quick health commands (run before testing)

```bash
# Verify DB schema is current
npm run db:doctor

# Apply any missing migrations
npm run db:migrate

# Check sacred file integrity
sha256sum server/captableCommitStore.ts server/roundsStore.ts server/lib/roundCloseCascade.ts server/spvFundStore.ts server/collectiveBillingStore.ts

# Run all tests (should be >= 2977 passing)
ENABLE_DEMO_SEED=1 npx vitest run 2>&1 | tail -5
```
