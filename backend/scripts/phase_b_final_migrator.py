#!/usr/bin/env python3
"""
Phase B FINAL migrator — fixed version.

Key fixes from v1:
1. For inline .all() (same-line expr), extract query from `before_all`, not from `line`
2. For .run() transformation, collect chains more carefully to avoid
   collecting object literal content
3. For standalone .all(), same fix
"""

import re
import os
import shutil

SACRED = {
    "server/captableCommitStore.ts",
    "server/roundsStore.ts",
    "server/lib/roundCloseCascade.ts",
    "server/spvFundStore.ts",
    "server/collectiveBillingStore.ts",
}


def get_portable_path(filepath):
    parts = filepath.replace("\\", "/").split("/")
    if len(parts) >= 3 and parts[0] == "server" and parts[1] in ("lib", "jobs"):
        return "../db/portable"
    return "./db/portable"


def ensure_portable_import(content, filepath, names):
    if not names:
        return content
    portable_path = get_portable_path(filepath)
    pattern = re.compile(
        r'(import\s*\{)([^}]*?)(\}\s*from\s*["\']'
        + re.escape(portable_path)
        + r'["\'])(\s*;[^\n]*)',
        re.DOTALL
    )
    m = pattern.search(content)
    if m:
        existing = [re.sub(r'/\*.*?\*/', '', x).strip() for x in m.group(2).split(",")]
        existing = [x for x in existing if x]
        to_add = [n for n in names if n not in existing]
        if not to_add:
            return content
        all_names = existing + to_add
        replacement = m.group(1) + " " + ", ".join(all_names) + " " + m.group(3) + m.group(4)
        return content[:m.start()] + replacement + content[m.end():]
    new_line = f'import {{ {", ".join(names)} }} from "{portable_path}"; /* Wave H Track A */\n'
    last_end = 0
    for im in re.finditer(r"^import\s[^\n]*\n", content, re.MULTILINE):
        last_end = im.end()
    if last_end:
        return content[:last_end] + new_line + content[last_end:]
    return new_line + content


def extract_query_from_before_all(before_all):
    """
    Given 'before_all' which may be:
      'db.select().from(t)'  → query is the whole thing
      'const rows = db.select().from(t)'  → query is 'db.select().from(t)'
    Returns (decl, query_expr, indent)
    """
    assign_m = re.match(
        r'^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\](){}:,]+)?\s*=\s*)(.*)',
        before_all
    )
    if assign_m:
        return assign_m.group(2), assign_m.group(3).strip(), assign_m.group(1)
    return None, before_all.strip(), re.match(r'^(\s*)', before_all).group(1)


def collect_chain(result_lines):
    """Collect preceding chain lines from the result buffer."""
    cont_lines = []
    k = len(result_lines) - 1
    while k >= 0:
        prev = result_lines[k]
        pt = prev.strip()
        # Stop conditions
        if pt == "" or pt.endswith(";"):
            break
        if pt.startswith("//") or pt.startswith("/*") or pt.startswith("*"):
            break
        if pt in ("}", "});", "});", "});"):
            break
        cont_lines.insert(0, result_lines.pop())
        k -= 1
        # If this is start of an assignment, stop collecting
        if cont_lines and re.match(r'^\s*(const|let|var)\s+\w+', cont_lines[0]):
            break
    return cont_lines


def is_safe_run(chain_lines):
    """Return True if it's safe to transform this chain to pRun."""
    text = "\n".join(chain_lines)
    open_braces = text.count("{")
    close_braces = text.count("}")
    # If braces don't balance, we're inside an object literal → unsafe
    return open_braces == close_braces


