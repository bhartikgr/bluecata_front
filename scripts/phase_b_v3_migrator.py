#!/usr/bin/env python3
"""
Phase B v3 migrator — handles all edge cases correctly.

Edge cases handled:
1. return db.select()...all() → return await pAll<T>(db.select()...)
2. const rows = db.select()...all() → const rows = await pAll<T>(db.select()...)
3. standalone .all() line with full chain above
4. inline .all() on same line as expression
5. Array<{...}> type annotations → (await pAll<any>(...)) as Array<{...}>
6. .run() on its own line (standalone)
7. inline .run() with simple expression
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


def collect_chain(result_lines):
    """Collect preceding chain lines from the result buffer. Includes return/const lines."""
    cont_lines = []
    k = len(result_lines) - 1
    while k >= 0:
        prev = result_lines[k]
        pt = prev.strip()
        # Absolute stops
        if pt == "" or pt.endswith(";"):
            break
        if pt.startswith("//") or pt.startswith("/*") or pt.startswith("*"):
            break
        if pt in ("}", "});"):
            break
        # Check for enclosing structure lines
        if re.match(r'^\s*(?:try|catch|finally|if|else|for|while|switch)\s*[({]', prev):
            break
        cont_lines.insert(0, result_lines.pop())
        k -= 1
        # If this is a complete chain start (const/let/var OR return), stop
        if cont_lines:
            first_t = cont_lines[0].strip()
            if re.match(r'^(const|let|var)\s+\w+', first_t):
                break
            if first_t.startswith("return "):
                break
    return cont_lines


def is_safe_run(chain_lines):
    """Return True if it's safe to transform this chain to pRun (balanced braces)."""
    text = "\n".join(chain_lines)
    return text.count("{") == text.count("}")


