import re, pathlib
p = pathlib.Path("client/src/components/comms/MessagesWidget.tsx")
src = p.read_text()

# Replacement #1 — make whole row clickable to ?thread + ?channel
old1 = '''                <Link href={`${basePath}?channel=${encodeURIComponent(ch.id)}`}>
                  <button
                    className="w-full text-left px-3 py-2.5 hover-elevate flex items-start gap-3"
                    data-testid={`thread-preview-${ch.id}`}
                  >'''
new1 = '''                <button
                    type="button"
                    onClick={() => {
                      // Sprint 18 Phase 3 B1+B5 — open the exact thread inline rather than
                      // dumping the user on the inbox. We push a hash with both `thread`
                      // and `channel` for backward compat. Wouter's hash-router consumes
                      // the pathname; the query string is parsed inside MessagesPage.
                      window.location.hash = `#${basePath}?thread=${encodeURIComponent(ch.id)}&channel=${encodeURIComponent(ch.id)}`;
                    }}
                    className="w-full text-left px-3 py-2.5 hover-elevate flex items-start gap-3"
                    data-testid={`thread-preview-${ch.id}`}
                  >'''

# Try to find the link block ignoring whitespace amount but keeping same lines
# Use a regex with \s* between
def loose(s):
    parts = [re.escape(line.lstrip()) for line in s.splitlines()]
    return r'\s*' + r'\s+'.join(parts)

pat = loose(old1)
m = re.search(pat, src)
assert m, "Not found"

src2 = re.sub(pat, lambda mo: mo.group(0).split('<Link')[0] + '\n'.join(line for line in new1.splitlines()) , src, count=1)
# That probably broke indentation. Let's do something simpler: replace with proper indent reconstructed

# Actually do a literal replace using the matched text
matched = m.group(0)
# Compute base indent (from start of <Link in matched)
idx = matched.find('<Link')
base_indent = ''
# walk backwards from idx
i = idx - 1
while i >= 0 and matched[i] in ' \t':
    base_indent = matched[i] + base_indent
    i -= 1
# Build replacement preserving base_indent for first line; subsequent lines use the same convention as old1
# Easier: recreate replacement using base indent
lines_new = new1.splitlines()
# old1's first line had indent matching `base_indent`. Each subsequent line's indent in old1 was relative to that.
old_lines = old1.splitlines()
old_first_indent = len(old_lines[0]) - len(old_lines[0].lstrip())
new_first_indent = len(lines_new[0]) - len(lines_new[0].lstrip())
# adjust each new line by (base_indent length) - new_first_indent
delta = len(base_indent) - new_first_indent
def adjust(line):
    if not line.strip():
        return line
    cur = len(line) - len(line.lstrip())
    new_indent = max(0, cur + delta)
    return ' ' * new_indent + line.lstrip()
new_block = '\n'.join(adjust(l) for l in lines_new)
# Replace
src2 = src[:m.start()] + (matched[:i+1] if False else '') 
# Simpler: replace exact matched substring
src2 = src.replace(matched, ('\n' if not matched.startswith('\n') else '') + new_block, 1) if False else None

# Use position-based replace
prefix = src[:m.start()]
suffix = src[m.end():]
# matched starts with leading whitespace including newline before <Link maybe
# Keep leading whitespace prior to <Link
lead = matched[:idx]
src_new = prefix + lead + new_block.lstrip() + suffix
# But new_block.lstrip removes only leading spaces of first line, fine.

# Now replacement #2 — close </Link> -> remove
old2 = '                  </button>\n                </Link>\n              </li>'
# Find exact in src_new
# Construct loose
def loose_simple(s):
    # find with flexible whitespace BETWEEN tokens but keep tokens literal
    return s
# Try literal first
if old2 in src_new:
    src_new = src_new.replace(old2, '                  </button>\n              </li>', 1)
else:
    # Try matching with single-space leading just to be safe
    # Find </Link> followed by whitespace and </li>
    pat2 = re.compile(r'(</button>)\s*</Link>\s*(</li>)', re.MULTILINE)
    src_new, n = pat2.subn(r'\1\n              \2', src_new, count=1)
    assert n==1, "could not strip </Link>"

# Replacement #3 — view-all link should preserve filter intent
old3 = '<Link href={basePath}>'
new3 = '<Link href={`${basePath}?filter=last`}>'
assert old3 in src_new
src_new = src_new.replace(old3, new3, 1)

p.write_text(src_new)
print("done")
