import { useEffect, useState } from "react";
import { Activity, CheckCircle2, PlayCircle, ServerCrash, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

type RuntimeHealth = {
  retrieval_mode: string;
  gemini: { provider: string; available: boolean; detail: string };
  postgres: { provider: string; available: boolean; detail: string };
  neo4j: { provider: string; available: boolean; detail: string };
  ingestion_queue_depth: number;
  fallback_modes: string[];
};

type DiagnosticsSummary = {
  passed: number;
  total: number;
  score: number;
};

export function AdministrationPage() {
  const [runtime, setRuntime] = useState<RuntimeHealth | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch("/api/status/runtime")
      .then(async (response) => (await response.json()) as RuntimeHealth)
      .then(setRuntime)
      .catch(() => setRuntime(null));
  }, []);

  async function runChecks() {
    setError(null);
    try {
      const response = await apiFetch("/api/diagnostics/evaluate");
      if (!response.ok) throw new Error(`Diagnostics failed with status ${response.status}`);
      const payload = (await response.json()) as DiagnosticsSummary;
      setDiagnostics(payload);
    } catch (diagnosticsError) {
      setError(diagnosticsError instanceof Error ? diagnosticsError.message : "Unable to run diagnostics.");
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="size-4" />
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Administration</p>
          </div>
          <CardTitle className="text-lg font-bold">Runtime and governance controls</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <Activity className="size-4 text-primary" />
            <p className="mt-2 text-sm font-bold text-slate-900">Retrieval mode</p>
            <p className="mt-1 text-sm text-slate-600">{runtime?.retrieval_mode ?? "Unknown"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <ServerCrash className="size-4 text-amber-600" />
            <p className="mt-2 text-sm font-bold text-slate-900">Processing queue</p>
            <p className="mt-1 text-sm text-slate-600">{runtime?.ingestion_queue_depth ?? 0} document(s) in progress</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200 flex-row items-center justify-between">
          <CardTitle className="text-base font-bold">Evaluation benchmark</CardTitle>
          <Button type="button" onClick={runChecks}>
            <PlayCircle className="mr-1.5 size-4" />
            Run checks
          </Button>
        </CardHeader>
        <CardContent className="p-5">
          {error ? (
            <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
              <AlertTitle>Evaluation failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {diagnostics ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-success" />
                <p className="text-sm font-bold text-slate-900">
                  {diagnostics.passed}/{diagnostics.total} benchmark checks passed
                </p>
              </div>
              <p className="mt-1 text-sm text-slate-600">Overall score: {Math.round(diagnostics.score * 100)}%</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Run evaluation checks to validate retrieval grounding and response quality.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
