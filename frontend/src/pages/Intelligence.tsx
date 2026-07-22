import { useEffect, useState } from "react";
import { AlertTriangle, BrainCircuit, FileBarChart, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

type AssetSummary = {
  tag: string;
  display_name: string;
  ai_brief: string;
  document_count: number;
  inspection_count: number;
  procedure_count: number;
};

type ImpactSummary = {
  uploaded_documents: number;
  processed_documents: number;
  extracted_entities: number;
  extracted_relations: number;
  indexed_chunks: number;
  equipment_tags_covered: string[];
};

type IntelligencePageProps = {
  dataVersion: number;
};

export function IntelligencePage({ dataVersion }: IntelligencePageProps) {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [impact, setImpact] = useState<ImpactSummary | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch("/api/assets")
      .then(async (response) => (await response.json()) as { assets: AssetSummary[] })
      .then((payload) => {
        if (active) setAssets(payload.assets);
      })
      .catch(() => {
        if (active) setAssets([]);
      });
    apiFetch("/api/impact/summary")
      .then(async (response) => (await response.json()) as ImpactSummary)
      .then((payload) => {
        if (active) setImpact(payload);
      })
      .catch(() => {
        if (active) setImpact(null);
      });
    return () => {
      active = false;
    };
  }, [dataVersion]);

  return (
    <div className="space-y-6">
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="size-4" />
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Industrial Intelligence</p>
          </div>
          <CardTitle className="text-lg font-bold">Cross-asset patterns and knowledge coverage</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <FileBarChart className="size-4 text-primary" />
            <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Knowledge coverage</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{impact?.uploaded_documents ?? 0}</p>
            <p className="text-sm text-slate-600">uploaded records across {impact?.equipment_tags_covered.length ?? 0} tagged assets</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <BrainCircuit className="size-4 text-success" />
            <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Entity intelligence</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{impact?.extracted_entities ?? 0}</p>
            <p className="text-sm text-slate-600">entities and {impact?.extracted_relations ?? 0} relations extracted</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <AlertTriangle className="size-4 text-amber-600" />
            <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Retrieval substrate</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{impact?.indexed_chunks ?? 0}</p>
            <p className="text-sm text-slate-600">indexed semantic chunks ready for hybrid retrieval</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200">
          <CardTitle className="text-base font-bold">Asset intelligence signals</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-5">
          {assets.slice(0, 6).map((asset) => (
            <div key={asset.tag} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-slate-900">{asset.display_name}</p>
                <span className="text-[11px] font-mono text-slate-500">{asset.tag}</span>
              </div>
              <p className="mt-2 text-sm text-slate-600">{asset.ai_brief}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
