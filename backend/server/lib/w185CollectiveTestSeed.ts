/**
 * WAVE 185 · ITEM C · OWNER RULING Q8 — "Populate/seed with a test members."
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS. Wave 183 established that the Collective is REAL but
 * UNPOPULATED: all 15 gated pages exist, every route is present, every query is
 * real — and `collective_memberships` holds 3 rows while 18 related tables hold
 * zero. The gate screen the owner saw was largely correct behaviour, so nothing
 * could be verified because there was nothing to render. This module creates
 * exactly enough test data that the gated pages render real content.
 *
 * ═══ THE FIVE RULES THIS MODULE IS BUILT AROUND ══════════════════════════════
 *
 * 1. NEVER ON BOOT. There is no import-time side effect here and NO migration.
 *    Migrations run automatically at production start, which is precisely what
 *    the ruling forbids, so the mechanism is an ADMIN-INVOKED route calling
 *    `seedW185CollectiveTestData()`. A production start that nobody clicks
 *    anything on creates nothing. This is also why wave 185 consumes no
 *    migration number and cannot collide with wave 184's.
 *
 * 2. UNMISTAKABLY TEST DATA, PRECISELY DELETABLE. Every primary key contains the
 *    literal token `w185_test`; every human-readable field starts with the
 *    literal prefix `W185 TEST — `; every email ends `@w185.test.invalid`, a
 *    domain reserved by RFC 2606 that can never receive mail. One grep finds
 *    everything; `purgeW185CollectiveTestData()` removes it; the exact criteria
 *    are written out in `build_log/wave185/COLLECTIVE_SEED_CLEANUP.md`.
 *
 * 3. IDEMPOTENT. Every write is keyed on a deterministic id and every statement
 *    is `INSERT … ON CONFLICT DO NOTHING` or an explicit existence check. Running
 *    the seeder twice leaves the same rows and reports `alreadyPresent`.
 *
 * 4. NOT ONE UNIT OF INVENTED MONEY. No fee, price, commission or capital figure
 *    is written anywhere. The chapter's `membership_fee_annual_minor` is set
 *    EXPLICITLY NULL rather than 0, because 0 is a PRICE — a claim that
 *    membership is free — while NULL is the absence of one, and wave 184 is
 *    making fees database-driven where a seeded 0 would read as a real
 *    configured amount. The only figure this module writes at all is the
 *    soft-circle sentinel `1111.11` / `111111` minor, which exists because those
 *    columns are `NOT NULL` under money type-floor triggers and which is
 *    self-evidently not a real commitment.
 *
 * 5. NO REAL ENTITLEMENT, NO CONTACT WITH THE OWNER'S ACCOUNTS. The seeded
 *    members get a `collective_memberships` row and a `chapter_memberships` row
 *    in a DEDICATED sandbox chapter, and nothing else. This module writes NO
 *    `captable_commits`, NO `spv_subscription`, NO `investor_identity_alias`, NO
 *    `partner_team_members` and NO admin role — so it cannot widen anybody's
 *    messaging reach, cannot manufacture a cap-table position, and cannot appear
 *    in any real chapter's roster. It never reads or writes a row belonging to a
 *    real user, and it binds to no existing account.
 *
 * COMPANIES ARE ADOPTED, NOT INVENTED. `collective_directory_listings.company_id`
 * is UNIQUE and the Companies page joins to `companies`, so listing a company
 * means claiming one. Rather than fabricate company records — which would then
 * need cap tables, rounds and valuations to render, and which the owner would
 * have to identify among real ones during cleanup — the seeder LISTS EXISTING
 * DEMO companies (`companies.is_demo = 1`) into the sandbox chapter and records
 * which listing rows it created. Cleanup deletes the LISTINGS; the companies are
 * left exactly as they were, because they were never ours.
 */
