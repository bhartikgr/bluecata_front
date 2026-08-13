#!/usr/bin/env python3
"""WAVE 23 · ITEM 2 mutation matrix — enforced trusted-proxy-peer invariant."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "wave21"))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
T = "server/lib/rateLimit.ts"

MUTATIONS = [
    Mutation(
        name="M1-drop-peer-check",
        target=T,
        anchor="  if (!isTrustedProxyPeer(socketIp)) {",
        replacement="  if (false) {",
        why="the exact Review A CRITICAL: any peer may choose its own key again",
    ),
    Mutation(
        name="M2-trust-everyone",
        target=T,
        anchor='  if (peer === "" || peer === "unknown") return false;',
        replacement='  if (peer === "" || peer === "unknown") return true;',
        why="fails OPEN on an unknown peer",
    ),
    Mutation(
        name="M3-malformed-entry-widens",
        target=T,
        anchor="    if (m === null) {",
        replacement="    if (m === null) { trusted = true; }\n    if (m === null) {",
        why="a typo in TRUSTED_PROXY_PEERS silently widens trust",
    ),
    Mutation(
        name="M4-public-range-in-defaults",
        target=T,
        anchor='  "172.16.0.0/12",    // RFC1918',
        replacement='  "172.0.0.0/8",      // MUTANT: swallows public 172.x space',
        why="default trusted set leaks into public address space",
    ),
    Mutation(
        name="M5-override-extends-not-replaces",
        target=T,
        anchor="  if (trustedProxyPeerOverride !== null) return trustedProxyPeerOverride;",
        replacement="  if (trustedProxyPeerOverride !== null) return [...trustedProxyPeerOverride, ...DEFAULT_TRUSTED_PROXY_PEERS];",
        why="an operator who narrows trust silently keeps the wide defaults",
    ),
    Mutation(
        name="M6-prefix-ignored",
        target=T,
        anchor="  const restBits = prefix & 7;",
        replacement="  const restBits = 0; // MUTANT: ignore the sub-byte part of the prefix",
        why="CIDR prefixes that are not byte-aligned match too much",
    ),
    Mutation(
        name="M7-family-confusion",
        target=T,
        anchor="  if (addr.length !== net.length) return false;",
        replacement="  if (addr.length !== net.length) return true;",
        why="an IPv6 peer matches an IPv4 allow-list entry",
    ),
    Mutation(
        name="M8-mapped-ipv6-not-folded",
        target=T,
        anchor="  const mapped = /^::ffff:((?:\\d{1,3}\\.){3}\\d{1,3})$/i.exec(s);\n  if (mapped) s = mapped[1];",
        replacement="  // MUTANT: leave ::ffff: mapped addresses unfolded",
        why="a legitimate private peer presented as ::ffff:10.0.0.9 stops being trusted",
    ),
    Mutation(
        name="M9-header-read-before-check",
        target=T,
        anchor="""    return socketIp;
  }
  const rawHeader = req.headers["x-forwarded-for"];""",
        replacement="""    // MUTANT: log but continue
  }
  const rawHeader = req.headers["x-forwarded-for"];""",
        why="warns about an untrusted peer but reads the header anyway",
    ),
    Mutation(
        name="M10-hop-algorithm-changed",
        target=T,
        anchor="  const idx = addresses.length - 1 - hops;",
        replacement="  const idx = 0;",
        why="regresses the (correct, NOT-to-be-changed) hop algorithm to leftmost-entry",
    ),
]

if __name__ == "__main__":
    sys.exit(
        run_matrix(
            ROOT,
            ["npx", "tsx", "scripts/wave23/item2_trusted_peer_harness.ts"],
            MUTATIONS,
            "ITEM2",
        )
    )