def transform_file(filepath):
    content = open(filepath, encoding="utf-8").read()
    lines = content.split("\n")
    result = []
    needed = set()
    i = 0

    while i < len(lines):
        line = lines[i]
        t = line.strip()

        # Skip comment lines entirely
        if t.startswith("//") or t.startswith("*") or t.startswith("/*"):
            result.append(line)
            i += 1
            continue

        # ── db.transaction((tx) => { ────────────────────────────────────
        txn_m = re.match(
            r'^(\s*)(\w+)\.transaction\s*\((\([^)]*\))\s*=>\s*\{(.*)$',
            line
        )
        if txn_m:
            indent, db_var, params, rest = txn_m.groups()
            needed.add("pTransaction")
            result.append(f"{indent}await pTransaction({db_var}, async {params} => {{{rest}")
            i += 1
            continue

        # ── .all() as T[] ───────────────────────────────────────────────
        # Pattern A: standalone — line is ONLY "  .all() as T[];"
        standalone_all = re.match(
            r'^(\s*)\.all\(\)(\s*as\s+[\w\[\]\s|<>(){}:,;]+)?(\s*;?)\s*$',
            line
        )
        # Pattern B: inline — "  expr.all() as T[];"
        inline_all = (
            re.match(
                r'^(\s*)(.+?)\.all\(\)(\s*as\s+[\w\[\]\s|<>(){}:,;]+)?(\s*;?)\s*$',
                line
            )
            if not standalone_all else None
        )

        if standalone_all:
            indent = standalone_all.group(1)
            as_type = (standalone_all.group(2) or "").strip()
            semi = standalone_all.group(3).strip()
            terminator = ";" if semi else ""
            type_m = re.search(r'as\s+(\w+)', as_type)
            T = type_m.group(1) if type_m else "any"
            has_complex = "Array<" in as_type or ("{" in as_type and "}" in as_type)

            cont_lines = collect_chain(result)
            needed.add("pAll")

            if cont_lines:
                first = cont_lines[0]
                first_indent = re.match(r'^(\s*)', first).group(1)
                # Extract decl from first line
                assign_m = re.match(
                    r'^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\](){}:,]+)?\s*=\s*)(.*)',
                    first
                )
                if assign_m:
                    fi, decl = assign_m.group(1), assign_m.group(2)
                    rest_parts = [assign_m.group(3).rstrip()] + [l.rstrip() for l in cont_lines[1:]]
                    body = "\n".join(rest_parts)
                    if has_complex:
                        result.append(f"{fi}{decl}(await pAll<any>(\n{fi}  {body}\n{fi})) {as_type}{terminator}")
                    else:
                        result.append(f"{fi}{decl}await pAll<{T}>(\n{fi}  {body}\n{fi}){terminator}")
                else:
                    body = "\n".join(l.rstrip() for l in cont_lines)
                    if has_complex:
                        result.append(f"{first_indent}(await pAll<any>(\n{first_indent}  {body}\n{first_indent})) {as_type}{terminator}")
                    else:
                        result.append(f"{first_indent}await pAll<{T}>(\n{first_indent}  {body}\n{first_indent}){terminator}")
            else:
                result.append(f"{indent}/* MANUAL: .all() with no chain */\n{indent}await pAll<{T}>(\n{indent}  /* FILL_IN */\n{indent}){terminator}")
            i += 1
            continue

        elif inline_all and inline_all.group(2).strip():
            indent = inline_all.group(1)
            before_all = inline_all.group(2).rstrip()
            as_type = (inline_all.group(3) or "").strip()
            semi = inline_all.group(4).strip()
            terminator = ";" if semi else ""
            type_m = re.search(r'as\s+(\w+)', as_type)
            T = type_m.group(1) if type_m else "any"
            has_complex = "Array<" in as_type or ("{" in as_type and "}" in as_type)

            # Extract query from before_all
            decl, query_expr, first_indent = extract_query_from_before_all(before_all)

            cont_lines = collect_chain(result)
            needed.add("pAll")

            if cont_lines:
                # Multi-line chain: combine cont_lines + query_expr
                # First line might have decl from cont_lines
                first = cont_lines[0]
                fi = re.match(r'^(\s*)', first).group(1)
                first_assign_m = re.match(
                    r'^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\](){}:,]+)?\s*=\s*)(.*)',
                    first
                )
                if first_assign_m:
                    fi = first_assign_m.group(1)
                    fdecl = first_assign_m.group(2)
                    body_parts = [first_assign_m.group(3).rstrip()] + [l.rstrip() for l in cont_lines[1:]] + [query_expr]
                    body = "\n".join(body_parts)
                    if has_complex:
                        result.append(f"{fi}{fdecl}(await pAll<any>(\n{fi}  {body}\n{fi})) {as_type}{terminator}")
                    else:
                        result.append(f"{fi}{fdecl}await pAll<{T}>(\n{fi}  {body}\n{fi}){terminator}")
                else:
                    body_parts = [l.rstrip() for l in cont_lines] + [query_expr]
                    body = "\n".join(body_parts)
                    if has_complex:
                        result.append(f"{fi}(await pAll<any>(\n{fi}  {body}\n{fi})) {as_type}{terminator}")
                    else:
                        result.append(f"{fi}await pAll<{T}>(\n{fi}  {body}\n{fi}){terminator}")
            else:
                # Single-line: use decl and query_expr directly
                if decl:
                    if has_complex:
                        result.append(f"{indent}{decl}(await pAll<any>(\n{indent}  {query_expr}\n{indent})) {as_type}{terminator}")
                    else:
                        result.append(f"{indent}{decl}await pAll<{T}>(\n{indent}  {query_expr}\n{indent}){terminator}")
                else:
                    if has_complex:
                        result.append(f"{indent}(await pAll<any>(\n{indent}  {query_expr}\n{indent})) {as_type}{terminator}")
                    else:
                        result.append(f"{indent}await pAll<{T}>(\n{indent}  {query_expr}\n{indent}){terminator}")
            i += 1
            continue

        # ── .run() - standalone on its own line ─────────────────────────
        standalone_run = re.match(r'^(\s*)\.run\(\)\s*;?\s*$', line)
        if standalone_run:
            indent = standalone_run.group(1)
            cont_lines = collect_chain(result)

            if cont_lines and is_safe_run(cont_lines):
                needed.add("pRun")
                first = cont_lines[0]
                fi = re.match(r'^(\s*)', first).group(1)
                assign_m = re.match(
                    r'^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\](){}:,]+)?\s*=\s*)(.*)',
                    first
                )
                if assign_m:
                    body_parts = [assign_m.group(3).rstrip()] + [l.rstrip() for l in cont_lines[1:]]
                    body = "\n".join(body_parts)
                    result.append(f"{assign_m.group(1)}{assign_m.group(2)}await pRun(\n{assign_m.group(1)}  {body}\n{assign_m.group(1)});")
                else:
                    body = "\n".join(l.rstrip() for l in cont_lines)
                    result.append(f"{fi}await pRun(\n{fi}  {body}\n{fi});")
            else:
                # Not safe or no chain — restore and keep as-is
                result.extend(cont_lines)
                result.append(line)
            i += 1
            continue

        # ── .run() inline: expr.run(); (only simple cases) ──────────────
        inline_run = re.match(r'^(\s*)((?:(?:const|let|var)\s+\w+[^=]+=\s*)?\w[^;{}]*?)\.run\(\)\s*;?\s*$', line)
        if inline_run and not t.startswith("//"):
            indent = inline_run.group(1)
            expr = inline_run.group(2).strip()
            # Only transform if expr has no object literals
            if "{" not in expr and "}" not in expr:
                # Also collect preceding lines
                cont_lines = collect_chain(result)
                all_for_check = cont_lines + [expr]
                if is_safe_run(all_for_check):
                    needed.add("pRun")
                    if cont_lines:
                        first = cont_lines[0]
                        fi = re.match(r'^(\s*)', first).group(1)
                        assign_m = re.match(
                            r'^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\](){}:,]+)?\s*=\s*)(.*)',
                            first
                        )
                        if assign_m:
                            body_parts = [assign_m.group(3).rstrip()] + [l.rstrip() for l in cont_lines[1:]] + [expr]
                            body = "\n".join(body_parts)
                            result.append(f"{assign_m.group(1)}{assign_m.group(2)}await pRun(\n{assign_m.group(1)}  {body}\n{assign_m.group(1)});")
                        else:
                            body_parts = [l.rstrip() for l in cont_lines] + [expr]
                            body = "\n".join(body_parts)
                            result.append(f"{fi}await pRun(\n{fi}  {body}\n{fi});")
                    else:
                        assign_m2 = re.match(
                            r'^((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\]()]+)?\s*=\s*)(.*)',
                            expr
                        )
                        if assign_m2:
                            result.append(f"{indent}{assign_m2.group(1)}await pRun(\n{indent}  {assign_m2.group(2).strip()}\n{indent});")
                        else:
                            result.append(f"{indent}await pRun(\n{indent}  {expr}\n{indent});")
                    i += 1
                    continue
                else:
                    result.extend(cont_lines)
                    # Fall through

        result.append(line)
        i += 1

    new_content = "\n".join(result)
    if needed:
        new_content = ensure_portable_import(new_content, filepath, sorted(needed))

    return new_content, needed


