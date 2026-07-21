import { Panel } from "../components/Panel";

export function DocumentViewerPage() {
  return (
    <Panel title="Document Viewer" eyebrow="Source Evidence">
      <div className="grid gap-4 lg:grid-cols-[0.7fr_1.3fr]">
        <aside className="rounded-[1.5rem] bg-white p-4">
          <p className="text-sm font-semibold text-ink">Demo sources</p>
          <div className="mt-3 grid gap-2 text-sm text-steel">
            <button className="rounded-2xl bg-paper px-3 py-2 text-left">Maintenance Manual Rev C</button>
            <button className="rounded-2xl px-3 py-2 text-left hover:bg-paper">Inspection Checklist Scan</button>
            <button className="rounded-2xl px-3 py-2 text-left hover:bg-paper">Asset Register Q3</button>
          </div>
        </aside>
        <div className="rounded-[1.5rem] border border-steel/10 bg-paper p-5 text-sm leading-7 text-steel">
          Document previews, OCR overlays, page anchors, and highlighted evidence spans will live
          here so every generated answer can be audited quickly.
        </div>
      </div>
    </Panel>
  );
}

