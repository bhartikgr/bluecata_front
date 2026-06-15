#!/usr/bin/env python3
"""
Phase B complete migrator for Capavate v23.5.
Transforms all non-sacred files to use portable async helpers.

This script uses careful line-by-line transformation:
1. .all() → pAll (with async wrapping)
2. .get() → pGet
3. .run() → pRun (terminal on expressions inside transactions)
4. db.transaction((tx) => {  →  await pTransaction(db, async (tx) => {

For .run() calls inside transactions:
  tx.insert(...).values(...).run()
  → await pRun(tx.insert(...).values(...))
  
  But the surrounding async function (the pTransaction callback) is already async,
  so these are fine.

For functions that now contain await calls:
  - If function is already async: fine
  - If function is not async: add 'async' keyword

SAFETY:
  - Never modify SACRED files
  - Each file is backed up before modification
  - Counts printed before/after for verification
"""

import re
import os
import sys
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
    """Get relative path from file to portable.ts."""
    parts = filepath.replace("\\", "/").split("/")
    if len(parts) >= 3 and parts[0] == "server" and parts[1] in ("lib", "jobs"):
        return "../db/portable"
    return "./db/portable"


def ensure_portable_import(content: str, filepath: str, names: list[str]) -> str:
    """Add or update portable import."""
    if not names:
        return content
    portable_path = get_portable_path(filepath)
    
    # Try to find existing portable import
    pattern = re.compile(
        r'(import\s*\{)([^}]*?)(\}\s*from\s*["\']'
        + re.escape(portable_path)
        + r'["\'])(\s*;[^\n]*)',
        re.DOTALL
    )
    m = pattern.search(content)
    if m:
        existing = [x.strip() for x in m.group(2).split(",") if x.strip()]
        # Remove /* comments */ from existing
        existing = [re.sub(r'/\*.*?\*/', '', x).strip() for x in existing]
        existing = [x for x in existing if x]
        to_add = [n for n in names if n not in existing]
        if not to_add:
            return content
        all_names = existing + to_add
        replacement = (
            m.group(1)
            + " "
            + ", ".join(all_names)
            + " "
            + m.group(3)
            + m.group(4)
        )
        return content[: m.start()] + replacement + content[m.end() :]
    
    # Add new import line after the last import statement
    new_line = f'import {{ {", ".join(names)} }} from "{portable_path}"; /* Wave H Track A — Postgres compat */\n'
    
    # Find position: after all import lines
    last_import_end = 0
    for im in re.finditer(r"^import\s[^\n]*\n(?:  [^\n]*\n)*", content, re.MULTILINE):
        last_import_end = im.end()
    
    if last_import_end == 0:
        # Single-line imports
        for im in re.finditer(r"^import\s[^;]+;\n", content, re.MULTILINE):
            last_import_end = im.end()
    
    if last_import_end:
        return content[:last_import_end] + new_line + content[last_import_end:]
    return new_line + content


def transform_transactions(content: str) -> tuple[str, int]:
    """
    Transform db.transaction((tx: any) => { to await pTransaction(db, async (tx: any) => {
    Also handles: db.transaction((tx) => {
    """
    count = 0
    
    def repl(m):
        nonlocal count
        count += 1
        indent = m.group(1)
        db_var = m.group(2)
        params = m.group(3)
        return f"{indent}await pTransaction({db_var}, async {params} => {{"
    
    result = re.sub(
        r"^(\s*)(\w+)\.transaction\s*\((\([^)]*\))\s*=>\s*\{",
        repl,
        content,
        flags=re.MULTILINE,
    )
    return result, count


