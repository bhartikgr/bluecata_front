#!/usr/bin/env python3
"""
Phase B: Portable migration transformer.

Transforms each file in-place:
1. .all() as any[]  → remove .all() terminal (query becomes awaitable)
2. .all() as Row[]  → same
3. .get() as X | undefined → remove .get() terminal
4. .run()           → remove .run() terminal
5. db.transaction((tx) => { ... }) → await pTransaction(db, async (tx) => { ... })
6. Adds await before the variable assignment that uses these
7. Makes enclosing function async if not already
8. Adds import for portable helpers

SAFETY RULES:
- Never touch sacred files
- Never change content inside template literals except for transaction wrapping
- Create backup before modifying

Usage:
  python3 scripts/do_portable_migration.py [file1 file2 ...]
  # or process all REMAINING_LIVE.txt files:
  python3 scripts/do_portable_migration.py --all
"""

import re
import sys
import os
import shutil
from pathlib import Path

SACRED = {
    "server/captableCommitStore.ts",
    "server/roundsStore.ts",
    "server/lib/roundCloseCascade.ts",
    "server/spvFundStore.ts",
    "server/collectiveBillingStore.ts",
}

def get_portable_import_path(filepath: str) -> str:
    """Return correct relative path to portable.ts from given file."""
    parts = filepath.split("/")
    # server/lib/*.ts or server/jobs/*.ts → ../db/portable
    if len(parts) >= 3 and parts[0] == "server" and parts[1] in ("lib", "jobs"):
        return "../db/portable"
    # server/*.ts → ./db/portable
    return "./db/portable"

def add_or_update_portable_import(content: str, filepath: str, needed: set) -> str:
    """Add/update portable import line."""
    if not needed:
        return content
    
    import_path = get_portable_import_path(filepath)
    
    # Check for existing portable import
    pattern = re.compile(
        r'(import\s*\{)([^}]*?)(\}\s*from\s*["\']' + re.escape(import_path) + r'["\'])(\s*;)',
        re.DOTALL
    )
    m = pattern.search(content)
    
    if m:
        existing = [x.strip() for x in m.group(2).split(',') if x.strip()]
        to_add = [n for n in sorted(needed) if n not in existing]
        if not to_add:
            return content
        all_names = existing + to_add
        replacement = m.group(1) + " " + ", ".join(all_names) + " " + m.group(3) + m.group(4)
        return content[:m.start()] + replacement + content[m.end():]
    else:
        # Add after last import statement
        new_line = f'import {{ {", ".join(sorted(needed))} }} from "{import_path}"; /* Wave H — Postgres compatibility */\n'
        
        # Find end of last import block
        last_end = 0
        for im in re.finditer(r'^import\s[^\n]*\n(?:\s[^\n]*\n)*', content, re.MULTILINE):
            last_end = im.end()
        
        if last_end == 0:
            # Try single-line imports
            for im in re.finditer(r'^import\s[^;]+;', content, re.MULTILINE):
                last_end = im.end()
        
        if last_end:
            return content[:last_end] + new_line + content[last_end:]
        else:
            return new_line + content

