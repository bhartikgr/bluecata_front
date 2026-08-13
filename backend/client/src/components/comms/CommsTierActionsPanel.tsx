/**
 * WAVE 18 / ORP-043 (DEF-043) — the orphaned Tier 1/2/3 comms surface.
 *
 * `CommsTiersTabs` renders LISTINGS only (it reads
 * `/api/comms/channels-tiered`). Every Tier 1/2/3 *action* endpoint in
 * `server/commsTiersStore.ts` — create a co-investor group, post into one,
 * request an intro, open a cross-cohort DM, mute a sender — plus
 * `GET /api/comms/search` (`server/commsStore.ts:3277`) and
 * `GET /api/founder/crm/high-value-advocates` had ZERO client callers. An engine
 * with no caller is not shipped, so this panel is the caller.
 *
 * Design rules honoured here:
 *   - RULE 5: every refusal is RENDERED as copy. A 401/403/429/opt-out is a
 *     visible sentence, never a blank card and never a silent empty list. The
 *     cross-cohort cap and the recipient's opt-out are *expected* refusals for
 *     this surface, so they read as explanations, not as errors.
 *   - No money is rendered anywhere on this surface, so there is no minor-unit
 *     conversion to get wrong. (Deliberate: the tier engines carry no amounts.)
 *   - Actor identity is NOT sent in any request body. The server now derives it
 *     from the session (ORP-043 hardening); a body actor would be either ignored
 *     or a 400. This panel therefore posts content only, never "who I am".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Users2, Send, Search, Star, VolumeX } from "lucide-react";

export interface CoInvestorGroupRow {
  id: string;
  companyId: string;
  participants: string[];
  createdAt: string;
}

export interface CommsSearchRow {
  messageId: string;
  channelId: string;
  channelKind: string;
  preview: string;
  createdAt: string;
  authorLabel: string;
}

/* ---------------------------------------------------------------------------
 * Refusal copy. Exported so the suite asserts the SAME strings the UI renders
 * rather than a re-typed guess (a re-typed expectation cannot catch a copy
 * regression).
 * ------------------------------------------------------------------------ */
export const TIER_ERROR_COPY: Record<string, string> = {
  missing_identity: "Sign in again to use co-investor comms.",
  actorId_must_match_session: "This action was refused: it named a different user than your session.",
  authorUserId_must_match_session: "This action was refused: it named a different author than your session.",
  requesterId_must_match_session: "This action was refused: it named a different requester than your session.",
  fromUserId_must_match_session: "This action was refused: it named a different sender than your session.",
  muterId_must_match_session: "This action was refused: it named a different user than your session.",
  not_a_participant: "You are not a participant in this group.",
  group_not_found: "That group no longer exists.",
  soft_circler_opted_out: "This investor has not opted in to cross-cohort messages.",
  muted_by_recipient: "This investor has muted messages from you.",
  rate_limit_combined_cap_reached: "This investor has reached the cross-cohort message cap for this round.",
  missing_fields: "Some required details are missing.",
  NOT_ON_CAP_TABLE: "You do not have access to this company's advocate list.",
  "companyId required": "Select a company first.",
};

export function tierErrorCopy(code: string | null | undefined): string {
  if (!code) return "That request could not be completed. Nothing was changed.";
  return TIER_ERROR_COPY[code] ?? `That request could not be completed (${code}). Nothing was changed.`;
}

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string; message?: string };
    return String(j?.error ?? j?.message ?? res.status);
  } catch {
    return String(res.status);
  }
}

