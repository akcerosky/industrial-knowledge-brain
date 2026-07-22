import { useEffect, useState } from "react";
import { AlertCircle, ExternalLink, FileSearch, ShieldCheck } from "lucide-react";
import type { Citation, DocumentPayload } from "../App";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, apiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

type DocumentViewerProps = {
  citation: Citation | null;
  sticky?: boolean;
};

export function DocumentViewerPage({ citation, sticky = true }: DocumentViewerProps) {
  const [documentData, setDocumentData] = useState<DocumentPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isStructuredCitation = Boolean(citation && !citation.source_url && citation.locator.startsWith("graph:"));

  useEffect(() => {
    if (!citation) {
      setDocumentData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    if (isStructuredCitation) {
      setDocumentData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);
    setDocumentData(null);

    apiFetch(`/api/document/${citation.document_id}?locator=${encodeURIComponent(citation.locator)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Unable to load source ${response.status}`);
        }
        return (await response.json()) as DocumentPayload;
      })
      .then((payload) => {
        if (isMounted) {
          setDocumentData(payload);
        }
      })
      .catch((viewerError) => {
        if (isMounted) {
          setError(viewerError instanceof Error ? viewerError.message : "Unable to load source.");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [citation, isStructuredCitation]);

  return (
    <Card
      className={cn(
        "border border-slate-200 bg-white shadow-sm relative overflow-hidden rounded-lg",
        sticky ? "sticky top-6" : "",
      )}
    >
      <CardHeader className="flex-row items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <FileSearch className="size-4 animate-pulse" />
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Evidence Viewport</p>
          </div>
          <CardTitle className="mt-1 text-lg font-bold">Source Grounding Inspector</CardTitle>
        </div>
        {citation ? (
          <Badge className="bg-sky-50 text-sky-700 border border-sky-200 rounded-full font-mono px-3 py-1 text-[10px]">
            {citation.locator}
          </Badge>
        ) : null}
      </CardHeader>

      <CardContent className="px-5 py-4">
        <div className="min-h-[360px] rounded-lg bg-slate-50 p-4 flex flex-col justify-center border border-slate-200">
          {!citation ? (
            <div className="grid h-full min-h-[328px] place-items-center text-center text-xs leading-relaxed text-slate-500">
              <div className="flex flex-col items-center justify-center p-6 border border-dashed border-slate-200 rounded-lg bg-white max-w-sm w-full mx-auto shadow-sm">
                <div className="p-3 bg-sky-50 rounded-full border border-sky-100 mb-3 text-sky-600 animate-pulse">
                  <ShieldCheck className="size-6" />
                </div>
                <p className="font-bold text-slate-900 text-sm tracking-wide">Evidence Verification Ready</p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                  Click any citation badge in the Copilot response to inspect the exact original text, PDF page, or scanned diagram in this viewport.
                </p>
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="grid gap-3.5 w-full">
              <Skeleton className="h-16 w-full rounded-xl bg-muted/20" />
              <Skeleton className="h-64 w-full rounded-xl bg-muted/20" />
            </div>
          ) : null}

          {error ? (
            <Alert className="border-destructive/30 bg-destructive/10 text-destructive-foreground" variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle className="text-sm font-bold">Unable to Load Source</AlertTitle>
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          ) : null}

          {citation && isStructuredCitation ? (
            <div className="grid gap-4 w-full">
              <div className="rounded-lg bg-slate-100 px-4 py-3 border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs sm:text-sm font-bold text-slate-900 tracking-wide">
                      {citation.document_name ?? "Graph-derived evidence"}
                    </p>
                    <p className="text-[9px] text-slate-500 mt-0.5 font-mono uppercase tracking-wider flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-primary" />
                      structured graph context
                    </p>
                    <p className="mt-2 text-[10px] leading-relaxed text-slate-500 font-mono">
                      Locator: <span className="font-bold text-primary">{citation.locator}</span>
                    </p>
                  </div>
                  <Badge className="bg-sky-50 text-sky-700 border border-sky-200 rounded-full font-mono px-3 py-1 text-[10px]">
                    {Math.round(citation.confidence * 100)}% source match
                  </Badge>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Structured Evidence Summary</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">{citation.excerpt}</p>
                {citation.relation_to_answer ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Relation to answer</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{citation.relation_to_answer}</p>
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-[11px] leading-relaxed text-slate-500">
                This citation comes from graph context assembled from ingested documents rather than a single file slice, so the copilot shows the structured summary here instead of opening a raw file.
              </div>
            </div>
          ) : null}

          {documentData && !isLoading ? (
            <div className="grid gap-4 w-full">
              <div className="rounded-lg bg-slate-100 px-4 py-3 border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs sm:text-sm font-bold text-slate-900 tracking-wide">{documentData.document_name}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5 font-mono uppercase tracking-wider flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-primary" />
                      {documentData.document_type} &middot; {documentData.content_type}
                    </p>
                    <p className="mt-2 text-[10px] leading-relaxed text-slate-500 font-mono">
                      Locator: <span className="font-bold text-primary">{citation?.locator}</span>
                    </p>
                    {citation?.evidence_kind ? (
                      <p className="mt-1 text-[10px] leading-relaxed text-slate-500 font-mono">
                        Evidence Type: <span className="font-bold text-slate-700">{citation.evidence_kind}</span>
                      </p>
                    ) : null}
                  </div>
                  <Button asChild size="sm" variant="outline" className="rounded-lg px-4 text-xs font-semibold border-slate-200 hover:border-slate-350 hover:bg-slate-50 transition-all duration-200 cursor-pointer text-slate-805">
                      <a href={apiUrl(documentData.download_url)} target="_blank" rel="noreferrer">
                      Raw File
                      <ExternalLink className="size-3.5 ml-1.5 text-slate-500" />
                    </a>
                  </Button>
                </div>
              </div>

              {documentData.content_type === "image" ? (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-2">
                  <img
                    alt={documentData.document_name}
                    className="h-auto w-full object-contain rounded"
                    src={apiUrl(documentData.download_url)}
                    loading="lazy"
                  />
                </div>
              ) : documentData.content_type === "pdf" ? (
                <iframe
                  className="h-[calc(100vh-320px)] min-h-[350px] w-full rounded-lg bg-white border border-slate-200 shadow-sm"
                  src={`${apiUrl(documentData.download_url)}#page=1`}
                  title={documentData.document_name}
                />
              ) : (
                <div className="grid gap-3">
                  <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-700">Exact Supporting Excerpt</p>
                    <p className="mt-2 text-[12px] leading-relaxed text-slate-700">{citation?.excerpt}</p>
                    {citation?.relation_to_answer ? (
                      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{citation.relation_to_answer}</p>
                    ) : null}
                  </div>
                  <div className="max-h-[calc(100vh-420px)] min-h-[250px] overflow-auto rounded-lg bg-white p-4 border border-slate-200 scrollbar-thin shadow-sm">
                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-800">
                      {documentData.raw_text}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
