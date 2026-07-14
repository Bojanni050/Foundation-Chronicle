import sys
import os
import logging
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

from chronicle_memory_provider import ChronicleMemoryProvider
from run_agent import AIAgent

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] [Gaia] %(message)s")
logger = logging.getLogger(__name__)

# Globale instantiaties
provider = None
agent = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global provider, agent
    logger.info("Starting Hermes Agent (Gaia) subprocess...")
    
    # Initialiseer de Chronicle Memory Provider voor Hermes
    provider = ChronicleMemoryProvider()
    provider.initialize(session_id="gaia_session_init", platform="chronicle")
    
    # Initialiseer de werkelijke Hermes agent
    # Hermes auto-detecteert OpenRouter via OPENROUTER_API_KEY en zet de base_url zelf.
    # OpenRouter verwacht het model ZONDER 'openrouter/' prefix — die strippen we hier.
    agent_model = os.getenv("HERMES_MODEL", "deepseek/deepseek-chat")
    if agent_model.startswith("openrouter/"):
        agent_model = agent_model[len("openrouter/"):]
    logger.info(f"Initializing Hermes with model: {agent_model}")
    agent = AIAgent(
        model=agent_model,
        quiet_mode=True
    )
    
    # TODO: Registreer de provider bij de agent.
    # Bijv. agent.memory_providers.append(provider) of agent.register_provider(provider)
    
    logger.info("Hermes Agent is running via FastAPI on port 4579...")
    yield # Hier draait de server
    
    logger.info("Hermes Agent is stopping...")
    if provider:
        provider.shutdown()
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


@app.post("/chat")
def chat_endpoint(request: ChatRequest):
    """
    Synchrone endpoint (draait in FastAPI threadpool) om Hermes een bericht te sturen.
    """
    logger.info(f"Received message for Gaia: {request.message}")
    if not agent:
        raise HTTPException(status_code=500, detail="Agent is not initialized")

    history = normalize_conversation_history(request.history)
    if history is not None:
        logger.info("Passing %s historical message(s) to Hermes agent", len(history))

    try:
        result = agent.run_conversation(
            user_message=request.message,
            task_id=request.task_id,
            conversation_history=history,
        )
        return {
            "success": True,
            "response": result.get("final_response"),
            "messages_count": len(result.get("messages", []))
        }
    except Exception as e:
        logger.error(f"Error during agent execution: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    # Zorg dat standard output/error direct geflushed worden
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
    
    uvicorn.run("gaia_server:app", host="127.0.0.1", port=4579, log_level="info")
