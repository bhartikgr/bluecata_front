/**
 * v25.44 Surface 7 — /collective/monthly-meetings.
 * Reads GET /api/collective/monthly-meetings (past/current/upcoming).
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays } from "lucide-react";

interface Meeting {
  id: string;
  title: string;
  date: string;
  location: string;
  companyId: string | null;
}
interface MeetingsResponse {
  past: Meeting[];
  current: Meeting[];
  upcoming: Meeting[];
}

function Section({ title, rows }: { title: string; rows: Meeting[] }) {
  return (
    <div className="mb-5" data-testid={`mm-section-${title.toLowerCase()}`}>
      <h3 className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">{title} ({rows.length})</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">None.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((m) => (
            <div key={m.id} className="flex items-center justify-between py-2 px-3 rounded-md bg-slate-50">
              <span className="text-sm text-slate-700">{m.title}</span>
              <span className="text-[11px] text-slate-400">{new Date(m.date).toLocaleString()} · {m.location}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MonthlyMeetingsPage() {
  const q = useQuery<MeetingsResponse>({
    queryKey: ["/api/collective/monthly-meetings"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/monthly-meetings")).json(),
    staleTime: 30_000,
  });

  return (
    <div className="p-6 max-w-4xl mx-auto" data-testid="page-monthly-meetings">
      <div className="flex items-center gap-2 mb-6">
        <CalendarDays className="h-6 w-6 text-[#cc0001]" />
        <h1 className="text-2xl font-semibold" style={{ color: "#041e41" }}>Monthly Meetings</h1>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-500">Past · current · upcoming chapter meetings</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : q.error ? (
            <div className="text-sm text-red-700">Couldn't load monthly meetings.</div>
          ) : (
            <>
              <Section title="Current" rows={q.data?.current ?? []} />
              <Section title="Upcoming" rows={q.data?.upcoming ?? []} />
              <Section title="Past" rows={q.data?.past ?? []} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
