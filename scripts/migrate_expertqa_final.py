#!/usr/bin/env python3
"""
Migrate expertQAStore.ts to async portable helpers.

This script uses a line-by-line state machine approach to correctly wrap
.all() and .run() calls and convert db.transaction to pTransaction.
"""
import re
import os
import shutil

path = "/home/user/workspace/avi_v19_tree/server/expertQAStore.ts"
bak = path + ".bak_manual_eqa"

# Restore from original backup if it exists
if os.path.exists(bak):
    shutil.copy2(bak, path)
    print("Restored from backup")

with open(path, 'r') as f:
    content = f.read()

# -----------------------------------------------------------------------
# PASS 1: Add imports
# -----------------------------------------------------------------------
if 'pAll, pGet, pRun, pTransaction' not in content:
    content = content.replace(
        'import { requireAuth } from "./lib/authMiddleware";',
        'import { requireAuth } from "./lib/authMiddleware";\nimport { pAll, pGet, pRun, pTransaction } from "./db/portable";',
        1
    )
    print("Added import")

# -----------------------------------------------------------------------
# PASS 2: recomputeReputationInTx - this is called inside txs, must be async
# -----------------------------------------------------------------------
content = content.replace(
    'function recomputeReputationInTx(\n  tx: any,\n  args: { userId: string; chapterId: string; tenantId: string; ts: string },\n): {\n  before: ReputationRow | null;\n  after: ReputationRow;\n} {',
    'async function recomputeReputationInTx(\n  tx: any,\n  args: { userId: string; chapterId: string; tenantId: string; ts: string },\n): Promise<{\n  before: ReputationRow | null;\n  after: ReputationRow;\n}> {'
)

# -----------------------------------------------------------------------
# PASS 3: Inside recomputeReputationInTx, replace .all() and .run() calls
# The patterns are: const XRows = tx.select()...all() as any[];
# and tx.insert()...run(); / tx.update()...run();
# -----------------------------------------------------------------------

# Replace .all() as any[] with ) as any[] and add pAll wrapping to query start
# We need to find each "const Xrows = tx" and wrap it

def replace_all_in_recompute(content):
    # Pattern: lines ending with .all() as any[];
    # These need the assignment to start with await pAll<any>(
    lines = content.split('\n')
    new_lines = []
    i = 0
    in_recompute = False
    depth = 0  # track brace depth from function start
    recompute_start_depth = None
    
    for line in lines:
        if 'async function recomputeReputationInTx' in line:
            in_recompute = True
            recompute_start_depth = 0
        
        if in_recompute:
            depth += line.count('{') - line.count('}')
            if recompute_start_depth is not None and depth < 0:
                in_recompute = False
        
        new_lines.append(line)
        i += 1
    
    return '\n'.join(new_lines)

# More direct approach: replace exact patterns in recomputeReputationInTx

# The patterns in recomputeReputationInTx are systematic:
# const XRows = tx.select({...}).from(Y).where(...).all() as any[];
# tx.insert(Y).values({...} as any).run();
# tx.update(Y).set({...} as any).where(...).run();

# Since recomputeReputationInTx uses tx (not db) and these are the only
# uses of .all() and .run() with tx inside the function, let's replace 
# all tx-prefixed .all() and .run() patterns

# Strategy: replace all occurrences of .all() as any[]; (preceded by query chain)
# when they appear as the last line of an assignment that started with tx.select
# 
# Use a simpler pattern: find lines that end with ".all() as any[];" and 
# walk back to find the assignment start

content_lines = content.split('\n')
result_lines = []
i = 0

while i < len(content_lines):
    line = content_lines[i]
    stripped = line.rstrip()
    
    # Check for .all() as any[]; at end of line
    if stripped.endswith('.all() as any[];'):
        # Find the assignment start by looking backward
        j = len(result_lines) - 1
        chain_start_idx = None
        while j >= 0:
            prev = result_lines[j]
            # Check if this line has a variable assignment that starts the chain
            # Patterns: "  const X = tx.select(" or "  const X = db.select("
            # or continuation lines that include the select call
            if re.match(r'\s+(const|let|var)\s+\w+\s*=\s*(tx|db)\.select\(', prev):
                chain_start_idx = j
                break
            # Also check if we've gone too far back (hit an empty line or statement)
            if j < len(result_lines) - 15:  # reasonable limit
                break
            j -= 1
        
        if chain_start_idx is not None:
            start_line = result_lines[chain_start_idx]
            # Find the = position and insert await pAll<any>(
            eq_match = re.match(r'(\s+(?:const|let|var)\s+\w+\s*=\s*)(.*)', start_line)
            if eq_match:
                prefix = eq_match.group(1)
                rest = eq_match.group(2)
                result_lines[chain_start_idx] = prefix + 'await pAll<any>(' + rest
                # Modify current line: remove .all() as any[] and add )
                new_line = stripped[:-len('.all() as any[];')] + ');'
                result_lines.append(new_line)
                i += 1
                continue
    
    # Check for .run(); at end of line (only tx. calls, not method definitions)
    elif stripped.endswith('.run();') and not stripped.strip().startswith('//'):
        # Find the start of this chain
        j = len(result_lines) - 1
        chain_start_idx = None
        while j >= 0:
            prev = result_lines[j]
            prev_stripped = prev.strip()
            # Chain starts with tx.insert( or tx.update( or tx.delete(
            if re.match(r'^\s*(tx|db)\.(insert|update|delete)\(', prev):
                chain_start_idx = j
                break
            # Or: await pRun(tx.insert( - already wrapped
            if re.match(r'^\s*await pRun\(', prev):
                chain_start_idx = None  # already done
                break
            # Don't go too far back
            if j < len(result_lines) - 20:
                break
            j -= 1
        
        if chain_start_idx is not None:
            start_line = result_lines[chain_start_idx]
            start_stripped_ws = start_line.lstrip()
            indent_len = len(start_line) - len(start_stripped_ws)
            indent = ' ' * indent_len
            result_lines[chain_start_idx] = indent + 'await pRun(' + start_stripped_ws
            # Remove .run() from current line and add )
            new_line = stripped[:-len('.run();')] + ');'
            result_lines.append(new_line)
            i += 1
            continue
    
    result_lines.append(line)
    i += 1