export function CommsTierActionsPanel({
  companyId,
  roundId,
  showAdvocates = false,
}: {
  companyId?: string;
  roundId?: string;
  showAdvocates?: boolean;
}) {
  /* ----- Tier 1: co-investor groups ----- */
  const [groups, setGroups] = useState<CoInvestorGroupRow[] | null>(null);
  const [groupsRefusal, setGroupsRefusal] = useState<string | null>(null);
  const [participantsRaw, setParticipantsRaw] = useState("");
  const [createRefusal, setCreateRefusal] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [messageRefusal, setMessageRefusal] = useState<string | null>(null);
  const [messageSentId, setMessageSentId] = useState<string | null>(null);
  const [introTarget, setIntroTarget] = useState("");
  const [introRefusal, setIntroRefusal] = useState<string | null>(null);
  const [introOk, setIntroOk] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    if (!companyId) {
      setGroups(null);
      setGroupsRefusal("companyId required");
      return;
    }
    setGroupsRefusal(null);
    const res = await apiRequest(
      "GET",
      `/api/comms/co-investor-groups/${encodeURIComponent(companyId)}`,
    ).catch(() => null);
    if (!res || !res.ok) {
      /* Fail-closed and RENDERED. An empty list here would read as "you are in
         no groups", which is a different and false statement. */
      setGroups(null);
      setGroupsRefusal(res ? await readError(res) : "network");
      return;
    }
    const j = (await res.json()) as { groups?: CoInvestorGroupRow[] };
    setGroups(Array.isArray(j?.groups) ? j.groups : []);
  }, [companyId]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const createGroup = useCallback(async () => {
    setCreateRefusal(null);
    if (!companyId) {
      setCreateRefusal("companyId required");
      return;
    }
    const participants = participantsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (participants.length === 0) {
      setCreateRefusal("missing_fields");
      return;
    }
    setCreating(true);
    try {
      /* No actorId in the body — the server takes the creator from the session. */
      const res = await apiRequest("POST", "/api/comms/co-investor-groups", {
        companyId,
        participants,
      }).catch(() => null);
      if (!res || !res.ok) {
        setCreateRefusal(res ? await readError(res) : "network");
        return;
      }
      setParticipantsRaw("");
      /* Re-READ from the server: the new group must come back from the store, not
         from local state (the Wave 17 ORP-031 defect). */
      await loadGroups();
    } finally {
      setCreating(false);
    }
  }, [companyId, participantsRaw, loadGroups]);

  const postMessage = useCallback(
    async (groupId: string) => {
      setMessageRefusal(null);
      setMessageSentId(null);
      setMessageTarget(groupId);
      if (!messageBody.trim()) {
        setMessageRefusal("missing_fields");
        return;
      }
      /* No authorUserId in the body. */
      const res = await apiRequest(
        "POST",
        `/api/comms/co-investor-groups/${encodeURIComponent(groupId)}/messages`,
        { body: messageBody.trim() },
      ).catch(() => null);
      if (!res || !res.ok) {
        setMessageRefusal(res ? await readError(res) : "network");
        return;
      }
      const j = (await res.json()) as { id?: string };
      setMessageSentId(String(j?.id ?? ""));
      setMessageBody("");
    },
    [messageBody],
  );

  const requestIntro = useCallback(
    async (groupId: string) => {
      setIntroRefusal(null);
      setIntroOk(null);
      if (!introTarget.trim()) {
        setIntroRefusal("missing_fields");
        return;
      }
      const res = await apiRequest(
        "POST",
        `/api/comms/co-investor-groups/${encodeURIComponent(groupId)}/intro`,
        { targetId: introTarget.trim() },
      ).catch(() => null);
      if (!res || !res.ok) {
        setIntroRefusal(res ? await readError(res) : "network");
        return;
      }
      setIntroOk(introTarget.trim());
      setIntroTarget("");
    },
    [introTarget],
  );

  /* ----- Tier 3: cross-cohort DM + mute ----- */
  const [dmTo, setDmTo] = useState("");
  const [dmBody, setDmBody] = useState("");
  const [dmRefusal, setDmRefusal] = useState<string | null>(null);
  const [dmOk, setDmOk] = useState<string | null>(null);
  const [muteTarget, setMuteTarget] = useState("");
  const [muteRefusal, setMuteRefusal] = useState<string | null>(null);
  const [mutedIds, setMutedIds] = useState<string[]>([]);

  const startDm = useCallback(async () => {
    setDmRefusal(null);
    setDmOk(null);
    if (!roundId) {
      setDmRefusal("missing_fields");
      return;
    }
    if (!dmTo.trim() || !dmBody.trim()) {
      setDmRefusal("missing_fields");
      return;
    }
    /* No fromUserId in the body. */
    const res = await apiRequest("POST", "/api/comms/cross-cohort/dm/start", {
      roundId,
      toUserId: dmTo.trim(),
      body: dmBody.trim(),
    }).catch(() => null);
    if (!res || !res.ok) {
      /* 429 here is not a bug: it is the privacy guard or the hard cap doing its
         job. It must still be rendered as a sentence the investor can act on. */
      setDmRefusal(res ? await readError(res) : "network");
      return;
    }
    const j = (await res.json()) as { id?: string; status?: string };
    setDmOk(String(j?.status ?? "open"));
    setDmBody("");
  }, [roundId, dmTo, dmBody]);

  const mute = useCallback(async () => {
    setMuteRefusal(null);
    if (!roundId || !muteTarget.trim()) {
      setMuteRefusal("missing_fields");
      return;
    }
    /* No muterId in the body. */
    const res = await apiRequest("POST", "/api/comms/cross-cohort/mute", {
      roundId,
      mutedId: muteTarget.trim(),
    }).catch(() => null);
    if (!res || !res.ok) {
      setMuteRefusal(res ? await readError(res) : "network");
      return;
    }
    setMutedIds((prev) => (prev.includes(muteTarget.trim()) ? prev : [...prev, muteTarget.trim()]));
    setMuteTarget("");
  }, [roundId, muteTarget]);

  /* ----- Message search ----- */
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommsSearchRow[] | null>(null);
  const [searchRefusal, setSearchRefusal] = useState<string | null>(null);
  const [searched, setSearched] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    setSearchRefusal(null);
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearched(null);
      return;
    }
    const res = await apiRequest("GET", `/api/comms/search?q=${encodeURIComponent(q)}`).catch(() => null);
    if (!res || !res.ok) {
      setResults(null);
      setSearchRefusal(res ? await readError(res) : "network");
      return;
    }
    const j = (await res.json()) as { results?: CommsSearchRow[] };
    setResults(Array.isArray(j?.results) ? j.results : []);
    setSearched(q);
  }, [query]);

  /* ----- Founder-only: high-value advocates ----- */
  const [advocates, setAdvocates] = useState<string[] | null>(null);
  const [advocatesRefusal, setAdvocatesRefusal] = useState<string | null>(null);
  const [advocatesLabel, setAdvocatesLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!showAdvocates) return;
    let live = true;
    void (async () => {
      if (!companyId) {
        if (live) {
          setAdvocates(null);
          setAdvocatesRefusal("companyId required");
        }
        return;
      }
      const res = await apiRequest(
        "GET",
        `/api/founder/crm/high-value-advocates?companyId=${encodeURIComponent(companyId)}`,
      ).catch(() => null);
      if (!live) return;
      if (!res || !res.ok) {
        setAdvocates(null);
        setAdvocatesRefusal(res ? await readError(res) : "network");
        return;
      }
      const j = (await res.json()) as { advocates?: string[]; label?: string; note?: string };
      setAdvocates(Array.isArray(j?.advocates) ? j.advocates : []);
      setAdvocatesRefusal(null);
      setAdvocatesLabel(String(j?.label ?? ""));
    })();
    return () => {
      live = false;
    };
  }, [showAdvocates, companyId]);

  const firstGroupId = useMemo(() => (groups && groups.length > 0 ? groups[0].id : null), [groups]);

  return (
    <div data-testid="comms-tier-actions-panel" className="space-y-4 px-4 py-3">
      {/* ---------- Tier 1 ---------- */}
      <Card data-testid="comms-tier-groups-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users2 className="h-4 w-4" /> Co-investor groups
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {groupsRefusal ? (
            <p data-testid="comms-tier-groups-refusal" className="text-sm text-destructive">
              {tierErrorCopy(groupsRefusal)}
            </p>
          ) : groups === null ? (
            <p data-testid="comms-tier-groups-loading" className="text-sm text-muted-foreground">
              Loading groups…
            </p>
          ) : groups.length === 0 ? (
            <p data-testid="comms-tier-groups-empty" className="text-sm text-muted-foreground">
              You are not in a co-investor group for this company yet.
            </p>
          ) : (
            <ul data-testid="comms-tier-groups-list" className="space-y-2">
              {groups.map((g) => (
                <li key={g.id} data-testid={`comms-tier-group-${g.id}`} className="rounded border border-border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{g.id}</span>
                    <Badge variant="outline" data-testid={`comms-tier-group-count-${g.id}`}>
                      {g.participants.length} participants
                    </Badge>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Input
                      value={messageBody}
                      onChange={(e) => setMessageBody(e.target.value)}
                      placeholder="Message this group"
                      data-testid={`comms-tier-message-input-${g.id}`}
                    />
                    <Button
                      size="sm"
                      onClick={() => void postMessage(g.id)}
                      data-testid={`comms-tier-message-send-${g.id}`}
                    >
                      <Send className="mr-1 h-3 w-3" /> Send
                    </Button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Input
                      value={introTarget}
                      onChange={(e) => setIntroTarget(e.target.value)}
                      placeholder="Request an intro to (user id)"
                      data-testid={`comms-tier-intro-input-${g.id}`}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void requestIntro(g.id)}
                      data-testid={`comms-tier-intro-send-${g.id}`}
                    >
                      Request intro
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {messageRefusal ? (
            <p data-testid="comms-tier-message-refusal" className="text-sm text-destructive">
              {tierErrorCopy(messageRefusal)}
            </p>
          ) : null}
          {messageSentId && messageTarget ? (
            <p data-testid="comms-tier-message-sent" className="text-sm text-muted-foreground">
              Message posted to {messageTarget}.
            </p>
          ) : null}
          {introRefusal ? (
            <p data-testid="comms-tier-intro-refusal" className="text-sm text-destructive">
              {tierErrorCopy(introRefusal)}
            </p>
          ) : null}
          {introOk ? (
            <p data-testid="comms-tier-intro-ok" className="text-sm text-muted-foreground">
              Intro requested to {introOk}.
            </p>
          ) : null}

          <div className="flex gap-2 border-t border-border pt-3">
            <Input
              value={participantsRaw}
              onChange={(e) => setParticipantsRaw(e.target.value)}
              placeholder="New group participants (comma-separated user ids)"
              data-testid="comms-tier-create-input"
            />
            <Button size="sm" onClick={() => void createGroup()} disabled={creating} data-testid="comms-tier-create-submit">
              Create group
            </Button>
          </div>
          {createRefusal ? (
            <p data-testid="comms-tier-create-refusal" className="text-sm text-destructive">
              {tierErrorCopy(createRefusal)}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            You are added to any group you create, and only groups you are in are listed.
          </p>
        </CardContent>
      </Card>

      {/* ---------- Tier 3 ---------- */}
      <Card data-testid="comms-tier-crosscohort-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <VolumeX className="h-4 w-4" /> Cross-cohort messages
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!roundId ? (
            <p data-testid="comms-tier-crosscohort-no-round" className="text-sm text-muted-foreground">
              Open a round to message soft-circling investors.
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  value={dmTo}
                  onChange={(e) => setDmTo(e.target.value)}
                  placeholder="Recipient user id"
                  data-testid="comms-tier-dm-to"
                />
                <Input
                  value={dmBody}
                  onChange={(e) => setDmBody(e.target.value)}
                  placeholder="Message"
                  data-testid="comms-tier-dm-body"
                />
                <Button size="sm" onClick={() => void startDm()} data-testid="comms-tier-dm-send">
                  Send
                </Button>
              </div>
              {dmRefusal ? (
                <p data-testid="comms-tier-dm-refusal" className="text-sm text-destructive">
                  {tierErrorCopy(dmRefusal)}
                </p>
              ) : null}
              {dmOk ? (
                <p data-testid="comms-tier-dm-ok" className="text-sm text-muted-foreground">
                  Message delivered (status: {dmOk}).
                </p>
              ) : null}
              <div className="flex gap-2 border-t border-border pt-3">
                <Input
                  value={muteTarget}
                  onChange={(e) => setMuteTarget(e.target.value)}
                  placeholder="Mute cross-cohort messages from (user id)"
                  data-testid="comms-tier-mute-input"
                />
                <Button size="sm" variant="outline" onClick={() => void mute()} data-testid="comms-tier-mute-submit">
                  Mute
                </Button>
              </div>
              {muteRefusal ? (
                <p data-testid="comms-tier-mute-refusal" className="text-sm text-destructive">
                  {tierErrorCopy(muteRefusal)}
                </p>
              ) : null}
              {mutedIds.length > 0 ? (
                <p data-testid="comms-tier-muted-list" className="text-sm text-muted-foreground">
                  Muted: {mutedIds.join(", ")}
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------- Search ---------- */}
      <Card data-testid="comms-tier-search-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Search className="h-4 w-4" /> Search my messages
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search messages you can see"
              data-testid="comms-tier-search-input"
            />
            <Button size="sm" onClick={() => void runSearch()} data-testid="comms-tier-search-submit">
              Search
            </Button>
          </div>
          {searchRefusal ? (
            <p data-testid="comms-tier-search-refusal" className="text-sm text-destructive">
              {tierErrorCopy(searchRefusal)}
            </p>
          ) : results === null ? null : results.length === 0 ? (
            <p data-testid="comms-tier-search-empty" className="text-sm text-muted-foreground">
              No messages match “{searched}”.
            </p>
          ) : (
            <ul data-testid="comms-tier-search-results" className="space-y-2">
              {results.map((r) => (
                <li
                  key={r.messageId}
                  data-testid={`comms-tier-search-row-${r.messageId}`}
                  className="rounded border border-border p-2 text-sm"
                >
                  <span className="font-medium">{r.authorLabel}</span>
                  <span className="ml-2 text-muted-foreground">{r.preview}</span>
                  <Badge variant="outline" className="ml-2">
                    {r.channelKind}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Results are limited to channels you are a member of.
          </p>
        </CardContent>
      </Card>

      {/* ---------- Founder-only advocates ---------- */}
      {showAdvocates ? (
        <Card data-testid="comms-tier-advocates-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Star className="h-4 w-4" /> High-value advocates
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {advocatesRefusal ? (
              <p data-testid="comms-tier-advocates-refusal" className="text-sm text-destructive">
                {tierErrorCopy(advocatesRefusal)}
              </p>
            ) : advocates === null ? (
              <p data-testid="comms-tier-advocates-loading" className="text-sm text-muted-foreground">
                Loading advocates…
              </p>
            ) : advocates.length === 0 ? (
              <p data-testid="comms-tier-advocates-empty" className="text-sm text-muted-foreground">
                No advocates flagged for this company yet.
              </p>
            ) : (
              <ul data-testid="comms-tier-advocates-list" className="space-y-1">
                {advocates.map((a) => (
                  <li key={a} data-testid={`comms-tier-advocate-${a}`} className="text-sm">
                    {a}
                  </li>
                ))}
              </ul>
            )}
            {advocatesLabel ? (
              <p data-testid="comms-tier-advocates-label" className="text-xs text-muted-foreground">
                {advocatesLabel}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Advisory CRM-only flag; NOT a cap-table-engine input.
            </p>
          </CardContent>
        </Card>
      ) : null}
      {firstGroupId ? (
        <p data-testid="comms-tier-primary-group" className="sr-only">
          {firstGroupId}
        </p>
      ) : null}
    </div>
  );
}

export default CommsTierActionsPanel;
