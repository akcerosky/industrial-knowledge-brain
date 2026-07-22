from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Optional

from backend.graph.schema import schema_statements


@dataclass
class NodeRecord:
    label: str
    key: str
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RelationshipRecord:
    from_label: str
    from_key: str
    rel_type: str
    to_label: str
    to_key: str
    properties_signature: tuple[tuple[str, str], ...]


class GraphStore:
    def ensure_schema(self) -> None:
        raise NotImplementedError

    def merge_node(self, label: str, key: str, properties: dict[str, Any]) -> None:
        raise NotImplementedError

    def get_node(self, label: str, key: str) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def find_nodes(self, label: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    def merge_relationship(
        self,
        from_label: str,
        from_key: str,
        rel_type: str,
        to_label: str,
        to_key: str,
        properties: dict[str, Any] | None = None,
    ) -> None:
        raise NotImplementedError

    def relationship_count(self) -> int:
        raise NotImplementedError

    def query_equipment_context(self, tag: str) -> dict[str, list[dict[str, Any]]]:
        raise NotImplementedError

    def query_node_neighborhood(self, label: str, key: str) -> Optional[dict[str, Any]]:
        raise NotImplementedError


class InMemoryGraphStore(GraphStore):
    def __init__(self) -> None:
        self.nodes: dict[str, dict[str, NodeRecord]] = defaultdict(dict)
        self.relationships: set[RelationshipRecord] = set()
        self.applied_schema: list[str] = []

    def ensure_schema(self) -> None:
        self.applied_schema = schema_statements()

    def merge_node(self, label: str, key: str, properties: dict[str, Any]) -> None:
        existing = self.nodes[label].get(key)
        if existing is None:
            self.nodes[label][key] = NodeRecord(label=label, key=key, properties=dict(properties))
            return

        merged = dict(existing.properties)
        for prop_key, prop_value in properties.items():
            if prop_key == "aliases":
                merged[prop_key] = sorted(set(merged.get(prop_key, [])) | set(prop_value))
            else:
                merged[prop_key] = prop_value
        existing.properties = merged

    def get_node(self, label: str, key: str) -> Optional[dict[str, Any]]:
        record = self.nodes.get(label, {}).get(key)
        return dict(record.properties) if record else None

    def find_nodes(self, label: str) -> list[dict[str, Any]]:
        return [dict(record.properties) for record in self.nodes.get(label, {}).values()]

    def merge_relationship(
        self,
        from_label: str,
        from_key: str,
        rel_type: str,
        to_label: str,
        to_key: str,
        properties: dict[str, Any] | None = None,
    ) -> None:
        normalized_props = tuple(sorted((properties or {}).items()))
        self.relationships.add(
            RelationshipRecord(
                from_label=from_label,
                from_key=from_key,
                rel_type=rel_type,
                to_label=to_label,
                to_key=to_key,
                properties_signature=normalized_props,
            )
        )

    def relationship_count(self) -> int:
        return len(self.relationships)

    def query_equipment_context(self, tag: str) -> dict[str, list[dict[str, Any]]]:
        equipment = self.get_node("Equipment", tag)
        if not equipment:
            return {"equipment": [], "documents": [], "inspection_events": [], "procedures": [], "regulatory_refs": []}

        documents: dict[str, dict[str, Any]] = {}
        inspection_events: dict[str, dict[str, Any]] = {}
        procedures: dict[str, dict[str, Any]] = {}
        regulatory_refs: dict[str, dict[str, Any]] = {}

        for rel in self.relationships:
            if rel.from_label == "Equipment" and rel.from_key == tag and rel.rel_type == "REFERENCED_IN" and rel.to_label == "Document":
                node = self.get_node("Document", rel.to_key)
                if node:
                    documents[rel.to_key] = node
            if rel.from_label == "InspectionEvent" and rel.rel_type == "PART_OF" and rel.to_label == "Equipment" and rel.to_key == tag:
                node = self.get_node("InspectionEvent", rel.from_key)
                if node:
                    inspection_events[rel.from_key] = node
            if rel.from_label == "Equipment" and rel.from_key == tag and rel.rel_type == "GOVERNED_BY" and rel.to_label == "RegulatoryRef":
                node = self.get_node("RegulatoryRef", rel.to_key)
                if node:
                    regulatory_refs[rel.to_key] = node

        for rel in self.relationships:
            if rel.from_label == "Procedure" and rel.rel_type == "REFERENCED_IN" and rel.to_label == "Document" and rel.to_key in documents:
                node = self.get_node("Procedure", rel.from_key)
                if node:
                    procedures[rel.from_key] = node
            if (
                rel.from_label == "InspectionEvent"
                and rel.rel_type == "GOVERNED_BY"
                and rel.to_label == "RegulatoryRef"
                and rel.from_key in inspection_events
            ):
                node = self.get_node("RegulatoryRef", rel.to_key)
                if node:
                    regulatory_refs[rel.to_key] = node

        return {
            "equipment": [equipment],
            "documents": list(documents.values()),
            "inspection_events": list(inspection_events.values()),
            "procedures": list(procedures.values()),
            "regulatory_refs": list(regulatory_refs.values()),
        }

    def query_node_neighborhood(self, label: str, key: str) -> Optional[dict[str, Any]]:
        node = self.get_node(label, key)
        if not node:
            return None

        neighbors: list[dict[str, Any]] = []
        for rel in self.relationships:
            if rel.from_label == label and rel.from_key == key:
                neighbor_props = self.get_node(rel.to_label, rel.to_key)
                if neighbor_props:
                    neighbors.append(
                        {
                            "label": rel.to_label,
                            "key": rel.to_key,
                            "properties": neighbor_props,
                            "rel_type": rel.rel_type,
                            "direction": "out",
                        }
                    )
            if rel.to_label == label and rel.to_key == key:
                neighbor_props = self.get_node(rel.from_label, rel.from_key)
                if neighbor_props:
                    neighbors.append(
                        {
                            "label": rel.from_label,
                            "key": rel.from_key,
                            "properties": neighbor_props,
                            "rel_type": rel.rel_type,
                            "direction": "in",
                        }
                    )

        return {"label": label, "key": key, "properties": node, "neighbors": neighbors}


class Neo4jGraphStore(GraphStore):
    def __init__(self, driver: Any) -> None:
        self.driver = driver

    def ensure_schema(self) -> None:
        with self.driver.session() as session:
            for statement in schema_statements():
                session.run(statement)

    def merge_node(self, label: str, key: str, properties: dict[str, Any]) -> None:
        property_assignments = ", ".join(f"n.{field} = ${field}" for field in properties)
        query = (
            f"MERGE (n:{label} {{{self._key_field(label)}: $merge_key}}) "
            f"SET {property_assignments}"
        )
        payload = dict(properties)
        payload["merge_key"] = key
        with self.driver.session() as session:
            session.run(query, payload)

    def get_node(self, label: str, key: str) -> Optional[dict[str, Any]]:
        query = f"MATCH (n:{label} {{{self._key_field(label)}: $merge_key}}) RETURN properties(n) AS props LIMIT 1"
        with self.driver.session() as session:
            record = session.run(query, {"merge_key": key}).single()
        return dict(record["props"]) if record else None

    def find_nodes(self, label: str) -> list[dict[str, Any]]:
        with self.driver.session() as session:
            records = session.run(f"MATCH (n:{label}) RETURN properties(n) AS props")
            return [dict(record["props"]) for record in records]

    def merge_relationship(
        self,
        from_label: str,
        from_key: str,
        rel_type: str,
        to_label: str,
        to_key: str,
        properties: dict[str, Any] | None = None,
    ) -> None:
        property_assignments = ""
        if properties:
            property_assignments = " SET r += $props"
        query = (
            f"MATCH (a:{from_label} {{{self._key_field(from_label)}: $from_key}}) "
            f"MATCH (b:{to_label} {{{self._key_field(to_label)}: $to_key}}) "
            f"MERGE (a)-[r:{rel_type}]->(b)"
            f"{property_assignments}"
        )
        with self.driver.session() as session:
            session.run(query, {"from_key": from_key, "to_key": to_key, "props": properties or {}})

    def relationship_count(self) -> int:
        with self.driver.session() as session:
            record = session.run("MATCH ()-[r]->() RETURN count(r) AS count").single()
        return int(record["count"]) if record else 0

    def query_equipment_context(self, tag: str) -> dict[str, list[dict[str, Any]]]:
        query = """
        MATCH (e:Equipment {tag: $tag})
        OPTIONAL MATCH (e)-[:REFERENCED_IN]->(d:Document)
        OPTIONAL MATCH (ev:InspectionEvent)-[:PART_OF]->(e)
        OPTIONAL MATCH (p:Procedure)-[:REFERENCED_IN]->(d)
        OPTIONAL MATCH (ev)-[:GOVERNED_BY]->(g:RegulatoryRef)
        RETURN
            collect(DISTINCT properties(e)) AS equipment,
            collect(DISTINCT properties(d)) AS documents,
            collect(DISTINCT properties(ev)) AS inspection_events,
            collect(DISTINCT properties(p)) AS procedures,
            collect(DISTINCT properties(g)) AS regulatory_refs
        """
        with self.driver.session() as session:
            record = session.run(query, {"tag": tag}).single()
        if not record:
            return {"equipment": [], "documents": [], "inspection_events": [], "procedures": [], "regulatory_refs": []}
        return {key: [item for item in record[key] if item] for key in record.keys()}

    def query_node_neighborhood(self, label: str, key: str) -> Optional[dict[str, Any]]:
        query = f"""
        MATCH (n:{label} {{{self._key_field(label)}: $key}})
        OPTIONAL MATCH (n)-[r]-(m)
        RETURN
            properties(n) AS node_props,
            collect(CASE WHEN m IS NULL THEN NULL ELSE {{
                labels: labels(m),
                props: properties(m),
                rel_type: type(r),
                direction: CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END
            }} END) AS neighbors
        """
        with self.driver.session() as session:
            record = session.run(query, {"key": key}).single()
        if not record or not record["node_props"]:
            return None

        neighbors: list[dict[str, Any]] = []
        for item in record["neighbors"]:
            if not item:
                continue
            neighbor_label = item["labels"][0] if item["labels"] else "Unknown"
            try:
                neighbor_key_field = self._key_field(neighbor_label)
            except KeyError:
                neighbor_key_field = None
            neighbors.append(
                {
                    "label": neighbor_label,
                    "key": item["props"].get(neighbor_key_field) if neighbor_key_field else None,
                    "properties": dict(item["props"]),
                    "rel_type": item["rel_type"],
                    "direction": item["direction"],
                }
            )

        return {"label": label, "key": key, "properties": dict(record["node_props"]), "neighbors": neighbors}

    @staticmethod
    def _key_field(label: str) -> str:
        return {
            "Equipment": "tag",
            "Document": "document_id",
            "Person": "normalized_name",
            "Procedure": "normalized_name",
            "RegulatoryRef": "normalized_code",
            "InspectionEvent": "event_id",
            "Parameter": "entity_id",
            "Organization": "normalized_name",
            "Product": "normalized_name",
            "Concept": "normalized_name",
        }[label]
