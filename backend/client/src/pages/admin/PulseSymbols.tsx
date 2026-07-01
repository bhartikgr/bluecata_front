/**
 * v25.47 APD-022 — Admin Pulse Symbols (DB-driven watchlist CRUD).
 *
 * Manages the Pulse index watchlist entirely from the database — no hardcoded
 * symbol list. Reads GET /api/admin/pulse-symbols, upserts via POST, and toggles
 * the enabled flag via PATCH /api/admin/pulse-symbols/:symbol/enabled.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { LineChart } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PulseSymbol {
  symbol: string;
  label: string | null;
  category: string | null;
  enabled: boolean;
  refreshSeconds: number | null;
  sortOrder: number | null;
}

interface SymbolsResponse {
  ok: boolean;
  symbols: PulseSymbol[];
}

export default function PulseSymbols() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<SymbolsResponse>({
    queryKey: ["/api/admin/pulse-symbols"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/pulse-symbols")).json(),
    retry: false,
  });
  const symbols = data?.symbols ?? [];

  const [symbol, setSymbol] = useState("");
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/admin/pulse-symbols"] });

  const upsertMut = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await apiRequest("POST", "/api/admin/pulse-symbols", body)).json(),
    onSuccess: () => {
      invalidate();
      setSymbol("");
      setLabel("");
      setCategory("");
      toast({ title: "Symbol saved" });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Save failed", description: e.message }),
  });

  const toggleMut = useMutation({
    mutationFn: async (vars: { symbol: string; enabled: boolean }) =>
      (
        await apiRequest(
          "PATCH",
          `/api/admin/pulse-symbols/${encodeURIComponent(vars.symbol)}/enabled`,
          { enabled: vars.enabled },
        )
      ).json(),
    onSuccess: () => invalidate(),
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Update failed", description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Pulse Symbols"
        description="Manage the DB-driven Pulse index watchlist. Authed users see only the enabled set."
        breadcrumbs={[{ href: "/admin/dashboard", label: "Admin" }, { label: "Pulse Symbols" }]}
      />
      <PageBody>
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LineChart className="h-5 w-5 text-[#041e41]" /> Add / update symbol
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-4"
              data-testid="pulse-symbol-form"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (!symbol.trim()) return;
                upsertMut.mutate({
                  symbol: symbol.trim().toUpperCase(),
                  label: label.trim() || undefined,
                  category: category.trim() || undefined,
                });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="symbol">Symbol</Label>
                <Input
                  id="symbol"
                  value={symbol}
                  onChange={(ev) => setSymbol(ev.target.value)}
                  placeholder="AAPL"
                  data-testid="input-symbol"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  value={label}
                  onChange={(ev) => setLabel(ev.target.value)}
                  placeholder="Apple Inc."
                  data-testid="input-label"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  value={category}
                  onChange={(ev) => setCategory(ev.target.value)}
                  placeholder="equity"
                  data-testid="input-category"
                />
              </div>
              <Button type="submit" disabled={upsertMut.isPending} data-testid="save-symbol-btn">
                {upsertMut.isPending ? "Saving…" : "Save symbol"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Watchlist ({symbols.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="pulse-symbols-loading">
                Loading symbols…
              </p>
            ) : error ? (
              <p className="text-sm text-rose-600" data-testid="pulse-symbols-error">
                Could not load symbols. Please retry.
              </p>
            ) : symbols.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="pulse-symbols-empty">
                No symbols yet. Add one above.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {symbols.map((s) => (
                    <TableRow key={s.symbol} data-testid={`symbol-row-${s.symbol}`}>
                      <TableCell className="font-medium">{s.symbol}</TableCell>
                      <TableCell>{s.label ?? "—"}</TableCell>
                      <TableCell>{s.category ?? "—"}</TableCell>
                      <TableCell>
                        <Switch
                          checked={s.enabled}
                          disabled={toggleMut.isPending}
                          onCheckedChange={(v) => toggleMut.mutate({ symbol: s.symbol, enabled: v })}
                          data-testid={`toggle-${s.symbol}`}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
