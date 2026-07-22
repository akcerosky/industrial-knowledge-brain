import { useEffect, useState } from "react";
import { Database, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { IngestPage } from "./Ingest";

type KnowledgeDocumentSummary = {
  document_id: string;
  document_name: string;
  document_type: string;
  processing_status: "indexed" | "uploaded" | "failed";
  asset_tags: string[];
  entity_count: number;
  relation_count: number;
  source_path: string;
};

type KnowledgePageProps = {
  dataVersion: number;
  onExploreGraph: (equipmentTag: string) => void;
  onAskAbout: (documentName: string) => void;
  onCorpusUpdated: () => void;
};

export function KnowledgePage({ dataVersion, onExploreGraph, onAskAbout, onCorpusUpdated }: KnowledgePageProps) {
  const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([]);

  useEffect(() => {
    let active = true;
    apiFetch("/api/knowledge/documents")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load knowledge library.");
        return (await response.json()) as { documents: KnowledgeDocumentSummary[] };
      })
      .then((payload) => {
        if (active) setDocuments(payload.documents);
      })
      .catch(() => {
        if (active) setDocuments([]);
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
            <Database className="size-4" />
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Knowledge Library</p>
          </div>
          <CardTitle className="text-lg font-bold">Unified document intelligence</CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          <p className="text-sm text-slate-600">
            Upload operational records, inspect processing progress, and browse indexed documents with linked asset tags.
          </p>
        </CardContent>
      </Card>

      <IngestPage onAskAbout={onAskAbout} onExploreGraph={onExploreGraph} onIngestionComplete={onCorpusUpdated} />

      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200">
          <CardTitle className="text-base font-bold">Indexed knowledge records</CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          <div className="grid gap-3">
            {documents.map((document) => (
              <div key={document.document_id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{document.document_name}</p>
                    <p className="mt-1 text-[11px] font-mono text-slate-500">{document.document_type}</p>
                  </div>
                  <Badge variant="outline" className="uppercase">
                    {document.processing_status}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {document.asset_tags.map((tag) => (
                    <Badge key={tag} className="bg-sky-50 text-sky-700 border border-sky-200">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
                  <span>{document.entity_count} entities</span>
                  <span>{document.relation_count} relations</span>
                  <button
                    type="button"
                    onClick={() => onAskAbout(document.document_name)}
                    className="font-bold text-primary"
                  >
                    Ask Copilot
                  </button>
                </div>
              </div>
            ))}
            {documents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                No indexed knowledge records yet.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
