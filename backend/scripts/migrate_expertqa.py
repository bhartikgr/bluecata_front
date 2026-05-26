#!/usr/bin/env python3
"""
Migrate expertQAStore.ts to async portable helpers.
Uses a different strategy: read the whole file, apply regex-based replacements
for the common patterns, then handle edge cases.
"""
import re
import os
import shutil

path = "/home/user/workspace/avi_v19_tree/server/expertQAStore.ts"
bak = path + ".bak_manual_eqa"

if not os.path.exists(bak):
    shutil.copy2(path, bak)

with open(path, 'r') as f:
    content = f.read()

original = content

# -----------------------------------------------------------------------
# Step 1: All simple .all() as any[] at end of chain
# Pattern: .all() as any[]  →  (handled via pAll wrapper below)
# 
# The tricky part: we need to wrap the entire Drizzle query chain in pAll(...)
# These appear as:
#   const rows = tx.select()...all() as any[];
#   const rows = db.select()...all() as any[];
# -----------------------------------------------------------------------

# Simple strategy: replace all standalone .all() as any[] occurrences
# by removing ".all() as any[]" and expecting the variable = already done with await pAll(...)
# Instead, let's use a targeted search for each .all() pattern

# Replace pattern: (var) = (query)\n...\n.all() as any[];
# by wrapping in await pAll<any>(...)

# Method: find lines with .all() as any[] and trace back to the start of the assignment
# This is complex; instead use simpler approach:
# Replace ".all() as any[]" with "_AWAIT_PALL_" marker and fix wrapping separately

# Actually for this file, since the patterns are consistent, let's just do
# global replace of the simple one-liner patterns and the multi-line .all() endings

# Pattern 1: single-line .all() as any[]
# These appear like: .all() as any[]; at end of a chain
content = re.sub(
    r'(\s+)\.all\(\) as any\[\];',
    r'\1) as any[];  // __pAll_DONE__',
    content
)

# Actually this approach is wrong. Let me do it cleanly.
# Restore and use a line-by-line approach.
content = original

# -----------------------------------------------------------------------
# Better strategy: replace all .run(); with await pRun marker,
# all .all() as any[] with await pAll marker, 
# all .all() as Array<X> with await pAll marker,
# all db.transaction with await pTransaction marker
# Then fix the wrapper calls
# -----------------------------------------------------------------------

# 1. Replace .run(); -> ); and mark that pRun is needed
# Pattern: preceding chain ending in .run();
# We'll replace the final .run() call

lines = content.split('\n')
new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    # Replace .run(); at end of line (with optional whitespace)
    if re.match(r'^\s+\.run\(\);', line):
        # Check if it's part of a tx chain
        indent = len(line) - len(line.lstrip())
        new_lines.append(line.replace('.run();', ');'))
        # We'll add await pRun( at the start of the chain later
        new_lines[-1] = line.replace('.run();', ');  // TODO_pRun')
        i += 1
        continue
    new_lines.append(line)
    i += 1

content = '\n'.join(new_lines)

# This approach is getting complicated. Let me use a cleaner regex approach.

content = original

# -----------------------------------------------------------------------
# Clean approach: use sed-like replacements for known patterns
# -----------------------------------------------------------------------

# Pattern A: simple .all() as any[] at very end of statement
# These look like:
#   .all() as any[];
# Replace with ) as any[]; and mark that pAll is needed at statement start

# Pattern B: .run(); at end 
# Replace with ); and add await pRun( wrapper

# For this file, the safest approach is to:
# 1. Add pAll/pRun/pTransaction imports (already done)
# 2. Convert each db.transaction to await pTransaction
# 3. Convert each .all() to await pAll()  
# 4. Convert each .run() to await pRun()
# 5. Make containing functions async

# Let's do a direct replacement approach for the most common patterns

# STEP A: Replace simple `db.transaction((tx: any) => {` with `await pTransaction(db, async (tx: any) => {`
content = content.replace(
    'db.transaction((tx: any) => {',
    'await pTransaction(db, async (tx: any) => {'
)

# STEP B: For the recomputeReputationInTx function which already works inside a tx:
# The inner .all() and .run() calls in this function become await calls
# This function itself needs to be async

