#!/usr/bin/env python3
"""WAVE 17 ORP-042 falsification harness.

Each mutation breaks ONE property the suite claims to prove; the suite must fail.
Files are restored from an in-memory copy after every run, and the harness
re-asserts a clean pass at the end so a mutation cannot be left behind.
"""
import subprocess, sys, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2]
COMP = ROOT / "client/src/components/pulse/LiveCapitalPulse.tsx"
DASH = ROOT / "client/src/pages/investor/Dashboard.tsx"
SUITE = "client/src/components/pulse/__tests__/LiveCapitalPulse.test.tsx"

orig = {p: p.read_text() for p in (COMP, DASH)}


def run():
    r = subprocess.run(["npx", "vitest", "run", SUITE], cwd=ROOT,
                       capture_output=True, text=True)
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", r.stdout)
    failed = int(m.group(1) or 0) if m else -1
    passed = int(m.group(2)) if m else -1
    return failed, passed


MUTATIONS = [
    # 1. the Wave-16 transport trap: subscribe onmessage-style instead of named.
    (COMP,
     lambda s: s.replace(
         "    for (const type of PULSE_EVENT_TYPES) {\n      src.addEventListener(type,",
         "    for (const type of [\"message\"]) {\n      src.addEventListener(type,"),
     "subscribe the unnamed `message` channel instead of the three named types"),
    # 2. append blindly instead of keying by id.
    (COMP,
     lambda s: s.replace(
         "  const byId = new Map<string, PulseEvent>();\n  for (const ev of existing) byId.set(ev.id, ev);\n  for (const ev of incoming) byId.set(ev.id, ev);",
         "  const byId = new Map<string, PulseEvent>();\n  let seq = 0;\n  for (const ev of existing) byId.set(`${ev.id}#${seq++}`, ev);\n  for (const ev of incoming) byId.set(`${ev.id}#${seq++}`, ev);"),
     "append every frame instead of de-duplicating by event id"),
    # 3. infer liveness from payload arrival rather than onopen (silence == dead).
    (COMP,
     lambda s: s.replace("    src.onopen = () => {\n      if (closedRef.current) return;\n      setLive(true);",
                         "    src.onopen = () => {\n      if (closedRef.current) return;\n      setLive(false);"),
     "never report live on onopen — liveness left to be inferred from traffic"),
    # 4. drop the no-price disclosure.
    (COMP,
     lambda s: re.sub(r"Tracked symbols only[^<]*", "Index watchlist. ", s),
     "remove the 'quotes are not published' copy"),
    # 5. the actual Wave-16 defect: mounted nowhere.
    (DASH,
     lambda s: s.replace("        <LiveCapitalPulse />\n", ""),
     "unmount the component from the investor dashboard"),
    # 6. spread a MapIterator (the TS2802 the parent fixed).
    (COMP,
     lambda s: s.replace("return Array.from(byId.values())", "return [...byId.values()]"),
     "spread a MapIterator instead of Array.from"),
]

rows = []
for path, mutate, label in MUTATIONS:
    new = mutate(orig[path])
    assert new != orig[path], f"mutation did not apply: {label}"
    path.write_text(new)
    failed, passed = run()
    path.write_text(orig[path])
    rows.append((label, failed, passed))
    print(f"[{'OK' if failed > 0 else 'VACUOUS'}] {label}: {failed} failed / {passed} passed", flush=True)

failed, passed = run()
print(f"[restored] {failed} failed / {passed} passed", flush=True)
bad = [r for r in rows if r[1] <= 0]
sys.exit(1 if (bad or failed != 0) else 0)
