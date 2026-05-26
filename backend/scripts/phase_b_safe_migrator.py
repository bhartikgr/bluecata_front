#!/usr/bin/env python3
"""
Phase B SAFE migrator — conservative approach.

Rules:
1. ONLY transform .all() that is either:
   a. Standalone on its own line: "      .all() as any[];"
   b. At the END of a line that starts with spaces + simple expression (no { or : inside)

2. For .run(): ONLY transform patterns where .run() is on its own line
   OR is appended to a line that doesn't contain { } for object literals.
   NEVER transform .run() that appears after ).onConflictDoUpdate or other
   complex query chains with object arguments.

3. For db.transaction(): transform ALL occurrences.

4. Add async keyword to enclosing functions where needed.

This conservative approach avoids the false-positive issue where the migrator
wraps object literal contents in await pRun().
"""

import re
import os
import shutil
from typing import Optional

SACRED = {
    "server/captableCommitStore.ts",
    "server/roundsStore.ts",
    "server/lib/roundCloseCascade.ts",
    "server/spvFundStore.ts",
    "server/collectiveBillingStore.ts",
}


def get_portable_path(filepath: str) -> str:
    parts = filepath.replace("\\", "/").split("/")
    if len(parts) >= 3 and parts[0] == "server" and parts[1] in ("lib", "jobs"):
        return "../db/portable"
    return "./db/portable"


def ensure_portable_import(content: str, filepath: str, names: list[str]) -> str:
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
        replacement = (
            m.group(1) + " " + ", ".join(all_names) + " " + m.group(3) + m.group(4)
        )
        return content[: m.start()] + replacement + content[m.end() :]
    new_line = f'import {{ {", ".join(names)} }} from "{portable_path}"; /* Wave H Track A — Postgres compat */\n'
    last_import_end = 0
    for im in re.finditer(r"^import\s[^\n]*\n", content, re.MULTILINE):
        last_import_end = im.end()
    if last_import_end:
        return content[:last_import_end] + new_line + content[last_import_end:]
    return new_line + content


def collect_chain_for_all(result_lines):
    """
    Collect continuation lines for a .all() call.
    Returns (cont_lines, remaining_result) where cont_lines is the full chain.
    """
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
        # Block ends that aren't method chain continuations
        if pt in ("}", "});", "});", "});"):
            break
        
        cont_lines.insert(0, result_lines.pop())
        k -= 1
        
        # If this is a var/const/let declaration, it's the start
        if re.match(r'^\s*(const|let|var)\s+\w+', cont_lines[0] if cont_lines else ''):
            break
    
    return cont_lines


def is_safe_for_run_transform(lines_up_to_run):
    """
    Check if it's SAFE to transform a .run() call.
    
    UNSAFE cases:
    - The chain contains an UNCLOSED { (meaning we're inside an object literal)
    - The .run() is on a line AFTER a line that ends with a , or : in an object context
    """
    if not lines_up_to_run:
        return True
    
    # Count braces in the collected chain
    chain_text = '\n'.join(lines_up_to_run)
    open_braces = chain_text.count('{')
    close_braces = chain_text.count('}')
    
    # If braces don't balance, we're inside an object literal - UNSAFE
    if open_braces != close_braces:
        return False
    
    return True