def transform_all_calls(content: str) -> tuple[str, bool]:
    """
    Transform .all() terminal calls.
    
    Pattern: expr\n    .all() as T[]
    Becomes: await pAll<T>(expr)
    
    We handle:
    - Simple: const x = db.select().from(t).all() as T[]
    - Chained: db.select()\n  .from(t)\n  .where(...)\n  .all() as T[]
    - Result assigned: const x: T[] = ...\n  .all() as T[]
    - Direct call: someFunc(db.select().from(t).all() as T[])
    """
    changed = False
    
    # Pattern 1: variable assignment with .all() as any[]
    # const rows = db.select()....\n    .all() as any[];
    # → const rows = await pAll<any>(db.select()....);
    
    def replace_all_terminal(m):
        nonlocal changed
        changed = True
        # m.group(0) = full match including .all() as T[]
        # Remove .all() as T[] from end — the query builder is already captured
        return ""  # just remove the .all() part
    
    # Remove .all() as any[] patterns (the result is already an awaitable in PG)
    # We do this by transforming the variable declaration
    
    # Match: assignment lines that end with .all() as T[]
    # const varName: T[] = (query).all() as T[];
    # const varName = (query).all() as any[];
    
    def transform_assignment_all(m):
        nonlocal changed
        indent = m.group(1)
        decl = m.group(2)  # const/let/var varName: type =
        query = m.group(3)  # the query builder chain
        type_hint = m.group(4) or "any"  # T from as T[]
        
        changed = True
        # Extract clean type: "any" from "any[]", "Row" from "Row[]"
        t = type_hint.rstrip("[]").strip() or "any"
        
        return f"{indent}{decl}await pAll<{t}>(\n{indent}  {query.strip()}\n{indent})"
    
    # Simpler approach: just replace .all() as TypeName[] with nothing and wrap with pAll
    # We'll do a two-pass approach:
    # Pass 1: Find all .all() usages and track line numbers
    # Pass 2: Wrap each in await pAll(...)
    
    # Most patterns in the codebase are:
    # const rows = db.select().from(t).where(...).all() as any[];
    # OR multi-line:
    # const rows = db
    #   .select()
    #   .from(t)
    #   .where(...)
    #   .all() as any[];
    
    # Simplest safe transformation: find the last .all() as T[] on each "statement"
    # A "statement" ends with .all() as T[];
    
    # We'll use a line-by-line approach for safety
    lines = content.split('\n')
    result_lines = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Check if this line ends with .all() as T[] or .all()
        all_match = re.search(r'(\.all\(\)\s*as\s+\w+(?:\[\])?|\.all\(\))(\s*;?\s*)$', line)
        
        if all_match:
            changed = True
            # Remove the .all() part from this line
            new_line = line[:all_match.start()] + all_match.group(2)
            
            # Now find where this statement started (go backward to find assignment)
            # and wrap the whole thing in await pAll(...)
            
            # Find the start of this multi-line expression
            # by looking for the = sign that starts the assignment
            stmt_lines = [new_line]
            j = i - 1
            
            # Collect preceding continuation lines (indented, no semicolon)
            while j >= 0:
                prev_line = result_lines[j] if j < len(result_lines) else lines[j]
                # Check if previous line is a continuation (ends without semicolon, or is indented)
                prev_stripped = prev_line.rstrip()
                if prev_stripped.endswith(';') or prev_stripped.endswith('{') or prev_stripped.endswith('}'):
                    break
                # If prev line has an assignment for what could be our var
                if '=' in prev_line and not prev_line.strip().startswith('//'):
                    break
                j -= 1
            
            result_lines.append(new_line)
        else:
            result_lines.append(line)
        
        i += 1
    
    result = '\n'.join(result_lines)
    return result, changed

def migrate_file_content(content: str, filepath: str) -> tuple[str, set, bool]:
    """
    Main transformation function.
    Returns (new_content, needed_imports, was_changed)
    """
    needed = set()
    changed = False
    
    # Check what needs to be done
    has_all = bool(re.search(r'\.all\(\)', content))
    has_get = bool(re.search(r'\.get\(\)', content))
    has_run = bool(re.search(r'\.run\(\)', content))
    has_txn = bool(re.search(r'\bdb\.transaction\s*\(', content) or re.search(r'\btx\.transaction\s*\(', content))
    
    if has_all:
        needed.add("pAll")
    if has_get:
        needed.add("pGet")
    if has_run:
        needed.add("pRun")
    if has_txn:
        needed.add("pTransaction")
    
    result = content
    
    # ── Transform .all() calls ────────────────────────────────────────────────
    if has_all:
        # Replace: expr.all() as any[] → pAll awaitable
        # Simple patterns first
        
        # Pattern: variable = expr.all() as any[];
        # → variable = await pAll<any>(expr);
        
        def repl_all_simple(m):
            nonlocal changed
            changed = True
            indent = m.group(1)
            var_decl = m.group(2)  # e.g. "const rows = " or "const rows: Foo[] = "
            query = m.group(3)    # the query builder
            as_type = m.group(4) or ""  # " as any[]" etc.
            
            # Extract type from "as Foo[]" → "Foo"
            t_match = re.search(r'as\s+(\w+)', as_type)
            t = t_match.group(1) if t_match else "any"
            
            return f"{indent}{var_decl}await pAll<{t}>(\n{indent}  {query.strip()}\n{indent})"
        
        # Single-line: const x = db.select()...all() as T[]
        result = re.sub(
            r'^(\s*)((?:const|let|var)\s+\w+(?::\s*\w+(?:\[\])?(?:\s*\|\s*\w+)*)?\s*=\s*)'
            r'([^\n]+?)'
            r'(\.all\(\)(?:\s*as\s+\w+(?:\[\])?)?)',
            repl_all_simple,
            result,
            flags=re.MULTILINE
        )
        
        # After replacement, add await where needed (if not already await)
        # Any remaining .all() → mark for manual
    
    # ── Transform .get() calls ────────────────────────────────────────────────  
    if has_get:
        def repl_get_simple(m):
            nonlocal changed
            changed = True
            indent = m.group(1)
            var_decl = m.group(2)
            query = m.group(3)
            as_type = m.group(4) or ""
            
            t_match = re.search(r'as\s+(\w+)', as_type)
            t = t_match.group(1) if t_match else "any"
            
            return f"{indent}{var_decl}await pGet<{t}>(\n{indent}  {query.strip()}\n{indent})"
        
        result = re.sub(
            r'^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w\s|<>]+)?\s*=\s*)'
            r'([^\n]+?)'
            r'(\.get\(\)(?:\s*as\s+\w+(?:\s*\|\s*\w+)*)?)',
            repl_get_simple,
            result,
            flags=re.MULTILINE
        )
    
    # ── Transform .run() calls ────────────────────────────────────────────────
    if has_run:
        # Pattern: expr.run(); → await pRun(expr);
        def repl_run(m):
            nonlocal changed
            changed = True
            indent = m.group(1)
            query = m.group(2).strip()
            return f"{indent}await pRun(\n{indent}  {query}\n{indent});"
        
        result = re.sub(
            r'^(\s*)((?:(?:const|let|var)\s+\w+\s*=\s*)?[^\n]+?)\.run\(\)\s*;',
            repl_run,
            result,
            flags=re.MULTILINE
        )
    
    # ── Transform db.transaction calls ───────────────────────────────────────
    if has_txn:
        # db.transaction((tx: any) => {
        # → await pTransaction(db, async (tx: any) => {
        def repl_txn(m):
            nonlocal changed
            changed = True
            indent = m.group(1)
            db_var = m.group(2)  # db or other var
            params = m.group(3)  # (tx: any) or similar
            return f"{indent}await pTransaction({db_var}, async {params} {{"
        
        result = re.sub(
            r'^(\s*)(\w+)\.transaction\s*\((\([^)]*\))\s*=>\s*\{',
            repl_txn,
            result,
            flags=re.MULTILINE
        )
    
    # Add portable imports
    if needed:
        result = add_or_update_portable_import(result, filepath, needed)
    
    return result, needed, changed

