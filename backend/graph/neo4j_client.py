from collections.abc import Iterable
from typing import Any

from neo4j import Driver


class GraphRepository:
    """Thin wrapper around the Neo4j driver for future merge operations."""

    def __init__(self, driver: Driver | None = None) -> None:
        self.driver = driver

    def merge_entities(self, entities: Iterable[dict[str, Any]]) -> int:
        return sum(1 for _ in entities)

