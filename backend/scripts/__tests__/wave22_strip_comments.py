#!/usr/bin/env python3
"""WAVE 22 — shared comment stripper for the ITEM 1–5 falsification harnesses.

Why this exists as a real (if small) lexer rather than a regex:

The ITEM 1 harness first reported its own fix as broken, because the WAVE 22
header block in CloseRoundPanel.tsx *quotes* the deleted `fakeIp()` body,
literal `203.0.113.` included, so a raw grep saw the corpse and called it a
live body. The first repair was a regex — `re.sub(r"/\\*.*?\\*/", " ", src,
flags=re.S)` — and that promptly produced a SECOND false result: ITEM 2's
harness reported `server/partnerRoutes.ts` as not using the shared resolver.
It does (partnerRoutes.ts:1687). The regex had swallowed the call, because a
`/*` appearing inside a string literal or a regex literal earlier in the file
opened a "comment" that ran on until the next `*/` hundreds of lines later.

That is the exact failure shape this codebase keeps paying for: a checker that
matches the wrong thing and reports a confident, wrong answer. So the stripper
tracks string, template-literal and comment state properly. It is not a full
TypeScript parser — it does not attempt to disambiguate regex literals from
division, which is why regex-literal contents are left in place rather than
guessed at — but it never lets quoted text open or close a comment.

Usage:  python3 wave22_strip_comments.py <file>   -> executable source on stdout
"""
import sys


def strip(src: str) -> str:
    out = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        # Line comment
        if c == "/" and nxt == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue
        # Block comment
        if c == "/" and nxt == "*":
            i += 2
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                if src[i] == "\n":
                    out.append("\n")  # keep line numbering usable
                i += 1
            i += 2
            out.append(" ")
            continue
        # String / template literal — copied through verbatim, and crucially
        # NOT scanned for comment openers.
        if c in ("'", '"', "`"):
            quote = c
            out.append(c)
            i += 1
            while i < n:
                if src[i] == "\\":
                    out.append(src[i:i + 2])
                    i += 2
                    continue
                out.append(src[i])
                if src[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as fh:
        sys.stdout.write(strip(fh.read()))