import { rawDb } from "../db/connection";
import { writeUserPrivacy } from "./userPrivacyResolver";
/* ══════════════════════════════════════════════════════════════════════════════
   THE GATE HAS FOUR STEPS, NOT ONE. THE PREFLIGHT MAP HAD THIS WRONG.
   ══════════════════════════════════════════════════════════════════════════════
   `server/lib/requireCollectiveMember.ts` runs the W2-A1 decision tree:
     step 1  identity;
     step 2  an active `collective_memberships` row;
     step 3  A CAP-TABLE POSITION, unless the membership carries `cap_table_exempt`;
     step 4  A RECORDED ACCREDITATION SELF-DECLARATION — a "none" status is
             refused 403 ACCREDITATION_DECLARATION_REQUIRED, fail-closed.

   The first draft of this seeder satisfied steps 1-2 only, so every gated page
   would still have 403'd and Item C would have shipped a seed that seeds nothing
   visible. The test suite caught it. Both remaining steps are satisfied here, and
   HOW they are satisfied matters:

   STEP 3 IS SATISFIED BY THE EXEMPTION, NOT BY A CAP-TABLE POSITION. Writing
   `captable_commits` rows for the seeded members would have been the easy route
   and it is the WRONG one, for two independent reasons:
     (a) rule 5 of the brief — a cap-table position is a REAL ENTITLEMENT (it is
         ownership of equity in a real company, and it feeds portfolio, LP and
         valuation reads); and
     (b) IT WOULD HAVE WIDENED WHO CAN SEE WHOM — Item A of this very wave makes
         investor messaging peer resolution alias-aware over `captable_commits`,
         so a seeded member holding a position in a REAL company would become a
         reachable co-investor of that company's real investors, and its real
         investors would surface in the seeded member's recipient search. That is
         precisely the fence Item A refuses to trade away, and Item C would have
         breached it from the other direction.
   `cap_table_exempt = 1` bypasses step 3 AND ONLY step 3. It is the same durable
   flag admin-bootstrapped members already carry, it grants nothing, and it leaves
   `captable_commits` untouched.

   STEP 4 IS SATISFIED THROUGH THE PRODUCTION PRIMITIVE, not by an INSERT. The
   declaration table is append-only and hash-chained; writing it by hand would
   either break the chain or require reimplementing it. `recordAccreditationDeclaration`
   is the same function the live endpoint calls, and the declaration is stamped
   with the test label so it is as greppable as everything else. */
import { recordAccreditationDeclaration } from "../investorComplianceRoutes";
import { ACCREDITATION_CRITERIA } from "../../shared/accreditationClause";
import { tenantForChapter } from "./chapterDefaults";

/* ── THE CONVENTION, DECLARED ONCE ──────────────────────────────────────────
   Every deletion criterion in COLLECTIVE_SEED_CLEANUP.md is expressed in terms
   of these three literals. They are exported so the tests assert against the
   same constants the writes use, and so no future edit can change the marker in
   one place and leave the cleanup document describing the old one. */
export const W185_ID_TOKEN = "w185_test";
export const W185_LABEL_PREFIX = "W185 TEST — ";
export const W185_EMAIL_DOMAIN = "@w185.test.invalid";

/** The one sandbox chapter. Nothing is seeded into a real chapter, ever. */
export const W185_CHAPTER_ID = "chap_w185_test";
const W185_TENANT = "tenant_platform";
/* ══════════════════════════════════════════════════════════════════════════════
   CHAPTER-SCOPED TABLES LIVE IN A PER-CHAPTER TENANT, NOT `tenant_platform`.
   ══════════════════════════════════════════════════════════════════════════════
   `withTenant()` scopes the announcement and screening-event reads to
   `tenantForChapter(chapterId)` — literally `tenant_chap_<chapterId>`. The first
   draft wrote `tenant_platform` on those rows, so they existed in the database,
   were returned by a direct SELECT, and were INVISIBLE to the actual route: the
   Calendar page rendered empty with a fully "successful" seed. Read from the
   platform's own helper rather than reconstructed here, so the seed cannot drift
   from the convention the reads use. */
const W185_CHAPTER_TENANT = tenantForChapter(W185_CHAPTER_ID);
/** Stamped into `created_by` / `activated_by` so provenance is legible in SQL. */
const W185_ACTOR = "system:w185_test_seed";

/** The five test members. Deterministic ids: re-running cannot create a sixth. */
const W185_MEMBERS = [
  { n: 1, name: "Ada Sandbox", role: "investor" },
  { n: 2, name: "Bruno Sandbox", role: "investor" },
  { n: 3, name: "Chandra Sandbox", role: "investor" },
  { n: 4, name: "Dilek Sandbox", role: "investor" },
  { n: 5, name: "Elias Sandbox", role: "investor" },
] as const;

const userId = (n: number): string => `u_${W185_ID_TOKEN}_${n}`;
const contactId = (n: number): string => `ac_investor_${W185_ID_TOKEN}_${n}`;
const memberEmail = (n: number): string => `member${n}${W185_EMAIL_DOMAIN}`;
const memberName = (n: number): string => `${W185_LABEL_PREFIX}${W185_MEMBERS[n - 1].name}`;

