#!/usr/bin/env python3
"""Patch PostsFeed.tsx for E3: preview, draft save, schedule, formatting hint."""
from pathlib import Path

p = Path("/home/user/workspace/capavate-app/client/src/components/comms/PostsFeed.tsx")
s = p.read_text()

# 1) Add Eye + Calendar + FileText icons.
old1 = ' Globe2, UserCircle2, BadgeCheck, Sparkles, Send, MapPin, Lock,\n} from "lucide-react";'
new1 = ' Globe2, UserCircle2, BadgeCheck, Sparkles, Send, MapPin, Lock,\n Eye, Calendar as CalendarIcon, Save,\n} from "lucide-react";'
assert old1 in s
s = s.replace(old1, new1, 1)

# 2) Add useState for preview/scheduledFor/savedDraftAt after `const [sort, setSort]...`.
old2 = ' const [sort, setSort] = useState<Sort>("newest");\n'
new2 = (
    ' const [sort, setSort] = useState<Sort>("newest");\n'
    ' // Sprint 18 Phase 3 E3 — composer enhancements.\n'
    ' const [preview, setPreview] = useState(false);\n'
    ' const [scheduledFor, setScheduledFor] = useState<string>("");\n'
    ' const [savedDraftAt, setSavedDraftAt] = useState<string | null>(null);\n'
)
assert old2 in s
s = s.replace(old2, new2, 1)

# 3) Replace the Composer block to add preview-card, schedule input, save-draft.
#    We anchor on the textarea start and the </div> after submit button area.
old3 = (
    '   {/* Composer */}\n'
    '   <div className="space-y-2">\n'
    '   <Textarea\n'
    '   value={draft}\n'
    '   onChange={(e) => setDraft(e.target.value)}\n'
    '   placeholder={role === "founder"\n'
    '   ? "Share an update with your investors and network..."\n'
    '   : "Share a thought with your network..."}\n'
    '   rows={2}\n'
    '   className="resize-none"\n'
    '   data-testid="input-post-draft"\n'
    '   />'
)
# That likely won't match — let me grab the actual leading whitespace.
import re
m = re.search(r"(\s*)\{/\* Composer \*/\}\s*\n(\s*)<div className=\"space-y-2\">", s)
indent = m.group(1) if m else " "
print("composer indent length:", len(indent))

# Use a regex-based approach instead.
pattern = re.compile(
    r"(\{/\* Composer \*/\}\s*\n\s*<div className=\"space-y-2\">\s*\n)(\s*<Textarea[\s\S]*?data-testid=\"input-post-draft\"\s*\n\s*/>\s*\n)",
    re.MULTILINE,
)
m2 = pattern.search(s)
assert m2, "Could not match Composer/Textarea region"

# Insert preview card after the textarea.
preview_block = (
    ' {preview && draft.trim() && (\n'
    '  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm" data-testid="post-preview">\n'
    '   <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Preview</div>\n'
    '   <div className="whitespace-pre-wrap leading-relaxed">{draft}</div>\n'
    '  </div>\n'
    ' )}\n'
)
s = s[:m2.end(2)] + preview_block + s[m2.end(2):]

# 4) Replace the bottom row (Select+Submit) with an enriched row.
old4 = (
    '   <div className="flex items-center justify-between gap-2">\n'
    '   <Select value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>\n'
    '   <SelectTrigger className="h-8 w-[220px] text-xs" data-testid="select-post-visibility">\n'
    '   <SelectValue />\n'
    '   </SelectTrigger>\n'
    '   <SelectContent>\n'
    '   <SelectItem value="network">\n'
    '   <span className="inline-flex items-center gap-2"><Globe2 className="h-3.5 w-3.5" /> Network</span>\n'
    '   </SelectItem>\n'
    '   <SelectItem value="followers">\n'
    '   <span className="inline-flex items-center gap-2"><UserCircle2 className="h-3.5 w-3.5" /> My company followers</span>\n'
    '   </SelectItem>\n'
    '   <SelectItem value="both">\n'
    '   <span className="inline-flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> Both</span>\n'
    '   </SelectItem>\n'
    '   </SelectContent>\n'
    '   </Select>'
)

