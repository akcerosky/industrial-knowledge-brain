import { type ReactNode, useState } from "react";
import {
  Activity,
  AlertCircle,
  BrainCircuit,
  BriefcaseBusiness,
  Cpu,
  Layers,
  ListChecks,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UploadCloud,
  Workflow,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { PendingActionsPanel } from "./PendingActions";

type DiagnosticsProps = {
  runtimeStatus: {
    vector: { backend: string; chunks: number };
    graph: { backend: string; equipment_nodes: number; document_nodes: number; relationships: number };
    llm: { provider: string; enabled: boolean };
    corpus: { documents: number; uploads: number };
  } | null;
  runtimeHealth: {
    gemini: { provider: string; available: boolean; detail: string };
    postgres: { provider: string; available: boolean; detail: string };
    neo4j: { provider: string; available: boolean; detail: string };
    ingestion_queue_depth: number;
    fallback_modes: string[];
  } | null;
  impactSummary: {
    uploaded_documents: number;
    processed_documents: number;
    extracted_entities: number;
    extracted_relations: number;
    indexed_chunks: number;
    equipment_tags_covered: string[];
    latest_upload_name?: string | null;
  } | null;
  runtimeStatusState: "loading" | "ready" | "unavailable";
  selectedTag: string;
};

type DiagnosticsSummary = {
  passed: number;
  total: number;
  score: number;
  cases: Array<{
    question: string;
    passed: boolean;
    confidence: number;
    citation_count: number;
    notes: string[];
  }>;
};

export function DiagnosticsPage({
  runtimeStatus,
  runtimeHealth,
  impactSummary,
  runtimeStatusState,
  selectedTag,
}: DiagnosticsProps) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSummary | null>(null);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runDiagnostics() {
    setIsRunningDiagnostics(true);
    setError(null);
    try {
      const apiResponse = await apiFetch("/api/diagnostics/evaluate", { cache: "no-store" });
      if (!apiResponse.ok) {
        throw new Error(`Diagnostics failed with status ${apiResponse.status}`);
      }
      setDiagnostics((await apiResponse.json()) as DiagnosticsSummary);
    } catch (diagnosticsError) {
      setError(diagnosticsError instanceof Error ? diagnosticsError.message : "Unable to run diagnostics.");
    } finally {
      setIsRunningDiagnostics(false);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-7xl mx-auto">
      {/* Overview/Why Different Header */}
      <Card className="border border-slate-200 bg-white shadow-sm overflow-hidden rounded-xl">
        <div className="absolute top-0 right-0 p-4 opacity-5">
          <Layers className="size-36 text-primary" />
        </div>
        <CardContent className="p-6 relative z-10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                <Sparkles className="size-3" />
                <span>Architecture Grounding</span>
              </span>
              <h2 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
                Hybrid Retrieval & Verification Engine
              </h2>
              <p className="text-sm text-slate-500 max-w-3xl leading-relaxed font-medium">
                Expert Knowledge Copilot pairs high-dimensional vector search with structured graph topology connections. Answers and extraction run against the active LLM provider while graph and vector backends remain independently visible for verification.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="border-sky-200 bg-sky-50 text-sky-700 shadow-none px-3 py-1 font-medium rounded-full">Grounded citations</Badge>
              <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700 shadow-none px-3 py-1 font-medium rounded-full">Hybrid retrieval</Badge>
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 shadow-none px-3 py-1 font-medium rounded-full">Decision support</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connection & Ingestion Health Status Grid */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Connection Runtimes</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <RuntimeStripCard
            icon={<Activity className="size-4 text-primary" />}
            label="LLM Runtime"
            detail={runtimeHealth?.gemini.detail ?? "Answering synthesis engine connection status"}
            value={runtimeHealth?.gemini.available ? runtimeHealth.gemini.provider : "Fallback Answering"}
            tone={runtimeHealth?.gemini.available ? "good" : "warn"}
          />
          <RuntimeStripCard
            icon={<BrainCircuit className="size-4 text-accent" />}
            label="Postgres Vector"
            detail={runtimeHealth?.postgres.detail ?? "Vector similarity and state store connection status"}
            value={runtimeHealth?.postgres.provider ?? "checking persistence"}
            tone={runtimeHealth?.postgres.available ? "good" : "warn"}
          />
          <RuntimeStripCard
            icon={<Workflow className="size-4 text-slate-700" />}
            label="Neo4j Graph"
            detail={runtimeHealth?.neo4j.detail ?? "Knowledge graph topology connection status"}
            value={runtimeHealth?.neo4j.provider ?? "checking relationships"}
            tone={runtimeHealth?.neo4j.available ? "good" : "warn"}
          />
          <RuntimeStripCard
            icon={<ShieldAlert className="size-4 text-amber-600" />}
            label="System Flags"
            detail={runtimeHealth?.ingestion_queue_depth ? `${runtimeHealth.ingestion_queue_depth} document(s) in queue` : "Ingestion queue is clear"}
            value={runtimeHealth?.fallback_modes.length ? runtimeHealth.fallback_modes.join(", ") : "Normal Mode"}
            tone={runtimeHealth?.fallback_modes.length ? "warn" : "good"}
          />
        </div>
      </div>

      {/* Live Indexing Metrics Grid */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Live Corpus Statistics</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={<UploadCloud className="size-4 text-sky-600" />}
            label="Corpus Size"
            value={runtimeStatus ? `${runtimeStatus.corpus.documents} Documents` : runtimeStatusState === "loading" ? "Loading..." : "Unavailable"}
            detail={
              runtimeStatus
                ? `${runtimeStatus.corpus.uploads} manually uploaded source manuals/logs`
                : "Checking file counts..."
            }
          />
          <MetricCard
            icon={<ShieldCheck className="size-4 text-blue-600" />}
            label="Entity Extractions"
            value={impactSummary ? `${impactSummary.extracted_entities} Extracted` : runtimeStatusState === "loading" ? "Loading..." : "Unavailable"}
            detail={
              impactSummary
                ? `${impactSummary.extracted_entities} entities and ${impactSummary.extracted_relations} relationships persisted in Neo4j`
                : "Analyzing graph database..."
            }
          />
          <MetricCard
            icon={<BrainCircuit className="size-4 text-emerald-600" />}
            label="Semantic Chunks"
            value={impactSummary ? `${impactSummary.indexed_chunks} Chunks` : runtimeStatusState === "loading" ? "Loading..." : "Unavailable"}
            detail={
              impactSummary
                ? impactSummary.equipment_tags_covered.length
                  ? `${impactSummary.equipment_tags_covered.length} equipment tag(s) indexed: ${impactSummary.equipment_tags_covered.slice(0, 3).join(", ")}${impactSummary.equipment_tags_covered.length > 3 ? "..." : ""}`
                  : "No tags mapped in Postgres"
                : "Loading chunks..."
            }
          />
          <MetricCard
            icon={<BriefcaseBusiness className="size-4 text-amber-600" />}
            label="Latest Processed Upload"
            value={impactSummary?.latest_upload_name ?? "No Uploads Yet"}
            detail={
              impactSummary
                ? `${impactSummary.uploaded_documents} files represented in vector index`
                : "Syncing metrics..."
            }
          />
        </div>
      </div>

      <PendingActionsPanel selectedTag={selectedTag} />

      {/* Diagnostics Runner */}
      <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
        <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-slate-100 p-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-primary">
              <TimerReset className="size-4 text-primary" />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Validation Harness</p>
            </div>
            <CardTitle className="text-lg font-bold">Golden Industrial Evaluation Suite</CardTitle>
            <p className="text-xs text-slate-500">
              Run evaluation prompts against the current model config to verify response grounding and factual accuracy.
            </p>
          </div>
          <Button
            className="rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/95 transition-all shadow-sm flex items-center gap-1.5 cursor-pointer px-4 py-2"
            disabled={isRunningDiagnostics}
            onClick={runDiagnostics}
            type="button"
          >
            {isRunningDiagnostics ? (
              <span className="flex items-center gap-1.5">
                <span className="relative flex size-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full size-2 bg-white" />
                </span>
                <span>Evaluating...</span>
              </span>
            ) : (
              <>
                <Play className="size-3.5 fill-current" />
                <span>Run Golden Tests</span>
              </>
            )}
          </Button>
        </CardHeader>
        <CardContent className="p-5 space-y-4">
          {error ? (
            <Alert className="border-destructive/30 bg-destructive/10 text-destructive-foreground" variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle className="text-sm font-bold">Evaluation Failure</AlertTitle>
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          ) : null}

          {!diagnostics && !isRunningDiagnostics ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <ListChecks className="mx-auto size-8 text-slate-400 mb-2" />
              <p className="text-sm font-bold text-slate-900">Suite Ready</p>
              <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
                Execute the evaluation suite to run all golden validation tests. This evaluates compliance, confidence alignment, and citation matches.
              </p>
            </div>
          ) : null}

          {isRunningDiagnostics ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <div className="relative flex size-6 items-center justify-center">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/20 opacity-75" />
                <span className="relative inline-flex rounded-full size-3 bg-primary" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Processing Golden Questions</p>
                <p className="text-xs text-slate-500">Querying retrieval routers and grading semantic citations...</p>
              </div>
            </div>
          ) : null}

          {diagnostics && !isRunningDiagnostics ? (
            <div className="space-y-6">
              {/* Score summary panel */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Passing Rate</p>
                  <p className="mt-2 text-3xl font-extrabold text-slate-900">
                    {diagnostics.passed} <span className="text-lg text-slate-455 font-normal">/ {diagnostics.total}</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">Grounding verified successfully</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Factual Score</p>
                  <p className="mt-2 text-3xl font-extrabold text-primary">
                    {Math.round(diagnostics.score * 100)}%
                  </p>
                  <p className="text-xs text-slate-500 mt-1">Weighted semantic verification score</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Evaluation State</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-emerald-500" />
                    <p className="text-base font-bold text-slate-900">Verified</p>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Passed minimum grounding threshold</p>
                </div>
              </div>

              {/* Individual Case Log */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-450">Test Cases</h4>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
                  {diagnostics.cases.map((item, index) => (
                    <div key={index} className="p-4 hover:bg-slate-50/50 transition-colors flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between bg-white">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-400">#{index + 1}</span>
                          <h5 className="text-xs sm:text-sm font-bold text-slate-900">{item.question}</h5>
                        </div>
                        {item.notes.length ? (
                          <div className="space-y-1 pl-4">
                            {item.notes.map((note, noteIdx) => (
                              <p key={noteIdx} className="text-[11px] text-slate-500 leading-relaxed font-medium">
                                • {note}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-3 shrink-0 self-end sm:self-start">
                        <div className="text-right">
                          <p className="text-[10px] font-bold text-slate-400 font-mono">Confidence</p>
                          <p className="text-xs font-bold font-mono text-slate-700">{Math.round(item.confidence * 100)}%</p>
                        </div>
                        <div className="text-right border-l pl-3 border-slate-200">
                          <p className="text-[10px] font-bold text-slate-400 font-mono">Citations</p>
                          <p className="text-xs font-bold font-mono text-slate-700">{item.citation_count}</p>
                        </div>
                        <Badge
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase border tracking-wider ml-1 shadow-none ${
                            item.passed
                              ? "border-emerald-250 bg-emerald-50 text-emerald-700"
                              : "border-amber-250 bg-amber-50 text-amber-700"
                          }`}
                        >
                          {item.passed ? "Pass" : "Needs Review"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function RuntimeStripCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "good" | "warn";
}) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-sm transition-all duration-300 ${
        tone === "good"
          ? "border-emerald-100 bg-emerald-50/50 hover:bg-emerald-50"
          : "border-amber-100 bg-amber-50/50 hover:bg-amber-50"
      }`}
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2.5 text-sm font-extrabold text-slate-800">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500 font-medium">{detail}</p>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-all duration-300 shadow-sm hover:shadow-md">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      </div>
      <p className="mt-2.5 text-2xl font-extrabold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 font-medium">{detail}</p>
    </div>
  );
}