export interface W185SeedReport {
  ok: boolean;
  /** Rows this invocation actually created, per table. */
  created: Record<string, number>;
  /** Rows that were already present, per table — the idempotency evidence. */
  alreadyPresent: Record<string, number>;
  /** Tables the seeder could not write, with the reason. Never thrown away. */
  skipped: Array<{ table: string; reason: string }>;
  /** The exact criteria the owner's cleanup uses. Returned, not just documented. */
  cleanup: {
    idToken: string;
    labelPrefix: string;
    emailDomain: string;
    chapterId: string;
  };
}

const now = (): string => new Date().toISOString();

/* A counted write. `changes === 0` means the row was already there, which is the
   idempotent case and NOT a failure — the distinction is what the report shows
   the owner. Any SQL error is recorded as a skip with its message rather than
   aborting: a table that has drifted must not prevent the other pages being
   populated, and silence about it would be worse than either. */
function tally(
  report: W185SeedReport,
  table: string,
  sql: string,
  params: unknown[],
): void {
  try {
    const info = rawDb().prepare(sql).run(...(params as any[]));
    const changed = Number((info as { changes?: number })?.changes ?? 0) > 0;
    const bucket = changed ? report.created : report.alreadyPresent;
    bucket[table] = (bucket[table] ?? 0) + 1;
  } catch (err) {
    report.skipped.push({ table, reason: (err as Error).message });
  }
}

/**
 * How many accreditation declarations this user already has. Used to decide
 * created-vs-already-present WITHOUT relying on an INSERT's `changes` count,
 * because the declaration table is append-only and would happily accept a
 * duplicate. A read error returns 0, which makes the seeder ATTEMPT the
 * declaration — the fail-safe direction, since a missing declaration is the
 * thing that breaks every gated page.
 */