# Probably indentation is single-space too. Let me just find the Select region by regex.
sel_pat = re.compile(
    r"(\s*<div className=\"flex items-center justify-between gap-2\">\s*\n\s*<Select value=\{visibility\}[\s\S]*?</Select>)",
    re.MULTILINE,
)
m3 = sel_pat.search(s)
assert m3, "Select region not found"
sel_text = m3.group(1)

# Add schedule input + draft button + preview button before submit button.
# Find the Submit button right after </Select>.
submit_pat = re.compile(r"</Select>\s*\n(\s*)<Button\s*\n(\s*)size=\"sm\"\s*\n(\s*)disabled=\{!draft\.trim\(\) \|\| createPost\.isPending\}", re.MULTILINE)
m4 = submit_pat.search(s)
assert m4, "Submit button region not found"
ind = m4.group(1)

extra_controls = (
    f'\n{ind}<input\n'
    f'{ind} type="datetime-local"\n'
    f'{ind} value={{scheduledFor}}\n'
    f'{ind} onChange={{(e) => setScheduledFor(e.target.value)}}\n'
    f'{ind} className="h-8 px-2 text-xs rounded-md border border-input bg-background"\n'
    f'{ind} data-testid="input-post-schedule"\n'
    f'{ind} aria-label="Schedule for later"\n'
    f'{ind}/>\n'
    f'{ind}<Button\n'
    f'{ind} type="button"\n'
    f'{ind} variant="ghost"\n'
    f'{ind} size="sm"\n'
    f'{ind} className="h-8 px-2 text-xs"\n'
    f'{ind} onClick={{() => setPreview((v) => !v)}}\n'
    f'{ind} data-testid="button-post-preview"\n'
    f'{ind} aria-label="Toggle preview"\n'
    f'{ind}>\n'
    f'{ind} <Eye className="h-3.5 w-3.5 mr-1" /> {{preview ? "Hide" : "Preview"}}\n'
    f'{ind}</Button>\n'
    f'{ind}<Button\n'
    f'{ind} type="button"\n'
    f'{ind} variant="ghost"\n'
    f'{ind} size="sm"\n'
    f'{ind} className="h-8 px-2 text-xs"\n'
    f'{ind} disabled={{!draft.trim()}}\n'
    f'{ind} onClick={{() => {{\n'
    f'{ind}  setSavedDraftAt(new Date().toISOString());\n'
    f'{ind}  toast({{ title: "Draft saved", description: "We\'ll keep this draft on this device for the session." }});\n'
    f'{ind} }}}}\n'
    f'{ind} data-testid="button-post-save-draft"\n'
    f'{ind}>\n'
    f'{ind} <Save className="h-3.5 w-3.5 mr-1" /> Draft\n'
    f'{ind}</Button>'
)

# Inject extras between </Select> and <Button (submit).
inj_point = m4.start()  # start of "{ind}<Button"
# Find the position of ind before "<Button"
inject_at = s.find("<Button", inj_point) - len(ind)
# Build replacement: take everything up to inject_at, insert extras, then continue.
s = s[:inject_at] + extra_controls + "\n" + s[inject_at:]

# 5) Update submit-button mutation to pass scheduledFor (cosmetic; just a hint via toast).
#    Find createPost.mutate() call and wrap it.
old_call = "onClick={() => createPost.mutate()}"
new_call = (
    "onClick={() => {\n"
    "         if (scheduledFor) {\n"
    "          toast({ title: \"Scheduled\", description: `Will post on ${new Date(scheduledFor).toLocaleString()} (demo).` });\n"
    "         }\n"
    "         createPost.mutate();\n"
    "        }}"
)
assert old_call in s
s = s.replace(old_call, new_call, 1)

# 6) Show "Saved at HH:MM" hint above submit row when savedDraftAt exists.
#    Insert just after `{preview && draft.trim() && (...)}` block we added.
saved_hint = (
    ' {savedDraftAt && (\n'
    '  <div className="text-[11px] text-muted-foreground" data-testid="text-draft-saved">\n'
    '   Draft saved at {new Date(savedDraftAt).toLocaleTimeString()}\n'
    '  </div>\n'
    ' )}\n'
)
# Insert after the preview block we already inserted.
s = s.replace(
    " {preview && draft.trim() && (\n",
    saved_hint + " {preview && draft.trim() && (\n",
    1,
)

p.write_text(s)
print("OK patched PostsFeed.tsx for E3 composer")
