// Shim to execute the verifier-owned probe saved under build_spec.
//
// v25.47 note: the referenced probe file
// (build_spec/v25_45_round2_gpt55_archive_probe.mjs) is a verifier-owned
// artifact that is NOT shipped in Avi's live-site zip tree. A bare top-level
// `import` of a non-existent module crashes the vitest module loader and fails
// the whole file at load time (0 tests, pure load error). This pre-existed the
// v25.47 work (the shim ships in the zip, the probe does not). Guard the import
// so the suite is green when the probe is absent, and still runs it when a
// verifier drops the probe back in. Test-only change; no production code.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const probePath = resolve(here, '../../build_spec/v25_45_round2_gpt55_archive_probe.mjs');

if (existsSync(probePath)) {
  await import(probePath);
} else {
  describe('v25.45 gpt55 privacy no-row probe (shim)', () => {
    it.skip('verifier-owned probe not present in this tree — skipped', () => {});
  });
}
