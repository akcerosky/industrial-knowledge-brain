"""Quality Management System (QMS) integration point.

There is no real QMS available in this hackathon context. This module defines the
pluggable connector interface a real QMS (e.g. SAP QM, IBM Maximo, Ellipse) would
implement, plus a `MockQMSConnector` that is clearly labeled as a demo/mock adapter.
It is never presented as a real integration.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional, Protocol
from uuid import uuid4

logger = logging.getLogger(__name__)


class QMSConnector(Protocol):
    """Interface a QMS connector must satisfy to plug into the approval workflow.

    A real implementation (SAP QM, IBM Maximo, Ellipse, etc.) would submit the
    approved work order to the external system and return its reference id.
    """

    def submit_work_order(self, action: dict[str, Any]) -> dict[str, Any]:
        ...


class MockQMSConnector:
    """Mock QMS connector for demo purposes.

    Swap for a real SAP QM / Maximo / Ellipse client by implementing the same
    QMSConnector interface. This connector does NOT talk to any real system - it
    only logs the payload it would send and returns a synthetic reference id so
    the rest of the application can demonstrate the integration point end-to-end.
    """

    def submit_work_order(self, action: dict[str, Any]) -> dict[str, Any]:
        qms_reference = f"QMS-MOCK-{uuid4().hex[:8].upper()}"
        submitted_at = datetime.now(timezone.utc).isoformat()
        logger.info(
            "[MOCK QMS] Would submit work order to external QMS. "
            "qms_reference=%s payload=%s",
            qms_reference,
            action,
        )
        return {
            "qms_reference": qms_reference,
            "status": "submitted",
            "submitted_at": submitted_at,
            "approval_step": "human_approved",
            "status_transition_audit": [
                {
                    "status": "approved",
                    "at": submitted_at,
                    "detail": "Human reviewer approved the work order draft in the copilot.",
                },
                {
                    "status": "submitted",
                    "at": submitted_at,
                    "detail": f"Mock QMS accepted the submission with reference {qms_reference}.",
                },
            ],
        }


def get_qms_connector(provider: Optional[str] = None) -> QMSConnector:
    """Resolve which QMS connector implementation to use.

    Mirrors the provider-selection pattern in backend/llm/client.py's
    `get_llm_client()`: precedence is explicit `provider` arg > `QMS_PROVIDER`
    env var. Today only the mock adapter exists, so this always returns
    `MockQMSConnector`, but call sites should never need to change when a real
    provider (e.g. "sap_qm", "maximo", "ellipse") is added here in the future.
    """

    provider = (provider or os.getenv("QMS_PROVIDER") or "mock").strip().lower()

    if provider in {"mock", ""}:
        return MockQMSConnector()

    # No real QMS provider is wired up yet - fall back to the mock rather than
    # failing the approval flow.
    logger.warning("Unknown QMS_PROVIDER=%r; falling back to MockQMSConnector.", provider)
    return MockQMSConnector()