function accreditationRowCount(uid: string): number {
  try {
    const row = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM investor_accreditation_declaration WHERE investor_id = ?`)
      .get(uid) as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

/**
 * SEED. Idempotent, admin-invoked, boot-safe.
 *
 * Ordered so that every row's referent already exists when it is written: the
 * chapter, then the people, then their memberships, then the content that names
 * them. Nothing here depends on a prior seeder having run.
 */
export function seedW185CollectiveTestData(): W185SeedReport {
  const report: W185SeedReport = {
    ok: true,
    created: {},
    alreadyPresent: {},
    skipped: [],
    cleanup: {
      idToken: W185_ID_TOKEN,
      labelPrefix: W185_LABEL_PREFIX,
      emailDomain: W185_EMAIL_DOMAIN,
      chapterId: W185_CHAPTER_ID,
    },
  };
  const ts = now();

  /* ── 1 · THE SANDBOX CHAPTER ─────────────────────────────────────────────
     Its own chapter, because chapter membership is what scopes the directory,
     the companies list, the calendar and the leaderboard. Seeding into a real
     chapter would put test people on a real roster. `membership_fee_annual_minor`
     is EXPLICITLY NULL — see rule 4. `admin_user_id` and `partner_org_id` are
     NULL so no real person or organisation is named as running it. */
  tally(
    report,
    "chapters",
    `INSERT INTO chapters
       (id, tenant_id, name, region, city, status, admin_user_id, partner_org_id,
        membership_fee_annual_minor, dsc_quorum_pct, founded, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, 'active', NULL, NULL, NULL, 50, NULL, ?, ?, NULL)
     ON CONFLICT(id) DO NOTHING`,
    [
      W185_CHAPTER_ID,
      W185_CHAPTER_TENANT,
      `${W185_LABEL_PREFIX}Sandbox Chapter`,
      `${W185_LABEL_PREFIX}Sandbox Region`,
      `${W185_LABEL_PREFIX}Sandbox City`,
      ts,
      ts,
    ],
  );

  /* ── 2 · THE PEOPLE ──────────────────────────────────────────────────────
     `is_demo = 1` so every existing demo-stripping filter already excludes them
     from production surfaces that honour it, INDEPENDENTLY of the id token. Two
     unrelated mechanisms have to fail before a test member reaches a real
     screen. Role `investor` — never `admin`, never `partner` (rule 5). */
  for (const m of W185_MEMBERS) {
    tally(
      report,
      "users",
      `INSERT INTO users (id, tenant_id, email, name, display_name, role, is_demo, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, NULL)
       ON CONFLICT(id) DO NOTHING`,
      [userId(m.n), W185_TENANT, memberEmail(m.n), memberName(m.n), memberName(m.n), m.role],
    );

    /* The Member Directory reads `contacts`, matches contact.email → users.email,
       and scopes by chapter membership. So each member needs a contact of kind
       `investor` whose email matches their account exactly. Written with SQL
       rather than through `createContact` deliberately: `createContact` mints a
       revision chain and a fresh id, and a seeded row must have a DETERMINISTIC
       id or rule 3 cannot hold. The revision-hash columns are NOT NULL, so a
       stated sentinel goes in them — never a computed hash, which would imply
       this row was audited like a real one. */
    tally(
      report,
      "contacts",
      `INSERT INTO contacts
         (id, kind, legal_name, display_name, email, phone, region, status, verification,
          metadata_json, created_at, updated_at, created_by, updated_by, version,
          prev_revision_hash, revision_hash, tenant_id, deleted_at)
       VALUES (?, 'investor', ?, ?, ?, NULL, ?, 'active', 'unverified',
               ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)
       ON CONFLICT(id) DO NOTHING`,
      [
        contactId(m.n),
        memberName(m.n),
        memberName(m.n),
        memberEmail(m.n),
        `${W185_LABEL_PREFIX}Sandbox Region`,
        JSON.stringify({ w185TestSeed: true, isSeed: true }),
        ts,
        ts,
        W185_ACTOR,
        W185_ACTOR,
        `w185_test_no_prev_revision`,
        `w185_test_not_a_real_revision_hash`,
        W185_TENANT,
      ],
    );

    /* ── 3 · MEMBERSHIP: the two rows the gate and the scope need ─────────
       `collective_memberships` is what `requireCollectiveMember` checks, and
       `chapter_memberships` is what every chapter-scoped query filters on.
       `cap_table_exempt = 1` for the reason argued at length in the header: it
       is what lets these members past step 3 WITHOUT a cap-table position, and
       a cap-table position would both grant a real entitlement and widen who can
       see whom through this wave's own Item A change.
       `tier = 'standard'` because a tier is a permission level, not a price. */
    tally(
      report,
      "collective_memberships",
      `INSERT INTO collective_memberships
         (user_id, tenant_id, chapter_id, status, tier, activated_at, activated_by,
          deactivated_at, deactivated_by, cap_table_exempt, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'active', 'standard', ?, ?, NULL, NULL, 1, ?, ?, NULL)
       ON CONFLICT(user_id) DO NOTHING`,
      [userId(m.n), W185_TENANT, W185_CHAPTER_ID, ts, W185_ACTOR, ts, ts],
    );

    tally(
      report,
      "chapter_memberships",
      `INSERT INTO chapter_memberships
         (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, 'member', 'active', ?, ?, ?, NULL)
       ON CONFLICT(id) DO NOTHING`,
      [
        `cm_${W185_ID_TOKEN}_${m.n}`,
        W185_CHAPTER_TENANT,
        W185_CHAPTER_ID,
        userId(m.n),
        ts,
        ts,
        ts,
      ],
    );

    /* ── 4 · THE OPT-IN THAT MAKES THE DIRECTORY RENDER A NAME ────────────
       `visibleInCollectiveDirectory` DEFAULTS FALSE (privacy by default), so
       without an explicit row every seeded member renders as "Private Investor"
       and the Member Directory would look broken rather than populated. Written
       through the SACRED resolver's own `writeUserPrivacy` — called, never
       reimplemented — so the seeded opt-in is expressed exactly as a real
       member's would be, and only for accounts this module created. */
    try {
      writeUserPrivacy(userId(m.n), { visibleInCollectiveDirectory: true });
      report.created["profilestore_user_privacy"] =
        (report.created["profilestore_user_privacy"] ?? 0) + 1;
    } catch (err) {
      report.skipped.push({
        table: "profilestore_user_privacy",
        reason: (err as Error).message,
      });
    }

    /* ── 4b · STEP 4 OF THE GATE: THE ACCREDITATION SELF-DECLARATION ──────
       Without this the gate refuses every seeded member 403
       ACCREDITATION_DECLARATION_REQUIRED and not one gated page renders. See the
       header: recorded through the PRODUCTION primitive, never by INSERT, because
       the table is append-only and hash-chained.

       The signature carries the test label, so the declaration is greppable by
       the same convention as everything else — and it is plainly not a real
       person's legal signature. Idempotent in the sense that matters: the table
       is append-only, so a second seed extends the chain rather than conflicting,
       and the report counts it as already-present because the GATE STATUS (the
       thing the seed exists to achieve) is already satisfied. */
    try {
      const already = accreditationRowCount(userId(m.n)) > 0;
      if (already) {
        report.alreadyPresent["investor_accreditation_declaration"] =
          (report.alreadyPresent["investor_accreditation_declaration"] ?? 0) + 1;
      } else {
        const decl = recordAccreditationDeclaration(userId(m.n), {
          signatureName: `${W185_LABEL_PREFIX}${m.name}`,
          /* Read off the SERVED clause config rather than hardcoded, so the seed
             cannot drift from the criterion ids the live endpoint accepts. */
          criteria: [ACCREDITATION_CRITERIA[0]?.id ?? "us_income"],
          jurisdiction: "US",
        });
        if (decl.ok) {
          report.created["investor_accreditation_declaration"] =
            (report.created["investor_accreditation_declaration"] ?? 0) + 1;
        } else {
          /* NAMED, never swallowed — a silent failure here would leave the pages
             403'ing with no explanation of why. */
          report.skipped.push({
            table: "investor_accreditation_declaration",
            reason: `${(decl as { error?: string }).error ?? "refused"}: ${(decl as { message?: string }).message ?? ""}`,
          });
        }
      }
    } catch (err) {
      report.skipped.push({
        table: "investor_accreditation_declaration",
        reason: (err as Error).message,
      });
    }
  }

  /* ── 5 · COMPANIES: LISTED, NOT INVENTED ─────────────────────────────────
     Existing DEMO companies are listed into the sandbox chapter. `company_id` is
     UNIQUE across the table, so a company already listed elsewhere is left
     alone — claiming it would move a real listing. Cleanup deletes these listing
     rows only; the companies themselves are untouched because they were never
     ours to delete. */
  let listedCompanyIds: string[] = [];
  try {
    listedCompanyIds = (rawDb()
      .prepare(
        `SELECT c.id AS id FROM companies c
          WHERE c.is_demo = 1 AND c.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM collective_directory_listings l WHERE l.company_id = c.id
            )
          ORDER BY c.id ASC LIMIT 3`,
      )
      .all() as Array<{ id?: string }>)
      .map((r) => String(r.id ?? ""))
      .filter((s) => s.length > 0);
  } catch (err) {
    report.skipped.push({ table: "collective_directory_listings", reason: (err as Error).message });
  }
  /* Already-listed sandbox companies are re-read on a second run so the later
     stages (soft circles, screening events) still have companies to reference —
     otherwise the seeder would be idempotent but the SECOND run would silently
     stop populating half the pages. */
  try {
    const existing = (rawDb()
      .prepare(
        `SELECT company_id FROM collective_directory_listings
          WHERE id LIKE ? OR chapter = ?`,
      )
      .all(`%${W185_ID_TOKEN}%`, W185_CHAPTER_ID) as Array<{ company_id?: string }>)
      .map((r) => String(r.company_id ?? ""))
      .filter((s) => s.length > 0);
    for (const id of existing) if (!listedCompanyIds.includes(id)) listedCompanyIds.push(id);
  } catch { /* the fresh-selection path above already covers the first run */ }

  listedCompanyIds.forEach((companyId, i) => {
    tally(
      report,
      "collective_directory_listings",
      `INSERT INTO collective_directory_listings
         (id, company_id, application_id, chapter, stage, sector, listed_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'listed')
       ON CONFLICT(id) DO NOTHING`,
      [
        `cdl_${W185_ID_TOKEN}_${i + 1}`,
        companyId,
        `app_${W185_ID_TOKEN}_${i + 1}`,
        W185_CHAPTER_ID,
        `${W185_LABEL_PREFIX}stage`,
        `${W185_LABEL_PREFIX}sector`,
        ts,
      ],
    );
  });

  /* ── 6 · SOFT CIRCLES ────────────────────────────────────────────────────
     `amount` and `amount_minor` are NOT NULL under money type-floor triggers, so
     a figure is unavoidable here. It is the SAME self-evident sentinel every
     time — 1111.11 / 111111 minor — and the investor name carries the test
     prefix, so no report can mistake it for a commitment. It is NOT a fee:
     nothing prices anything off `soft_circles`. `sourced_from_partner_id` is
     NULL so no partner is credited with attribution for test interest. */
  const roundIdsByCompany = new Map<string, string>();
  try {
    for (const companyId of listedCompanyIds) {
      const row = rawDb()
        .prepare(
          `SELECT id FROM rounds WHERE company_id = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1`,
        )
        .get(companyId) as { id?: string } | undefined;
      const rid = String(row?.id ?? "");
      if (rid) roundIdsByCompany.set(companyId, rid);
    }
  } catch (err) {
    report.skipped.push({ table: "soft_circles", reason: `round lookup: ${(err as Error).message}` });
  }
  if (roundIdsByCompany.size === 0 && listedCompanyIds.length > 0) {
    report.skipped.push({
      table: "soft_circles",
      reason:
        "no round exists on any listed company, and this seeder does not create rounds — a round carries capital terms",
    });
  }
  let sc = 0;
  /* `Array.from` rather than iterating the Map directly: this tree's `tsconfig`
     targets below ES2015 without `--downlevelIteration`, so a bare `for...of`
     over a Map raises TS2802 and would have pushed the error count above its
     557 baseline. Same behaviour, no new error. */
  for (const [companyId, roundId] of Array.from(roundIdsByCompany.entries())) {
    sc += 1;
    const m = W185_MEMBERS[(sc - 1) % W185_MEMBERS.length];
    tally(
      report,
      "soft_circles",
      `INSERT INTO soft_circles
         (id, tenant_id, round_id, company_id, invitation_id, investor_user_id, investor_email,
          investor_name, amount, amount_minor, currency, status, collective_visible,
          created_at, updated_at, deleted_at, chapter_id, sourced_from_partner_id)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 1111.11, 111111, 'USD', 'intent', 1, ?, ?, NULL, ?, NULL)
       ON CONFLICT(id) DO NOTHING`,
      [
        `sc_${W185_ID_TOKEN}_${sc}`,
        W185_TENANT,
        roundId,
        companyId,
        userId(m.n),
        memberEmail(m.n),
        memberName(m.n),
        ts,
        ts,
        W185_CHAPTER_ID,
      ],
    );
  }

  /* ── 7 · POSTS ───────────────────────────────────────────────────────────
     `network_posts.scope` has NO DEFAULT on purpose: the read side treats NULL
     as the SAFE author-only case. These are written with an EXPLICIT scope so
     they render in the feed, and every body carries the test prefix so a reader
     cannot mistake a seeded post for a member's words. */
  for (let i = 1; i <= 4; i += 1) {
    const m = W185_MEMBERS[(i - 1) % W185_MEMBERS.length];
    tally(
      report,
      "network_posts",
      `INSERT INTO network_posts
         (id, tenant_id, author_user_id, audience, body, content_json, likes, comments,
          parent_post_id, created_at, updated_at, deleted_at, scope, company_id, chapter_id)
       VALUES (?, ?, ?, 'all', ?, NULL, 0, 0, NULL, ?, ?, NULL, 'collective', NULL, ?)
       ON CONFLICT(id) DO NOTHING`,
      [
        `np_${W185_ID_TOKEN}_${i}`,
        W185_TENANT,
        userId(m.n),
        `${W185_LABEL_PREFIX}Sandbox post ${i}. This post exists only so the Collective feed can be verified with real content, and carries no opinion, no figure and no commitment.`,
        ts,
        ts,
        W185_CHAPTER_ID,
      ],
    );
  }

  /* ── 8 · ANNOUNCEMENTS ───────────────────────────────────────────────────
     `curr_hash` is NOT NULL and the table is hash-chained. A STATED sentinel is
     written rather than a computed hash: a real hash would assert this row had
     been through the chain-verifying write path, which it has not. */
  for (let i = 1; i <= 2; i += 1) {
    tally(
      report,
      "chapter_announcements",
      `INSERT INTO chapter_announcements
         (id, tenant_id, chapter_id, author_user_id, title, body, pinned, priority, audience,
          expires_at, prev_hash, curr_hash, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'all', NULL, NULL, ?, ?, ?, NULL)
       ON CONFLICT(id) DO NOTHING`,
      [
        `ann_${W185_ID_TOKEN}_${i}`,
        W185_CHAPTER_TENANT,
        W185_CHAPTER_ID,
        userId(1),
        `${W185_LABEL_PREFIX}Sandbox announcement ${i}`,
        `${W185_LABEL_PREFIX}This announcement exists so the Calendar and Chapters pages can be verified with real content. It announces nothing.`,
        i === 1 ? "high" : "normal",
        `w185_test_not_a_real_hash_${i}`,
        ts,
        ts,
      ],
    );
  }

  /* ── 9 · SCREENING EVENTS + ATTENDANCE ───────────────────────────────────
     `ics_uid` is UNIQUE and `curr_hash` NOT NULL; both take stated test values
     for the same reason as above. `attended = 1` on some attendees is what makes
     the LEADERBOARD computable — it is derived from attendance, answers,
     announcements authored and resources approved, so seeding a snapshot
     directly would be writing a fabricated score. `scheduled_for` is an INTEGER
     epoch; both events are placed in the FUTURE so the calendar has upcoming
     entries, with one attendance already recorded so the leaderboard is not
     uniformly zero. */
  const futureMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const eventCompanyId = listedCompanyIds[0] ?? "";
  if (!eventCompanyId) {
    report.skipped.push({
      table: "screening_events",
      reason: "no company could be listed, and screening_events.company_id is NOT NULL",
    });
  } else {
    for (let i = 1; i <= 2; i += 1) {
      tally(
        report,
        "screening_events",
        `INSERT INTO screening_events
           (id, tenant_id, chapter_id, round_id, company_id, title, description, scheduled_for,
            duration_minutes, location, event_type, status, organizer_user_id, ics_uid,
            prev_hash, curr_hash, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 60, ?, 'screening', 'scheduled', ?, ?, NULL, ?, ?, ?, NULL)
         ON CONFLICT(id) DO NOTHING`,
        [
          `se_${W185_ID_TOKEN}_${i}`,
          W185_CHAPTER_TENANT,
          W185_CHAPTER_ID,
          eventCompanyId,
          `${W185_LABEL_PREFIX}Sandbox screening ${i}`,
          `${W185_LABEL_PREFIX}This event exists so the Calendar page can be verified with real content.`,
          futureMs + i * 24 * 60 * 60 * 1000,
          `${W185_LABEL_PREFIX}Sandbox location`,
          userId(1),
          `w185-test-${i}${W185_EMAIL_DOMAIN}`,
          `w185_test_not_a_real_hash_se_${i}`,
          ts,
          ts,
        ],
      );

      /* Attendance for three members per event, one marked attended, so the
         leaderboard has a real non-zero input to compute from. */
      W185_MEMBERS.slice(0, 3).forEach((m, j) => {
        tally(
          report,
          "screening_event_attendees",
          `INSERT INTO screening_event_attendees
             (id, event_id, user_id, role, rsvp, attended, checked_in_at, created_at, updated_at)
           VALUES (?, ?, ?, 'observer', 'accepted', ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
          [
            `sea_${W185_ID_TOKEN}_${i}_${m.n}`,
            `se_${W185_ID_TOKEN}_${i}`,
            userId(m.n),
            j === 0 ? 1 : 0,
            j === 0 ? ts : null,
            ts,
            ts,
          ],
        );
      });
    }
  }

  report.ok = true;
  return report;
}

