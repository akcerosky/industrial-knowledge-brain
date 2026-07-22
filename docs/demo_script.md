# Industrial Knowledge Brain — Live Demo Script (~100 seconds)

Stack running for real, no mocks: FastAPI backend at http://127.0.0.1:8000, frontend prod-preview
at http://localhost:4173, Neo4j graph, Postgres + pgvector, Gemini for extraction/embeddings/synthesis.

Setup before recording: app open at http://localhost:4173 on the **Ingest** tab (the default/first
tab). Have `docs/demo_upload_sample.md` visible in Finder/Explorer so it can be dragged in one motion.

---

## Step 1 — Upload a brand-new document (0:00–0:25)

**ACTION:** Drag `docs/demo_upload_sample.md` from the file browser onto the dashed drop zone on the
Ingest tab (or click "Choose file" and select it).

**SAY:** "This is a document the system has never seen — a tank inspection report, not the pump data
it already knows about. Watch it go through the real pipeline live."

**VIEWER SHOULD SEE:** The upload card switches to a processing card showing the filename and five
stages ticking from pending → running → completed in order: *Receive file*, *Load & OCR*, *Extract
entities & relations*, *Merge into knowledge graph*, *Chunk & index for retrieval*. The progress bar
fills as each completes. When done, a results summary appears with entity/relation/chunk counts and a
"Resolved equipment" badge reading `TK-77`.

**SAY (as stages tick):** "These are real pipeline stages — Gemini is extracting entities right now,
and this is landing in an actual Neo4j graph and Postgres vector index, not a canned progress bar."

---

## Step 2 — Jump into the graph (0:25–0:45)

**ACTION:** Click the **"Explore This Equipment Graph"** button that appears next to the results summary.

**SAY:** "And there it is — a brand-new equipment node just appeared in the graph, completely separate
from the existing pump cluster."

**VIEWER SHOULD SEE:** The app switches to the Graph Explorer tab, centered on `TK-77`. The equipment
tag box shows `TK-77`. The graph shows the `TK-77` node (primary color, largest circle) connected to
the new inspection report document, and edges toward a regulatory reference node (OSHA 29 CFR
1910.147) — visibly a different node cluster than the `P-101A` pump graph, using the same legend
(Equipment/Document/InspectionEvent/Procedure/RegulatoryRef colors).

---

## Step 3 — Ask a cross-document question (0:45–1:05)

**ACTION:** Switch to the **Copilot** tab. Clear/replace the textarea and type this question, then
click **Ask**:

> "What does OSHA 29 CFR 1910.147 require for lockout on Feed Pump 101A and on Tank 77, and does a
> documented isolation procedure already exist for both?"

**SAY:** "Now let's ask something that spans both the document I just uploaded and the original
sample corpus."

**VIEWER SHOULD SEE:** The answer stream renders a new assistant message with a **confidence badge**
(percentage, color-coded) in the top right of the card, a synthesized answer that should note the
existing LOTO procedure for `P-101A` (SOP-LOTO-4A-017) versus the noted gap for `TK-77` ("no prior
isolation procedure exists on file"), and a row of **citation chips** below the answer pulling from
both the old procedure doc and the newly uploaded report.

---

## Step 4 — Prove the citation is real (1:05–1:15)

**ACTION:** Click one of the citation chips referencing the new tank inspection report.

**SAY:** "Every citation is clickable, and it's not a snippet — it's the actual source document."

**VIEWER SHOULD SEE:** The Source Viewer panel in the right-hand column (already visible alongside
the chat) updates to show the real document name, type, and the raw markdown content of
`demo_upload_sample.md` loaded live from the backend, scrollable in a monospace preview pane.

---

## Step 5 — Generate and approve a proposal (1:15–1:35)

**ACTION:** Switch to the **System Diagnostics** tab. In the **Work Order & Compliance Hub** panel, click
**"Draft for TK-77"**.

**SAY:** "Now the system proposes what should happen next — but nothing happens automatically."

**VIEWER SHOULD SEE:** One or more proposal cards appear (e.g. a compliance-flag proposal about the
missing LOTO procedure for `TK-77`, or a work-order draft for the `V-512` packing repair), each with a
summary, supporting citations, and **Approve**/**Dismiss** buttons, status badge reading "pending."

**ACTION:** Click **Approve** on one card.

**SAY:** "I have to click Approve myself — nothing gets actioned, filed, or sent without a human in
the loop. That's deliberate: this system drafts and recommends, it never acts on its own."

**VIEWER SHOULD SEE:** The card's status badge flips to "approved" (green) and the Approve/Dismiss
buttons disable.

---

## Step 6 — Close (1:35–1:45)

**SAY:** "Everything you just saw ran on real infrastructure — a live Neo4j graph, real Postgres with
pgvector for retrieval, and Gemini doing the actual extraction and synthesis. No mocks, no canned
data — this is the working system."

**VIEWER SHOULD SEE:** Final frame can rest on the approved action card or the graph view, showing the
new `TK-77` node sitting alongside the original `P-101A` cluster in the same live knowledge graph.
