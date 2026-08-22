# Anti-Silent-Drop Build Guard

A build-time **inventory guard** that HARD-FAILS the build when *primary
functionality* present in a committed baseline has **disappeared** and has not
been explicitly approved for removal.

This is the **presence** analog of the sacred byte-check: the byte-check proves
sacred files did not *change*; this guard proves tracked functionality did not
*vanish*. It protects every subsequent v26.1.x wave from silent drops (rule #8).

> ### CORRECTION — WAVE 0, 2026-08-21. THIS README UNDER-SELLS THE GUARD.
>
> The section below documents **three** inventories. `extract-inventory.ts`
> actually maintains **eight**, plus a ninth derived one: `routes`,
> `clientRoutes`, `nav`, `tabs`, `buttons`, `events`, `copy`, `panels`, plus
> `routeTargets`. A clean run prints all of them, e.g.
> *"OK: 1178 routes, 208 pages, 108 nav, 208 route targets, 306 tabs, 1129
> buttons, 2475 events, 8079 copy, 17827 panels — no silent drops"*.
> The stale text was causing the guard to be **under-trusted**, so this note is
> here rather than a rewrite: the three descriptions below are still accurate for
> the three they describe.
>
> ### WHAT THE GUARD DOES NOT COVER — and where that is covered instead
>
> Three holes were located in this file's source during the design-system
> pre-flight. All three are the kind a **restyle** falls through:
>
> | # | Hole | Where in this directory | Sites |
> |---|---|---|---|
> | H1 | A copy attribute whose value is an **expression** is skipped: `if (v && !v.startsWith("<expr:")) out.copy.add(…)` | `extract-inventory.ts` | 143 |
> | H2 | **Toast copy is not inventoried at all** — the string `toast` appears nowhere in `extract-inventory.ts` | — | 1,141 strings |
> | H3 | **JSX expression children are not copy** — the walk handles `ts.isJsxText` only, so `<td>{formatMinor(x)}</td>` is invisible, and that is where every rendered NUMBER lives | the `visitLive` callback | 8,176 |
>
> H1–H3 are covered by **`scripts/restyle-drop-detector/`**, which is wired into
> `npm run preflight` as `npm run drop:restyle`. Its both-poles proof
> (`npm run drop:restyle:poles`) includes a mutation that empties a money figure
> while leaving its `data-testid` in place — a mutation THIS guard, the
> reachability gate, `tsc` and the whole vitest suite all pass.
> **Neither instrument replaces the other. Run both.**

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

## WAVE 11 — container fingerprinting: child SETS, not concatenated text

A container used to be fingerprinted two ways that both conflated *addition*
with *removal*:

1. its identity fell back to `text=<the concatenated text of all its children>`;
2. its body was `children=<n>:<digest of the joined child sequence>`.

Under that scheme adding a child rewrote the container's own record, the old
record was absent from the new inventory, and the guard reported the container
as **REMOVED**. It blocked real product work twice: WAVE 4B could not add a
column to the partner roster `<table>`, and WAVE 10 could not add a twelfth tab
to `SpvDetailTabs.tsx` (`REMOVED tabs (1)` with nothing removed) — that wave
reverted and routed around the guard. Four of the six `removedPanels`
allow-list entries were owner-blessed "CONTENT HASH CHURN, not a dropped panel",
i.e. the owner was being asked to sign off on the guard's false positives.

Now:

| Record | Meaning |
| --- | --- |
| `<file>\t<Tag>\t<identity>\tchild=<token>#<k>` | the k-th direct child with that token. **Membership**: appending a child adds `#k+1`; removing one makes `#k` disappear, so cardinality is still enforced. |
| `…\tinner=<Tag>#<k>` | a tag rendered inside a conditional/mapped expression child, as a sorted multiset. The old `{Tag,Tag,…}` token was the same concatenation defect one level down. |
| `…\tchildorder=<a\|b\|c>` | the child order, compared by `guard.ts` as a **subsequence** (`orderRegressions`): insertion passes, removal and reordering fail. Diffing this as a set member would report every insertion as a removal, so it is excluded from the set diff. |

Container identity never uses concatenated descendant text. It prefers a stable
attribute (`data-testid`, `id`, `name`, `value`, `aria-label`, `title`) and only
otherwise falls back to `at=<enclosing decl>:<ancestor tag chain>#<ordinal>`.
The ordinal counts every same-tag/same-path container, attribute-keyed or not,
so adding a `data-testid` to a sibling does not renumber its neighbours. The
same rule applies to the `tabs` class for `TabsList` / `Tabs` / `TabsContent` /
`TabPanel`: a tab CONTAINER is no longer keyed on the labels of its children.
Text removed from inside a container is still caught by the `copy` class, which
records every text node individually.

**Known limit, asserted explicitly** in `__tests__/wave11-child-membership.test.ts`
(11b): permuting siblings that share a tag (four `<TableHead>` swapped among
themselves) is invisible. The pre-WAVE-11 digest — `digest("TableHead|TableHead|
TableHead|TableHead")` — could not see it either, and a permutation drops
nothing.

Proven **both ways** in `__tests__/wave11-child-membership.test.ts` (20 tests,
opening with an anti-vacuity block that proves the fixture is on disk and was
collected, per the DA-3 lesson): adding a tab, appending a column, inserting a
column mid-table and adding a field inside a mapped row all exit 0; removing a
tab, removing a column, removing one cell from a mapped row, an add+remove in
one edit, reordering distinct children and emptying a panel all exit 1 and name
the loss.

After the change the companion baseline was regenerated from the verified,
read-only G-0 snapshot (`npm run guard:companion`) — the only sanctioned path —
and `npm run guard` reports **zero drops with no new allow-list entries**.
`baseline.json` is untouched (`8e8b8856…`).
