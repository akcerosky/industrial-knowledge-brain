from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha1
from pathlib import Path
from threading import RLock
from typing import Any


class PendingActionManager:
    """Keeps human-reviewable proposed actions in memory and optionally on disk."""

    def __init__(self, storage_path: Path | None = None) -> None:
        self._actions: dict[str, dict[str, Any]] = {}
        self._storage_path = storage_path
        self._lock = RLock()
        self._load()

    def upsert_actions(self, actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
        with self._lock:
            for action in actions:
                action_id = stable_action_id(action["kind"], action["equipment_tag"], action["title"])
                existing = self._actions.get(action_id)
                if existing:
                    if existing["status"] == "pending":
                        existing.update(
                            {
                                "summary": action["summary"],
                                "details": action["details"],
                                "citations": action.get("citations", []),
                                "draft_text": action.get("draft_text"),
                                "updated_at": _utc_now(),
                            }
                        )
                    continue

                self._actions[action_id] = {
                    "action_id": action_id,
                    "kind": action["kind"],
                    "equipment_tag": action["equipment_tag"],
                    "title": action["title"],
                    "summary": action["summary"],
                    "details": action["details"],
                    "draft_text": action.get("draft_text"),
                    "citations": action.get("citations", []),
                    "status": "pending",
                    "created_at": _utc_now(),
                    "updated_at": _utc_now(),
                }
            self._persist_locked()
            return self._sorted_actions_locked()

    def list_actions(self) -> list[dict[str, Any]]:
        with self._lock:
            return self._sorted_actions_locked()

    def update_status(self, action_id: str, status: str) -> dict[str, Any]:
        with self._lock:
            if action_id not in self._actions:
                raise KeyError(action_id)
            if status not in {"approved", "dismissed"}:
                raise ValueError(status)
            self._actions[action_id]["status"] = status
            self._actions[action_id]["updated_at"] = _utc_now()
            self._persist_locked()
            return deepcopy(self._actions[action_id])

    def merge_details(self, action_id: str, extra: dict[str, Any]) -> dict[str, Any]:
        """Persist additional details onto a stored action (e.g. a QMS submission
        reference) so they survive future reads, not just the response of the call
        that triggered them."""
        with self._lock:
            if action_id not in self._actions:
                raise KeyError(action_id)
            self._actions[action_id]["details"] = {**self._actions[action_id].get("details", {}), **extra}
            self._actions[action_id]["updated_at"] = _utc_now()
            self._persist_locked()
            return deepcopy(self._actions[action_id])

    def _sorted_actions_locked(self) -> list[dict[str, Any]]:
        return sorted((deepcopy(action) for action in self._actions.values()), key=lambda item: item["created_at"], reverse=True)

    def _load(self) -> None:
        if not self._storage_path or not self._storage_path.exists():
            return
        try:
            payload = json.loads(self._storage_path.read_text())
        except (OSError, json.JSONDecodeError):
            return

        actions = payload.get("actions", [])
        if not isinstance(actions, list):
            return

        for action in actions:
            if not isinstance(action, dict) or "action_id" not in action:
                continue
            self._actions[str(action["action_id"])] = deepcopy(action)

    def _persist_locked(self) -> None:
        if not self._storage_path:
            return
        self._storage_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self._storage_path.with_suffix(f"{self._storage_path.suffix}.tmp")
        payload = {"actions": list(self._actions.values())}
        temp_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
        temp_path.replace(self._storage_path)


def stable_action_id(kind: str, equipment_tag: str, title: str) -> str:
    digest = sha1(f"{kind}:{equipment_tag}:{title}".encode("utf-8")).hexdigest()[:12]
    return f"action-{digest}"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