def process_all():
    remaining_files = []
    with open("/home/user/workspace/wave_h_audit/REMAINING_LIVE.txt") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 2:
                remaining_files.append(parts[1])

    totals = {"before_all": 0, "before_run": 0, "before_txn": 0,
              "after_all": 0, "after_run": 0, "after_txn": 0}

    for fp in remaining_files:
        if fp in SACRED or not os.path.exists(fp):
            continue
        content = open(fp).read()
        b_all = content.count(".all()")
        b_run = content.count(".run()")
        b_txn = len(re.findall(r"\bdb\.transaction\s*\(", content))
        if not (b_all or b_run or b_txn):
            continue

        totals["before_all"] += b_all
        totals["before_run"] += b_run
        totals["before_txn"] += b_txn

        new_content, needed = transform_file(fp)
        if new_content == content:
            totals["after_all"] += b_all
            totals["after_run"] += b_run
            totals["after_txn"] += b_txn
            continue

        a_all = new_content.count(".all()")
        a_run = new_content.count(".run()")
        a_txn = len(re.findall(r"\bdb\.transaction\s*\(", new_content))
        totals["after_all"] += a_all
        totals["after_run"] += a_run
        totals["after_txn"] += a_txn

        bak = fp + ".bak_final"
        if not os.path.exists(bak):
            shutil.copy2(fp, bak)
        open(fp, "w", encoding="utf-8").write(new_content)

        fixed = (b_all - a_all) + (b_run - a_run) + (b_txn - a_txn)
        remaining = a_all + a_run + a_txn
        if fixed > 0:
            print(f"  MIGRATED: {fp} [{sorted(needed)}]")
            print(f"    .all {b_all}→{a_all}  .run {b_run}→{a_run}  txn {b_txn}→{a_txn}  remaining={remaining}")

    print(f"\n{'='*60}")
    print(f"Before: {totals['before_all']} all, {totals['before_run']} run, {totals['before_txn']} txn")
    print(f"After:  {totals['after_all']} all, {totals['after_run']} run, {totals['after_txn']} txn")
    grand = totals["after_all"] + totals["after_run"] + totals["after_txn"]
    print(f"Remaining: {grand}")


if __name__ == "__main__":
    process_all()