# STEP C: Replace all .all() as any[]; at end of lines in tx context
# Pattern: the line ends with .all() as any[];
def wrap_query_with_pall(content):
    """Replace .all() as any[] with await pAll<any>() wrapper."""
    # Find all occurrences of .all() as any[] and wrap the preceding query
    # This is a multi-line pattern; we need to find the start of the assignment
    
    # Simple approach: replace the .all() as any[] endings and add await pAll( 
    # at the variable assignment start
    result = []
    lines = content.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]
        if '.all() as any[]' in line:
            # Replace .all() as any[] with ) as any[] 
            # and mark that we need to wrap
            new_line = line.replace('.all() as any[]', ') as any[]  // __MARK_pAll__')
            result.append(new_line)
        elif '.all() as Array<' in line:
            new_line = line.replace('.all() as Array<', ') as Array<  // __MARK_pAll_typed__')
            result.append(new_line)
        else:
            result.append(line)
        i += 1
    return '\n'.join(result)

# This is too complex for automated transformation without an AST.
# Let's use the SIMPLEST possible approach: just do direct text replacements
# of the exact patterns we see in the file.

content = original

# Re-add import (already added by previous script)
# Check if import already exists
if 'pAll, pGet, pRun, pTransaction' not in content:
    content = content.replace(
        'import { requireAuth } from "./lib/authMiddleware";',
        'import { requireAuth } from "./lib/authMiddleware";\nimport { pAll, pGet, pRun, pTransaction } from "./db/portable";',
        1
    )

# -----------------------------------------------------------------------
# SPECIFIC REPLACEMENTS for expertQAStore.ts
# Based on the exact content we read
# -----------------------------------------------------------------------

# 1. recomputeReputationInTx: convert to async, replace all .all() and .run() inside
content = content.replace(
    'function recomputeReputationInTx(\n  tx: any,\n  args: { userId: string; chapterId: string; tenantId: string; ts: string },\n): {\n  before: ReputationRow | null;\n  after: ReputationRow;\n} {',
    'async function recomputeReputationInTx(\n  tx: any,\n  args: { userId: string; chapterId: string; tenantId: string; ts: string },\n): Promise<{\n  before: ReputationRow | null;\n  after: ReputationRow;\n}> {'
)

# Inside recomputeReputationInTx, replace .all() as any[] patterns
# These are all used as: const Xrows = tx.select()...all() as any[];
patterns_all_eqa = [
    # prevRows
    ('    .all() as any[];\n  const before: ReputationRow | null = prevRows[0]',
     ') as any[];\n  const before: ReputationRow | null = prevRows[0]'),
    # questionsAskedRows
    ('    .all() as any[];\n  const questionsAsked = Number(questionsAskedRows',
     ') as any[];\n  const questionsAsked = Number(questionsAskedRows'),
    # answersGivenRows  
    ('    .all() as any[];\n  const answersGiven = Number(answersGivenRows',
     ') as any[];\n  const answersGiven = Number(answersGivenRows'),
    # bestAnswersRows
    ('    .all() as any[];\n  const bestAnswers = Number(bestAnswersRows',
     ') as any[];\n  const bestAnswers = Number(bestAnswersRows'),
    # upvoteSumRows
    ('    .all() as any[];\n  const upvotesReceived = Number(upvoteSumRows',
     ') as any[];\n  const upvotesReceived = Number(upvoteSumRows'),
    # afterRows
    ('    .all() as any[];\n  const after = reputationRowFromDb(afterRows[0]);',
     ') as any[];\n  const after = reputationRowFromDb(afterRows[0]);'),
]

# This approach is still too complex. Let me use a completely different strategy:
# Use Python regex with a multi-line approach to handle the file structure.

print("Using regex-based approach for expertQAStore.ts...")

content = original

# Re-add import
if 'pAll, pGet, pRun, pTransaction' not in content:
    content = content.replace(
        'import { requireAuth } from "./lib/authMiddleware";',
        'import { requireAuth } from "./lib/authMiddleware";\nimport { pAll, pGet, pRun, pTransaction } from "./db/portable";',
        1
    )

