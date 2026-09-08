/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ITEM 11 — a founder clicked a search result and landed on a dead page.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `server/founderSearchStore.ts` built every investor-contact search hit with
 * `href: "/founder/investor-crm"`. THAT IS AN API PATH IN A UI SLOT. `href` is
 * where the browser is sent; `/api/founder/investor-crm` is where the data comes
 * from. The client router registers `/founder/crm` and `/founder/crm/new` and
 * nothing resembling `investor-crm`, so the link went nowhere.
 *
 * THE OTHER HALF OF THE FINDING WAS NOT REAL and nothing was built for it: the
 * claim that global search does not index CRM contacts. It does — the block that
 * produced this very `href` is the CRM-contact indexer. Test 3 pins that, so the
 * failed premise is recorded in the suite rather than re-investigated later.
 *
 * THE INSTRUMENT: this test does not read the source file for a string. It reads
 * the ROUTES THE CLIENT ROUTER ACTUALLY REGISTERS out of `client/src/App.tsx`
 * and requires the produced `href` to be one of them. A hand-copied list of
 * "valid routes" would be a replica that cannot catch the next paste of a server
 * path into a client slot; this cannot pass unless the route really exists.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const APP_TSX = path.resolve(__dirname, "../../client/src/App.tsx");
const SEARCH_STORE = path.resolve(__dirname, "../founderSearchStore.ts");

/** Every literal `<Route path="…">` the client router registers. */
function registeredRoutes(): string[] {
  const src = fs.readFileSync(APP_TSX, "utf8");
  const out: string[] = [];
  const re = /<Route\s+path=\{?"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

/** The `href` the contact-hit block assigns, read from the source it is written in. */
function contactHrefLiteral(): string | null {
  const src = fs.readFileSync(SEARCH_STORE, "utf8");
  /* Anchored on the hit's OWN discriminator rather than a comment heading. The
     first attempt sliced from the "Investor CRM contacts" comment and picked up
     the ROUNDS href instead — the instrument was wrong before the product was,
     which is exactly why it was validated by a control first. */
  const anchor = src.indexOf(`kind: "contact"`);
  if (anchor < 0) return null;
  const m = /href:\s*`([^`]+)`/.exec(src.slice(anchor));
  return m ? m[1] : null;
}

describe("ITEM 11 · a contact search hit points at a route that exists", () => {
  it("0 · CONTROL — the instrument really found the router's routes", () => {
    const routes = registeredRoutes();
    /* rows > 0 PRECONDITION. If the regex matched nothing, every `includes`
       below would fail for the wrong reason and a later `not.toContain` would
       pass for the wrong reason. */
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain("/founder/crm");
    /* And the instrument is honest about absence: the old string is genuinely
       not a route. This is the measurement the whole item rests on. */
    expect(routes).not.toContain("/founder/investor-crm");
  });

  it("1 · the produced href IS one of the registered routes", () => {
    const href = contactHrefLiteral();
    expect(href).toBeTruthy();
    expect(registeredRoutes()).toContain(href as string);
  });

  it("2 · the API path is no longer used as a destination", () => {
    expect(contactHrefLiteral()).not.toBe("/founder/investor-crm");
    expect(contactHrefLiteral()).not.toMatch(/^\/api\//);
  });

  it("3 · FAILED PREMISE, PINNED — global search DOES index CRM contacts", () => {
    const src = fs.readFileSync(SEARCH_STORE, "utf8");
    /* The indexer exists: it selects from the contacts table and pushes hits of
       kind "contact". The finding claimed it did not, and nothing was built. */
    expect(src).toContain("investor_crm_contacts");
    expect(src).toContain(`kind: "contact"`);
  });
});
