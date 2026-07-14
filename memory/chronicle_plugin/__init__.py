"""Chronicle memory provider plugin for Hermes.

Tracked source of truth for the plugin — synced into
$HERMES_HOME/plugins/chronicle/ at Gaia server startup (see
memory/gaia_server.py), since $HERMES_HOME is ephemeral runtime state, not
something to author code inside. Activated via "memory: {provider: chronicle}"
in that HERMES_HOME's config.yaml.

Implements agent.memory_provider.MemoryProvider exactly (verified against the
installed package, not guessed — see docs/hermes-chronicle-integratie.md for
the design rationale). A thin HTTP client over Chronicle's existing
/api/memory REST API and /api/objects/import — no business logic (dedup,
embeddings, the no-auto-confirm rule) is duplicated here; all of that lives
in exactly one place, server/routes/memory.js, same discipline as
server/mcpServer.js.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

import requests

from agent.memory_provider import MemoryProvider

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "http://127.0.0.1:4577"
DEFAULT_TIMEOUT = 5.0

CHRONICLE_TOOL_SCHEMAS: List[Dict[str, Any]] = [
    {
        "name": "chronicle_recall",
        "description": (
            "Semantically search Chronicle's memory (hypotheses and confirmed facts together). "
            "Each result is labeled with its kind (hypothesis/fact), status, and confidence — an "
            "open, unverified hypothesis is not the same as a confirmed fact; weigh them accordingly."
        ),
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "What to recall."}},
            "required": ["query"],
        },
    },
    {
        "name": "chronicle_retain",
        "description": (
            "Save something worth remembering as a new, open hypothesis in Chronicle. This never "
            "creates a confirmed fact automatically — a human must review and explicitly confirm it "
            "later in the Chronicle app."
        ),
        "parameters": {
            "type": "object",
            "properties": {"statement": {"type": "string", "description": "The thing to remember, phrased neutrally."}},
            "required": ["statement"],
        },
    },
    {
        "name": "chronicle_reflect",
        "description": (
            "Show Chronicle's current state of belief: active (non-superseded) confirmed facts and "
            "open hypotheses awaiting review. This reads current state — it does not trigger new "
            "analysis; Chronicle's own reflection pipeline runs independently inside the Chronicle app."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "chronicle_timeline",
        "description": (
            "List recently captured observations (episodes) in chronological order — the raw, "
            "immutable provenance record Chronicle's hypotheses and facts are built from."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "since": {"type": "string", "description": "Optional ISO timestamp; only episodes captured after this."},
                "limit": {"type": "integer", "description": "Max episodes to return (default 20)."},
            },
            "required": [],
        },
    },
    {
        "name": "chronicle_hypothesize",
        "description": (
            "Propose a new, testable hypothesis in Chronicle — an explicitly uncertain claim, not a "
            "fact. Optionally state what would verify/confirm/reject it. Never auto-confirms; a human "
            "reviews it in the Chronicle app."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "hypothesis": {"type": "string", "description": "The claim, phrased neutrally."},
                "verification_criteria": {"type": "string", "description": "What would verify this."},
                "confirmation_criteria": {"type": "string", "description": "What would justify confirming this."},
                "rejection_criteria": {"type": "string", "description": "What would justify rejecting this."},
            },
            "required": ["hypothesis"],
        },
    },
]


def _tool_error(message: str) -> str:
    return json.dumps({"error": message})


class ChronicleMemoryProvider(MemoryProvider):
    """Bridges Hermes' memory-provider lifecycle to Chronicle's local API."""

    def __init__(self, base_url: Optional[str] = None):
        self._base_url = (base_url or os.environ.get("CHRONICLE_API_URL") or DEFAULT_BASE_URL).rstrip("/")
        self._session = requests.Session()
        self._token: Optional[str] = None
        self._session_id = ""
        # Accumulated since the last successful flush — cleared only on a
        # confirmed 2xx from Chronicle, so a transient outage never silently
        # drops a turn; it just retries on the next sync_turn/session_end.
        self._pending_turns: List[Dict[str, str]] = []

    @property
    def name(self) -> str:
        return "chronicle"

    def is_available(self) -> bool:
        # Local-only, no credentials required — opt OUT via env var rather
        # than opt in, matching Chronicle's own "off by default, one flag"
        # convention elsewhere. No network call here per the ABC contract
        # ("Should not make network calls"); reachability is checked in
        # initialize(), and every call degrades gracefully if it's down.
        return os.environ.get("CHRONICLE_MEMORY_DISABLED", "").strip().lower() not in {"1", "true", "yes"}

    def initialize(self, session_id: str, **kwargs) -> None:
        self._session_id = session_id or ""
        try:
            resp = self._session.get(f"{self._base_url}/api/settings/token", timeout=DEFAULT_TIMEOUT)
            resp.raise_for_status()
            self._token = resp.json().get("token")
            logger.info("Chronicle memory provider connected (session=%s)", self._session_id)
        except requests.RequestException as e:
            logger.warning(
                "Chronicle server unreachable at %s: %s — provider stays inactive this session",
                self._base_url, e,
            )
            self._token = None

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    def system_prompt_block(self) -> str:
        if not self._token:
            return ""
        return (
            "# Chronicle Memory\n"
            "Active. Relevant context is recalled automatically before each turn. Use "
            "chronicle_retain or chronicle_hypothesize to explicitly save something worth "
            "remembering, chronicle_reflect to see current confirmed facts and open hypotheses, "
            "chronicle_timeline for recent raw observations. Nothing saved here is ever "
            "auto-confirmed — a human reviews it in the Chronicle app."
        )

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        if not self._token or not query:
            return ""
        try:
            resp = self._session.get(
                f"{self._base_url}/api/memory/search",
                params={"q": query, "limit": 5},
                headers=self._headers(),
                timeout=DEFAULT_TIMEOUT,
            )
            resp.raise_for_status()
            results = resp.json().get("results", [])
        except requests.RequestException as e:
            logger.debug("Chronicle prefetch failed (non-fatal): %s", e)
            return ""
        if not results:
            return ""
        lines = ["# Chronicle Memory"]
        for r in results:
            label = "fact" if r.get("kind") == "fact" else f"hypothesis ({r.get('status', 'open')})"
            lines.append(f"- [{label}] {r.get('text', '')}")
        return "\n".join(lines)

    def sync_turn(
        self,
        user_content: str,
        assistant_content: str,
        *,
        session_id: str = "",
        messages: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        if not self._token:
            return
        self._pending_turns.append({"role": "user", "text": user_content or ""})
        self._pending_turns.append({"role": "assistant", "text": assistant_content or ""})
        self._flush_turns(session_id or self._session_id)

    def _flush_turns(self, session_id: str) -> None:
        """POST the accumulated session to Chronicle's inbox as one growing object.

        sourceProvider + a synthetic per-session url gives Chronicle's own
        providerConversationId derivation (server/providerConversationId.js)
        a stable identity, so repeated flushes of the SAME session update one
        Chronicle object instead of creating a new one per turn.
        """
        if not self._pending_turns:
            return
        content = "\n\n".join(f"{t['role']}: {t['text']}" for t in self._pending_turns if t["text"])
        if not content:
            return
        payload = {
            "title": f"Gaia session {session_id or 'unknown'}"[:120],
            "content": content,
            "sourceProvider": "hermes",
            "url": f"hermes-session://{session_id or 'unknown'}",
            "turns": self._pending_turns,
        }
        try:
            resp = self._session.post(
                f"{self._base_url}/api/objects/import",
                json=payload,
                headers=self._headers(),
                timeout=DEFAULT_TIMEOUT,
            )
            resp.raise_for_status()
        except requests.RequestException as e:
            logger.warning("Chronicle sync_turn failed, will retry next turn: %s", e)
            return
        # Only clear on confirmed success (see docstring).
        self._pending_turns = []

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        if not self._token:
            return []
        return list(CHRONICLE_TOOL_SCHEMAS)

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        if not self._token:
            return _tool_error("Chronicle server is not reachable.")
        try:
            if tool_name == "chronicle_recall":
                return self._recall(args)
            if tool_name == "chronicle_retain":
                return self._retain(args)
            if tool_name == "chronicle_reflect":
                return self._reflect(args)
            if tool_name == "chronicle_timeline":
                return self._timeline(args)
            if tool_name == "chronicle_hypothesize":
                return self._hypothesize(args)
            return _tool_error(f"Unknown Chronicle tool: {tool_name}")
        except requests.RequestException as e:
            logger.warning("Chronicle tool %s failed: %s", tool_name, e)
            return _tool_error(f"Chronicle request failed: {e}")

    def _recall(self, args: Dict[str, Any]) -> str:
        query = (args.get("query") or "").strip()
        if not query:
            return _tool_error("query required")
        resp = self._session.get(
            f"{self._base_url}/api/memory/search",
            params={"q": query, "limit": 10},
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        return json.dumps(resp.json())

    def _retain(self, args: Dict[str, Any]) -> str:
        statement = (args.get("statement") or "").strip()
        if not statement:
            return _tool_error("statement required")
        resp = self._session.post(
            f"{self._base_url}/api/memory/hypotheses",
            json={"hypothese": statement},
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        note = (
            " (matched an existing similar entry)"
            if data.get("matched")
            else " (saved as a new, open hypothesis — not yet confirmed)"
        )
        return json.dumps({"result": f"Retained{note}.", "hypothesis": data})

    def _reflect(self, args: Dict[str, Any]) -> str:
        facts_resp = self._session.get(
            f"{self._base_url}/api/memory/facts",
            params={"active": "true"},
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT,
        )
        facts_resp.raise_for_status()
        hyps_resp = self._session.get(
            f"{self._base_url}/api/memory/hypotheses",
            params={"status": "open"},
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT,
        )
        hyps_resp.raise_for_status()
        return json.dumps({"active_facts": facts_resp.json(), "open_hypotheses": hyps_resp.json()})

    def _timeline(self, args: Dict[str, Any]) -> str:
        params: Dict[str, Any] = {}
        if args.get("since"):
            params["since"] = args["since"]
        resp = self._session.get(
            f"{self._base_url}/api/memory/episodes",
            params=params,
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        episodes = resp.json()
        limit = args.get("limit") or 20
        return json.dumps({"episodes": episodes[-limit:]})

    def _hypothesize(self, args: Dict[str, Any]) -> str:
        hypothese = (args.get("hypothesis") or "").strip()
        if not hypothese:
            return _tool_error("hypothesis required")
        payload = {
            "hypothese": hypothese,
            "verificatieCriteria": args.get("verification_criteria"),
            "bevestigingsCriteria": args.get("confirmation_criteria"),
            "afwijzingsCriteria": args.get("rejection_criteria"),
        }
        resp = self._session.post(
            f"{self._base_url}/api/memory/hypotheses",
            json=payload,
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        return json.dumps(resp.json())

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        # Final safety flush. sync_turn already flushes after every turn, so
        # this normally has nothing pending — it only matters if a prior
        # flush failed (server briefly down) and no later turn retried it.
        self._flush_turns(self._session_id)

    def shutdown(self) -> None:
        self._session.close()


def register(ctx) -> None:
    """Plugin entry point — Hermes' plugin loader calls this."""
    ctx.register_memory_provider(ChronicleMemoryProvider())