/** What is currently present, without writing anything. */
export function statusW185CollectiveTestData(): {
  ok: boolean;
  present: Record<string, number>;
  cleanup: W185SeedReport["cleanup"];
} {
  const present: Record<string, number> = {};
  const count = (table: string, sql: string, params: unknown[] = []): void => {
    try {
      const row = rawDb().prepare(sql).get(...(params as any[])) as { n?: number };
      present[table] = Number(row?.n ?? 0);
    } catch {
      present[table] = -1; /* -1 states "unreadable", never a silent 0 */
    }
  };
  count("chapters", `SELECT COUNT(*) AS n FROM chapters WHERE id = ?`, [W185_CHAPTER_ID]);
  count("users", `SELECT COUNT(*) AS n FROM users WHERE id LIKE ?`, [`%${W185_ID_TOKEN}%`]);
  count("contacts", `SELECT COUNT(*) AS n FROM contacts WHERE id LIKE ?`, [`%${W185_ID_TOKEN}%`]);
  count("collective_memberships", `SELECT COUNT(*) AS n FROM collective_memberships WHERE user_id LIKE ?`, [`%${W185_ID_TOKEN}%`]);
  count("investor_accreditation_declaration", `SELECT COUNT(*) AS n FROM investor_accreditation_declaration WHERE investor_id LIKE ?`, [`%${W185_ID_TOKEN}%`]);
  count("chapter_memberships", `SELECT COUNT(*) AS n FROM chapter_memberships WHERE id LIKE ?`, [`%${W185_ID_TOKEN}%`]);
  count("collective_directory_listings", `SELECT COUNT(*) AS n FROM collective_directory_listings WHERE id LIKE ?`, [`%${W185_ID_TOKEN}%`]);
  count("soft_circles", `SELECT COUNT(*) AS n FROM soft_circles WHERE id LIKE ?`, [`%${W185_ID_TOKEN}%`]);
  count("network_posts", `SELECT COUNT(*) AS n FROM network_posts WHERE id LIKE ?`, [`%${W185_ID_TOKEN}%`]);
  count("chapter_announcements", `SELECT COUNT(*) AS n FROM chapter_announcements WHERE id LIKE ?`, [`%${W185_ID_TOKEN}%`]);
  count("screening_events", `SELECT COUNT(*) AS n FROM screening_events WHERE id LIKE ?`, [`%${W185_ID_TOKEN}%`]);
  count("screening_event_attendees", `SELECT COUNT(*) AS n FROM screening_event_attendees WHERE id LIKE ?`, [`%${W185_ID_TOKEN}%`]);
  return {
    ok: true,
    present,
    cleanup: {
      idToken: W185_ID_TOKEN,
      labelPrefix: W185_LABEL_PREFIX,
      emailDomain: W185_EMAIL_DOMAIN,
      chapterId: W185_CHAPTER_ID,
    },
  };
}