def transform_file(filepath: str) -> tuple[str, set]:
    content = open(filepath, encoding="utf-8").read()
    lines = content.split("\n")
    result = []
    needed = set()
    i = 0
    
    while i < len(lines):
        line = lines[i]
        t = line.strip()
        
        # Skip comments
        if t.startswith("//") or t.startswith("*") or t.startswith("/*"):
            result.append(line)
            i += 1
            continue
        
        # ── Transform db.transaction((tx) => { ──────────────────────────
        txn_m = re.match(
            r'^(\s*)(\w+)\.transaction\s*\((\([^)]*\))\s*=>\s*\{(.*)$',
            line
        )
        if txn_m:
            indent = txn_m.group(1)
            db_var = txn_m.group(2)
            params = txn_m.group(3)
            rest = txn_m.group(4)
            needed.add("pTransaction")
            result.append(f"{indent}await pTransaction({db_var}, async {params} => {{{rest}")
            i += 1
            continue
        
        # ── Transform .all() as T[] ─────────────────────────────────────
        
        # Case A: standalone .all() line
        standalone_all = re.match(r'^(\s*)\.all\(\)(\s*as\s+[\w\[\]\s|<>(){}:,;]+)?(\s*;?)\s*$', line)
        # Case B: inline .all() appended to expression
        inline_all = (
            re.match(r'^(\s*)(.+?)\.all\(\)(\s*as\s+[\w\[\]\s|<>(){}:,;]+)?(\s*;?)\s*$', line)
            if not standalone_all else None
        )
        
        if standalone_all and not t.startswith("//"):
            indent = standalone_all.group(1)
            as_type = (standalone_all.group(2) or "").strip()
            semi = standalone_all.group(3).strip()
            terminator = ";" if semi else ""
            
            type_m = re.search(r'as\s+(\w+)', as_type)
            T = type_m.group(1) if type_m else "any"
            # For Array<{...}> types, keep the original 'as' cast
            has_complex_type = "Array<" in as_type or "{" in as_type
            
            cont_lines = collect_chain_for_all(result)
            needed.add("pAll")
            
            if cont_lines:
                first = cont_lines[0]
                first_indent = re.match(r'^(\s*)', first).group(1)
                assign_m = re.match(
                    r'^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\](){}:,]+)?\s*=\s*)(.*)',
                    first
                )
                
                body_parts = [assign_m.group(3).rstrip() if assign_m else cont_lines[0]] + [
                    l.rstrip() for l in (cont_lines[1:] if assign_m else cont_lines)
                ]
                body = '\n'.join(body_parts)
                
                if assign_m:
                    fi = assign_m.group(1)
                    decl = assign_m.group(2)
                    if has_complex_type:
                        result.append(f'{fi}{decl}(await pAll<any>(\n{fi}  {body}\n{fi})) {as_type}{terminator}')
                    else:
                        result.append(f'{fi}{decl}await pAll<{T}>(\n{fi}  {body}\n{fi}){terminator}')
                else:
                    if has_complex_type:
                        result.append(f'{first_indent}(await pAll<any>(\n{first_indent}  {body}\n{first_indent})) {as_type}{terminator}')
                    else:
                        result.append(f'{first_indent}await pAll<{T}>(\n{first_indent}  {body}\n{first_indent}){terminator}')
            else:
                result.append(f'{indent}(await pAll<any>(\n{indent}  /* MANUAL_NEEDED */\n{indent})) {as_type}{terminator}')
            i += 1
            continue
        
        elif inline_all and inline_all.group(2).strip() and not t.startswith("//"):
            indent = inline_all.group(1)
            before_all = inline_all.group(2).rstrip()
            as_type = (inline_all.group(3) or "").strip()
            semi = inline_all.group(4).strip()
            terminator = ";" if semi else ""
            
            type_m = re.search(r'as\s+(\w+)', as_type)
            T = type_m.group(1) if type_m else "any"
            has_complex_type = "Array<" in as_type or "{" in as_type
            
            cont_lines = collect_chain_for_all(result)
            needed.add("pAll")
            
            if cont_lines:
                all_lines = cont_lines + [before_all]
                first = all_lines[0]
                first_indent = re.match(r'^(\s*)', first).group(1)
                assign_m = re.match(
                    r'^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\](){}:,]+)?\s*=\s*)(.*)',
                    first
                )
                if assign_m:
                    fi = assign_m.group(1)
                    decl = assign_m.group(2)
                    rest_of_first = assign_m.group(3).rstrip()
                    body_parts = [rest_of_first] + [l.rstrip() for l in all_lines[1:]]
                    body = '\n'.join(body_parts)
                    if has_complex_type:
                        result.append(f'{fi}{decl}(await pAll<any>(\n{fi}  {body}\n{fi})) {as_type}{terminator}')
                    else:
                        result.append(f'{fi}{decl}await pAll<{T}>(\n{fi}  {body}\n{fi}){terminator}')
                else:
                    body = '\n'.join(l.rstrip() for l in all_lines)
                    if has_complex_type:
                        result.append(f'{first_indent}(await pAll<any>(\n{first_indent}  {body}\n{first_indent})) {as_type}{terminator}')
                    else:
                        result.append(f'{first_indent}await pAll<{T}>(\n{first_indent}  {body}\n{first_indent}){terminator}')
            else:
                assign_m = re.match(
                    r'^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\](){}:,]+)?\s*=\s*)(.*)',
                    line
                )
                if assign_m:
                    fi = assign_m.group(1)
                    decl = assign_m.group(2)
                    expr = before_all.strip()
                    if has_complex_type:
                        result.append(f'{fi}{decl}(await pAll<any>(\n{fi}  {expr}\n{fi})) {as_type}{terminator}')
                    else:
                        result.append(f'{fi}{decl}await pAll<{T}>(\n{fi}  {expr}\n{fi}){terminator}')
                else:
                    if has_complex_type:
                        result.append(f'{indent}(await pAll<any>(\n{indent}  {before_all.strip()}\n{indent})) {as_type}{terminator}')
                    else:
                        result.append(f'{indent}await pAll<{T}>(\n{indent}  {before_all.strip()}\n{indent}){terminator}')
            i += 1
            continue
        
        # ── Transform .run() - ONLY on standalone line ───────────────────
        # Pattern: the line is ONLY "      .run();" with nothing before the .run()
        # This is safe because the chain above doesn't have unclosed braces
        standalone_run = re.match(r'^(\s*)\.run\(\)\s*;?\s*$', line)
        if standalone_run and not t.startswith("//"):
            indent = standalone_run.group(1)
            
            # Collect the chain
            cont_lines = []
            k = len(result) - 1
            while k >= 0:
                prev = result[k]
                pt = prev.strip()
                if pt == "" or pt.endswith(";"):
                    break
                if pt.startswith("//") or pt.startswith("/*") or pt.startswith("*"):
                    break
                cont_lines.insert(0, result.pop())
                k -= 1
                if re.match(r'^\s*(const|let|var)\s+\w+', cont_lines[0] if cont_lines else ''):
                    break
            
            # Check if safe to transform
            if cont_lines and is_safe_for_run_transform(cont_lines):
                needed.add("pRun")
                first = cont_lines[0]
                first_indent = re.match(r'^(\s*)', first).group(1)
                assign_m = re.match(
                    r'^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\](){}:,]+)?\s*=\s*)(.*)',
                    first
                )
                body_parts = [
                    assign_m.group(3).rstrip() if assign_m else cont_lines[0].rstrip()
                ] + [l.rstrip() for l in cont_lines[1:]]
                body = '\n'.join(body_parts)
                
                if assign_m:
                    fi = assign_m.group(1)
                    decl = assign_m.group(2)
                    result.append(f'{fi}{decl}await pRun(\n{fi}  {body}\n{fi});')
                else:
                    result.append(f'{first_indent}await pRun(\n{first_indent}  {body}\n{first_indent});')
            else:
                # Not safe — put lines back and keep .run()
                result.extend(cont_lines)
                result.append(line)
            i += 1
            continue
        
        # ── Transform inline .run() on end of line ────────────────────────
        # "  tx.insert(...).values(...).run();"
        # BUT ONLY if the preceding part has balanced braces
        inline_run = re.match(r'^(\s*)(.*[^\s])\.run\(\)\s*;?\s*$', line)
        if inline_run and not t.startswith("//") and not t.startswith("*"):
            expr = inline_run.group(2).strip()
            indent = inline_run.group(1)
            
            # Count braces in this single line
            open_b = expr.count('{')
            close_b = expr.count('}')
            
            if open_b == close_b and '{' not in expr.split('.run()')[0].split('(')[0]:
                # Collect preceding continuation lines too
                cont_lines = []
                k = len(result) - 1
                while k >= 0:
                    prev = result[k]
                    pt = prev.strip()
                    if pt == "" or pt.endswith(";"):
                        break
                    if pt.startswith("//") or pt.startswith("/*"):
                        break
                    cont_lines.insert(0, result.pop())
                    k -= 1
                    if re.match(r'^\s*(const|let|var)\s+\w+', cont_lines[0] if cont_lines else ''):
                        break
                
                all_lines_for_check = cont_lines + [expr]
                if is_safe_for_run_transform(all_lines_for_check):
                    needed.add("pRun")
                    if cont_lines:
                        all_lines = cont_lines + [expr]
                        first = all_lines[0]
                        first_indent = re.match(r'^(\s*)', first).group(1)
                        assign_m = re.match(
                            r'^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\](){}:,]+)?\s*=\s*)(.*)',
                            first
                        )
                        if assign_m:
                            fi = assign_m.group(1)
                            decl = assign_m.group(2)
                            body_parts = [assign_m.group(3).rstrip()] + [l.rstrip() for l in all_lines[1:]]
                            body = '\n'.join(body_parts)
                            result.append(f'{fi}{decl}await pRun(\n{fi}  {body}\n{fi});')
                        else:
                            body = '\n'.join(l.rstrip() for l in all_lines)
                            result.append(f'{first_indent}await pRun(\n{first_indent}  {body}\n{first_indent});')
                    else:
                        result.append(f'{indent}await pRun(\n{indent}  {expr}\n{indent});')
                    i += 1
                    continue
                else:
                    # Put continuation lines back
                    result.extend(cont_lines)
            # Fall through - keep as-is
        
        result.append(line)
        i += 1
    
    new_content = "\n".join(result)
    
    # Update imports
    if needed:
        new_content = ensure_portable_import(new_content, filepath, sorted(needed))
    
    return new_content, needed


