/**
 * Minimal type declaration for bcryptjs (CP-041).
 *
 * The bcryptjs npm package ships without an official .d.ts and we don't
 * want to take @types/bcryptjs as a dev-dep just for two functions. The
 * surface we use is:
 *   - hashSync(plaintext, salt | costFactor): string
 *   - compareSync(plaintext, hash): boolean
 */

declare module "bcryptjs" {
  /**
   * Synchronously generates a hash for the given string.
   * @param s plaintext
   * @param salt either a pre-generated salt string OR a cost factor (number).
   */
  export function hashSync(s: string, salt: string | number): string;

  /** Synchronously verifies a plaintext string against a stored hash. */
  export function compareSync(s: string, hash: string): boolean;

  /** Synchronously generates a salt of the given cost factor. */
  export function genSaltSync(rounds?: number): string;

  /** Async equivalents (not used by Capavate but exposed for completeness). */
  export function hash(s: string, salt: string | number): Promise<string>;
  export function compare(s: string, hash: string): Promise<boolean>;
  export function genSalt(rounds?: number): Promise<string>;

  const _default: {
    hashSync: typeof hashSync;
    compareSync: typeof compareSync;
    genSaltSync: typeof genSaltSync;
    hash: typeof hash;
    compare: typeof compare;
    genSalt: typeof genSalt;
  };
  export default _default;
}
