import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, Database, Radio, ShieldCheck, Sparkles, Waypoints, Wrench } from "lucide-react";
import { AdministrationPage } from "./pages/Administration";
import { AssetsPage } from "./pages/Assets";
import { ChatPage } from "./pages/Chat";
import { DocumentViewerPage } from "./pages/DocumentViewer";
import { IntelligencePage } from "./pages/Intelligence";
import { KnowledgePage } from "./pages/Knowledge";
import { PendingActionsPanel } from "./pages/PendingActions";
import { WorkflowsPage } from "./pages/Workflows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";

export type Citation = {
  document_id: string;
  document_name?: string | null;
  excerpt: string;
  locator: string;
  confidence: number;
  source_url?: string | null;
  evidence_kind?: string | null;
  relation_to_answer?: string | null;
};

export type QueryResponse = {
  answer: string;
  citations: Citation[];
  entities: Array<{
    entity_id: string;
    canonical_name: string;
    entity_type: string;
    confidence: number;
    source_document_id: string;
  }>;
  confidence: number;
  evidence_coverage: number;
  source_diversity: number;
  retrieval_mode: "vector" | "graph" | "hybrid";
  graph_entities: string[];
  recommended_actions: Array<{
    action_type: string;
    title: string;
    immediate_step: string;
    risk_level: "low" | "medium" | "high";
    equipment_tag?: string | null;
    rationale: string;
    supporting_citations: string[];
  }>;
  business_impact: {
    downtime_avoided_hours: number;
    compliance_risk_prevented: string;
    maintenance_response_time_reduction_minutes: number;
    asset_criticality: "low" | "medium" | "high";
    impact_basis: string[];
  };
  reasoning_summary: {
    summary: string;
    confidence_rationale: string;
    strongest_facts: string[];
    graph_support_count: number;
    vector_support_count: number;
    fallback_used: boolean;
  };
  what_changed: Array<{
    driver_type: string;
    title: string;
    summary: string;
  }>;
};

export type DocumentPayload = {
  document_id: string;
  document_name: string;
  document_type: string;
  content_type: string;
  locator?: string | null;
  raw_text: string;
  download_url: string;
};

export type PendingAction = {
  action_id: string;
  kind: "compliance_flag" | "work_order_draft";
  equipment_tag: string;
  title: string;
  summary: string;
  details: Record<string, unknown>;
  draft_text?: string | null;
  citations: string[];
  status: "pending" | "approved" | "dismissed";
  created_at: string;
  updated_at: string;
};

type RuntimeStatus = {
  api: string;
  retrieval: string;
  graph: {
    backend: string;
    equipment_nodes: number;
    document_nodes: number;
    relationships: number;
  };
  vector: {
    backend: string;
    chunks: number;
  };
  llm: {
    provider: string;
    enabled: boolean;
    embedding_backend: string;
  };
  corpus: {
    documents: number;
    uploads: number;
    processed_uploads?: number;
    latest_upload_name?: string | null;
  };
};

type RuntimeStatusState = "loading" | "ready" | "unavailable";

