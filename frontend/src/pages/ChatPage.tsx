import { Panel } from "../components/Panel";

export function ChatPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <Panel title="Copilot" eyebrow="Query">
        <div className="grid gap-4">
          <textarea
            className="min-h-40 rounded-3xl border border-steel/15 bg-paper px-4 py-3 text-sm text-ink outline-none ring-0 placeholder:text-steel/60"
            placeholder="Ask about maintenance intervals, failure history, asset dependencies, or procedures..."
          />
          <div className="flex items-center justify-between">
            <p className="text-sm text-steel">Hybrid retrieval will route between graph context and chunk evidence.</p>
            <button className="rounded-full bg-signal px-4 py-2 text-sm font-semibold text-white">
              Run Query
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Answer Trace" eyebrow="Citations">
        <div className="grid gap-4">
          <div className="rounded-3xl bg-ink p-4 text-sm leading-7 text-paper">
            Pump P-101 requires seal inspection every 1,500 operating hours based on the current
            maintenance manual excerpt.
          </div>
          <div className="rounded-3xl border border-dashed border-steel/20 p-4 text-sm text-steel">
            Source: `doc-demo-manual`, page 12
          </div>
        </div>
      </Panel>
    </div>
  );
}

