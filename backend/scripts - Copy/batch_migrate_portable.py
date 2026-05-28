#!/usr/bin/env python3
"""
Phase B batch migrator: transforms non-sacred files to use portable helpers.

Strategy: regex-based with careful handling of multi-line chained queries.
Each pattern is conservative to avoid false positives.
"""

import re
import sys
import os

SACRED = {
    "server/captableCommitStore.ts",
    "server/roundsStore.ts",
    "server/lib/roundCloseCascade.ts",
    "server/spvFundStore.ts",
    "server/collectiveBillingStore.ts",
}

def is_in_lib(filepath):
    return "/lib/" in filepath or "/jobs/" in filepath

def portable_import_path(filepath):
    if is_in_lib(filepath):
        return "../db/portable"
    return "./db/portable"

def add_portable_import(content, filepath, needed):
    """Add pAll/pGet/pRun/pTransaction to portable import."""
    # Check existing portable import
    existing_pattern = re.compile(
        r'(import\s*\{)([^}]*?)(\}\s*from\s*["\'](?:\.\./)*db/portable["\'])(\s*;)',
        re.DOTALL
    )
    m = existing_pattern.search(content)
    if m:
        existing_names = [x.strip() for x in m.group(2).split(',') if x.strip()]
        to_add = [n for n in needed if n not in existing_names]
        if not to_add:
            return content
        all_names = existing_names + to_add
        new_import = m.group(1) + " " + ", ".join(all_names) + " " + m.group(3) + m.group(4)
        return content[:m.start()] + new_import + content[m.end():]
    else:
        # Add new import after last import line
        import_path = portable_import_path(filepath)
        new_import_line = f'import {{ {", ".join(needed)} }} from "{import_path}";\n'
        
        # Find position after last import
        last_import_end = 0
        for im in re.finditer(r'^import\s[^;]+;', content, re.MULTILINE):
            last_import_end = im.end()
        
        if last_import_end:
            return content[:last_import_end] + '\n' + new_import_line + content[last_import_end:]
        else:
            return new_import_line + content

def migrate_file(content, filepath):
    """Apply portable helper transformations to file content."""
    changed = False
    needed_imports = set()

    # ── 1. Replace .all() as any[] → (await pAll<any>(qb)) ──────────────
    # Pattern: queryBuilder\n  .method()\n  .all() as any[]
    # We need to wrap the whole query builder in await pAll(...)
    
    # Simple inline: expr.all() as any[] → await pAll<any>(expr)
    # We'll handle by replacing .all() and letting caller add await
    
    # Replace: .all() as any[]  → but we need to wrap entire expression
    # The safest approach: replace the terminal .all() call pattern
    
    def replace_all(m):
        nonlocal changed
        changed = True
        needed_imports.add("pAll")
        # Don't change the query builder part, just remove .all()
        # The await will be added at the assignment level
        return ""
    
    # Match: (query chain).all() 
    # We handle this by finding all occurrences and doing targeted replacements
    
    # Strategy: find assignment patterns like:
    #   const x = db.select()...all() as T[]
    # and transform to:
    #   const x = await pAll<T>(db.select()...)
    
    # For now, mark the file needs transformation
    has_all = '.all()' in content
    has_get = '.get()' in content  
    has_run = '.run()' in content
    has_txn = 'db.transaction(' in content or 'tx.transaction(' in content
    
    if has_all:
        needed_imports.add("pAll")
    if has_get:
        needed_imports.add("pGet")
    if has_run:
        needed_imports.add("pRun")
    if has_txn:
        needed_imports.add("pTransaction")
    
    return content, needed_imports, changed

if __name__ == "__main__":
    print("This is a helper module. Use migrate_batch.py for actual migration.")