def transform_run_calls(content: str) -> tuple[str, int]:
    """
    Transform .run() terminal calls.
    Handles multi-line patterns like:
      tx.insert(table)
        .values(data)
        .run();
    → await pRun(
        tx.insert(table)
          .values(data)
      );
    
    Also single-line:
      tx.insert(table).values(data).run();
    → await pRun(tx.insert(table).values(data));
    """
    count = 0
    lines = content.split("\n")
    result = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        # Match: line ending with .run();  (not inside comment)
        run_m = re.match(r"^(\s*)(.*?)\.run\(\)\s*;?\s*$", line)
        
        if run_m and not line.strip().startswith("//") and not line.strip().startswith("*"):
            indent = run_m.group(1)
            before_run = run_m.group(2).rstrip()
            
            # Collect preceding continuation lines from result buffer
            cont_lines = []
            k = len(result) - 1
            while k >= 0:
                prev = result[k]
                pt = prev.strip()
                # Stop conditions
                if (
                    pt == ""
                    or pt.endswith(";")
                    or pt.endswith("{")
                    or (pt.endswith("}") and not pt.startswith("."))
                    or pt.startswith("//")
                    or pt.startswith("*")
                    or pt.startswith("/*")
                    or re.match(r"^(if|else|for|while|switch|try|catch|return|const|let|var|import|export)\b", pt)
                ):
                    break
                cont_lines.insert(0, result.pop())
                k -= 1
            
            count += 1
            
            if cont_lines:
                # Multi-line: wrap the whole chain
                all_lines = cont_lines + [before_run + line[run_m.start(2) + len(run_m.group(2)):].rstrip()]
                # Reconstruct: just use all_lines without .run()
                all_lines[-1] = before_run  # already stripped .run()
                
                first = all_lines[0]
                first_indent = re.match(r"^(\s*)", first).group(1)
                
                # Check for assignment in first line
                assign_m = re.match(
                    r"^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\]()]+)?\s*=\s*)(.*)",
                    first, re.DOTALL
                )
                if assign_m:
                    fi = assign_m.group(1)
                    decl = assign_m.group(2)
                    rest = assign_m.group(3).rstrip()
                    body_lines = [rest] + [l.strip() for l in all_lines[1:] if l.strip()]
                    body = ("\n" + fi + "    ").join(body_lines)
                    result.append(f"{fi}{decl}await pRun(\n{fi}  {body}\n{fi});")
                else:
                    body_lines = [l.strip() for l in all_lines if l.strip()]
                    body = ("\n" + first_indent + "    ").join(body_lines)
                    result.append(f"{first_indent}await pRun(\n{first_indent}  {body}\n{first_indent});")
            else:
                # Single line
                assign_m = re.match(
                    r"^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\]()]+)?\s*=\s*)(.*)",
                    before_run.rstrip()
                )
                if assign_m:
                    fi = assign_m.group(1)
                    decl = assign_m.group(2)
                    expr = assign_m.group(3).strip()
                    result.append(f"{fi}{decl}await pRun(\n{fi}  {expr}\n{fi});")
                else:
                    result.append(f"{indent}await pRun(\n{indent}  {before_run.strip()}\n{indent});")
        else:
            result.append(line)
        
        i += 1
    
    return "\n".join(result), count


def transform_all_calls(content: str) -> tuple[str, int]:
    """
    Transform .all() terminal calls.
    Handles:
      const rows = db.select().from(t).all() as any[];
      const rows = db.select()
        .from(t)
        .where(...)
        .all() as any[];
      db.select().from(t).all()  (no assignment)
    """
    count = 0
    lines = content.split("\n")
    result = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        # Match .all() at end of line with optional as T[]
        all_m = re.match(
            r"^(\s*)(.*?)\.all\(\)(\s*as\s+[\w\[\]\s|<>,()]+)?(\s*;?)(\s*)$",
            line
        )
        
        if all_m and not line.strip().startswith("//") and not line.strip().startswith("*") and all_m.group(2).strip():
            indent = all_m.group(1)
            before_all = all_m.group(2).rstrip()
            as_type = (all_m.group(3) or "").strip()
            semi = all_m.group(4).strip()
            
            # Extract type
            type_m = re.search(r"as\s+(\w+)(?:\[\])?", as_type)
            T = type_m.group(1) if type_m else "any"
            
            # Collect continuation lines
            cont_lines = []
            k = len(result) - 1
            while k >= 0:
                prev = result[k]
                pt = prev.strip()
                if (
                    pt == ""
                    or pt.endswith(";")
                    or pt.endswith("{")
                    or (pt.endswith("}") and not pt.startswith("."))
                    or pt.startswith("//")
                    or pt.startswith("*")
                    or pt.startswith("/*")
                    or re.match(r"^(if|else|for|while|switch|try|catch|return|const|let|var|import|export)\b", pt)
                ):
                    break
                cont_lines.insert(0, result.pop())
                k -= 1
            
            count += 1
            terminator = ";" if semi == ";" else ""
            
            if cont_lines:
                all_lines = cont_lines + [before_all]
                first = all_lines[0]
                first_indent = re.match(r"^(\s*)", first).group(1)
                
                assign_m = re.match(
                    r"^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\]()]+)?\s*=\s*)(.*)",
                    first, re.DOTALL
                )
                if assign_m:
                    fi = assign_m.group(1)
                    decl = assign_m.group(2)
                    rest = assign_m.group(3).rstrip()
                    body_lines = [rest] + [l.strip() for l in all_lines[1:] if l.strip()]
                    body = ("\n" + fi + "    ").join(body_lines)
                    result.append(f"{fi}{decl}await pAll<{T}>(\n{fi}  {body}\n{fi}){terminator}")
                else:
                    body_lines = [l.strip() for l in all_lines if l.strip()]
                    body = ("\n" + first_indent + "    ").join(body_lines)
                    result.append(f"{first_indent}await pAll<{T}>(\n{first_indent}  {body}\n{first_indent}){terminator}")
            else:
                assign_m = re.match(
                    r"^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\]()]+)?\s*=\s*)(.*)",
                    line
                )
                if assign_m:
                    fi = assign_m.group(1)
                    decl = assign_m.group(2)
                    expr = before_all.strip()
                    result.append(f"{fi}{decl}await pAll<{T}>(\n{fi}  {expr}\n{fi}){terminator}")
                else:
                    result.append(f"{indent}await pAll<{T}>(\n{indent}  {before_all.strip()}\n{indent}){terminator}")
        else:
            result.append(line)
        
        i += 1
    
    return "\n".join(result), count


