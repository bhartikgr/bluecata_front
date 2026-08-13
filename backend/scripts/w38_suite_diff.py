import json, sys, collections

def load(p):
    d = json.load(open(p))
    m = {}
    st = set()
    for f in d.get("testResults", []):
        n = f["name"].replace("/home/user/workspace/work/", "")
        nf = sum(1 for a in f.get("assertionResults", []) if a.get("status") == "failed")
        m[n] = nf
        if f.get("status") == "failed":
            st.add(n)
    return m, st

a, ast = load(sys.argv[1])   # baseline
b, bst = load(sys.argv[2])   # final
print("BASELINE:", sys.argv[1], "files:", len(a), "failing-assertion files:", sum(1 for v in a.values() if v), "failures:", sum(a.values()), "runner-failed:", len(ast))
print("FINAL   :", sys.argv[2], "files:", len(b), "failing-assertion files:", sum(1 for v in b.values() if v), "failures:", sum(b.values()), "runner-failed:", len(bst))
print()
print("--- files whose failure count CHANGED ---")
for n in sorted(set(a) | set(b)):
    x, y = a.get(n), b.get(n)
    if x != y:
        print(f"  {x if x is not None else 'ABSENT':>6} -> {y if y is not None else 'ABSENT':>6}   {n}")
print()
print("--- runner-failed only in FINAL ---")
for n in sorted(bst - ast):
    print("  ", n)
print("--- runner-failed only in BASELINE ---")
for n in sorted(ast - bst):
    print("  ", n)
