import { useEffect, useMemo, useState } from "react";
import { AlertCircle, FileText, Network, ShieldCheck, Siren, Wrench } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { GraphExplorerPage } from "./GraphExplorer";

type AssetSummary = {
  tag: string;
  display_name: string;
  document_count: number;
  inspection_count: number;
  procedure_count: number;
  regulatory_count: number;
  last_event_date?: string | null;
  context_status: string;
  ai_brief: string;
};

type AssetTimelineItem = {
  item_id: string;
  item_type: "inspection" | "document" | "procedure" | "regulation";
  title: string;
  subtitle?: string | null;
  event_date?: string | null;
};

type AssetDetail = {
  summary: AssetSummary;
  documents: Array<Record<string, unknown>>;
  inspections: Array<Record<string, unknown>>;
  procedures: Array<Record<string, unknown>>;
  regulations: Array<Record<string, unknown>>;
  timeline: AssetTimelineItem[];
};

type AssetsPageProps = {
  dataVersion: number;
  selectedTag: string;
  onExploreGraph: (equipmentTag: string) => void;
};

export function AssetsPage({ dataVersion, selectedTag, onExploreGraph }: AssetsPageProps) {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [activeTag, setActiveTag] = useState(selectedTag);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [tab, setTab] = useState<"overview" | "timeline" | "documents" | "relationships">("overview");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setActiveTag(selectedTag);
  }, [selectedTag]);

  useEffect(() => {
    let active = true;
    apiFetch("/api/assets")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load assets (${response.status})`);
        return (await response.json()) as { assets: AssetSummary[] };
      })
      .then((payload) => {
        if (active) setAssets(payload.assets);
      })
      .catch((fetchError) => {
        if (active) setError(fetchError instanceof Error ? fetchError.message : "Unable to load assets.");
      });
    return () => {
      active = false;
    };
  }, [dataVersion]);

  useEffect(() => {
    if (!activeTag) return;
    let active = true;
    setIsLoading(true);
    setError(null);
    apiFetch(`/api/assets/${encodeURIComponent(activeTag)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load asset context (${response.status})`);
        return (await response.json()) as AssetDetail;
      })
      .then((payload) => {
        if (active) setDetail(payload);
      })
      .catch((fetchError) => {
        if (active) setError(fetchError instanceof Error ? fetchError.message : "Unable to load asset context.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeTag, dataVersion]);

  const currentSummary = detail?.summary ?? assets.find((item) => item.tag === activeTag) ?? null;

  const metrics = useMemo(
    () =>
      currentSummary
        ? [
            { label: "Documents", value: currentSummary.document_count, icon: <FileText className="size-4 text-primary" /> },
            { label: "Inspections", value: currentSummary.inspection_count, icon: <ShieldCheck className="size-4 text-success" /> },
            { label: "Procedures", value: currentSummary.procedure_count, icon: <Wrench className="size-4 text-amber-600" /> },
            { label: "Regulations", value: currentSummary.regulatory_count, icon: <Siren className="size-4 text-red-500" /> },
          ]
        : [],
    [currentSummary],
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Asset Hierarchy</p>
          <CardTitle className="text-base font-bold">Equipment Navigator</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <div className="grid gap-2">
            {assets.map((asset) => (
              <button
                key={asset.tag}
                type="button"
                onClick={() => {
                  setActiveTag(asset.tag);
                  onExploreGraph(asset.tag);
                }}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  activeTag === asset.tag
                    ? "border-primary bg-primary/5"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">{asset.display_name}</p>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {asset.tag}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">{asset.ai_brief}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5">
        {error ? (
          <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
            <AlertCircle className="size-4" />
            <AlertTitle>Asset context unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Asset Intelligence</p>
                <CardTitle className="mt-1 text-xl font-bold">{currentSummary?.display_name ?? activeTag}</CardTitle>
                <p className="mt-1 text-xs text-slate-500">Operations Brain / Assets / Equipment / {currentSummary?.tag ?? activeTag}</p>
              </div>
              {currentSummary?.tag ? (
                <Badge className="rounded-full border border-sky-200 bg-sky-50 text-sky-700 font-mono">
                  {currentSummary.tag}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2">
                    {metric.icon}
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{metric.label}</p>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{metric.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">AI-generated asset brief</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">
                {currentSummary?.ai_brief ?? "Select an equipment tag to inspect linked context, evidence, and relationships."}
              </p>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {[
                ["overview", "Overview"],
                ["timeline", "Timeline"],
                ["documents", "Documents"],
                ["relationships", "Relationships"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant={tab === value ? "default" : "outline"}
                  className="rounded-full"
                  onClick={() => setTab(value as typeof tab)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {tab === "overview" && detail ? (
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardContent className="p-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Operational context</p>
                  <p className="mt-2 text-sm text-slate-700">Latest event: {detail.summary.last_event_date ?? "No dated inspection event available"}</p>
                  <p className="mt-1 text-sm text-slate-700">Context status: {detail.summary.context_status.replace("_", " ")}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Recommended next step</p>
                  <p className="mt-2 text-sm text-slate-700">
                    Open the relationships view to inspect connected evidence, then use Copilot with this asset pinned for deeper analysis.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {tab === "timeline" && detail ? (
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardContent className="p-5">
              <div className="grid gap-3">
                {detail.timeline.map((item) => (
                  <div key={`${item.item_type}-${item.item_id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900">{item.title}</p>
                      <Badge variant="outline" className="uppercase text-[10px]">
                        {item.item_type}
                      </Badge>
                    </div>
                    {item.subtitle ? <p className="mt-1 text-sm text-slate-600">{item.subtitle}</p> : null}
                    {item.event_date ? <p className="mt-1 text-[11px] font-mono text-slate-500">{item.event_date}</p> : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {tab === "documents" && detail ? (
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardContent className="p-5">
              <div className="grid gap-3">
                {detail.documents.map((document) => (
                  <div key={String(document.document_id)} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-bold text-slate-900">{String(document.title)}</p>
                    <p className="mt-1 text-[11px] text-slate-500 font-mono">{String(document.doc_type)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {tab === "relationships" && activeTag ? (
          <GraphExplorerPage selectedTag={activeTag} />
        ) : null}

        {isLoading ? (
          <p className="text-sm text-slate-500">Loading asset intelligence...</p>
        ) : null}
      </div>
    </div>
  );
}