export default function App() {
  const [activeTab, setActiveTab] = useState<"copilot" | "assets" | "knowledge" | "workflows" | "intelligence" | "administration">("copilot");
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [latestResponse, setLatestResponse] = useState<QueryResponse | null>(null);
  const [graphTagOverride, setGraphTagOverride] = useState<string | null>(null);
  const [chatSeed, setChatSeed] = useState<{ question: string; nonce: number } | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeStatusState, setRuntimeStatusState] = useState<RuntimeStatusState>("loading");
  const [mobileEvidenceOpen, setMobileEvidenceOpen] = useState(false);
  const [reviewQueueOpen, setReviewQueueOpen] = useState(false);
  const [corpusVersion, setCorpusVersion] = useState(0);

  const defaultGraphTag = useMemo(() => {
    if (graphTagOverride) {
      return graphTagOverride;
    }
    const entity = latestResponse?.entities?.find((item) => item.entity_type === "Equipment");
    return entity?.canonical_name ?? "P-101A";
  }, [latestResponse, graphTagOverride]);

  function handleExploreGraph(equipmentTag: string) {
    setGraphTagOverride(equipmentTag);
    setActiveTab("assets");
  }

  function handleCitationSelect(citation: Citation) {
    setSelectedCitation(citation);
    setMobileEvidenceOpen(true);
  }

  function handleAskAbout(documentName: string) {
    setChatSeed((current) => ({
      question: `What does ${documentName} say, and what equipment or procedures does it reference?`,
      nonce: (current?.nonce ?? 0) + 1,
    }));
    setActiveTab("copilot");
  }

  function handleCorpusUpdated() {
    setCorpusVersion((current) => current + 1);
  }

  useEffect(() => {
    let active = true;

    apiFetch("/api/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Status failed (${response.status})`);
        }
        return (await response.json()) as RuntimeStatus;
      })
      .then((payload) => {
        if (active) {
          setRuntimeStatus(payload);
          setRuntimeStatusState("ready");
        }
      })
      .catch(() => {
        if (active) {
          setRuntimeStatus(null);
          setRuntimeStatusState("unavailable");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-foreground selection:bg-primary/25 selection:text-primary lg:flex">
      
      {/* Left Sidebar */}
      <aside className="w-full border-b border-slate-200 bg-white shadow-sm lg:sticky lg:top-0 lg:h-screen lg:w-80 lg:shrink-0 lg:border-b-0 lg:border-r">
        {/* Top Brand & Branding Header */}
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <BrainCircuit className="size-5" />
            </div>
            <div>
              <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-700 block leading-none">
                Citation-Grounded AI
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Expert Knowledge Copilot</span>
            </div>
          </div>
          <h1 className="mt-3 text-lg font-bold tracking-tight text-slate-900 leading-none">
            Expert Knowledge Copilot
          </h1>
          <p className="mt-1.5 text-[11px] text-slate-500 leading-relaxed font-medium">
            A unified operations brain for asset knowledge, evidence-backed answers, workflows, and industrial intelligence.
          </p>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            Ask. Verify. Decide. Act.
          </p>
          <div className="mt-3">
            <Badge className="bg-sky-50 hover:bg-sky-50 text-sky-700 border-sky-200 text-[9px] font-semibold uppercase tracking-wider rounded-full px-2.5 py-0.5 shadow-none">
              Mobile + Desktop
            </Badge>
          </div>
        </div>

        {/* Middle Navigation Section */}
        <nav className="px-4 py-4">
          <p className="px-2 text-[9px] font-extrabold uppercase tracking-widest text-slate-400 mb-2.5">Operations Brain</p>
          <div className="grid gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("copilot")}
              className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-bold rounded-lg transition-all duration-200 cursor-pointer ${
                activeTab === "copilot"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Radio className="size-4 shrink-0" />
              <span>Copilot</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("assets")}
              className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-bold rounded-lg transition-all duration-200 cursor-pointer ${
                activeTab === "assets"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Waypoints className="size-4 shrink-0" />
              <span>Assets</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("knowledge")}
              className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-bold rounded-lg transition-all duration-200 cursor-pointer ${
                activeTab === "knowledge"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Database className="size-4 shrink-0" />
              <span>Knowledge</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("workflows")}
              className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-bold rounded-lg transition-all duration-200 cursor-pointer ${
                activeTab === "workflows"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Wrench className="size-4 shrink-0" />
              <span>Workflows</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("intelligence")}
              className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-bold rounded-lg transition-all duration-200 cursor-pointer ${
                activeTab === "intelligence"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Sparkles className="size-4 shrink-0" />
              <span>Intelligence</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("administration")}
              className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-bold rounded-lg transition-all duration-200 cursor-pointer ${
                activeTab === "administration"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <ShieldCheck className="size-4 shrink-0" />
              <span>Administration</span>
            </button>
          </div>
        </nav>

        <div className="p-4 border-t border-slate-100 bg-slate-50/50 lg:mt-auto">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-[11px] text-slate-600">
            <p className="font-bold text-slate-900">Current corpus</p>
            <p className="mt-1">
              {runtimeStatus
                ? `${runtimeStatus.corpus.documents} documents, ${runtimeStatus.vector.chunks} indexed chunks`
                : runtimeStatusState === "loading"
                  ? "Checking backend status..."
                  : "Backend status unavailable"}
            </p>
          </div>
        </div>
      </aside>

      {/* Right Main Workspace */}
      <div className="flex-1 min-w-0 flex flex-col lg:h-screen overflow-hidden">
        
        {/* Top Navbar */}
        <header className="border-b border-slate-200 bg-white px-5 py-4 shrink-0 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <span className="w-fit text-[10px] font-black font-mono text-primary uppercase tracking-wider bg-primary/10 px-2.5 py-1 rounded">
                {activeTab === "copilot" && "Copilot"}
                {activeTab === "assets" && "Assets"}
                {activeTab === "knowledge" && "Knowledge"}
                {activeTab === "workflows" && "Workflows"}
                {activeTab === "intelligence" && "Intelligence"}
                {activeTab === "administration" && "Administration"}
              </span>
              <span className="hidden text-slate-200 sm:inline">|</span>
              <span className="text-xs font-semibold text-slate-500">
                {activeTab === "copilot" && "Ask operational questions, inspect evidence, and follow AI-guided actions."}
                {activeTab === "assets" && "Explore asset context, maintenance history, and linked industrial knowledge."}
                {activeTab === "knowledge" && "Manage ingested documents, parsed records, and processing status."}
                {activeTab === "workflows" && "Review governed AI workflows, approvals, and operational follow-up tasks."}
                {activeTab === "intelligence" && "Track recurring risks, knowledge coverage, and asset-level intelligence signals."}
                {activeTab === "administration" && "Inspect runtime health, evaluation controls, and processing administration."}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg border-slate-200 text-[11px] font-bold"
                onClick={() => setReviewQueueOpen(true)}
              >
                <Wrench className="mr-1.5 size-3.5" />
                Review Queue
              </Button>
              <span className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-wider">
                {runtimeStatus ? "Connected" : "Connecting..."}
              </span>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="p-5 sm:p-6 flex-1 min-h-0 overflow-y-auto">
          {activeTab === "knowledge" && (
            <KnowledgePage
              dataVersion={corpusVersion}
              onAskAbout={handleAskAbout}
              onCorpusUpdated={handleCorpusUpdated}
              onExploreGraph={handleExploreGraph}
            />
          )}

          {activeTab === "assets" && (
            <AssetsPage
              dataVersion={corpusVersion}
              selectedTag={defaultGraphTag}
              onExploreGraph={handleExploreGraph}
            />
          )}

          {activeTab === "copilot" && (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] h-full items-start">
              <section className="min-w-0">
                <ChatPage
                  assetContext={defaultGraphTag}
                  onCitationSelect={handleCitationSelect}
                  onResponse={setLatestResponse}
                  response={latestResponse}
                  seedQuestion={chatSeed}
                  runtimeSummary={{
                    llmProvider: runtimeStatus?.llm.provider || (runtimeStatusState === "loading" ? "connecting" : "unavailable"),
                    vectorBackend: runtimeStatus?.vector.backend || (runtimeStatusState === "loading" ? "connecting" : "unavailable"),
                    graphBackend: runtimeStatus?.graph.backend || (runtimeStatusState === "loading" ? "connecting" : "unavailable"),
                  }}
                />
              </section>

              <aside className="hidden min-w-0 xl:flex xl:flex-col xl:gap-6">
                <DocumentViewerPage citation={selectedCitation} />
              </aside>
            </div>
          )}

          {activeTab === "workflows" && <WorkflowsPage selectedTag={defaultGraphTag} />}

          {activeTab === "intelligence" && <IntelligencePage dataVersion={corpusVersion} />}

          {activeTab === "administration" && <AdministrationPage />}
        </div>

      </div>

      {/* Mobile Citation Sheet */}
      <Sheet open={mobileEvidenceOpen} onOpenChange={setMobileEvidenceOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88vh] overflow-y-auto rounded-t-3xl border-slate-200 bg-slate-50 p-0 xl:hidden"
        >
          <SheetHeader className="border-b border-slate-200 bg-white px-5 py-4">
            <SheetTitle>Source Evidence</SheetTitle>
            <SheetDescription>
              Review the exact supporting excerpt, file, or graph-derived context behind the current answer.
            </SheetDescription>
          </SheetHeader>
          <div className="p-4">
            <DocumentViewerPage citation={selectedCitation} sticky={false} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Floating Inspect Evidence Bar (Mobile) */}
      {selectedCitation && activeTab === "copilot" ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur xl:hidden">
          <Button
            className="h-auto w-full justify-between rounded-2xl bg-primary px-4 py-3 text-left text-primary-foreground shadow-sm hover:bg-primary/95"
            onClick={() => setMobileEvidenceOpen(true)}
            type="button"
          >
            <span className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-primary-foreground/75">
                Inspect Evidence
              </span>
              <span className="block truncate text-sm font-semibold">
                {selectedCitation.document_name ?? selectedCitation.document_id}
              </span>
            </span>
            <span className="rounded-full bg-white/15 px-2 py-1 font-mono text-[10px]">
              {selectedCitation.locator}
            </span>
          </Button>
        </div>
      ) : null}

      <Sheet open={reviewQueueOpen} onOpenChange={setReviewQueueOpen}>
        <SheetContent
          side="right"
          className="w-full max-w-xl overflow-y-auto border-slate-200 bg-slate-50 p-0"
        >
          <SheetHeader className="border-b border-slate-200 bg-white px-5 py-4">
            <SheetTitle>Review Queue</SheetTitle>
            <SheetDescription>
              Review and approve draft work orders or compliance proposals tied to the current equipment context.
            </SheetDescription>
          </SheetHeader>
          <div className="p-4">
            <PendingActionsPanel selectedTag={defaultGraphTag} />
          </div>
        </SheetContent>
      </Sheet>

    </div>
  );
}
