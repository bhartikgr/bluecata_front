/**
 * LegalDrawer — slide-in sheet listing all 5 legal documents as collapsed accordions.
 *
 * - Uses shadcn Sheet (slide-in) + Accordion (collapsed by default).
 * - Each item shows: title, lastUpdated chip, 2-line summary, "Read full" toggle.
 * - Lightweight inline markdown renderer (no library): paragraphs, headings, lists,
 *   blockquotes, bold, italic, links.
 * - Light-mode only (cream surface, navy text, plum accent).
 * - Exports <LegalDrawer /> (controlled via open/onOpenChange props)
 *   and useLegalDrawer() re-exported from context module.
 */
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { LEGAL_DOCS } from "@/lib/legalDocs";
import type { LegalDoc } from "@/lib/legalDocs";
import type { LegalDocId } from "@/lib/legalDrawer";
import { _useLegalDrawerContext } from "@/lib/legalDrawer";

// ─── Lightweight markdown renderer ───────────────────────────────────────────

function renderInline(text: string): string {
  // Bold **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // Italic *text* or _text_
  text = text.replace(/\*([^*]+?)\*/g, "<em>$1</em>");
  text = text.replace(/_([^_]+?)_/g, "<em>$1</em>");
  // Links [label](url)
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\)]+|mailto:[^\)]+)\)/g,
    '<a href="$2" class="text-[hsl(300_60%_35%)] underline underline-offset-2 hover:text-[hsl(300_60%_25%)]" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return text;
}

function MarkdownBlock({ body }: { body: string }) {
  const lines = body.split(/\n/);
  const elements: JSX.Element[] = [];
  let listItems: string[] = [];
  let key = 0;

  function flushList() {
    if (listItems.length === 0) return;
    elements.push(
      <ul key={`ul-${key++}`} className="list-disc pl-5 space-y-0.5 text-sm text-[hsl(219_45%_18%)]">
        {listItems.map((li, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: renderInline(li) }} />
        ))}
      </ul>,
    );
    listItems = [];
  }

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <h3 key={key++} className="text-sm font-semibold mt-4 mb-1 text-[hsl(219_45%_12%)]">
          {line.slice(3).trim()}
        </h3>,
      );
    } else if (line.startsWith("### ")) {
      flushList();
      elements.push(
        <h4 key={key++} className="text-sm font-medium mt-3 mb-0.5 text-[hsl(219_45%_15%)]">
          {line.slice(4).trim()}
        </h4>,
      );
    } else if (line.startsWith("- ")) {
      listItems.push(line.slice(2));
    } else if (line.startsWith("> ")) {
      flushList();
      const inner = renderInline(line.slice(2).trim());
      elements.push(
        <blockquote
          key={key++}
          className="border-l-2 border-[hsl(300_60%_35%)] pl-3 italic text-xs text-[hsl(219_45%_30%)] my-2"
          dangerouslySetInnerHTML={{ __html: inner }}
        />,
      );
    } else if (line.trim() === "") {
      flushList();
    } else if (line.trim()) {
      flushList();
      elements.push(
        <p
          key={key++}
          className="text-sm text-[hsl(219_45%_18%)] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderInline(line) }}
        />,
      );
    }
  }
  flushList();

  return <div className="space-y-1">{elements}</div>;
}

// ─── Single doc accordion item ────────────────────────────────────────────────

function LegalDocItem({ doc, defaultOpen }: { doc: LegalDoc; defaultOpen: boolean }) {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <AccordionItem
      value={doc.id}
      data-testid={`legal-doc-${doc.id}`}
      className="border border-[hsl(219_30%_88%)] rounded-lg mb-2 bg-white overflow-hidden"
    >
      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-[hsl(220_30%_97%)] [&[data-state=open]>svg]:rotate-180">
        <div className="flex items-start gap-3 text-left w-full pr-2">
          <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-[hsl(219_45%_35%)]" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-[hsl(219_45%_12%)]">{doc.title}</span>
              <Badge
                variant="outline"
                className="text-[10px] border-[hsl(219_30%_80%)] text-[hsl(219_45%_40%)] bg-[hsl(220_30%_97%)]"
              >
                Updated {doc.lastUpdated}
              </Badge>
            </div>
            <p className="text-xs text-[hsl(219_30%_45%)] mt-0.5 leading-snug line-clamp-2">
              {doc.summary}
            </p>
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent className="px-4 pb-4">
        {/* "Read full" toggle */}
        <div className="mb-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            className="text-[hsl(300_60%_35%)] hover:text-[hsl(300_60%_25%)] hover:bg-[hsl(300_60%_95%)] gap-1 h-7 text-xs px-2"
            data-testid={`button-legal-${doc.id}-${expanded ? "collapse" : "read"}`}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                Read full document
              </>
            )}
          </Button>
        </div>

        {expanded && (
          <div className="border-t border-[hsl(219_30%_92%)] pt-3">
            <MarkdownBlock body={doc.body} />
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

// ─── Drawer component (controlled) ───────────────────────────────────────────

interface LegalDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If set, this accordion item is auto-expanded on open. */
  focusDocId?: LegalDocId;
}

export function LegalDrawer({ open, onOpenChange, focusDocId }: LegalDrawerProps) {
  // Track which accordion items are open
  const [openItems, setOpenItems] = useState<string[]>(
    focusDocId ? [focusDocId] : [],
  );

  // Sync when focusDocId changes (e.g., opened from a link)
  // We use a key trick — when focusDocId changes the accordion resets
  const defaultValue = focusDocId ? [focusDocId] : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl bg-[hsl(220_33%_97%)] border-l border-[hsl(219_30%_85%)] flex flex-col p-0"
        data-testid="legal-drawer"
      >
        <SheetHeader className="px-5 py-4 border-b border-[hsl(219_30%_88%)] shrink-0">
          <SheetTitle className="flex items-center gap-2 text-[hsl(219_45%_12%)]">
            <ShieldCheck className="h-5 w-5 text-[hsl(219_45%_35%)]" />
            Legal &amp; Privacy
          </SheetTitle>
          <p className="text-xs text-[hsl(219_30%_45%)] mt-0.5">
            Blueprint Catalyst Limited · Incorporated in Hong Kong
          </p>
        </SheetHeader>

        <ScrollArea className="flex-1 px-4 py-4">
          <Accordion
            type="multiple"
            defaultValue={defaultValue}
            value={openItems}
            onValueChange={setOpenItems}
            className="space-y-0"
          >
            {LEGAL_DOCS.map((doc) => (
              <LegalDocItem
                key={doc.id}
                doc={doc}
                defaultOpen={openItems.includes(doc.id)}
              />
            ))}
          </Accordion>

          <div className="mt-4 text-[10px] text-[hsl(219_30%_55%)] text-center pb-2">
            For legal enquiries:{" "}
            <a
              href="mailto:legal@capavate.com"
              className="text-[hsl(300_60%_35%)] underline"
            >
              legal@capavate.com
            </a>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Connected version: reads state from LegalDrawerProvider context.
 * Use this in the provider tree (it wires itself to the context).
 */
export function ConnectedLegalDrawer() {
  const { open, activeFocusId, closeDrawer } = _useLegalDrawerContext();
  return (
    <LegalDrawer
      open={open}
      onOpenChange={(v) => { if (!v) closeDrawer(); }}
      focusDocId={activeFocusId}
    />
  );
}

// Re-export hook for convenience
export { useLegalDrawer } from "@/lib/legalDrawer";
