import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  UploadCloud,
  Waypoints,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { apiFetch } from "@/lib/api";

type StageStatus = "pending" | "running" | "completed" | "failed";

type IngestionStage = {
  key: string;
  label: string;
  status: StageStatus;
  detail?: string | null;
};

type IngestionResult = {
  document_id: string;
  document_name: string;
  entities_extracted: number;
  relations_extracted: number;
  chunks_indexed: number;
  equipment_tags: string[];
  entity_type_counts: Record<string, number>;
};

type IngestionJob = {
  job_id: string;
  filename: string;
  status: "queued" | "running" | "completed" | "failed";
  stages: IngestionStage[];
  error?: string | null;
  result?: IngestionResult | null;
};

type IngestPageProps = {
  onExploreGraph: (equipmentTag: string) => void;
  onAskAbout: (documentName: string) => void;
  onIngestionComplete?: () => void;
};

const ACCEPTED_EXTENSIONS =
  ".pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.csv,.xlsx,.xlsm,.md,.txt,.svg,.eml,.mbox,.json";

function stageIcon(status: StageStatus) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="size-4 text-success" />;
    case "running":
      return <Loader2 className="size-4 animate-spin text-primary" />;
    case "failed":
      return <XCircle className="size-4 text-destructive" />;
    default:
      return <CircleDashed className="size-4 text-muted-foreground/50" />;
  }
}

async function uploadOne(file: File): Promise<IngestionJob> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiFetch("/api/ingest/upload", { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error(`${file.name}: upload failed with status ${response.status}`);
  }
  return (await response.json()) as IngestionJob;
}

