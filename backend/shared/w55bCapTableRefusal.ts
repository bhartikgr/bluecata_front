/**
 * WAVE 55b · OQ-3 — the ONE place the cap-table-family load-failure status is
 * written down, so the client-side render test and the HTTP-route test cannot
 * drift apart.
 *
 * WHY A SHARED CONSTANT AND NOT A HAND-PICKED NUMBER IN THE CLIENT TEST:
 * the founder cap table's data comes from an HTTP route, so its failure state
 * must be the failure the route actually produces. The client render test runs
 * under jsdom, where Vite resolves imports for the browser and pulling
 * `server/routes.ts` in fails on optional server-only AWS SDK sub-packages. So
 * the proof is split and pinned:
 *
 *   server/__tests__/w55b_captable_family_refusal_http.test.ts
 *       boots the REAL `registerRoutes` Express stack and asserts each of the
 *       three cap-table-family read routes returns EXACTLY this status to a
 *       principal with no relationship to the company.
 *
 *   client/src/pages/founder/__tests__/w55b_captable_empty_vs_failed.test.tsx
 *   client/src/components/founder/__tests__/w55b_captable_interim_empty_vs_failed.test.tsx
 *   client/src/components/investor/__tests__/w55b_discuss_comembers_empty_vs_failed.test.tsx
 *       replay exactly this status into the component.
 *
 * If a future wave changes the routes' refusal status, the HTTP test fails here
 * rather than the render tests quietly asserting against a status that no longer
 * happens. It is 404 and not 403 by standing policy: a 403 confirms the resource
 * exists (see server/lib/capTableSinkScope.ts and WAVE 42 · F-9).
 */
export const W55B_CAP_TABLE_REFUSAL_STATUS = 404;

/** The three cap-table-family READ routes this wave's refusals are keyed to. */
export const W55B_CAP_TABLE_FAMILY_READ_ROUTES = [
  "/api/companies/:id/securities",
  "/api/companies/:id/captable/interim",
  "/api/investor/companies/:id/co-members",
] as const;
