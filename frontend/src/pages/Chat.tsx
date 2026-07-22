import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  BadgeCheck,
  Brain,
  Check,
  Copy,
  Cpu,
  ExternalLink,
  ListChecks,
  Radio,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Loader2,
} from "lucide-react";
import type { Citation, PendingAction, QueryResponse } from "../App";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";

type Message =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; response: QueryResponse };

type ChatPageProps = {
  assetContext?: string | null;
  onCitationSelect: (citation: Citation) => void;
  onResponse: (response: QueryResponse) => void;
  response: QueryResponse | null;
  seedQuestion?: { question: string; nonce: number } | null;
  runtimeSummary: {
    llmProvider: string;
    vectorBackend: string;
    graphBackend: string;
  };
};

const responseModes = [
  "Quick Answer",
  "Engineering Analysis",
  "Root Cause Analysis",
  "Compliance Review",
  "Maintenance Planning",
];

const quickQuestions = [
  {
    icon: <Radio className="size-3.5 text-primary" />,
    text: "Before starting Pump 101A, what should be verified and what recent maintenance concern exists?",
  },
  {
    icon: <Radio className="size-3.5 text-primary" />,
    text: "When was P-101A last inspected and what compliance flags were raised?",
  },
  {
    icon: <Sparkles className="size-3.5 text-success" />,
    text: "What governs lockout work on Feed Pump 101A?",
  },
];

function confidenceTone(confidence: number) {
  if (confidence >= 0.75) return "bg-success/15 text-success border-success/20";
  if (confidence >= 0.5) return "bg-warning/15 text-warning border-warning/20";
  return "bg-destructive/15 text-destructive border-destructive/20";
}

function confidenceBanner(confidence: number) {
  if (confidence >= 0.75) {
    return {
      title: "High confidence: sufficient corroborating evidence",
      icon: <BadgeCheck className="size-4 text-success" />,
      className: "border-success/25 bg-success/10 text-success",
    };
  }
  if (confidence >= 0.5) {
    return {
      title: "Medium confidence: partial evidence",
      icon: <ShieldCheck className="size-4 text-warning" />,
      className: "border-warning/25 bg-warning/10 text-warning",
    };
  }
  return {
    title: "Low confidence: answer requires operator verification",
    icon: <TriangleAlert className="size-4 text-destructive" />,
    className: "border-destructive/25 bg-destructive/10 text-destructive",
  };
}

function parseInlineStyles(text: string): ReactNode[] {
  const inlineParts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return inlineParts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index} className="font-extrabold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[11px] text-primary font-bold">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function renderMessageText(text: string) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, index) => {
    if (part.startsWith("```")) {
      const match = part.match(/```(\w*)\n([\s\S]*?)```/);
      const language = match ? match[1] : "";
      const code = match ? match[2] : part.slice(3, -3);
      return (
        <div key={index} className="my-3 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 font-mono text-xs shadow-sm">
          {language && (
            <div className="bg-slate-200 px-3 py-1.5 border-b border-slate-205 text-[9px] uppercase tracking-widest text-slate-705 font-black">
              {language}
            </div>
          )}
          <pre className="p-3.5 overflow-x-auto scrollbar-thin leading-relaxed text-slate-800">
            <code>{code}</code>
          </pre>
        </div>
      );
    }
    
    const lines = part.split("\n");
    return (
      <div key={index} className="space-y-2">
        {lines.map((line, lineIdx) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            const listContent = parseInlineStyles(trimmed.slice(2));
            return (
              <ul key={lineIdx} className="list-disc pl-5 my-1 text-xs sm:text-sm text-foreground/90 font-medium">
                <li>{listContent}</li>
              </ul>
            );
          }
          const numMatch = trimmed.match(/^(\d+)\.\s(.*)/);
          if (numMatch) {
            const listContent = parseInlineStyles(numMatch[2]);
            return (
              <ol key={lineIdx} className="list-decimal pl-5 my-1 text-xs sm:text-sm text-foreground/90 font-medium">
                <li>{listContent}</li>
              </ol>
            );
          }
          if (trimmed === "") {
            return <div key={lineIdx} className="h-1.5" />;
          }
          return (
            <p key={lineIdx} className="text-xs sm:text-sm leading-relaxed text-foreground/90 font-medium">
              {parseInlineStyles(line)}
            </p>
          );
        })}
      </div>
    );
  });
}

