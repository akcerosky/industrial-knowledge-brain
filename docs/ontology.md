# Ontology

This document is the human-readable contract for the graph model. Keep it aligned with `backend/graph/schema.py`.

## Entity Types

### Asset

Industrial equipment or systems such as pumps, valves, motors, compressors, tanks, and pipelines.

Core fields:
- `entity_id`
- `canonical_name`
- `asset_tag`
- `asset_type`
- `location`
- `manufacturer`
- `confidence`

### Document

A source artifact that can be cited in answers.

Core fields:
- `document_id`
- `title`
- `document_type`
- `source_path`
- `revision`
- `created_at`

### Procedure

Operational or maintenance instructions extracted from manuals, SOPs, or work orders.

Core fields:
- `entity_id`
- `canonical_name`
- `procedure_type`
- `system`
- `confidence`

### Observation

Measured conditions, incidents, alarms, inspection results, or engineer notes.

Core fields:
- `entity_id`
- `canonical_name`
- `observed_at`
- `severity`
- `confidence`

### Person

Named individuals such as operators, maintainers, approvers, or subject matter experts.

Core fields:
- `entity_id`
- `canonical_name`
- `role`
- `team`
- `confidence`

### Location

Plants, units, lines, rooms, or geographic sites.

Core fields:
- `entity_id`
- `canonical_name`
- `site_code`
- `location_type`
- `confidence`

## Relationship Types

- `MENTIONS`
  Source document references an entity.
- `LOCATED_IN`
  Asset, procedure, or observation is tied to a location.
- `PART_OF`
  Asset hierarchy such as valve to skid or pump to unit.
- `RELATED_TO`
  Generic semantic association when a stronger edge type is not yet justified.
- `DESCRIBES_PROCEDURE`
  Document contains a procedure.
- `OBSERVED_ON`
  Observation applies to an asset or system.
- `AUTHORED_BY`
  Document or observation is linked to a person.

## Retrieval Notes

- Every retrieved chunk must retain `document_id`, page or cell provenance, and extraction confidence.
- Graph search should prioritize canonical entities first, then expand to directly linked procedures, observations, and source documents.
- Vector search should retrieve chunk-level evidence and then reconcile entity references against the graph.