def process_all_files():
    remaining_files = []
    with open('/home/user/workspace/wave_h_audit/REMAINING_LIVE.txt') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 2:
                remaining_files.append(parts[1])
    
    total_before_all = 0
    total_before_run = 0
    total_before_txn = 0
    total_after_all = 0
    total_after_run = 0
    total_after_txn = 0
    
    for fp in remaining_files:
        if fp in SACRED or not os.path.exists(fp):
            continue
        
        content = open(fp).read()
        before_all = content.count('.all()')
        before_run = content.count('.run()')
        before_txn = len(re.findall(r'\bdb\.transaction\s*\(', content))
        
        if not (before_all or before_run or before_txn):
            continue
        
        total_before_all += before_all
        total_before_run += before_run
        total_before_txn += before_txn
        
        new_content, needed = transform_file(fp)
        
        if new_content == content:
            total_after_all += before_all
            total_after_run += before_run
            total_after_txn += before_txn
            continue
        
        after_all = new_content.count('.all()')
        after_run = new_content.count('.run()')
        after_txn = len(re.findall(r'\bdb\.transaction\s*\(', new_content))
        
        total_after_all += after_all
        total_after_run += after_run
        total_after_txn += after_txn
        
        # Write backup if doesn't exist yet
        bak = fp + ".bak_safe_b"
        if not os.path.exists(bak):
            shutil.copy2(fp, bak)
        
        open(fp, 'w', encoding='utf-8').write(new_content)
        
        fixed = (before_all - after_all) + (before_run - after_run) + (before_txn - after_txn)
        remaining = after_all + after_run + after_txn
        if fixed > 0:
            print(f"  MIGRATED: {fp} (added: {sorted(needed)})")
            print(f"    .all: {before_all}→{after_all}  .run: {before_run}→{after_run}  txn: {before_txn}→{after_txn}  remaining: {remaining}")
    
    print(f"\n{'='*60}")
    print(f"Before: .all={total_before_all} .run={total_before_run} txn={total_before_txn}")
    print(f"After:  .all={total_after_all} .run={total_after_run} txn={total_after_txn}")
    grand_remaining = total_after_all + total_after_run + total_after_txn
    print(f"Remaining: {grand_remaining}")


if __name__ == "__main__":
    process_all_files()
