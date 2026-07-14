import sys
import os
import logging
import json
import queue
import shutil
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

# --------------------------------------------------------------------------
# Option B: Gaia gets its own dedicated HERMES_HOME, isolated from the
# user's personal Hermes CLI config/state/skills — must be set before any
# hermes_cli/agent/run_agent import, since several module-level call sites
# resolve HERMES_HOME eagerly. See docs/hermes-chronicle-integratie.md.
# --------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parent.parent
GAIA_HERMES_HOME = Path(os.environ.get("GAIA_HERMES_HOME", _REPO_ROOT / "server" / "data" / "gaia-hermes-home"))
os.environ["HERMES_HOME"] = str(GAIA_HERMES_HOME)
GAIA_HERMES_HOME.mkdir(parents=True, exist_ok=True)

# Sync the tracked plugin source (memory/chronicle_plugin/) into the runtime
# home's plugins/ directory — $HERMES_HOME is ephemeral/gitignored, so the
# actual plugin code lives in the repo and gets copied in fresh on every
# startup, the same way `hermes` itself expects a user-installed provider at
# $HERMES_HOME/plugins/<name>/ (see plugins/memory/__init__.py's own
# docstring: "User-installed providers: $HERMES_HOME/plugins/<name>/").
_PLUGIN_SRC = Path(__file__).resolve().parent / "chronicle_plugin"
_PLUGIN_DEST = GAIA_HERMES_HOME / "plugins" / "chronicle"
if _PLUGIN_SRC.is_dir():
    shutil.rmtree(_PLUGIN_DEST, ignore_errors=True)
    shutil.copytree(_PLUGIN_SRC, _PLUGIN_DEST)

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn

# Activates the plugin just synced above — memory.provider is the one config
# key that selects which external provider AIAgent's own init wires up
# automatically (agent/agent_init.py). Nothing else here needs to touch the
# provider directly; AIAgent constructs it, calls initialize()/prefetch()/
# sync_turn() on its own via agent._memory_manager (agent/memory_manager.py).
from hermes_cli.config import set_config_value
set_config_value("memory.provider", "chronicle")

from run_agent import AIAgent

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] [Gaia] %(message)s")
logger = logging.getLogger(__name__)

# Globale instantiatie
agent = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent
    logger.info("Starting Hermes Agent (Gaia) subprocess... (HERMES_HOME=%s)", GAIA_HERMES_HOME)

    # Initialiseer de werkelijke Hermes agent
    # Hermes auto-detecteert OpenRouter via OPENROUTER_API_KEY en zet de base_url zelf.
    # OpenRouter verwacht het model ZONDER 'openrouter/' prefix — die strippen we hier.
    agent_model = os.getenv("HERMES_MODEL", "deepseek/deepseek-chat")
    if agent_model.startswith("openrouter/"):
        agent_model = agent_model[len("openrouter/"):]
    logger.info(f"Initializing Hermes with model: {agent_model}")
    # session_id is intentionally omitted — AIAgent generates a real, unique
    # one itself (agent/agent_init.py) when none is passed, instead of the
    # constant "gaia_session_init" this used to hardcode for the (now
    # removed) manual provider pre-init. platform="chronicle" so the
    # Chronicle memory provider's initialize() sees an honest platform
    # value instead of the "cli" default.
    agent = AIAgent(
        model=agent_model,
        quiet_mode=True,
        platform="chronicle",
    )

    logger.info("Hermes Agent is running via FastAPI on port 4579...")
    yield # Hier draait de server

    logger.info("Hermes Agent is stopping...")
    memory_manager = getattr(agent, "_memory_manager", None)
    if memory_manager:
        memory_manager.shutdown_all()
    logger.info("Hermes Agent shut down cleanly.")

app = FastAPI(lifespan=lifespan)

class ChatRequest(BaseModel):
    message: str
    task_id: str = "default_task"
    history: Optional[List[Dict[str, Any]]] = None


def normalize_conversation_history(history: Optional[List[Dict[str, Any]]]) -> Optional[List[Dict[str, Any]]]:
    """Normalize the frontend's chat history into the shape the Hermes agent expects."""
    if not history:
        return None

    normalized: List[Dict[str, Any]] = []
    for item in history:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        if role not in {"user", "assistant", "system", "tool"}:
            continue
        if role == "user" and "text" in item and "content" not in item:
            normalized.append({"role": "user", "content": item.get("text", "")})
        elif role == "assistant" and "text" in item and "content" not in item:
            normalized.append({"role": "assistant", "content": item.get("text", "")})
        else:
            normalized.append({
                "role": role,
                "content": item.get("content") or item.get("text") or "",
            })
    return normalized or None


def _iter_agent_stream(request: ChatRequest):
    """Yield NDJSON chunks as the Hermes agent emits deltas and then a final response."""
    if not agent:
        raise RuntimeError("Agent is not initialized")

    history = normalize_conversation_history(request.history)
    if history is not None:
        logger.info("Passing %s historical message(s) to Hermes agent", len(history))

    event_queue: "queue.Queue[Optional[Dict[str, Any]] ]" = queue.Queue()
    finished = object()

    def _run_agent() -> None:
        try:
            result = agent.run_conversation(
                user_message=request.message,
                task_id=request.task_id,
                conversation_history=history,
                stream_callback=lambda delta: event_queue.put({"delta": delta}) if isinstance(delta, str) and delta else None,
            )
            final_response = result.get("final_response") if isinstance(result, dict) else None
            if final_response is None and isinstance(result, dict):
                final_response = result.get("response")
            if isinstance(final_response, str) and final_response:
                event_queue.put({"response": final_response})
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.error(f"Error during agent execution: {exc}", exc_info=True)
            event_queue.put({"error": str(exc)})
        finally:
            event_queue.put(finished)

    worker = threading.Thread(target=_run_agent, daemon=True)
    worker.start()

    while True:
        item = event_queue.get()
        if item is finished:
            break
        if isinstance(item, dict):
            yield json.dumps(item) + "\n"


@app.post("/chat")
def chat_endpoint(request: ChatRequest):
    """
    Stream NDJSON chunks to the frontend so the chat UI can render incrementally.
    """
    logger.info(f"Received message for Gaia: {request.message}")
    try:
        return StreamingResponse(
            _iter_agent_stream(request),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-cache"},
        )
    except Exception as e:
        logger.error(f"Error during agent execution: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    # Zorg dat standard output/error direct geflushed worden
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
    
    uvicorn.run("gaia_server:app", host="127.0.0.1", port=4579, log_level="info")
