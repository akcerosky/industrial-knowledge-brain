# Ontology

This file is the single source of truth for the knowledge graph contract. Keep it aligned with [backend/graph/schema.py](/Users/akash/Desktop/AI%20Hackathon/industrial-knowledge-brain/backend/graph/schema.py).

## Node Labels

### Equipment

Represents a tagged industrial asset or component.

Core properties:
- `entity_id`
- `tag`
- `normalized_tag`
- `display_name`
- `aliases`
- `source_span`

### Document

Represents a source file that can later be cited by the RAG layer.

Core properties:
- `document_id`
- `path`
- `title`
- `doc_type`
- `ingested_at`

### Person

Represents maintainers, inspectors, operators, or authors named in the source corpus.

Core properties:
- `entity_id`
- `name`
- `normalized_name`

### Procedure

Represents a named SOP, work method, or lockout/startup procedure.

Core properties:
- `entity_id`
- `name`
- `normalized_name`

### RegulatoryRef

Represents cited regulations, standards, or internal governance references.

Core properties:
- `entity_id`
- `code`
- `normalized_code`

### InspectionEvent

Represents an observation or dated inspection/maintenance event derived from a document.

Core properties:
- `event_id`
- `event_date`
- `event_type`
- `evidence`

### Parameter

Represents structured operating values or measured conditions.

Core properties:
- `entity_id`
- `value`
- `normalized_value`

## Relationship Types

### `PART_OF`

Equipment hierarchy or composition.

### `FEEDS`

Flow or process-direction relationship between equipment nodes.

### `MAINTAINED_BY`

Connects equipment or inspection events to the person responsible for maintenance work.

### `INSPECTED_BY`

Connects an inspection event to the person who performed it.

### `GOVERNED_BY`

Connects equipment, procedures, or inspection events to applicable regulatory references.

### `REFERENCED_IN`

Connects every extracted entity to the source document node. This edge powers downstream citation tracing.

### `PERFORMED_BY`

Connects procedures or events to the person who performed or authored the work.

## Resolution Rules

- `Equipment.tag` is the canonical merge key whenever a recognizable tag is present.
- `normalized_tag` strips case, whitespace, punctuation, and common label words such as `pump`, `valve`, and `tank`.
- Aliases such as `P-101A`, `Pump 101A`, and `Feed Pump 101A` must resolve to one Equipment node when they normalize to the same tag family.
- Every merge decision should be logged so demos can show why a new mention was linked to an existing node.

## Query Expectations

For a canonical equipment tag query such as `P-101A`, the graph should be able to traverse to:
- connected `Document` nodes for citations
- related `InspectionEvent` nodes from logs and reports
- linked `Procedure` nodes that govern startup or lockout steps
- governing `RegulatoryRef` nodes when procedures cite them
