import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ClipboardList, Gauge, Sparkles, Ticket, X } from "lucide-react";
import type { PendingAction } from "../App";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";

type PendingActionsPanelProps = {
  selectedTag: string;
};

type PendingActionResponse = {
  actions: PendingAction[];
};

const statusVariant: Record<PendingAction["status"], string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  dismissed: "bg-muted text-muted-foreground",
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asConfidence(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function confidenceTone(confidence: number) {
  if (confidence >= 0.75) return "bg-success/15 text-success";
  if (confidence >= 0.5) return "bg-warning/15 text-warning";
  return "bg-destructive/15 text-destructive";
}

export function PendingActionsPanel({ selectedTag }: PendingActionsPanelProps) {
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadActions();
  }, []);

  const orderedActions = useMemo(() => {
    return [...actions].sort((left, right) => {
      const leftFocus = left.equipment_tag === selectedTag ? 1 : 0;
      const rightFocus = right.equipment_tag === selectedTag ? 1 : 0;
      if (leftFocus !== rightFocus) {
        return rightFocus - leftFocus;
      }
      return left.created_at < right.created_at ? 1 : -1;
    });
  }, [actions, selectedTag]);

  const focusedCount = orderedActions.filter((action) => action.equipment_tag === selectedTag).length;

  async function loadActions() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/actions");
      if (!response.ok) {
        throw new Error(`Unable to load actions (${response.status})`);
      }
      const payload = (await response.json()) as PendingActionResponse;
      setActions(payload.actions);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to load pending actions.");
    } finally {
      setIsLoading(false);
    }
  }

  async function generateActions() {
    setIsGenerating(true);
    setError(null);
    try {
      const response = await apiFetch("/api/actions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipment_tag: selectedTag || "P-101A" }),
      });
      if (!response.ok) {
        throw new Error(`Unable to generate actions (${response.status})`);
      }
      const payload = (await response.json()) as PendingActionResponse;
      setActions(payload.actions);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to generate proposed actions.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function updateAction(actionId: string, status: "approved" | "dismissed") {
    setError(null);
    try {
      const response = await apiFetch(`/api/actions/${actionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        throw new Error(`Unable to update action (${response.status})`);
      }
      const updated = (await response.json()) as PendingAction;
      setActions((current) => current.map((action) => (action.action_id === updated.action_id ? updated : action)));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update action.");
    }
  }

  return (
    <Card className="border border-slate-200 bg-white shadow-sm relative overflow-hidden rounded-lg">
      <CardHeader className="flex-row items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-warning">
            <ClipboardList className="size-4 animate-pulse" />
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Human-in-the-Loop Guardrail</p>
          </div>
          <CardTitle className="mt-1 text-base font-bold">Work Order &amp; Compliance Hub</CardTitle>
          <p className="mt-1 text-[11px] text-slate-500">
            Target Tag: <span className="font-mono font-bold text-primary">{selectedTag || "P-101A"}</span>
            {focusedCount ? ` · ${focusedCount} active proposal${focusedCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <Button
          disabled={isGenerating}
          onClick={() => void generateActions()}
          size="sm"
          className="rounded-lg px-4 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/95 transition-all shadow-sm"
        >
          {isGenerating ? "Generating..." : `Draft for ${selectedTag || "P-101A"}`}
        </Button>
      </CardHeader>

      <CardContent className="px-5 py-4">
        <div className="rounded-lg border border-warning/20 bg-warning/5 px-4 py-3 mb-4">
          <p className="text-[9px] font-mono font-bold uppercase tracking-wider text-warning flex items-center gap-1.5">
            <Sparkles className="size-3.5" />
            Human-in-the-Loop Control
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-650">
            AI-drafted work orders and safety notices require supervisor review before dispatching to the QMS connector.
          </p>
        </div>

        {error ? (
          <Alert className="mt-4 border-destructive/30 bg-destructive/10 text-destructive-foreground" variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle className="text-sm font-bold">Action Guardrail Error</AlertTitle>
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        ) : null}

        {isLoading ? (
          <div className="mt-4 grid gap-3">
            <Skeleton className="h-28 w-full rounded-2xl bg-muted/20" />
            <Skeleton className="h-28 w-full rounded-2xl bg-muted/20" />
          </div>
        ) : null}

        <div className="mt-4 grid gap-4">
          {orderedActions.length === 0 && !isLoading ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-xs text-slate-500 text-center">
              No pending actions. Click "Draft for {selectedTag || "P-101A"}" above to simulate generating a safety compliance proposal.
            </div>
          ) : null}

          {orderedActions.map((action) => {
            const reasoning = asString(action.details?.reasoning);
            const agentConfidence = asConfidence(action.details?.agent_confidence);
            const reasoningMode = asString(action.details?.reasoning_mode);
            const qmsReference = asString(action.details?.qms_reference);
            const qmsStatus = asString(action.details?.status);

            return (
              <article
                key={action.action_id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm hover:border-slate-300 transition-all duration-300"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2.5">
                  <div>
                    <p className="text-sm font-bold text-slate-900 leading-none tracking-wide">{action.title}</p>
                    <p className="mt-1 text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500">
                      {action.kind.replace("_", " ")} &middot; {action.equipment_tag}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {agentConfidence !== null ? (
                      <Badge className={`rounded-full font-bold px-2 py-0.5 text-[9px] tracking-wide border ${confidenceTone(agentConfidence)}`}>
                        <Gauge className="size-2.5 mr-1" />
                        {Math.round(agentConfidence * 100)}% Match
                      </Badge>
                    ) : null}
                    <Badge className={`rounded-full font-bold px-2.5 py-0.5 text-[9px] tracking-wide uppercase ${statusVariant[action.status]}`}>
                      {action.status}
                    </Badge>
                  </div>
                </div>

                <p className="mt-3 text-xs leading-relaxed text-slate-600 font-medium">{action.summary}</p>

                {reasoning ? (
                  <div className="mt-3 rounded-lg bg-white p-3 border border-slate-200 font-mono text-[11px]">
                    <div className="flex items-center gap-1.5 text-primary">
                      <Sparkles className="size-3.5" />
                      <p className="text-[9px] font-bold uppercase tracking-wider">
                        AI Safety Reasoning{reasoningMode === "llm" ? " · LLM-assisted" : ""}
                      </p>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-655 font-sans">{reasoning}</p>
                  </div>
                ) : null}

                {qmsReference ? (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-success/10 px-3.5 py-2 text-xs text-success border border-success/25 shadow-sm">
                    <Ticket className="size-3.5" />
                    <span className="font-mono font-bold text-[10px] uppercase tracking-wide">
                      Dispatched to QMS — Ticket #{qmsReference}{qmsStatus ? ` (${qmsStatus})` : ""}
                    </span>
                  </div>
                ) : null}

                {action.draft_text ? (
                  <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-800 border border-slate-200 scrollbar-thin shadow-sm">
                    {action.draft_text}
                  </pre>
                ) : null}

                {action.citations.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {action.citations.map((citation) => (
                      <Badge key={citation} variant="outline" className="rounded text-[9px] font-mono border-slate-200 text-slate-600 bg-white">
                        {citation}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                <div className="mt-4 flex gap-2.5 pt-3 border-t border-slate-200">
                  <Button
                    disabled={action.status !== "pending"}
                    onClick={() => void updateAction(action.action_id, "approved")}
                    size="sm"
                    className="rounded-lg px-5 text-xs font-semibold bg-success hover:bg-success/95 text-success-foreground transition-all shadow-sm"
                  >
                    <Check className="size-3.5 mr-1" />
                    Approve &amp; Dispatch
                  </Button>
                  <Button
                    disabled={action.status !== "pending"}
                    onClick={() => void updateAction(action.action_id, "dismissed")}
                    size="sm"
                    variant="outline"
                    className="rounded-lg px-5 text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-all"
                  >
                    <X className="size-3.5 mr-1" />
                    Dismiss Proposal
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
