/**
 * v23.4.6 — Build artifact markers.
 *
 * These string literals are intentionally retained through esbuild's
 * production minification (it does not collapse string literals that
 * end up referenced from the entry chunk). They allow CI / release
 * gate checks to confirm a given bundle ships with all the v23.4.5
 * + v23.4.6 fixes by greping the built JS for these tokens:
 *
 *   - tryRecoverFromCompanyNotFound  (v23.4.5 queryClient guard)
 *   - VALIDATION_FAILED              (v23.4.5 profile validation guard)
 *   - formatActor                    (v23.4.5 activity actor formatter)
 *   - missingRequired                (v23.4.5 company-page required-field guard)
 *   - inverse-migration              (v23.4.4 hash-route inverse-migration shim)
 *
 * The array is `export const`, imported from `main.tsx`, so the linker
 * cannot tree-shake it away. We do NOT consume the markers at runtime —
 * the import alone is enough to keep the literals in the bundle.
 */
export const V2346_BUILD_MARKERS: readonly string[] = [
  "tryRecoverFromCompanyNotFound",
  "VALIDATION_FAILED",
  "formatActor",
  "missingRequired",
  "inverse-migration",
] as const;
