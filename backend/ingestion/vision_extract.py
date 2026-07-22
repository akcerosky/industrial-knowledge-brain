from __future__ import annotations

import hashlib
import json

from backend.llm import get_llm_client
from backend.models.schema import ExtractionEntity, ExtractionRelation, ExtractionResult

_SYSTEM_PROMPT = (
    "You are a computer-vision extraction engine specialized in reading P&ID "
    "(Piping and Instrumentation Diagram) drawings. You will be given the raw SVG "
    "markup of a P&ID diagram. Even though it is textual markup, treat it as a "
    "description of a technical drawing: reason about the spatial layout (x/y "
    "coordinates, lines connecting shapes, labels near shapes) the same way you "
    "would visually inspect an image of the diagram, and infer which equipment "
    "tags are connected to which other equipment tags via the drawn lines.\n\n"
    "Extract:\n"
    "1. Every equipment tag visible in the drawing (e.g. P-101A, V-204, TK-12).\n"
    "2. Logical connections between equipment implied by lines/piping in the "
    "drawing (e.g. 'P-101A feeds V-204').\n"
    "3. Any other text annotations or labels visible in the drawing that are not "
    "equipment tags (e.g. dates, revision numbers, procedure names, parameters).\n\n"
    "Respond with JSON only, no prose, matching this schema exactly:\n"
    "{\n"
    '  "entities": [\n'
    '    {"id": "string", "type": "Equipment|Person|Date|RegulatoryRef|Procedure|Parameter", '
    '"value": "string", "source_span": "string"}\n'
    "  ],\n"
    '  "relations": [\n'
    '    {"from": "entity_id", "to": "entity_id", "type": '
    '"part_of|feeds|maintained_by|inspected_by|governed_by|performed_on", "evidence": "string"}\n'
    "  ]\n"
    "}\n"
    "Use the same string in `id` consistently to refer to the same entity across entities "
    "and relations. Only use entity ids that you defined in the `entities` list."
)


class PIDVisionExtractor:
    """Extracts structured entities/relations from a P&ID diagram file using the
    Gemini LLM.

    The current sample P&ID files are small hand-authored SVGs where every equipment
    tag and connector is already present as SVG markup (text elements, lines,
    coordinates). Rather than rasterizing to a PNG (which would require adding a new
    SVG-rendering dependency such as cairosvg), we send the raw SVG source as text
    and instruct the model to reason over the markup the way it would reason over a
    rendered image (coordinates, lines, nearby labels). This keeps the extractor
    dependency-free and testable offline, and means no vision-capable model is
    required — the same text LLM used everywhere else in the app handles this fine.
    """

    def __init__(self, client=None) -> None:
        self.client = client if client is not None else get_llm_client()

    def extract(self, file_bytes: bytes, filename: str = "diagram.svg") -> ExtractionResult:
        """Extract entities/relations from raw P&ID file bytes.

        Never raises: any failure (LLM unavailable, network error, malformed JSON,
        bad response) degrades to an empty ExtractionResult, matching the
        offline-safe behavior of every other LLM call site in this codebase.
        """
        try:
            if self.client is None:
                return ExtractionResult()

            svg_source = file_bytes.decode("utf-8", errors="ignore")
            if not svg_source.strip():
                return ExtractionResult()

            user_content = f"P&ID file: {filename}\n\nRaw SVG markup:\n{svg_source}"
            raw_text = self.client.complete(
                system=_SYSTEM_PROMPT,
                user=user_content,
                max_tokens=8192,
                json_mode=True,
                json_schema=ExtractionResult.model_json_schema(),
            )
            payload = json.loads(raw_text)
            result = ExtractionResult.model_validate(payload)
            return _namespace_result(result)
        except Exception:
            return ExtractionResult()


def _namespace_result(result: ExtractionResult) -> ExtractionResult:
    """Rewrite Gemini-supplied entity ids into stable, collision-free ids keyed by
    (type, value), mirroring `_stable_entity_id` in extract.py, so vision-derived
    entities merge cleanly by value with rule-based/text-LLM entities instead of
    colliding with whatever ad hoc ids Gemini invented."""

    id_map: dict[str, str] = {}
    entities: list[ExtractionEntity] = []
    for entity in result.entities:
        new_id = _stable_entity_id(entity.type, entity.value)
        id_map[entity.id] = new_id
        entities.append(entity.model_copy(update={"id": new_id}))

    relations: list[ExtractionRelation] = []
    for relation in result.relations:
        from_id = id_map.get(relation.from_entity, relation.from_entity)
        to_id = id_map.get(relation.to_entity, relation.to_entity)
        relations.append(relation.model_copy(update={"from_entity": from_id, "to_entity": to_id}))

    return ExtractionResult(entities=entities, relations=relations)


def _stable_entity_id(entity_type: str, value: str) -> str:
    digest = hashlib.sha1(f"{entity_type}:{value.strip()}".encode("utf-8")).hexdigest()[:10]
    return f"{entity_type.lower()}-{digest}"