# GLOBAL REPLACEMENT 1: .all() as any[] -> mark for pAll wrapping
# Strategy: For each assignment like `const X = db/tx.select()...all() as any[]`
# we want: `const X = await pAll<any>(db/tx.select()...)`

# Find: const X = tx_or_db\n...lines...\n.all() as any[];
# Replace with: const X = await pAll<any>(tx_or_db\n...lines\n);

# Let's do it line by line, tracking context
def process_file(content):
    lines = content.split('\n')
    output = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        stripped = line.rstrip()
        
        # Check if this line ends with .all() as any[];
        if stripped.endswith('.all() as any[];'):
            # This is the end of a query chain. The chain starts somewhere above.
            # Find the start of the assignment (const X = ...)
            # Look backward for the assignment
            j = len(output) - 1
            chain_start = -1
            while j >= 0:
                prev = output[j]
                # Look for: const|let|var X = (db|tx).select() or = db.select()
                if re.match(r'\s+(const|let|var)\s+\w+.*=\s+(db|tx)', prev):
                    chain_start = j
                    break
                # Also look for standalone assignment: X = db.select() 
                if re.match(r'\s+\w+\s+=\s+(db|tx)', prev):
                    chain_start = j
                    break
                # Look for direct select call: db.select( or tx.select(
                if re.match(r'\s+(const|let|var)\s+\w+', prev) and '=' in prev:
                    chain_start = j
                    break
                j -= 1
            
            if chain_start >= 0:
                # Wrap from chain_start to current line
                start_line = output[chain_start]
                # Find where the assignment value starts
                eq_pos = start_line.find('= ')
                if eq_pos >= 0:
                    prefix = start_line[:eq_pos + 2]
                    rest_of_start = start_line[eq_pos + 2:]
                    output[chain_start] = prefix + 'await pAll<any>(' + rest_of_start
                    # Remove .all() as any[] from current line
                    new_line = stripped[:-len('.all() as any[];')] + ');'
                    output.append(new_line)
                    i += 1
                    continue
            
            # Fallback: just remove .all() as any[] (will cause type error, better than wrong code)
            output.append(stripped[:-len('.all() as any[];')] + ') as any[]; // TODO: wrap in await pAll()')
            i += 1
            continue
        
        # Check if line ends with .run();
        elif stripped.endswith('.run();') and not stripped.strip().startswith('//'):
            indent = len(line) - len(line.lstrip())
            indent_str = ' ' * indent
            
            # Find the start of the chain
            j = len(output) - 1
            chain_start = -1
            while j >= 0:
                prev = output[j]
                prev_stripped = prev.strip()
                # The chain starts with tx.insert/update/delete or db.insert/update/delete
                if re.match(r'\s+(tx|db)\.(insert|update|delete)', prev):
                    chain_start = j
                    break
                j -= 1
            
            if chain_start >= 0:
                # Wrap from chain_start 
                start_line = output[chain_start]
                start_stripped = start_line.lstrip()
                chain_indent = len(start_line) - len(start_stripped)
                output[chain_start] = ' ' * chain_indent + 'await pRun(' + start_stripped
                # Remove .run() from current line
                new_line = stripped[:-len('.run();')] + ');'
                output.append(new_line)
                i += 1
                continue
            
            # Fallback
            output.append(stripped[:-len('.run();')] + '); // TODO: wrap in await pRun()')
            i += 1
            continue
        
        output.append(line)
        i += 1
    
    return '\n'.join(output)

# This is too risky - mismatched parens could break the file.
# Let me use the safest approach: use the exact string patterns from the file.

print("Using exact string replacement approach...")
content = original

# Re-add import
if 'pAll, pGet, pRun, pTransaction' not in content:
    content = content.replace(
        'import { requireAuth } from "./lib/authMiddleware";',
        'import { requireAuth } from "./lib/authMiddleware";\nimport { pAll, pGet, pRun, pTransaction } from "./db/portable";',
        1
    )

# Use sed to do the replacements
with open(path, 'w') as f:
    f.write(content)

print(f"Wrote expertQAStore.ts with import added. Remaining patterns: {content.count('.all() as any[]')} .all(), {content.count('.run();')} .run(), {content.count('db.transaction')} db.transaction")
