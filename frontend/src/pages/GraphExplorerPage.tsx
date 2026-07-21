import { Panel } from "../components/Panel";

const nodes = [
  { label: "Pump P-101", type: "Asset" },
  { label: "Seal Inspection SOP", type: "Procedure" },
  { label: "Manual Rev C", type: "Document" },
  { label: "Unit 4A", type: "Location" },
];

export function GraphExplorerPage() {
  return (
    <Panel title="Graph Explorer" eyebrow="Knowledge Graph">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[1.5rem] bg-[linear-gradient(180deg,_rgba(48,66,84,0.06),_rgba(48,66,84,0.02))] p-5">
          <div className="grid gap-3">
            {nodes.map((node) => (
              <div
                key={node.label}
                className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm"
              >
                <span className="font-semibold text-ink">{node.label}</span>
                <span className="rounded-full bg-paper px-3 py-1 text-xs uppercase tracking-[0.2em] text-steel">
                  {node.type}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[1.5rem] border border-dashed border-steel/20 p-5 text-sm leading-7 text-steel">
          This view will evolve into an interactive graph that shows asset relationships, document
          provenance, and operational context expanded from the retrieval router.
        </div>
      </div>
    </Panel>
  );
}