content = '\n'.join(result_lines)

# -----------------------------------------------------------------------
# PASS 4: Convert db.transaction to await pTransaction
# These are the route handler transactions
# -----------------------------------------------------------------------
content = content.replace(
    '        db.transaction((tx: any) => {',
    '        await pTransaction(db, async (tx: any) => {'
)
content = content.replace(
    '    db.transaction((tx: any) => {',
    '    await pTransaction(db, async (tx: any) => {'
)
content = content.replace(
    '  db.transaction((tx: any) => {',
    '  await pTransaction(db, async (tx: any) => {'
)
content = content.replace(
    'db.transaction((tx: any) => {',
    'await pTransaction(db, async (tx: any) => {'
)

# -----------------------------------------------------------------------
# PASS 5: Fix recomputeReputationInTx call sites (add await)
# -----------------------------------------------------------------------
content = content.replace(
    '          const repResult = recomputeReputationInTx(tx, {',
    '          const repResult = await recomputeReputationInTx(tx, {'
)
content = content.replace(
    '        const repResult = recomputeReputationInTx(tx, {',
    '        const repResult = await recomputeReputationInTx(tx, {'
)

# -----------------------------------------------------------------------
# PASS 6: Make route handlers async that call await pTransaction
# Also make read helper functions async (they use db.select().all())
# -----------------------------------------------------------------------

# recordMilestoneNotified: convert to async with void pTransaction
content = content.replace(
    '}): void {\n  const { userId, chapterId, tenantId, newHighWater } = args;\n  try {\n    const db: any = getDb();\n    await pTransaction(db, async (tx: any) => {',
    '}): void {\n  const { userId, chapterId, tenantId, newHighWater } = args;\n  void pTransaction(getDb() as any, async (tx: any) => {'
)

# Also need to fix the catch block for recordMilestoneNotified
old_record_catch = '''  }).catch((err: unknown) => {
    log.warn(
      "[expertQAStore.recordMilestoneNotified] update failed:",
      (err as Error).message,
    );
  });'''
# This should be there now - check
if old_record_catch not in content:
    # The try/catch structure needs fixing
    old_try = '''  try {
    const db: any = getDb();
    void pTransaction(getDb() as any, async (tx: any) => {'''
    
    # Find end of function - look for }.catch pattern
    # Let's just check what we have
    pass

# -----------------------------------------------------------------------
# PASS 7: Make read helpers async
# -----------------------------------------------------------------------

# getChapterMembership - already sync (returns null), keep sync but wrap .all()
# The .all() should have already been caught in PASS 3
# Let's check specifically
if '.limit(1)\n      .all() as any[];' in content:
    content = content.replace(
        '.limit(1)\n      .all() as any[];',
        '.limit(1)) as any[];'
    )
    print("WARNING: Some .all() patterns may need manual fixes")

# getQuestionById, getAnswerById - make async
content = content.replace(
    'export function getQuestionById(id: string): QuestionRow | null {',
    'export async function getQuestionById(id: string): Promise<QuestionRow | null> {'
)
content = content.replace(
    'export function getAnswerById(id: string): AnswerRow | null {',
    'export async function getAnswerById(id: string): Promise<AnswerRow | null> {'
)

# -----------------------------------------------------------------------
# Write result
# -----------------------------------------------------------------------
with open(path, 'w') as f:
    f.write(content)

# Count remaining issues
remaining_all = content.count('.all() as any[]')
remaining_run = len(re.findall(r'\btx\b.*\.run\(\);', content))
remaining_tx = content.count('db.transaction(')

print(f"After migration:")
print(f"  .all() as any[]: {remaining_all}")
print(f"  tx.*.run(): {remaining_run}")
print(f"  db.transaction: {remaining_tx}")
