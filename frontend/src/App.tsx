import { useState } from "react";
import { GraphExplorerPage } from "./pages/GraphExplorerPage";
import { ChatPage } from "./pages/ChatPage";
import { DocumentViewerPage } from "./pages/DocumentViewerPage";

const tabs = ["Chat", "Graph Explorer", "Document Viewer"] as const;
type Tab = (typeof tabs)[number];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Chat");

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="grid gap-6 rounded-[2rem] border border-steel/10 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.18),_transparent_30%),linear-gradient(135deg,_#fffdf8,_#eef4f7)] p-6 shadow-[0_24px_80px_rgba(15,23,32,0.08)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-signal">
                Industrial Knowledge Brain
              </p>
              <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
                Citation-backed industrial memory for operations and engineering teams.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-steel">
                Blend document ingestion, OCR, graph reasoning, and vector retrieval into a
                single copilot experience that can trace every answer back to source evidence.
              </p>
            </div>
            <div className="grid gap-3 rounded-3xl bg-ink p-5 text-paper">
              <span className="text-xs uppercase tracking-[0.3em] text-paper/60">Stack lock</span>
              <span className="text-sm">FastAPI + Neo4j + Postgres/pgvector + Claude + React</span>
            </div>
          </div>
          <nav className="flex flex-wrap gap-3">
            {tabs.map((tab) => (
              <button
                key={tab}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  activeTab === tab
                    ? "bg-ink text-paper"
                    : "bg-white/70 text-steel hover:bg-white"
                }`}
                onClick={() => setActiveTab(tab)}
                type="button"
              >
                {tab}
              </button>
            ))}
          </nav>
        </header>

        <main className="mt-6 flex-1">
          {activeTab === "Chat" && <ChatPage />}
          {activeTab === "Graph Explorer" && <GraphExplorerPage />}
          {activeTab === "Document Viewer" && <DocumentViewerPage />}
        </main>
      </div>
    </div>
  );
}

