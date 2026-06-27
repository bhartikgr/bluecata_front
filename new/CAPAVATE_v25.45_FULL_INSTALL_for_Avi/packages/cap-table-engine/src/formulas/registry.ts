/**
 * Formula registry — versioned, region-aware records.
 *
 * Each formula is a `{ id, region, version, status, definition, citation }` record
 * with a runtime evaluator. Custom variants (admin-created) can be added by calling
 * `registerFormula()` at runtime — the engine evaluates by `(formulaId, region)`.
 */
import type { FormulaRecord, Region } from "../types.js";
import { US_FORMULAS } from "./us-default.js";
import { CA_FORMULAS } from "./ca-default.js";
import { UK_FORMULAS } from "./uk-default.js";
import { SG_FORMULAS } from "./sg-default.js";
import { HK_FORMULAS } from "./hk-default.js";
import { CN_FORMULAS } from "./cn-default.js";
import { IN_FORMULAS } from "./in-default.js";
import { JP_FORMULAS } from "./jp-default.js";
import { AU_FORMULAS } from "./au-default.js";

const _registry: Map<string, FormulaRecord> = new Map();

function key(id: string, region: Region, version: string): string {
  return `${region}:${id}:${version}`;
}

export function registerFormula(f: FormulaRecord): void {
  _registry.set(key(f.id, f.region, f.version), f);
}

export function getFormula(id: string, region: Region, version?: string): FormulaRecord | undefined {
  if (version) return _registry.get(key(id, region, version));
  // pick latest active version
  const candidates = Array.from(_registry.values()).filter(
    (f) => f.id === id && f.region === region && f.status === "active",
  );
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => semverCompare(b.version, a.version));
  return candidates[0];
}

export function listFormulas(region?: Region): FormulaRecord[] {
  const all = Array.from(_registry.values());
  return region ? all.filter((f) => f.region === region) : all;
}

function semverCompare(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

// Bootstrap built-in formulas
[
  ...US_FORMULAS,
  ...CA_FORMULAS,
  ...UK_FORMULAS,
  ...SG_FORMULAS,
  ...HK_FORMULAS,
  ...CN_FORMULAS,
  ...IN_FORMULAS,
  ...JP_FORMULAS,
  ...AU_FORMULAS,
].forEach(registerFormula);

export const REGIONS: Region[] = ["US", "CA", "UK", "SG", "HK", "CN", "IN", "JP", "AU", "Custom"];

/** Convenience: by id only, fall back through region preference order. */
export function resolveFormula(id: string, preferRegion: Region): FormulaRecord {
  const f = getFormula(id, preferRegion) ?? getFormula(id, "US");
  if (!f) {
    // Synthesise a minimal record so the engine can keep computing for ids that
    // don't have an entry yet (option.exercise, warrant.exercise are mechanical).
    return {
      id, name: id, region: preferRegion, version: "1.0.0", status: "active",
      category: "ownership",
      citation: { source: "engine internal", url: "" },
      definition: { formula: id },
    };
  }
  return f;
}
