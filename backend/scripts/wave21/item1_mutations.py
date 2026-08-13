#!/usr/bin/env python3
"""WAVE 21 · ITEM 1 mutation matrix — TRUSTED_PROXY_HOPS fail-closed."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
T = "server/lib/rateLimit.ts"

MUTATIONS = [
    Mutation(
        name="M1-restore-clamp",
        target=T,
        anchor="""  if (n > MAX_TRUSTED_PROXY_HOPS) {
    return rejectHopConfig(raw, `above the maximum supported hop count (${MAX_TRUSTED_PROXY_HOPS})`);
  }
  return n;""",
        replacement="  return Math.min(n, MAX_TRUSTED_PROXY_HOPS);",
        why="the exact Wave 19 defect Review A exploited",
    ),
    Mutation(
        name="M2-reject-silently",
        target=T,
        anchor="""    loggedBadHopValues.add(raw);
    // eslint-disable-next-line no-console
    console.error(""",
        replacement="""    loggedBadHopValues.add(raw);
    // eslint-disable-next-line no-console
    if (false) console.error(""",
        why="fails closed but does NOT log loudly",
    ),
    Mutation(
        name="M3-raise-ceiling",
        target=T,
        anchor="const MAX_TRUSTED_PROXY_HOPS = 8;",
        replacement="const MAX_TRUSTED_PROXY_HOPS = 9999;",
        why="widens trust by raising the ceiling instead of rejecting",
    ),
    Mutation(
        name="M4-nonnumeric-trusts",
        target=T,
        anchor='  if (!/^\\d+$/.test(raw)) return rejectHopConfig(raw, "not a non-negative integer");',
        replacement="  if (!/^\\d+$/.test(raw)) return 1;",
        why="regresses a PRESERVED fail-closed case (non-numeric)",
    ),
    Mutation(
        name="M5-resolver-ignores-zero",
        target=T,
        anchor="""  const hops = trustedProxyHopCount();
  if (hops <= 0) return socketIp;""",
        replacement="  const hops = Math.max(1, trustedProxyHopCount());",
        why="resolver reads the header even when trust is 0",
    ),
    Mutation(
        name="M6-reject-everything",
        target=T,
        anchor="""    return rejectHopConfig(raw, `above the maximum supported hop count (${MAX_TRUSTED_PROXY_HOPS})`);
  }
  return n;""",
        replacement="""    return rejectHopConfig(raw, `above the maximum supported hop count (${MAX_TRUSTED_PROXY_HOPS})`);
  }
  return 0;""",
        why="over-correction: legitimate in-range config stops working",
    ),
    Mutation(
        name="M7-off-by-one-ceiling",
        target=T,
        anchor="  if (n > MAX_TRUSTED_PROXY_HOPS) {",
        replacement="  if (n > MAX_TRUSTED_PROXY_HOPS + 1) {",
        why="boundary slip: hops=9 becomes trusted again",
    ),
]

if __name__ == "__main__":
    sys.exit(
        run_matrix(
            ROOT,
            ["npx", "tsx", "scripts/wave21/item1_proxy_hops_harness.ts"],
            MUTATIONS,
            "ITEM1",
        )
    )
