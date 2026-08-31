/**
 * WAVE 210 — WHICH LEGAL CORPUS VERSION IS SERVED, AS SEEN BY A RENDERING PAGE.
 *
 * WHY A PLAIN `fetch` AND NOT `useQuery`. `Terms.tsx` and `Privacy.tsx` are
 * PUBLIC routes and are the pages this wave must prove by mounting for real. A
 * `useQuery` here would make both pages unmountable without a
 * `QueryClientProvider` wrapper, which means the proof of "the footer link now
 * serves the consolidated text" would depend on test scaffolding rather than on
 * the page. Handbook §8: never prove a replica. A page that mounts standalone is
 * a page whose behaviour can be proven.
 *
 * THE DEFAULT IS THE ADOPTED VERSION, AND THAT IS A SAFETY PROPERTY, NOT A
 * CONVENIENCE. Before the fetch resolves — and on every failure path — this hook
 * reports the adopted version. So a slow network, a 500, or a test with no
 * server can never cause the retired interim wording to render. The retained
 * superseded text becomes visible only on a POSITIVE, successful read saying
 * that is what the platform is serving.
 */
import { useEffect, useState } from "react";
import {
  ADOPTED_LEGAL_CORPUS_VERSION,
  SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
  SUPERSEDED_LEGAL_CORPUS_VERSION_2026_06_15,
  isKnownLegalCorpusVersion,
} from "@shared/wave210LegalCorpusVersion";

export interface ActiveLegalCorpusVersion {
  /** The version the platform serves. Never empty. */
  activeVersion: string;
  /** True once a successful read has happened. Surfaces may ignore it. */
  loaded: boolean;
  /** The 15 June 2026 interim pages are the served text. Retired; normally false. */
  servingInterimPages: boolean;
  /** The 17 March 2026 corpus is the served text. Superseded; normally false. */
  servingSupersededMarchCorpus: boolean;
}

export function useActiveLegalCorpusVersion(): ActiveLegalCorpusVersion {
  const [activeVersion, setActiveVersion] = useState<string>(ADOPTED_LEGAL_CORPUS_VERSION);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/legal/corpus/active", { credentials: "include" });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        if (body && isKnownLegalCorpusVersion(body.activeVersion)) {
          setActiveVersion(body.activeVersion as string);
          setLoaded(true);
        }
      } catch {
        /* Deliberately silent. The adopted default already holds and a legal
         * page must render even when the API is unreachable. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    activeVersion,
    loaded,
    servingInterimPages: activeVersion === SUPERSEDED_LEGAL_CORPUS_VERSION_2026_06_15,
    servingSupersededMarchCorpus: activeVersion === SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
  };
}
