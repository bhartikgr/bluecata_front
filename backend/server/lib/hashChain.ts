/**
 * Sprint 14 D8 — Universal hash chain primitive.
 *
 * Per Pattern 2 + harvest_capavate §2: every aggregate gets its own append-
 * only chain so tampering is detectable and the platform's audit story is
 * uniform across stores.
 *
 * Each store creates a `HashChain<T>` instance, calls `.append(body)` on
 * mutation, and exposes `.verify()` via a per-aggregate route mounted by
 * the central registrar in this file (`registerHashChainVerifyRoute`).
 *
 * Tamper detection: when `.verify()` returns `ok=false`, the chain emits an
 * `aggregate.compromised` event and locks itself (`compromised=true`). All
 * subsequent `.append()` calls fail until `.unlockBySignedAdminAck()` is
 * called by an admin SES check.
 */
import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";

export interface ChainEntry<T> {
  seq: number;
  ts: string;
  prevHash: string;
  hash: string;
  body: T;
}

export interface VerifyResult {
  ok: boolean;
  brokenAt?: number;
  length: number;
  head: string;
}

export class HashChain<T extends Record<string, unknown>> {
  readonly aggregate: string;
  private entries: ChainEntry<T>[] = [];
  private head = "GENESIS";
  private compromised = false;
  private onCompromise?: (broken: VerifyResult) => void;

  constructor(aggregate: string, onCompromise?: (broken: VerifyResult) => void) {
    this.aggregate = aggregate;
    this.onCompromise = onCompromise;
  }

  isCompromised(): boolean { return this.compromised; }

  /** Append a body to the chain. Throws if the chain is locked. */
  append(body: T): ChainEntry<T> {
    if (this.compromised) {
      throw new Error(`hash_chain_locked:${this.aggregate}`);
    }
    const seq = this.entries.length;
    const ts = new Date().toISOString();
    const json = JSON.stringify({ seq, ts, body });
    const hash = createHash("sha256").update(`${this.head}|${json}`).digest("hex").slice(0, 24);
    const entry: ChainEntry<T> = { seq, ts, prevHash: this.head, hash, body };
    this.entries.push(entry);
    this.head = hash;
    return entry;
  }

  /** Re-derive every hash and confirm chain integrity. */
  verify(): VerifyResult {
    let prev = "GENESIS";
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.prevHash !== prev) return this._broken(i);
      const json = JSON.stringify({ seq: e.seq, ts: e.ts, body: e.body });
      const expected = createHash("sha256").update(`${prev}|${json}`).digest("hex").slice(0, 24);
      if (expected !== e.hash) return this._broken(i);
      prev = e.hash;
    }
    return { ok: true, length: this.entries.length, head: this.head };
  }

  private _broken(i: number): VerifyResult {
    const r: VerifyResult = { ok: false, brokenAt: i, length: this.entries.length, head: this.head };
    if (!this.compromised) {
      this.compromised = true;
      this.onCompromise?.(r);
    }
    return r;
  }

  list(): readonly ChainEntry<T>[] { return this.entries; }
  byId<K extends keyof T>(idField: K, id: T[K]): ChainEntry<T> | undefined {
    return this.entries.find((e) => e.body[idField] === id);
  }
  filter(idField: keyof T, id: unknown): ChainEntry<T>[] {
    return this.entries.filter((e) => e.body[idField] === id);
  }

  /** Test/admin-only: simulate tamper by mutating an entry in place. */
  __tamperForTest(seq: number, mutator: (b: T) => T): void {
    const e = this.entries[seq];
    if (e) e.body = mutator(e.body);
  }

  /** Admin SES sign-off — re-verify, and if still broken stay locked. */
  unlockBySignedAdminAck(adminAck: { userId: string; sesToken: string }): VerifyResult {
    if (!adminAck.sesToken || !adminAck.userId) {
      return this.verify();
    }
    // Re-verify; if still broken, stay locked. Else clear.
    const r = this.verify();
    if (r.ok) this.compromised = false;
    return r;
  }

  __clear(): void {
    this.entries.length = 0;
    this.head = "GENESIS";
    this.compromised = false;
  }
}

/* ===========================================================================
 * Registry — every chain registers itself so /api/audit/verify can locate it
 * by aggregate-name.
 * ======================================================================== */
const registry = new Map<string, HashChain<any>>();

export function registerChain<T extends Record<string, unknown>>(chain: HashChain<T>): HashChain<T> {
  registry.set(chain.aggregate, chain);
  return chain;
}

export function getChain(aggregate: string): HashChain<any> | undefined {
  return registry.get(aggregate);
}

export function listChains(): readonly string[] { return Array.from(registry.keys()); }

/** Register the universal verify endpoint. */
export function registerHashChainVerifyRoute(app: Express): void {
  app.get("/api/audit/verify", (req: Request, res: Response) => {
    const aggregate = String(req.query.aggregate ?? "");
    if (!aggregate) {
      // Verify all
      const all: Record<string, VerifyResult> = {};
      for (const [name, chain] of registry.entries()) all[name] = chain.verify();
      const ok = Object.values(all).every((r) => r.ok);
      return res.json({ ok, chains: all });
    }
    const chain = registry.get(aggregate);
    if (!chain) return res.status(404).json({ error: `unknown_aggregate:${aggregate}` });
    const id = req.query.id;
    if (id) {
      const matches = chain.filter("id", String(id));
      return res.json({ aggregate, id, entries: matches, verify: chain.verify() });
    }
    return res.json({ aggregate, verify: chain.verify(), length: chain.list().length });
  });

  app.get("/api/audit/chains", (_req, res) => {
    res.json({ chains: listChains() });
  });
}

/** Test helper. */
export function __clearAllChains(): void {
  for (const c of registry.values()) c.__clear();
}