export function IngestPage({ onExploreGraph, onAskAbout, onIngestionComplete }: IngestPageProps) {
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollTimers = useRef<Record<string, number>>({});
  const completedNotifications = useRef<Record<string, true>>({});

  useEffect(() => {
    jobs.forEach((job) => {
      const isTerminal = job.status === "completed" || job.status === "failed";
      const hasTimer = pollTimers.current[job.job_id] !== undefined;

      if (isTerminal && hasTimer) {
        window.clearInterval(pollTimers.current[job.job_id]);
        delete pollTimers.current[job.job_id];
        return;
      }

      if (!isTerminal && !hasTimer) {
        const pollJob = async () => {
          try {
            const response = await apiFetch(`/api/ingest/upload/${job.job_id}`, { cache: "no-store" });
            if (!response.ok) {
              throw new Error(`Unable to poll ingestion job (${response.status})`);
            }

            const payload = (await response.json()) as IngestionJob;
            setJobs((current) => current.map((entry) => (entry.job_id === payload.job_id ? payload : entry)));

            if (payload.status === "completed" && !completedNotifications.current[payload.job_id]) {
              completedNotifications.current[payload.job_id] = true;
              onIngestionComplete?.();
            }

            if (payload.status === "completed" || payload.status === "failed") {
              window.clearTimeout(pollTimers.current[job.job_id]);
              delete pollTimers.current[job.job_id];
              return;
            }
          } catch (pollError) {
            setError(pollError instanceof Error ? pollError.message : "Lost track of an ingestion job.");
          }

          pollTimers.current[job.job_id] = window.setTimeout(pollJob, 700);
        };

        pollTimers.current[job.job_id] = window.setTimeout(pollJob, 0);
      }
    });
  }, [jobs]);

  useEffect(
    () => () => {
      Object.values(pollTimers.current).forEach((timerId) => window.clearTimeout(timerId));
    },
    [],
  );

  async function startUpload(files: File[]) {
    if (!files.length) {
      return;
    }

    setError(null);
    setIsUploading(true);

    const outcomes = await Promise.allSettled(files.map(uploadOne));
    const succeeded = outcomes
      .filter((outcome): outcome is PromiseFulfilledResult<IngestionJob> => outcome.status === "fulfilled")
      .map((outcome) => outcome.value);
    const failures = outcomes
      .filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected")
      .map((outcome) => (outcome.reason instanceof Error ? outcome.reason.message : "Unable to upload document."));

    if (succeeded.length) {
      setJobs((current) => [...succeeded, ...current]);
    }
    if (failures.length) {
      setError(failures.join("; "));
    }
    setIsUploading(false);
  }

  function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = "";
    if (files.length) {
      void startUpload(files);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    const files = event.dataTransfer.files ? Array.from(event.dataTransfer.files) : [];
    if (files.length) {
      void startUpload(files);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr] items-start flex-1 min-h-0">
      
      {/* Left Column: Drag & Drop Ingestion */}
      <Card className="border border-slate-200 bg-white shadow-sm relative overflow-hidden rounded-lg">
        <CardHeader className="px-5 py-4 border-b border-slate-200 flex-row items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <UploadCloud className="size-4" />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Corpus Ingestion</p>
            </div>
            <CardTitle className="mt-1 text-base font-bold">Bring New Evidence into the Copilot</CardTitle>
          </div>
        </CardHeader>

        <CardContent className="px-5 py-5 flex flex-col gap-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary flex items-center gap-1.5">
              <Waypoints className="size-3.5" />
              Upload Workflow
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
              Upload source files to extract entities, update the graph, and index evidence for grounded answers.
            </p>
          </div>

          <div
            className={`grid place-items-center rounded-lg border border-dashed p-8 text-center transition-all duration-300 cursor-pointer ${
              isDragActive
                ? "border-primary bg-sky-50"
                : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100"
            }`}
            onDragLeave={() => setIsDragActive(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="rounded-lg bg-sky-50 p-3 border border-sky-100 mb-3">
              <UploadCloud className={`size-6 text-primary transition-all duration-300 ${isUploading ? "animate-bounce" : ""}`} />
            </div>
            
            <p className="text-xs font-bold text-slate-900 tracking-wide">
              Drag &amp; drop files or click to browse
            </p>
            <p className="mt-1 text-[10px] text-slate-500 max-w-xs leading-relaxed">
              Supports PDFs, P&amp;ID diagrams, vibration CSVs, emails, or logs.
            </p>
            <input
              accept={ACCEPTED_EXTENSIONS}
              className="hidden"
              multiple
              onChange={handleFileInput}
              ref={fileInputRef}
              type="file"
            />
            <Button
              className="mt-4 rounded-lg px-4 py-1.5 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/95 transition-all duration-200 cursor-pointer shadow-sm"
              disabled={isUploading}
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              type="button"
            >
              {isUploading ? "Uploading..." : "Select Files"}
            </Button>
          </div>

          {error ? (
            <Alert className="border-destructive/30 bg-destructive/10 text-destructive-foreground" variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle className="text-sm font-bold">Ingestion Error</AlertTitle>
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* Right Column: Live Jobs Tracker */}
      <div className="flex flex-col gap-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Live Ingestion Tracker</p>
        {jobs.length ? (
          <div className="grid gap-4 max-h-[calc(100vh-260px)] lg:max-h-[calc(100vh-280px)] overflow-y-auto pr-1 scrollbar-thin">
            {jobs.map((job) => (
              <JobCard job={job} key={job.job_id} onAskAbout={onAskAbout} onExploreGraph={onExploreGraph} />
            ))}
          </div>
        ) : (
          <Card className="border-dashed border-slate-200 bg-slate-50/50 shadow-none rounded-lg">
            <CardContent className="px-5 py-12 text-xs text-slate-500 text-center">
              No active ingestion jobs. Upload source material on the left to add it to the searchable corpus.
            </CardContent>
          </Card>
        )}
      </div>

    </div>
  );
}

type JobCardProps = {
  job: IngestionJob;
  onExploreGraph: (equipmentTag: string) => void;
  onAskAbout: (documentName: string) => void;
};

function JobCard({ job, onExploreGraph, onAskAbout }: JobCardProps) {
  const completedStages = job.stages.filter((stage) => stage.status === "completed").length;
  const totalStages = job.stages.length || 5;
  const progressValue = Math.round((completedStages / totalStages) * 100);

  return (
    <Card className="border border-slate-200 bg-white shadow-sm overflow-hidden transition-all duration-300 hover:border-slate-300 rounded-lg">
      <CardHeader className="flex-row items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-slate-50">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-primary">Live Ingestion Job</p>
          <CardTitle className="mt-1 text-base font-bold truncate max-w-xs sm:max-w-md">{job.filename}</CardTitle>
        </div>
        <Badge
          variant={job.status === "failed" ? "destructive" : job.status === "completed" ? "default" : "secondary"}
          className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
            job.status === "completed" ? "bg-emerald-50 text-emerald-700 border border-emerald-250" : ""
          }`}
        >
          {job.status}
        </Badge>
      </CardHeader>

      <CardContent className="px-5 py-5">
        <div className="flex items-center justify-between gap-3 mb-2 text-[10px] font-bold text-slate-500 tracking-wider uppercase">
          <span>Pipeline Progress ({completedStages}/{totalStages} Stages)</span>
          <span className="font-mono text-primary font-bold text-xs">{progressValue}%</span>
        </div>
        <Progress className="h-2 bg-slate-100" value={progressValue} />

        {/* 5-Stage Stepper */}
        <div className="mt-6 relative border-l border-slate-200 pl-6 ml-2.5 space-y-5">
          {job.stages.map((stage) => (
            <div key={stage.key} className="relative group">
              <div className="absolute -left-[32.5px] top-0.5 bg-background rounded-full p-1 ring-2 ring-background">
                {stageIcon(stage.status)}
              </div>
              <div className="min-w-0">
                <p
                  className={`text-xs font-bold tracking-wide transition-all ${
                    stage.status === "pending"
                      ? "text-slate-400"
                      : stage.status === "running"
                        ? "text-primary font-black animate-pulse"
                        : "text-slate-800"
                  }`}
                >
                  {stage.label}
                </p>
                {stage.detail ? (
                  <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500 font-mono">{stage.detail}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {job.status === "failed" ? (
          <Alert className="mt-5 border-destructive/30 bg-destructive/10 text-destructive-foreground" variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle className="text-sm font-bold">Pipeline Failed</AlertTitle>
            <AlertDescription className="text-xs">{job.error}</AlertDescription>
          </Alert>
        ) : null}

        {job.status === "completed" && job.result ? (
          <div className="mt-6 pt-4 border-t border-slate-200">
            <div className="grid grid-cols-3 gap-3.5 text-center">
              <div className="rounded-lg border border-sky-100 bg-sky-50 p-3 shadow-sm hover:border-sky-200 transition-all">
                <p className="text-xl font-bold text-primary">{job.result.entities_extracted}</p>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Entities Extracted</p>
              </div>
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 shadow-sm hover:border-blue-200 transition-all">
                <p className="text-xl font-bold text-accent">{job.result.relations_extracted}</p>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Graph Relations</p>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 shadow-sm hover:border-emerald-200 transition-all">
                <p className="text-xl font-bold text-success">{job.result.chunks_indexed}</p>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Vector Chunks</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {Object.entries(job.result.entity_type_counts).map(([type, count]) => (
                <Badge key={type} variant="outline" className="rounded-full text-[10px] border-slate-200 font-semibold px-2.5 py-0.5 bg-slate-50 text-slate-600">
                  {type} &middot; {count}
                </Badge>
              ))}
            </div>

            {job.result.equipment_tags.length ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Resolved Equipment Tags:
                </span>
                {job.result.equipment_tags.map((tag) => (
                  <Badge className="bg-sky-50 text-sky-700 border border-sky-250 rounded-full font-bold px-3 py-0.5 text-[10px]" key={tag}>
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-3">
              {job.result.equipment_tags[0] ? (
                <Button
                  onClick={() => onExploreGraph(job.result!.equipment_tags[0])}
                  size="sm"
                  className="rounded-lg px-5 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/95 transition-all shadow-sm"
                >
                  <Waypoints className="size-3.5 mr-1.5" />
                  Explore This Equipment Graph
                </Button>
              ) : null}
              <Button
                onClick={() => onAskAbout(job.result!.document_name)}
                size="sm"
                variant="outline"
                className="rounded-lg px-5 text-xs font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all"
              >
                Ask Copilot About This Document
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
