# Avi Hand-Edits Inventory — DO NOT OVERWRITE

**Last updated:** 29 May 2026 (v23.4.8)
**Owner:** Computer (master agent) + Avinay (deployment owner)
**Purpose:** This document lists every file in this tree where Avinay has applied manual fixes that **must be preserved across every fix wave we ship**. If you touch any file listed here, verify Avi's fix is still intact AFTER your edits — and re-apply if necessary.

## How to use this list

Before packaging any zip:

```bash
cd /home/user/workspace/avi_v19_tree

# Hash-link discipline — must always return ZERO across these files
grep -rn 'href="#/\|"https://capavate.com/#/' client/src/components/home3compo/ 2>&1
# Expect: no output. If you see hits, re-run the sed fix below before zipping.
```

The reapply command (idempotent):
```bash
for f in client/src/components/home3compo/AudiencesSection.jsx \
         client/src/components/home3compo/FinalCTA.jsx \
         client/src/components/home3compo/Footer3.jsx \
         client/src/components/home3compo/Header3.jsx \
         client/src/components/home3compo/Hero.jsx \
         client/src/components/home3compo/LearnSection.jsx \
         client/src/components/home3compo/PricingSection.jsx; do
  sed -i -E 's|"https://capavate\.com/#/|"https://capavate.com/|g; s|href="#/|href="/|g' "$f"
done
```

---

## Preserved fixes

### 1. Path-based routing on landing-page anchors (Avi's fix, 29 May 2026)

**Files:**
- `client/src/components/home3compo/AudiencesSection.jsx`
- `client/src/components/home3compo/FinalCTA.jsx`
- `client/src/components/home3compo/Footer3.jsx`
- `client/src/components/home3compo/Header3.jsx`
- `client/src/components/home3compo/Hero.jsx`
- `client/src/components/home3compo/LearnSection.jsx`
- `client/src/components/home3compo/PricingSection.jsx`

**The fix:** every `<a href="#/...">` is replaced with `<a href="/...">`, and every `"https://capavate.com/#/..."` is replaced with `"https://capavate.com/..."`. These pages were originally written when Capavate used a HashRouter (Sprint 16 era) but the app has used BrowserRouter since v23.4.3 — those hash links still worked via the v23.4.4 inverse-migration shim, but only by triggering a full page reload, which is jarring UX.

**Avi's complaint (29 May 2026):**
> "but one most important thing my changes are getting removed every time because of the AI. For example, on this page: https://capavate.com/#/partner/login, I had fixed the '#' issue, but in the new ZIP file that code is missing."

**Status as of v23.4.8:** PERMANENTLY FIXED in the canonical tree. Future zips ship with the correct path-based hrefs. No more re-overwriting Avi's work.

---

## Discipline going forward

When opening a new fix wave (vX.Y.Z):
1. Read this document first.
2. Run the verification grep at the top.
3. If Avi reports another manual fix that's getting overwritten — add it to this inventory and apply it permanently in the canonical tree.

When closing a fix wave:
1. Re-run the verification grep.
2. Confirm zero hits.
3. Note any new preserved fixes added in the wave's master report.

---

## Post-v23.4.8 status

**Date:** 29 May 2026
**Wave:** v23.4.8 (4-phase fix wave)

**Verification at wave close:**
- `grep -rn 'href="#/' client/src/components/home3compo/` → **0 hits**
- `grep -rn '"https://capavate.com/#/' client/src/components/home3compo/` → **0 hits**
- Avi's path-based routing fix from 29 May 2026 (#1 above) remains intact across all 7 `home3compo/*.jsx` files.

**New preserved fixes added in v23.4.8:** None. No phase in v23.4.8 touched `client/src/components/home3compo/`.

**New CI guard added:**
- `scripts/verify_avi_preserved.sh` — lightweight bash check that fails non-zero if hash-link regressions reappear in `home3compo/`. Wire this into any future pre-commit / CI flow.

  Usage:
  ```bash
  ./scripts/verify_avi_preserved.sh
  ```
  Expected output: `PASS: no Avi-preserved-edit regressions`
