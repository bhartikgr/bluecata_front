# Anti-Silent-Drop Build Guard

A build-time **inventory guard** that HARD-FAILS the build when *primary
functionality* present in a committed baseline has **disappeared** and has not
been explicitly approved for removal.

This is the **presence** analog of the sacred byte-check: the byte-check proves
sacred files did not *change*; this guard proves tracked functionality did not
*vanish*. It protects every subsequent v26.1.x wave from silent drops (rule #8).

## What "primary functionality" means

Three inventories are extracted by a static scan of **source** (never build
bundles, `node_modules`, `dist`, `build`, or `*.test.*` / `*.spec.*`):

1. **Server routes** — every Express `app.(get|post|put|patch|delete)("<path>" …)`
   registration across `server/**/*.ts` (excludes `server/public/**` and tests).
   Normalized to `METHOD path`, e.g. `POST /api/investors/:id/kyc`. Non-string
   paths (template literals / variables like `` `${BASE}/:id` ``) are preserved
   verbatim as `METHOD <expr:…>` so they can never be silently dropped.
2. **Client routes / pages** — every wouter `<Route path="…" …>` in
   `client/src/**/*.tsx`. Normalized to the path string.
3. **Client nav entries** — every nav item object (`{ href, label, … }`) in the
   shell components (`client/src/**/*Shell*.tsx`, i.e. `AppShell.tsx`,
   `CollectiveShell.tsx`, `partner/PartnerShell.tsx`, plus any other `*Shell*.tsx`).
   Normalized to `path\tlabel`.

Extraction uses the TypeScript compiler API (AST), so multi-line calls,
template literals, and non-literal args are all handled deterministically. Every
inventory is **sorted and de-duplicated** — running the extractor twice always
yields byte-identical output.

## Files

| File | Purpose |
| --- | --- |
| `extract-inventory.ts` | Pure, side-effect-free scanner. Returns the 3 inventories as sorted arrays. |
| `guard.ts` | CLI entry: builds the current inventory, loads baseline + allow-list, computes `DISAPPEARED = baseline − current − allowlist`, and fails the build if it is non-empty. |
| `baseline.json` | The source of truth for "what existed": `{ generatedAt, gitHead, routes[], clientRoutes[], nav[] }`. Auto-generated and **checked in**. |
| `allowlist.json` | Explicit, logged approvals for intentional removals. Starts **empty**. |
| `__tests__/guard.test.ts` | Unit tests for the guard + extractor. |

## How to run

```bash
npm run guard
```

- **Green** (`exit 0`): `OK: N routes, M pages, K nav — no silent drops`.
  Newly added items are printed as `INFO:` and never fail the build.
- **Red** (`exit 1`): prints `SILENT DROP DETECTED — build BLOCKED` followed by
  the exact identifier of every dropped route / page / nav entry.

The guard runs automatically at the **start of `npm run build`** (see
`build.ts`, which invokes it before building the client/server and aborts on a
non-zero exit). `npm run dev` does **not** run it — only build/release do.

## How to approve an intentional removal

A silent drop is a hard failure by design. If a removal is **deliberate and
Ozan-approved**, choose one of:

1. **Allow-list it (preferred for a small, logged removal).** Add the exact
   baseline id to `allowlist.json` under the matching key, using the object form
   with `reason` / `approvedBy` / `date`:

   ```json
   {
     "removedRoutes": [
       { "id": "POST /api/legacy/foo", "reason": "endpoint deprecated in v26.1", "approvedBy": "Ozan", "date": "2026-07-15" }
     ],
     "removedClientRoutes": [],
     "removedNav": []
   }
   ```

   The guard then ignores that specific disappearance and stays green.

2. **Re-baseline (for a large, approved change set).** After Ozan approves,
   regenerate the baseline to accept the current tree as the new truth:

   ```bash
   tsx scripts/silent-drop-guard/guard.ts --update-baseline
   ```

   This overwrites `baseline.json` (with a fresh `generatedAt` + `gitHead`) and
   must be **checked in** as a visible, reviewable change.

Removals are therefore never silent: they require either an explicit checked-in
allow-list entry (with reason/approvedBy/date) or a deliberate, reviewable
`--update-baseline` commit.

## The guard is itself a no-silent-drop tool

This guard only **adds** files (`scripts/silent-drop-guard/**`) and a
`package.json` script plus a build hook. It modifies no existing route, page, or
nav entry, and removes nothing.
