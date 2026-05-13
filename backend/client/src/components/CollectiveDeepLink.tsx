/**
 * Sprint 13 — CollectiveDeepLink
 *
 * Renders a "View in Collective" / "View in Capavate" link for a given entity.
 * Reads bridge eligibility from /api/admin/sync/drift to disable the link when
 * the entity has never synced.
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useRole } from "@/lib/role";

interface DriftResp {
  rows?: Array<{ entityKey: string; aggregateId: string; status: string }>;
  synced?: boolean;
}

interface Props {
  entity: string;       // canonical EntityKey
  id: string;           // aggregate id
  label?: string;       // override default label
  variant?: "outline" | "ghost" | "secondary" | "default";
  size?: "sm" | "default";
}

export function CollectiveDeepLink({ entity, id, label, variant = "outline", size = "sm" }: Props) {
  const { role } = useRole();
  // Sprint 20 Wave 2 — skip /api/founder/sync/status query when viewer is not a founder (defect 64)
  const drift = useQuery<DriftResp>({
    queryKey: ["/api/founder/sync/status", entity, id],
    enabled: role === "founder",
  });
  // Defect 39: replaced admin-only /api/admin/sync/drift with founder-accessible /api/founder/sync/status
  const row = drift.data?.rows?.find(r => r.entityKey === entity && r.aggregateId === id);
  const eligible = (drift.data?.synced === true) || (!!row && row.status !== "never_synced");
  const text = label ?? (entity === "investor" ? "View Collective Member Profile"
    : entity === "round" ? "View in Collective Deal Room"
    : entity === "softCircle" || entity === "commsThread" ? "View Collective MIM"
    : "View in Collective");

  const href = `/collective/preview?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(id)}`;

  return (
    <Link href={href}>
      <Button
        variant={variant}
        size={size}
        disabled={!eligible}
        data-testid={`link-collective-${entity}-${id}`}
        title={eligible ? "Open in Collective" : "Not yet synced to Collective"}
      >
        <ExternalLink className="h-3.5 w-3.5 mr-1" />
        {text}
      </Button>
    </Link>
  );
}

export default CollectiveDeepLink;
