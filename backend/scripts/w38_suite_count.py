import json, sys, collections
p = sys.argv[1]
d = json.load(open(p))
res = d.get("testResults", [])
assert_fail_files = []
status_failed_files = []
tests_run = 0
failed_assertions = 0
for f in res:
    name = f.get("name")
    ars = f.get("assertionResults", [])
    ran = [a for a in ars if a.get("status") in ("passed", "failed")]
    tests_run += len(ran)
    nf = sum(1 for a in ars if a.get("status") == "failed")
    failed_assertions += nf
    if nf:
        assert_fail_files.append((name, nf))
    if f.get("status") == "failed":
        status_failed_files.append(name)
print("tests RUN (passed+failed assertions):", tests_run)
print("total assertions incl skipped:", sum(len(f.get('assertionResults', [])) for f in res))
print("failing tests (assertion-level):", failed_assertions)
print("assertion-failing FILES:", len(assert_fail_files))
print("runner-level status=='failed' FILES:", len(status_failed_files))
print("total files in report:", len(res))
only_status = sorted(set(status_failed_files) - set(n for n, _ in assert_fail_files))
print("files failed at runner level with ZERO failing assertions:", len(only_status))
for n in only_status:
    print("   ", n)
json.dump({
    "assert_fail_files": sorted(n for n, _ in assert_fail_files),
    "status_failed_files": sorted(status_failed_files),
    "failed_assertions": failed_assertions,
    "tests_run": tests_run,
}, open("/tmp/w38_suite_final_counts.json", "w"), indent=1)
