/**
 * Sprint 20 Wave 2 — Investor Glossary at /investor/glossary.
 *
 * Re-uses the shared Glossary component with investor-relevant category filters
 * pre-applied. Investor view emphasises: Cap Table, Rounds, Valuation, Legal,
 * M&A categories over founder-specific operational terms.
 */
import { useMemo, useState } from "react";
import { ENTRIES, CATEGORY_ORDER, CATEGORY_COLORS, type GlossaryEntry } from "@/components/Glossary";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, Search, Info, Code2, Link2, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/AppShell";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// Investor-relevant categories (subset of CATEGORY_ORDER)
const INVESTOR_CATEGORIES = [
  "Cap Table", "Rounds", "Valuation", "Legal", "M&A", "Governance",
];

function relatedFor(entry: GlossaryEntry, all: GlossaryEntry[]): string[] {
  const text = (entry.definition + " " + (entry.example || "")).toLowerCase();
  const set = new Set<string>();
  for (const e of all) {
    if (e.term === entry.term) continue;
    if (text.includes(e.term.toLowerCase()) && e.term.length >= 4) set.add(e.term);
  }
  return Array.from(set).slice(0, 5);
}

export default function InvestorGlossaryPage() {
  const [q, setQ] = useState("");
  const [letter, setLetter] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);

  // Filter to investor-relevant categories by default
  const baseEntries = useMemo(
    () => ENTRIES.filter((e) => INVESTOR_CATEGORIES.includes(e.category)),
    []
  );

  const filtered = useMemo(() => {
    let list = baseEntries.slice().sort((a, b) => a.term.localeCompare(b.term));
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter(e =>
        e.term.toLowerCase().includes(needle) ||
        e.definition.toLowerCase().includes(needle) ||
        e.alt?.some(a => a.toLowerCase().includes(needle)) ||
        e.example?.toLowerCase().includes(needle)
      );
    }
    if (letter) list = list.filter(e => e.term[0]?.toUpperCase() === letter);
    if (category) list = list.filter(e => e.category === category);
    return list;
  }, [q, letter, category, baseEntries]);

  const lettersWithEntries = useMemo(() => {
    const set = new Set(baseEntries.map(e => e.term[0]?.toUpperCase()).filter(Boolean) as string[]);
    return set;
  }, [baseEntries]);

  return (
    <>
      <PageHeader
        title="Investor Glossary"
        description="Key terms for cap tables, rounds, valuations, and deal mechanics."
        breadcrumbs={[{ href: "/investor/dashboard", label: "Workspace" }, { label: "Glossary" }]}
      />
      <PageBody data-testid="page-glossary">
        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
          {/* A-Z + Category sidebar */}
          <aside className="space-y-4 lg:sticky lg:top-4 self-start">
            <div>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">A-Z index</div>
              <div className="grid grid-cols-7 lg:grid-cols-4 gap-1">
                <button
                  onClick={() => setLetter(null)}
                  className={`text-xs px-1.5 py-1 rounded ${letter === null ? "bg-[hsl(184_98%_22%)] text-white" : "hover:bg-muted"}`}
                  data-testid="filter-letter-all"
                >
                  All
                </button>
                {ALPHABET.map(l => {
                  const active = letter === l;
                  const has = lettersWithEntries.has(l);
                  return (
                    <button
                      key={l}
                      disabled={!has}
                      onClick={() => setLetter(l)}
                      className={`text-xs px-1.5 py-1 rounded ${active ? "bg-[hsl(184_98%_22%)] text-white" : has ? "hover:bg-muted" : "text-muted-foreground/40"}`}
                      data-testid={`filter-letter-${l}`}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Category</div>
              <div className="space-y-1">
                <button
                  onClick={() => setCategory(null)}
                  className={`text-xs w-full text-left px-2 py-1 rounded ${category === null ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
                  data-testid="filter-cat-all"
                >
                  All investor terms
                </button>
                {INVESTOR_CATEGORIES.filter(c => CATEGORY_ORDER.includes(c)).map(c => (
                  <button
                    key={c}
                    onClick={() => setCategory(category === c ? null : c)}
                    className={`text-xs w-full text-left px-2 py-1 rounded flex items-center justify-between ${category === c ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
                    data-testid={`filter-cat-${c.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    <span>{c}</span>
                    <span className="text-[10px] text-muted-foreground">{baseEntries.filter(e => e.category === c).length}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* Main: search + cards */}
          <main className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search terms (e.g. 'cap', 'liquidation', 'cliff')…"
                className="pl-9 h-10"
                data-testid="input-glossary-search"
              />
              {(q || letter || category) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 text-xs"
                  onClick={() => { setQ(""); setLetter(null); setCategory(null); }}
                  data-testid="button-clear-filters"
                >
                  Clear
                </Button>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              Showing {filtered.length} investor terms
              {category && <> · category <span className="font-medium">{category}</span></>}
              {letter && <> · starting with <span className="font-medium">{letter}</span></>}
            </div>

            <ScrollArea className="h-[calc(100vh-320px)] pr-4">
              <div className="space-y-3">
                {filtered.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-16">
                    No terms match "{q}".
                  </div>
                ) : (
                  filtered.map(entry => {
                    const related = relatedFor(entry, baseEntries);
                    return (
                      <Card key={entry.term} id={`term-${entry.term.replace(/\s+/g, "-")}`} className="border-black/5" data-testid={`card-glossary-${entry.term.replace(/\s+/g, "-").toLowerCase()}`}>
                        <CardContent className="p-5 space-y-3">
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div>
                              <h3 className="text-lg font-semibold tracking-tight">{entry.term}</h3>
                              {entry.alt && entry.alt.length > 0 && (
                                <div className="text-xs text-muted-foreground mt-0.5">Also known as: {entry.alt.join(", ")}</div>
                              )}
                            </div>
                            <Badge variant="outline" className={`text-[10px] ${CATEGORY_COLORS[entry.category]}`}>{entry.category}</Badge>
                          </div>

                          <div className="grid sm:grid-cols-2 gap-3">
                            <div className="bg-emerald-50/60 border border-emerald-200/40 rounded-md p-3">
                              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-emerald-800 mb-1">
                                <Info className="h-3 w-3" /> Plain language
                              </div>
                              <div className="text-sm leading-relaxed">{entry.definition}</div>
                            </div>
                            {entry.technicalDefinition && (
                            <div className="bg-slate-50 border border-slate-200/60 rounded-md p-3">
                              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-slate-700 mb-1">
                                <Code2 className="h-3 w-3" /> Technical
                              </div>
                              <div className="text-sm leading-relaxed text-slate-700">
                                {entry.technicalDefinition}
                              </div>
                            </div>
                            )}
                          </div>

                          {entry.example && (
                            <div className="bg-amber-50/60 border border-amber-200/40 rounded-md p-3">
                              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-amber-900 mb-1">
                                <FlaskConical className="h-3 w-3" /> Example
                              </div>
                              <div className="text-sm leading-relaxed">{entry.example}</div>
                            </div>
                          )}

                          {related.length > 0 && (
                            <div className="flex items-center gap-2 flex-wrap pt-1">
                              <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1">
                                <Link2 className="h-3 w-3" /> Related
                              </span>
                              {related.map(r => (
                                <a
                                  key={r}
                                  href={`#term-${r.replace(/\s+/g, "-")}`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    document.getElementById(`term-${r.replace(/\s+/g, "-")}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }}
                                  className="text-xs text-[hsl(184_98%_22%)] hover:underline"
                                  data-testid={`link-related-${r.replace(/\s+/g, "-").toLowerCase()}`}
                                >
                                  {r}
                                </a>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </main>
        </div>
      </PageBody>
    </>
  );
}