def transform_get_calls(content: str) -> tuple[str, int]:
    """Transform .get() terminal calls."""
    count = 0
    lines = content.split("\n")
    result = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        get_m = re.match(
            r"^(\s*)(.*?)\.get\(\)(\s*as\s+[\w\[\]\s|<>,()]+)?(\s*;?)(\s*)$",
            line
        )
        
        if get_m and not line.strip().startswith("//") and not line.strip().startswith("*") and get_m.group(2).strip():
            indent = get_m.group(1)
            before_get = get_m.group(2).rstrip()
            as_type = (get_m.group(3) or "").strip()
            semi = get_m.group(4).strip()
            
            type_m = re.search(r"as\s+([\w\s|]+?)(?:\s*;|\s*$)", as_type)
            T_raw = type_m.group(1).strip() if type_m else "any"
            # Remove trailing | undefined for cleaner type
            T = re.sub(r"\s*\|\s*undefined$", "", T_raw).strip() or "any"
            
            cont_lines = []
            k = len(result) - 1
            while k >= 0:
                prev = result[k]
                pt = prev.strip()
                if (
                    pt == ""
                    or pt.endswith(";")
                    or pt.endswith("{")
                    or (pt.endswith("}") and not pt.startswith("."))
                    or pt.startswith("//")
                    or pt.startswith("*")
                    or pt.startswith("/*")
                    or re.match(r"^(if|else|for|while|switch|try|catch|return|const|let|var|import|export)\b", pt)
                ):
                    break
                cont_lines.insert(0, result.pop())
                k -= 1
            
            count += 1
            terminator = ";" if semi == ";" else ""
            
            if cont_lines:
                all_lines = cont_lines + [before_get]
                first = all_lines[0]
                first_indent = re.match(r"^(\s*)", first).group(1)
                
                assign_m = re.match(
                    r"^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\]()]+)?\s*=\s*)(.*)",
                    first, re.DOTALL
                )
                if assign_m:
                    fi = assign_m.group(1)
                    decl = assign_m.group(2)
                    rest = assign_m.group(3).rstrip()
                    body_lines = [rest] + [l.strip() for l in all_lines[1:] if l.strip()]
                    body = ("\n" + fi + "    ").join(body_lines)
                    result.append(f"{fi}{decl}await pGet<{T}>(\n{fi}  {body}\n{fi}){terminator}")
                else:
                    body_lines = [l.strip() for l in all_lines if l.strip()]
                    body = ("\n" + first_indent + "    ").join(body_lines)
                    result.append(f"{first_indent}await pGet<{T}>(\n{first_indent}  {body}\n{first_indent}){terminator}")
            else:
                assign_m = re.match(
                    r"^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w<>\s|[\]()]+)?\s*=\s*)(.*)",
                    line
                )
                if assign_m:
                    fi = assign_m.group(1)
                    decl = assign_m.group(2)
                    expr = before_get.strip()
                    result.append(f"{fi}{decl}await pGet<{T}>(\n{fi}  {expr}\n{fi}){terminator}")
                else:
                    result.append(f"{indent}await pGet<{T}>(\n{indent}  {before_get.strip()}\n{indent}){terminator}")
        else:
            result.append(line)
        
        i += 1
    
    return "\n".join(result), count


