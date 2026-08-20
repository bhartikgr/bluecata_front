#!/usr/bin/env node
/**
 * WAVE 58f · F4 — MAKE "BYTE-IDENTICAL" PROVABLE.
 *
 * WHY THIS EXISTS. Wave 58e's independent Review 1 graded the guard's
 * byte-identity **CANNOT VERIFY**: no genuine pre-wave copy of
 * `shared/roundMathEngineAdapter.ts` existed to diff against (the mutation
 * harness's `.bak` was taken AFTER the wave's edits, so it matched the
 * after-tree and proved nothing about the before-tree). An assertion of
 * non-modification is not evidence of non-modification.
 *
 * WHAT IT DOES. Extracts the `InvalidDiscountWireValueError` region
 * DETERMINISTICALLY — by two literal anchors, not by line numbers, which drift
 * on every edit above them — and prints its sha256 plus the sha256 of the whole
 * file. Recording these lets a FUTURE wave recompute and compare instead of
 * asserting.
 *
 * THE REGION. From the doc-comment that introduces the error class through the
 * closing brace of `readDiscountFraction` — i.e. the sole `[0,1]` arbiter and
 * its only reader. This is the block the binding constraints require to remain
 * unweakened, unbypassed and unduplicated.
 *
 * NOTE ON SCOPE. The whole-file hash CHANGES legitimately when prose elsewhere
 * in the file is corrected (Wave 58f · F3 does exactly that). The BLOCK hash is
 * the one that must hold. Both are recorded so the distinction is auditable
 * rather than argued.
 *
 *   node scripts/w58f_guard_block_hash.mjs [path-to-adapter]
 */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const REL = process.argv[2] ?? "shared/roundMathEngineAdapter.ts";
const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const FILE = path.isAbsolute(REL) ? REL : path.join(ROOT, REL);

const START = "/** Raised instead of guessing the unit of an out-of-domain discount. */";
const END = "export function readDiscountFraction(raw: unknown, securityId: string): number | undefined {";

const src = fs.readFileSync(FILE, "utf8");
const i = src.indexOf(START);
if (i < 0) { console.error(`ANCHOR_NOT_FOUND (start): ${START}`); process.exit(3); }
const j = src.indexOf(END, i);
if (j < 0) { console.error(`ANCHOR_NOT_FOUND (end): ${END}`); process.exit(3); }
/* End of the region = the closing brace of readDiscountFraction. Found by
   scanning forward to the first line that is exactly "}" — the function has no
   nested block that starts a line with a bare closing brace. */
const rest = src.slice(j);
const k = rest.indexOf("\n}\n");
if (k < 0) { console.error("ANCHOR_NOT_FOUND (end brace of readDiscountFraction)"); process.exit(3); }
const block = src.slice(i, j + k + 3);

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

console.log(`file                : ${REL}`);
console.log(`file_sha256         : ${sha(src)}`);
console.log(`file_bytes          : ${Buffer.byteLength(src, "utf8")}`);
console.log(`block_anchor_start  : ${JSON.stringify(START)}`);
console.log(`block_anchor_end    : ${JSON.stringify(END)}`);
console.log(`block_sha256        : ${sha(block)}`);
console.log(`block_bytes         : ${Buffer.byteLength(block, "utf8")}`);
console.log(`block_lines         : ${block.split("\n").length}`);
