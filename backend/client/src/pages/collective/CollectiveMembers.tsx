/**
 * Wave C-3 — Collective Member Directory
 * PII-filtered: no emails, no AUM, no check sizes.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Search, Users } from "lucide-react";

interface Member {
  id: string;
  displayName: string;
  kind: string;
  type: string;
  status: string;
  region: string;
  hqCountry: string;
  industries: string[];
  stages: string[];
  partnerWeight: number | null;
  partnerSince: string | null;
  website: string | null;
  linkedinUrl: string | null;
  tags: string[];
  initials: string;
}

const KIND_COLORS: Record<string, string> = {
  investor: "bg-blue-100 text-blue-700",
  consortium_partner: "bg-purple-100 text-purple-700",
  founder: "bg-emerald-100 text-emerald-700",
};

export default function CollectiveMembers() {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  const { data, isLoading, error } = useQuery<{ members: Member[]; total: number }>({
    queryKey: ["/api/collective/members"],
    queryFn: () => apiRequest("GET", "/api/collective/members").then((r) => r.json()),
  });

  const members = data?.members ?? [];

  const filtered = members.filter((m) => {
    if (search && !m.displayName.toLowerCase().includes(search.toLowerCase())) return false;
    if (kindFilter !== "all" && m.kind !== kindFilter) return false;
    if (regionFilter !== "all" && m.region !== regionFilter) return false;
    return true;
  });

  const allRegions = Array.from(new Set(members.map((m) => m.region).filter(Boolean)));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-semibold flex items-center gap-2"
            style={{ color: "#1A1A2E" }}
            data-testid="heading-members"
          >
            <Users className="h-5 w-5 text-[#8E2A4E]" />
            Member Directory
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Investors and consortium partners in the Collective.
          </p>
        </div>
        <Badge className="bg-[#8E2A4E]/10 text-[#8E2A4E] border-0" data-testid="badge-total-members">
          {data?.total ?? 0} members
        </Badge>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Search members…"
            className="pl-9 text-sm h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-members"
          />
        </div>
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-40 h-9 text-sm" data-testid="select-filter-kind">
            <SelectValue placeholder="Kind" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="investor">Investor</SelectItem>
            <SelectItem value="consortium_partner">Partner</SelectItem>
          </SelectContent>
        </Select>
        <Select value={regionFilter} onValueChange={setRegionFilter}>
          <SelectTrigger className="w-36 h-9 text-sm" data-testid="select-filter-region">
            <SelectValue placeholder="Region" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All regions</SelectItem>
            {allRegions.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Member grid */}
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="error-members">
          Failed to load member directory. Please refresh.
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-slate-500" data-testid="empty-members">
            <Users className="h-10 w-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-medium">No members found</p>
            <p className="text-xs mt-1">Adjust your filters or check back later.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((member) => (
            <Card
              key={member.id}
              className="cursor-pointer hover:border-[#8E2A4E]/30 transition-colors"
              onClick={() => setSelectedMember(member)}
              data-testid={`card-member-${member.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback
                      className="text-sm font-semibold text-white"
                      style={{ backgroundColor: "#8E2A4E" }}
                      data-testid={`avatar-${member.id}`}
                    >
                      {member.initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-slate-800 truncate" data-testid={`name-${member.id}`}>
                        {member.displayName}
                      </p>
                      <Badge
                        className={`text-[10px] capitalize shrink-0 ${KIND_COLORS[member.kind] ?? "bg-slate-100 text-slate-500"}`}
                        data-testid={`badge-kind-${member.id}`}
                      >
                        {member.kind.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{member.region} · {member.hqCountry}</p>
                    {member.industries.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {member.industries.slice(0, 3).map((ind) => (
                          <span
                            key={ind}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600"
                            data-testid={`chip-industry-${member.id}`}
                          >
                            {ind}
                          </span>
                        ))}
                        {member.industries.length > 3 && (
                          <span className="text-[10px] text-slate-400">+{member.industries.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Member detail drawer */}
      <Sheet open={!!selectedMember} onOpenChange={(open) => !open && setSelectedMember(null)}>
        <SheetContent side="right" className="w-80" data-testid="sheet-member-detail">
          {selectedMember && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3" style={{ color: "#1A1A2E" }}>
                  <Avatar className="h-10 w-10">
                    <AvatarFallback
                      className="text-sm font-semibold text-white"
                      style={{ backgroundColor: "#8E2A4E" }}
                    >
                      {selectedMember.initials}
                    </AvatarFallback>
                  </Avatar>
                  <span data-testid="text-detail-name">{selectedMember.displayName}</span>
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-3 text-sm">
                <div>
                  <span className="text-xs text-slate-500">Kind</span>
                  <Badge
                    className={`ml-2 text-[10px] capitalize ${KIND_COLORS[selectedMember.kind] ?? ""}`}
                    data-testid="badge-detail-kind"
                  >
                    {selectedMember.kind.replace("_", " ")}
                  </Badge>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Region</span>
                  <span className="ml-2 text-slate-700" data-testid="text-detail-region">{selectedMember.region}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Country</span>
                  <span className="ml-2 text-slate-700" data-testid="text-detail-country">{selectedMember.hqCountry}</span>
                </div>
                {selectedMember.industries.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Industries</p>
                    <div className="flex flex-wrap gap-1">
                      {selectedMember.industries.map((ind) => (
                        <Badge key={ind} variant="outline" className="text-[10px]" data-testid={`chip-detail-industry-${ind}`}>
                          {ind}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {selectedMember.partnerSince && (
                  <div>
                    <span className="text-xs text-slate-500">Partner since</span>
                    <span className="ml-2 text-slate-700" data-testid="text-detail-partner-since">
                      {new Date(selectedMember.partnerSince).toLocaleDateString()}
                    </span>
                  </div>
                )}
                {selectedMember.website && (
                  <a
                    href={selectedMember.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[#8E2A4E] hover:underline block"
                    data-testid="link-detail-website"
                  >
                    {selectedMember.website}
                  </a>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
