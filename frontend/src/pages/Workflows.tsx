import { ShieldCheck, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PendingActionsPanel } from "./PendingActions";

type WorkflowsPageProps = {
  selectedTag: string;
};

export function WorkflowsPage({ selectedTag }: WorkflowsPageProps) {
  return (
    <div className="space-y-6">
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200">
          <div className="flex items-center gap-2 text-primary">
            <Wrench className="size-4" />
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Agentic Workflow Centre</p>
          </div>
          <CardTitle className="text-lg font-bold">Human-approved industrial workflows</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-bold text-slate-900">Approval-gated actions</p>
            <p className="mt-2 text-sm text-slate-600">
              Draft work orders and compliance actions stay reviewable until an authorised user approves them.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-success" />
              <p className="text-sm font-bold text-slate-900">Current focus asset</p>
            </div>
            <p className="mt-2 text-sm text-slate-600">{selectedTag || "Select an asset in Copilot or Assets to scope workflow review."}</p>
          </div>
        </CardContent>
      </Card>

      <PendingActionsPanel selectedTag={selectedTag} />
    </div>
  );
}