export function ChatPage({ assetContext, onCitationSelect, onResponse, response, seedQuestion, runtimeSummary }: ChatPageProps) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isGeneratingActions, setIsGeneratingActions] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);
  const [responseMode, setResponseMode] = useState("Engineering Analysis");

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!seedQuestion) {
      return;
    }
    setQuestion(seedQuestion.question);
    // Auto submit seed questions to make flow seamless
    void executeQuery(seedQuestion.question);
  }, [seedQuestion]);

  useEffect(() => {
    if (!response) {
      return;
    }
    setMessages((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last && last.role === "assistant" && last.response.answer === response.answer) {
        return current;
      }
      const newId = `assistant-${Date.now()}`;
      next.push({ id: newId, role: "assistant", response });
      return next;
    });
  }, [response]);

  async function executeQuery(queryText: string) {
    const trimmed = queryText.trim();
    if (!trimmed) {
      return;
    }

    setError(null);
    setIsLoading(true);
    setActionSuccessMessage(null);
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", text: trimmed }]);

    try {
      const composedQuestion = [
        `Mode: ${responseMode}.`,
        assetContext ? `Asset context: ${assetContext}.` : null,
        trimmed,
      ]
        .filter(Boolean)
        .join(" ");
      const apiResponse = await apiFetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: composedQuestion,
          top_k: 5,
          include_graph_context: true,
        }),
      });

      if (!apiResponse.ok) {
        throw new Error(`Query failed with status ${apiResponse.status}`);
      }

      const payload = (await apiResponse.json()) as QueryResponse;
      onResponse(payload);
      if (payload.citations[0]) {
        onCitationSelect(payload.citations[0]);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to reach the backend.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isLoading) return;
    const q = question;
    setQuestion("");
    await executeQuery(q);
  }

  function copyAnswer(id: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function generateActionsFor(responsePayload: QueryResponse) {
    const equipmentTag =
      responsePayload.graph_entities[0] ||
      responsePayload.entities.find((entity) => entity.entity_type === "Equipment")?.canonical_name;
    if (!equipmentTag) {
      setError("No equipment tag was detected for action generation.");
      return;
    }
    setError(null);
    setIsGeneratingActions(equipmentTag);
    setActionSuccessMessage(null);
    try {
      const apiResponse = await apiFetch("/api/actions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipment_tag: equipmentTag }),
      });
      if (!apiResponse.ok) {
        throw new Error(`Action generation failed with status ${apiResponse.status}`);
      }
      const payload = await apiResponse.json();
      const actionsCount = (payload.actions as PendingAction[]).length;
      setActionSuccessMessage(`Successfully generated ${actionsCount} review action(s) for ${equipmentTag}. Open Review Queue to approve or dismiss them.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to generate actions.");
    } finally {
      setIsGeneratingActions(null);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] border border-slate-200 bg-white rounded-2xl overflow-hidden shadow-sm">
      
      {/* Scrollable Chat Area */}
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-thin bg-slate-50/30"
      >
        <div className="max-w-4xl mx-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Operations Brain Command Bar</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">Set your operating context before asking the copilot.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {responseModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setResponseMode(mode)}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                    responseMode === mode
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { label: "Plant", value: "Primary Site" },
              { label: "Unit", value: assetContext ? "Asset-scoped" : "All Units" },
              { label: "Asset", value: assetContext || "Not pinned" },
              { label: "Collection", value: "Approved uploads" },
            ].map((chip) => (
              <span key={chip.label} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                <span className="font-bold text-slate-800">{chip.label}:</span> {chip.value}
              </span>
            ))}
          </div>
        </div>

        {messages.length === 0 ? (
          <div className="max-w-2xl mx-auto py-8 space-y-8 animate-fade-in">
            {/* Header Title */}
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-2xl text-primary mb-2 shadow-sm">
                <Brain className="size-8" />
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                Expert Knowledge Copilot
              </h2>
              <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed font-medium">
                Ask about startup checks, maintenance concerns, isolation steps, or compliance status. Fully grounded in your document corpus.
              </p>
            </div>

            {/* Prompt Chips */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Quick Questions</span>
              <div className="flex flex-col gap-2">
                {quickQuestions.map((item) => (
                  <button
                    key={item.text}
                    className="flex items-center gap-3 rounded-xl border border-slate-250 bg-white hover:bg-slate-50 hover:border-slate-350 p-3 text-xs font-bold text-slate-700 transition-all cursor-pointer shadow-sm text-left group"
                    onClick={() => setQuestion(item.text)}
                    type="button"
                  >
                    <span className="p-1.5 bg-slate-100 rounded-lg group-hover:bg-primary/10 transition-colors shrink-0">
                      {item.icon}
                    </span>
                    <span className="truncate">{item.text}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6 max-w-4xl mx-auto">
            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-tr-none bg-primary text-primary-foreground px-4.5 py-3 text-xs sm:text-sm font-semibold leading-relaxed shadow-sm">
                    {message.text}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="space-y-3">
                  <div className="flex items-center gap-2 text-slate-400 pl-1">
                    <Brain className="size-4 text-primary" />
                    <span className="text-[10px] font-extrabold uppercase tracking-wider">Copilot Response</span>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4 relative group">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] font-bold text-slate-550 uppercase tracking-wider">Grounded Response</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[10px] text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
                          onClick={() => copyAnswer(message.id, message.response.answer)}
                        >
                          {copiedId === message.id ? (
                            <Check className="size-3 text-success mr-1" />
                          ) : (
                            <Copy className="size-3 mr-1" />
                          )}
                          {copiedId === message.id ? "Copied" : "Copy"}
                        </Button>

                        <Badge className={`rounded-full font-bold px-2.5 py-0.5 text-[10px] tracking-wide border shadow-none ${confidenceTone(message.response.confidence)}`}>
                          {Math.round(message.response.confidence * 100)}% Confidence
                        </Badge>
                      </div>
                    </div>

                    {/* Factual Confidence Banner */}
                    <div className={`rounded-xl border px-3 py-2.5 text-xs font-semibold ${confidenceBanner(message.response.confidence).className}`}>
                      <div className="flex items-center gap-2">
                        {confidenceBanner(message.response.confidence).icon}
                        <span>{confidenceBanner(message.response.confidence).title}</span>
                      </div>
                    </div>

                    {/* Main Answer Body */}
                    <div className="space-y-2 text-slate-800 font-medium leading-relaxed">
                      {renderMessageText(message.response.answer)}
                    </div>

                    {/* Recommended Actions */}
                    {message.response.recommended_actions.length > 0 && (
                      <div className="rounded-xl border border-slate-250 bg-slate-50/30 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/50 pb-2">
                          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-550">
                            <ListChecks className="size-3.5 text-primary" />
                            Recommended Actions
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-lg border-slate-200 text-[11px] font-bold cursor-pointer h-7 hover:bg-slate-100"
                            disabled={isGeneratingActions !== null}
                            onClick={() => generateActionsFor(message.response)}
                            type="button"
                          >
                            {isGeneratingActions ? (
                              <span className="flex items-center gap-1">
                                <Loader2 className="size-3 animate-spin" /> Generating...
                              </span>
                            ) : "Generate Review Queue"}
                          </Button>
                        </div>
                        
                        <div className="mt-3 grid gap-2.5">
                          {message.response.recommended_actions.map((action, idx) => (
                            <div key={idx} className="rounded-lg border border-slate-200 bg-white p-3 space-y-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-bold text-slate-900">{action.title}</p>
                                <Badge className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase shadow-none border ${
                                  action.risk_level === "high" ? "border-red-200 bg-red-50 text-red-700" :
                                  action.risk_level === "medium" ? "border-amber-200 bg-amber-50 text-amber-700" :
                                  "border-emerald-200 bg-emerald-50 text-emerald-700"
                                }`}>
                                  {action.risk_level} risk
                                </Badge>
                              </div>
                              <p className="text-[12px] font-bold text-slate-700">{action.immediate_step}</p>
                              <p className="text-[11px] text-slate-500 font-medium leading-relaxed">{action.rationale}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Source Citations */}
                    <div className="grid gap-2 pt-2">
                      {message.response.citations.map((citation, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl border border-sky-100 bg-sky-50/50 p-3 hover:bg-sky-50 transition-colors"
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <button
                              className="text-left cursor-pointer flex-1"
                              onClick={() => onCitationSelect(citation)}
                              type="button"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-bold text-sky-850">
                                  {citation.document_name ?? citation.document_id}
                                </span>
                                <span className="font-mono text-[9px] bg-white border border-sky-200 px-1.5 py-0.5 rounded text-sky-700">
                                  {citation.locator}
                                </span>
                                <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-sky-700">
                                  {Math.round(citation.confidence * 100)}% match
                                </span>
                              </div>
                              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-655 font-medium">
                                "{citation.excerpt}"
                              </p>
                              {citation.relation_to_answer && (
                                <p className="mt-1 text-[10px] font-bold text-slate-500">
                                  Relation: {citation.relation_to_answer}
                                </p>
                              )}
                            </button>

                            {citation.source_url && (
                              <Button asChild size="sm" variant="outline" className="h-8 rounded-lg border-sky-250 bg-white text-[11px] font-bold text-sky-700 hover:bg-sky-100 shrink-0 self-end sm:self-start">
                                <a href={citation.source_url} rel="noreferrer" target="_blank">
                                  Open Source
                                  <ExternalLink className="ml-1 size-3" />
                                </a>
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {message.response.citations.length > 0 && (
                      <p className="text-[10px] text-slate-400 font-medium">
                        Click a citation to inspect the matching source in the evidence panel.
                      </p>
                    )}
                  </div>
                </div>
              )
            )}
            
            {/* Auto-scroll end point */}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Floating Status & Success Messages */}
      {actionSuccessMessage && (
        <div className="bg-emerald-50 border-y border-emerald-200 px-5 py-2.5 text-xs font-semibold text-emerald-800 flex items-center justify-between animate-fade-in shrink-0">
          <span>{actionSuccessMessage}</span>
          <button 
            onClick={() => setActionSuccessMessage(null)} 
            className="text-emerald-500 hover:text-emerald-850 font-bold ml-2 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading animation placeholder */}
      {isLoading && (
        <div className="bg-slate-50/50 border-t border-slate-100 px-5 py-3 text-xs font-bold text-slate-500 flex items-center gap-2 shrink-0 animate-pulse">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span>Synthesis engine is verifying facts and formulating grounded response...</span>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="border-t border-destructive/20 p-3 shrink-0 bg-red-50">
          <Alert className="border-destructive/30 bg-destructive/10 text-destructive-foreground shadow-none rounded-xl" variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle className="text-sm font-bold">Query Error</AlertTitle>
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Fixed Chat Input Area */}
      <div className="p-4 border-t border-slate-200 bg-white shrink-0">
        <form className="max-w-4xl mx-auto flex items-end gap-2.5 relative" onSubmit={handleSubmit}>
          <div className="relative flex-1">
            <Textarea
              className="min-h-11 max-h-36 w-full resize-none rounded-xl bg-slate-50 px-4 py-3 pr-14 text-sm leading-relaxed border border-slate-200 focus:border-primary focus:bg-white focus:outline-none transition-all duration-300 placeholder:text-slate-400"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit(e);
                }
              }}
              placeholder="Ask startup checks, isolation procedures, active maintenance issues, or tag relationships..."
              value={question}
              disabled={isLoading}
            />
            <div className="absolute right-2 bottom-1.5">
              <Button
                className="size-8 rounded-lg p-0 bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer shadow-sm flex items-center justify-center"
                disabled={isLoading || !question.trim()}
                type="submit"
                title="Send Message"
              >
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
        </form>
          <div className="max-w-4xl mx-auto flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mt-2 px-1 text-[10px] text-slate-400 font-semibold font-mono">
          <span className="flex items-center gap-1.5">
            <Cpu className="size-3 text-primary animate-pulse" />
            {responseMode} · {runtimeSummary.llmProvider} + {runtimeSummary.vectorBackend} + {runtimeSummary.graphBackend}
          </span>
          <span>Verified factual citations linked directly to sources</span>
        </div>
      </div>

    </div>
  );
}
