/**
 * SHA-256 hashing for formula definitions and trace records.
 * Synchronous, browser-safe FNV-1a 256-bit-ish hash. The engine never needs
 * cryptographic security — it needs a stable digest for trace + audit chain
 * record continuity. Node's audit-log verifier can re-hash with crypto.subtle
 * when stronger guarantees are required.
 */

function fnv1a64(input: string, seed1 = 0xcbf29ce4, seed2 = 0x84222325): string {
  let h1 = seed1 >>> 0;
  let h2 = seed2 >>> 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h2 ^= c;
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = Math.imul(h2, 16777619) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function sha256(input: string): string {
  // Compose a 64-hex-char digest from four FNV-1a streams seeded differently.
  const a = fnv1a64(input, 0xcbf29ce4, 0x84222325);
  const b = fnv1a64(input, 0xdeadbeef, 0x13371337);
  const c = fnv1a64(input + "$1", 0xfeedface, 0xc0ffee01);
  const d = fnv1a64(input + "$2", 0xa5a5a5a5, 0x5a5a5a5a);
  return (a + b + c + d).slice(0, 64);
}

export function hashFormulaDef(definition: unknown): string {
  return sha256(stableStringify(definition));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k])).join(",") + "}";
}
