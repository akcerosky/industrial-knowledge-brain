from __future__ import annotations

from dataclasses import dataclass


NODE_LABELS = [
    "Equipment",
    "Document",
    "Person",
    "Procedure",
    "RegulatoryRef",
    "InspectionEvent",
    "Parameter",
]

RELATIONSHIP_TYPES = [
    "PART_OF",
    "FEEDS",
    "MAINTAINED_BY",
    "INSPECTED_BY",
    "GOVERNED_BY",
    "REFERENCED_IN",
    "PERFORMED_BY",
]


@dataclass(frozen=True)
class ConstraintDefinition:
    name: str
    cypher: str


CONSTRAINTS = [
    ConstraintDefinition(
        name="equipment_tag_unique",
        cypher=(
            "CREATE CONSTRAINT equipment_tag_unique IF NOT EXISTS "
            "FOR (n:Equipment) REQUIRE n.tag IS UNIQUE"
        ),
    ),
    ConstraintDefinition(
        name="document_id_unique",
        cypher=(
            "CREATE CONSTRAINT document_id_unique IF NOT EXISTS "
            "FOR (n:Document) REQUIRE n.document_id IS UNIQUE"
        ),
    ),
    ConstraintDefinition(
        name="person_name_unique",
        cypher=(
            "CREATE CONSTRAINT person_name_unique IF NOT EXISTS "
            "FOR (n:Person) REQUIRE n.normalized_name IS UNIQUE"
        ),
    ),
    ConstraintDefinition(
        name="procedure_name_unique",
        cypher=(
            "CREATE CONSTRAINT procedure_name_unique IF NOT EXISTS "
            "FOR (n:Procedure) REQUIRE n.normalized_name IS UNIQUE"
        ),
    ),
    ConstraintDefinition(
        name="regulatory_code_unique",
        cypher=(
            "CREATE CONSTRAINT regulatory_code_unique IF NOT EXISTS "
            "FOR (n:RegulatoryRef) REQUIRE n.normalized_code IS UNIQUE"
        ),
    ),
    ConstraintDefinition(
        name="inspection_event_id_unique",
        cypher=(
            "CREATE CONSTRAINT inspection_event_id_unique IF NOT EXISTS "
            "FOR (n:InspectionEvent) REQUIRE n.event_id IS UNIQUE"
        ),
    ),
    ConstraintDefinition(
        name="parameter_value_unique",
        cypher=(
            "CREATE CONSTRAINT parameter_value_unique IF NOT EXISTS "
            "FOR (n:Parameter) REQUIRE n.entity_id IS UNIQUE"
        ),
    ),
]

INDEXES = [
    "CREATE INDEX equipment_normalized_tag IF NOT EXISTS FOR (n:Equipment) ON (n.normalized_tag)",
    "CREATE INDEX document_path IF NOT EXISTS FOR (n:Document) ON (n.path)",
    "CREATE INDEX inspection_event_date IF NOT EXISTS FOR (n:InspectionEvent) ON (n.event_date)",
]


def schema_statements() -> list[str]:
    return [constraint.cypher for constraint in CONSTRAINTS] + INDEXES
