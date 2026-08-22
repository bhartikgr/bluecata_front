/**
 * client/src/components/PortalVersionFooter.tsx — WAVE 90 · ITEM 2.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG (OPEN_ITEMS_REGISTER PART 11 · M-1)
 * ─────────────────────────────────────────────────────────────────────────────
 * The live site reported THREE different answers to "what version is this?":
 *
 *   Admin footer            v 26.19.0 · build wcollective-wfeed · 2026-08-20T11:37:47.891Z
 *   Investor Settings       Capavate Investor Platform · v0.23.0
 *   Partner portal          (nothing at all)
 *
 * `v0.23.0` was **not a build, not a `package.json`, not a stale constant and
 * not a separate release train**. It was a HARDCODED STRING LITERAL inside the
 * JSX of one page — `client/src/pages/investor/Settings.tsx:422`, the text node
 * `Capavate Investor Platform · v0.23.0`. Nothing computed it, nothing read it,
 * nothing could ever update it. There is exactly ONE `package.json` in this
 * repo and it says `26.19.0`. So the investor portal was not behind; it was
 * lying, and it had been lying since whichever release last edited that line.
 *
 * That matters beyond cosmetics: Avi confirmed "26.19.0 installed" by reading
 * ONE surface, and this project has already shipped a package labelled 26.17.0
 * while claiming 26.19.0. A version string that some surfaces invent makes
 * every deploy verification unfalsifiable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SINGLE SOURCE
 * ─────────────────────────────────────────────────────────────────────────────
 *   package.json "version"
 *      └─ read at boot by the resolver at server/routes.ts (`const version`),
 *         which prefers `process.env.APP_VERSION` so a deploy can pin the
 *         shipped value regardless of bundle layout, and NEVER silently returns
 *         "0.0.0" — it logs and returns "unknown".
 *            └─ served on GET /api/healthz (public, no auth)
 *                  └─ read by THIS component
 *                        └─ rendered by every portal footer.
 *
 * So there is one number, it is resolved at runtime from the shipped artefact,
 * and no portal can disagree with another because no portal holds a literal.
 * `scripts/__tests__/w90_version_single_source.test.ts` FAILS if any portal
 * file reintroduces a version literal, and if `/api/healthz` disagrees with
 * `package.json`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT REUSE BuildVersionMarker
 * ─────────────────────────────────────────────────────────────────────────────
 * `BuildVersionMarker` is the ADMIN/ops marker: it shows the build id and the
 * build timestamp, which are operator facts. An investor footer showing
 * `build wcollective-wfeed` would be a fresh instance of the internal-language
 * defect the register spends four sections on (M-8, K-4). This component takes
 * its version from the SAME endpoint and shows the product name and the version
 * only. One source, two audiences.
 *
 * WHEN THE VERSION CANNOT BE RESOLVED it says so. It does not fall back to a
 * literal, and it does not render a plausible-looking number — that is the
 * failure-presented-as-fact class this register opens with.
 */
import { useQuery } from "@tanstack/react-query";

type Healthz = { version?: string };

export function PortalVersionFooter({
  /** The product name shown before the version, e.g. "Capavate Investor Platform". */
  productName,
  /** Stable hook for tests and the guard inventory. */
  testId,
  className = "",
}: {
  productName: string;
  testId: string;
  className?: string;
}) {
  const { data, isError } = useQuery<Healthz>({
    queryKey: ["/api/healthz"],
    queryFn: async () => {
      const res = await fetch("/api/healthz", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`healthz ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const version = typeof data?.version === "string" && data.version.trim() ? data.version.trim() : null;

  return (
    <span className={className} data-testid={testId}>
      <span data-testid={`${testId}-product`}>{productName}</span>
      {" · "}
      {version ? (
        <span data-testid={`${testId}-version`}>v{version}</span>
      ) : (
        <span data-testid={`${testId}-version-unknown`}>
          {isError ? "version unavailable" : "checking version…"}
        </span>
      )}
    </span>
  );
}

export default PortalVersionFooter;