def make_functions_async(content: str) -> str:
    """
    Make functions async where they now contain direct await calls.
    Only targets export functions/route handlers that are not already async.
    """
    # Add async to route handler callbacks: app.get('/path', (req, res) => {
    content = re.sub(
        r'(app\.(?:get|post|put|patch|delete|use)\s*\([^,]+,\s*)((?!async\s)\((?:req|request)[^)]*\)\s*(?::\s*\w+\s*)?=>\s*\{)',
        lambda m: m.group(1) + "async " + m.group(2),
        content
    )
    
    # Add async to export function declarations: export function foo(
    # Only if not already async
    content = re.sub(
        r'(\n\s*)(export\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w<>[\]|,\s()]+)?\s*\{)',
        lambda m: m.group(1) + re.sub(r'^export\s+function', 'export async function', m.group(2)),
        content
    )
    
    # Add async to plain export functions
    content = re.sub(
        r'(\n\s*)(function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w<>[\]|,\s()]+)?\s*\{)',
        lambda m: m.group(1) + re.sub(r'^function', 'async function', m.group(2)),
        content
    )
    
    return content


def migrate_file(filepath: str, dry_run: bool = False) -> dict:
    """Migrate a single file. Returns summary dict."""
    if filepath in SACRED:
        return {"status": "skip_sacred", "file": filepath}
    
    if not os.path.exists(filepath):
        return {"status": "not_found", "file": filepath}
    
    content = open(filepath, encoding="utf-8").read()
    
    # Count before
    before = {
        "all": len(re.findall(r"\.all\(\)", content)),
        "get": len(re.findall(r"\.get\(\)", content)),
        "run": len(re.findall(r"\.run\(\)", content)),
        "txn": len(re.findall(r"\bdb\.transaction\s*\(", content)),
    }
    
    if not any(before.values()):
        return {"status": "unchanged", "file": filepath, "before": before}
    
    # Apply transformations
    result = content
    
    needed = []
    
    if before["txn"]:
        result, n = transform_transactions(result)
        if n:
            needed.append("pTransaction")
    
    if before["all"]:
        result, n = transform_all_calls(result)
        if n:
            needed.append("pAll")
    
    if before["get"]:
        result, n = transform_get_calls(result)
        if n:
            needed.append("pGet")
    
    if before["run"]:
        result, n = transform_run_calls(result)
        if n:
            needed.append("pRun")
    
    # Update imports
    if needed:
        result = ensure_portable_import(result, filepath, sorted(set(needed)))
    
    # Count after
    after = {
        "all": len(re.findall(r"\.all\(\)", result)),
        "get": len(re.findall(r"\.get\(\)", result)),
        "run": len(re.findall(r"\.run\(\)", result)),
        "txn": len(re.findall(r"\bdb\.transaction\s*\(", result)),
    }
    
    changed = result != content
    
    if not dry_run and changed:
        # Write backup
        bak = filepath + ".bak_phase_b"
        if not os.path.exists(bak):
            shutil.copy2(filepath, bak)
        
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(result)
    
    return {
        "status": "modified" if changed else "unchanged",
        "file": filepath,
        "before": before,
        "after": after,
        "needed": needed,
        "changed": changed,
    }


if __name__ == "__main__":
    import argparse
    import json
    
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch", type=str, help="Comma-separated file indices e.g. 1-5")
    parser.add_argument("files", nargs="*")
    args = parser.parse_args()
    
    files = list(args.files)
    
    if args.all:
        with open("/home/user/workspace/wave_h_audit/REMAINING_LIVE.txt") as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) >= 2:
                    files.append(parts[1])
    
    if not files:
        print("No files. Use --all or provide file paths.")
        sys.exit(1)
    
    print(f"Processing {len(files)} files {'(dry-run)' if args.dry_run else ''}...\n")
    
    total_before = {"all": 0, "get": 0, "run": 0, "txn": 0}
    total_after = {"all": 0, "get": 0, "run": 0, "txn": 0}
    modified = 0
    
    for fp in files:
        r = migrate_file(fp, dry_run=args.dry_run)
        
        if r["status"] == "skip_sacred":
            print(f"  SACRED (skip): {fp}")
        elif r["status"] == "not_found":
            print(f"  NOT FOUND:     {fp}")
        elif r["status"] == "unchanged":
            print(f"  UNCHANGED:     {fp}")
        else:
            b = r.get("before", {})
            a = r.get("after", {})
            for k in total_before:
                total_before[k] += b.get(k, 0)
                total_after[k] += a.get(k, 0)
            if r.get("changed"):
                modified += 1
                remaining = sum(a.values())
                print(f"  MIGRATED:      {fp}")
                print(f"    Added: {r['needed']}")
                print(f"    Before: {b}  →  After: {a}  remaining_sites={remaining}")
    
    print(f"\n{'='*60}")
    print(f"Modified: {modified}/{len(files)} files")
    print(f"Before totals: {total_before}")
    print(f"After totals:  {total_after}")
    remaining = sum(total_after.values())
    print(f"Remaining sites: {remaining}")
    if remaining > 0:
        print("NOTE: Some sites may need manual migration (complex patterns)")