def build_pall_output(cont_lines, before_all_line, as_type, terminator, T, indent):
    """Build the await pAll<T>(...) output string."""
    has_complex = "Array<" in as_type or ("{" in as_type and "}" in as_type)
    
    # Combine cont_lines with before_all_line (the expr before .all())
    if before_all_line:
        all_lines = list(cont_lines) + [before_all_line]
    else:
        all_lines = list(cont_lines)
    
    if not all_lines:
        return f"{indent}await pAll<{T}>(\n{indent}  /* MANUAL_NEEDED */\n{indent}){terminator}"
    
    first = all_lines[0]
    first_indent = re.match(r'^(\s*)', first).group(1)
    
    # Check for const/let/var assignment
    assign_m = re.match(
        r'^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\](){}:,]+)?\s*=\s*)(.*)',
        first, re.DOTALL
    )
    # Check for return statement
    return_m = re.match(r'^(\s*)return\s+(.*)', first, re.DOTALL) if not assign_m else None
    
    if assign_m:
        fi = assign_m.group(1)
        decl = assign_m.group(2)
        rest_of_first = assign_m.group(3).rstrip()
        body_parts = [rest_of_first] + [l.rstrip() for l in all_lines[1:]]
        body = "\n".join(p for p in body_parts if p.strip() or not p.strip())
        # Remove empty trailing
        while body.endswith("\n"):
            body = body[:-1]
        if has_complex:
            return f"{fi}{decl}(await pAll<any>(\n{fi}  {body}\n{fi})) {as_type}{terminator}"
        else:
            return f"{fi}{decl}await pAll<{T}>(\n{fi}  {body}\n{fi}){terminator}"
    elif return_m:
        fi = return_m.group(1)
        rest_of_return = return_m.group(2).rstrip()
        body_parts = [rest_of_return] + [l.rstrip() for l in all_lines[1:]]
        body = "\n".join(body_parts)
        if has_complex:
            return f"{fi}return (await pAll<any>(\n{fi}  {body}\n{fi})) {as_type}{terminator}"
        else:
            return f"{fi}return await pAll<{T}>(\n{fi}  {body}\n{fi}){terminator}"
    else:
        body = "\n".join(l.rstrip() for l in all_lines)
        if has_complex:
            return f"{first_indent}(await pAll<any>(\n{first_indent}  {body}\n{first_indent})) {as_type}{terminator}"
        else:
            return f"{first_indent}await pAll<{T}>(\n{first_indent}  {body}\n{first_indent}){terminator}"


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

        # ── db.transaction((tx) => { ─────────────────────────────────────
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

        # ── Standalone .all() (line is ONLY .all()...) ───────────────────
        standalone_all = re.match(
            r'^(\s*)\.all\(\)(\s*as\s+[\w\[\]\s|<>(){}:,;]+)?(\s*;?)\s*$',
            line
        )
        if standalone_all and not t.startswith("//"):
            indent = standalone_all.group(1)
            as_type = (standalone_all.group(2) or "").strip()
            semi = standalone_all.group(3).strip()
            terminator = ";" if semi else ""
            type_m = re.search(r'as\s+(\w+)', as_type)
            T = type_m.group(1) if type_m else "any"

            cont_lines = collect_chain(result)
            needed.add("pAll")
            output = build_pall_output(cont_lines, "", as_type, terminator, T, indent)
            result.append(output)
            i += 1
            continue

        # ── Inline .all() (expr.all() on same line) ──────────────────────
        inline_all = re.match(
            r'^(\s*)(.+?)\.all\(\)(\s*as\s+[\w\[\]\s|<>(){}:,;]+)?(\s*;?)\s*$',
            line
        )
        if inline_all and inline_all.group(2).strip() and not t.startswith("//"):
            indent = inline_all.group(1)
            before_all = inline_all.group(2).rstrip()
            as_type = (inline_all.group(3) or "").strip()
            semi = inline_all.group(4).strip()
            terminator = ";" if semi else ""
            type_m = re.search(r'as\s+(\w+)', as_type)
            T = type_m.group(1) if type_m else "any"

            # Extract the query part from before_all
            # before_all could be: "const rows = db.select().from(t)" or just "db.select().from(t)"
            # or "return db.select().from(t)"
            
            cont_lines = collect_chain(result)
            needed.add("pAll")
            output = build_pall_output(cont_lines, before_all, as_type, terminator, T, indent)
            result.append(output)
            i += 1
            continue

        # ── Standalone .run() ────────────────────────────────────────────
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
                return_m = re.match(r'^(\s*)return\s+(.*)', first) if not assign_m else None
                if assign_m:
                    body_parts = [assign_m.group(3).rstrip()] + [l.rstrip() for l in cont_lines[1:]]
                    body = "\n".join(body_parts)
                    result.append(f"{assign_m.group(1)}{assign_m.group(2)}await pRun(\n{assign_m.group(1)}  {body}\n{assign_m.group(1)});")
                elif return_m:
                    body_parts = [return_m.group(2).rstrip()] + [l.rstrip() for l in cont_lines[1:]]
                    body = "\n".join(body_parts)
                    result.append(f"{return_m.group(1)}return await pRun(\n{return_m.group(1)}  {body}\n{return_m.group(1)});")
                else:
                    body = "\n".join(l.rstrip() for l in cont_lines)
                    result.append(f"{fi}await pRun(\n{fi}  {body}\n{fi});")
            else:
                result.extend(cont_lines)
                result.append(line)
            i += 1
            continue

        # ── Inline .run() with simple expression ─────────────────────────
        inline_run = re.match(r'^(\s*)([\w.()[\]"\'`|&+\-*/: ,]+?)\.run\(\)\s*;?\s*$', line)
        if inline_run and not t.startswith("//"):
            indent = inline_run.group(1)
            expr = inline_run.group(2).strip()
            if "{" not in expr and "}" not in expr:
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

    totals = dict(before_all=0, before_run=0, before_txn=0,
                  after_all=0, after_run=0, after_txn=0)

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

        bak = fp + ".bak_v3"
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