/**
 * PURGE. The owner said the cleanup is imminent (R156.4 / Q12), so it ships in
 * the same wave as the seed and is proved by the same tests.
 *
 * EVERY predicate is `id LIKE '%w185_test%'` on a table this module wrote. HARD
 * deletes, deliberately: a soft-deleted test row is still a test row sitting in
 * the production database, which is the state the owner asked to be able to
 * clear. And it deletes NOTHING it did not create — no company, no round, no
 * real member, no real chapter — so a mis-click cannot cost real data.
 */
export function purgeW185CollectiveTestData(): {
  ok: boolean;
  deleted: Record<string, number>;
  failed: Array<{ table: string; reason: string }>;
} {
  const deleted: Record<string, number> = {};
  const failed: Array<{ table: string; reason: string }> = [];
  const wipe = (table: string, sql: string, params: unknown[]): void => {
    try {
      const info = rawDb().prepare(sql).run(...(params as any[]));
      deleted[table] = Number((info as { changes?: number })?.changes ?? 0);
    } catch (err) {
      failed.push({ table, reason: (err as Error).message });
    }
  };
  const tok = `%${W185_ID_TOKEN}%`;
  /* Children before parents, so nothing is orphaned mid-purge. */
  wipe("screening_event_attendees", `DELETE FROM screening_event_attendees WHERE id LIKE ?`, [tok]);
  wipe("screening_events", `DELETE FROM screening_events WHERE id LIKE ?`, [tok]);
  wipe("chapter_announcements", `DELETE FROM chapter_announcements WHERE id LIKE ?`, [tok]);
  wipe("network_posts", `DELETE FROM network_posts WHERE id LIKE ?`, [tok]);
  wipe("soft_circles", `DELETE FROM soft_circles WHERE id LIKE ?`, [tok]);
  wipe("collective_directory_listings", `DELETE FROM collective_directory_listings WHERE id LIKE ?`, [tok]);
  wipe("chapter_memberships", `DELETE FROM chapter_memberships WHERE id LIKE ?`, [tok]);
  wipe("collective_memberships", `DELETE FROM collective_memberships WHERE user_id LIKE ?`, [tok]);
  wipe("profilestore_user_privacy", `DELETE FROM profilestore_user_privacy WHERE user_id LIKE ?`, [tok]);
  /* The accreditation declaration is append-only BY DESIGN and the platform must
     never delete a real one. This predicate can only ever match a row whose
     `user_id` contains the seed token — an id namespace no real account uses — so
     the append-only guarantee is intact for every genuine member. Left behind, a
     seeded declaration would be a compliance record for a person who does not
     exist, which is worse than removing it. */
  wipe("investor_accreditation_declaration", `DELETE FROM investor_accreditation_declaration WHERE investor_id LIKE ?`, [tok]);
  wipe("contacts", `DELETE FROM contacts WHERE id LIKE ?`, [tok]);
  wipe("users", `DELETE FROM users WHERE id LIKE ?`, [tok]);
  wipe("chapters", `DELETE FROM chapters WHERE id = ?`, [W185_CHAPTER_ID]);
  return { ok: failed.length === 0, deleted, failed };
}