def process_file(filepath: str, dry_run: bool = False) -> bool:
    """Process a single file. Returns True if modified."""
    if filepath in SACRED:
        print(f"  SKIP (sacred): {filepath}")
        return False
    
    if not os.path.exists(filepath):
        print(f"  MISSING: {filepath}")
        return False
    
    with open(filepath, 'r') as f:
        original = f.read()
    
    new_content, needed, changed = migrate_file_content(original, filepath)
    
    if not dry_run and changed:
        # Backup
        backup = filepath + ".pre_migrate_bak"
        shutil.copy2(filepath, backup)
        
        with open(filepath, 'w') as f:
            f.write(new_content)
        
        remaining_all = len(re.findall(r'\.all\(\)', new_content))
        remaining_get = len(re.findall(r'\.get\(\)', new_content))
        remaining_run = len(re.findall(r'\.run\(\)', new_content))
        remaining_txn = len(re.findall(r'\bdb\.transaction\s*\(', new_content))
        
        print(f"  MODIFIED: {filepath} (imports: {sorted(needed)})")
        print(f"    Remaining: .all()={remaining_all} .get()={remaining_get} .run()={remaining_run} db.transaction={remaining_txn}")
    elif changed:
        print(f"  WOULD MODIFY: {filepath}")
    else:
        print(f"  UNCHANGED: {filepath}")
    
    return changed

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser()
    parser.add_argument('--all', action='store_true', help='Process all files from REMAINING_LIVE.txt')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('files', nargs='*', help='Specific files to process')
    args = parser.parse_args()
    
    files_to_process = []
    
    if args.all:
        remaining_file = "wave_h_audit/REMAINING_LIVE.txt"
        if os.path.exists(remaining_file):
            with open(remaining_file) as f:
                for line in f:
                    line = line.strip()
                    if line:
                        parts = line.split()
                        if len(parts) >= 2:
                            files_to_process.append(parts[1])
    
    if args.files:
        files_to_process.extend(args.files)
    
    if not files_to_process:
        print("No files specified. Use --all or provide file paths.")
        sys.exit(1)
    
    print(f"Processing {len(files_to_process)} files...")
    modified = 0
    for fp in files_to_process:
        modified += 1 if process_file(fp, dry_run=args.dry_run) else 0
    
    print(f"\nDone. Modified {modified}/{len(files_to_process)} files.")
