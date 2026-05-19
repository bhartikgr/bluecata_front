/**
 * Wave C-3 — Collective Settings
 * Per-user Collective preferences: anonymity, notifications, deal-room visibility.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { apiRequest } from "@/lib/queryClient";
// apiRequest used for GET; native fetch used for PATCH (custom x-confirm header)
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";

interface CollectiveSettingsData {
  userId: string;
  anonymityLevel: "public" | "screen_name" | "private";
  notifyOnDscScore: boolean;
  notifyOnDealRoomUpdate: boolean;
  dealRoomVisibility: "visible" | "hidden" | "members_only";
  version: number;
  updatedAt: string;
}

type FormValues = Omit<CollectiveSettingsData, "userId" | "version" | "updatedAt">;

export default function CollectiveSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<CollectiveSettingsData>({
    queryKey: ["/api/collective/settings/mine"],
    queryFn: () => apiRequest("GET", "/api/collective/settings/mine").then((r) => r.json()),
  });

  const form = useForm<FormValues>({
    defaultValues: {
      anonymityLevel: "public",
      notifyOnDscScore: true,
      notifyOnDealRoomUpdate: true,
      dealRoomVisibility: "visible",
    },
  });

  useEffect(() => {
    if (data) {
      form.reset({
        anonymityLevel: data.anonymityLevel,
        notifyOnDscScore: data.notifyOnDscScore,
        notifyOnDealRoomUpdate: data.notifyOnDealRoomUpdate,
        dealRoomVisibility: data.dealRoomVisibility,
      });
    }
  }, [data, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await fetch("/api/collective/settings/mine", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-confirm": "true",
        },
        body: JSON.stringify(values),
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collective/settings/mine"] });
      toast({ title: "Settings saved", description: "Your Collective preferences have been updated." });
    },
    onError: () => {
      toast({ title: "Save failed", description: "Could not update settings. Please try again.", variant: "destructive" });
    },
  });

  function onSubmit(values: FormValues) {
    mutation.mutate(values);
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1
          className="text-xl font-semibold flex items-center gap-2"
          style={{ color: "#1A1A2E" }}
          data-testid="heading-settings"
        >
          <Settings className="h-5 w-5 text-[#8E2A4E]" />
          Collective Settings
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage your anonymity, notifications, and Deal Room visibility.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="error-settings">
          Failed to load settings. Please refresh.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Anonymity */}
          <Card data-testid="card-anonymity">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                Anonymity Level
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500 mb-3">
                Controls how your identity appears to other Collective members.
              </p>
              <Select
                value={form.watch("anonymityLevel")}
                onValueChange={(v) => form.setValue("anonymityLevel", v as "public" | "screen_name" | "private")}
              >
                <SelectTrigger className="w-full" data-testid="select-anonymity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public" data-testid="option-anonymity-public">Public — full name visible</SelectItem>
                  <SelectItem value="screen_name" data-testid="option-anonymity-screen">Screen name — pseudonym only</SelectItem>
                  <SelectItem value="private" data-testid="option-anonymity-private">Private — fully anonymous</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card data-testid="card-notifications">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                Notification Preferences
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="switch-dsc" className="text-sm font-medium text-slate-700">
                    DSC score published
                  </Label>
                  <p className="text-xs text-slate-500">Notify when a new composite score is published.</p>
                </div>
                <Switch
                  id="switch-dsc"
                  checked={form.watch("notifyOnDscScore")}
                  onCheckedChange={(v) => form.setValue("notifyOnDscScore", v)}
                  data-testid="switch-notify-dsc"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="switch-dealroom" className="text-sm font-medium text-slate-700">
                    Deal room updates
                  </Label>
                  <p className="text-xs text-slate-500">Notify when a company enters or updates the Deal Room.</p>
                </div>
                <Switch
                  id="switch-dealroom"
                  checked={form.watch("notifyOnDealRoomUpdate")}
                  onCheckedChange={(v) => form.setValue("notifyOnDealRoomUpdate", v)}
                  data-testid="switch-notify-dealroom"
                />
              </div>
            </CardContent>
          </Card>

          {/* Deal Room Visibility */}
          <Card data-testid="card-deal-room-visibility">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                Deal Room Visibility
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500 mb-3">
                Controls whether your company appears in the Collective Deal Room.
              </p>
              <Select
                value={form.watch("dealRoomVisibility")}
                onValueChange={(v) => form.setValue("dealRoomVisibility", v as "visible" | "hidden" | "members_only")}
              >
                <SelectTrigger className="w-full" data-testid="select-deal-room-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="visible" data-testid="option-visibility-visible">Visible to all Collective members</SelectItem>
                  <SelectItem value="members_only" data-testid="option-visibility-members">Members only</SelectItem>
                  <SelectItem value="hidden" data-testid="option-visibility-hidden">Hidden — not listed</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Button
            type="submit"
            disabled={mutation.isPending}
            className="w-full"
            style={{ backgroundColor: "#8E2A4E" }}
            data-testid="button-save-settings"
          >
            {mutation.isPending ? "Saving…" : "Save Settings"}
          </Button>

          {data && (
            <p className="text-xs text-center text-slate-400">
              Last updated: {new Date(data.updatedAt).toLocaleString()} · Version {data.version}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
