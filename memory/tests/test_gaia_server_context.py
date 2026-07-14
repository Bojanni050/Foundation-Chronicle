import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

import gaia_server
from gaia_server import normalize_conversation_history


def test_normalize_conversation_history_converts_frontend_messages_to_agent_messages():
    frontend_messages = [
        {"role": "user", "text": "hello"},
        {"role": "assistant", "text": "Hi there"},
    ]

    history = normalize_conversation_history(frontend_messages)

    assert history == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "Hi there"},
    ]


def test_chat_endpoint_streams_ndjson_chunks(monkeypatch):
    class FakeAgent:
        def run_conversation(self, user_message, system_message=None, conversation_history=None, task_id=None, stream_callback=None, **kwargs):
            stream_callback("Hello")
            stream_callback(" world")
            return {"final_response": "Hello world", "messages": []}

    monkeypatch.setattr(gaia_server, "agent", FakeAgent())
    client = TestClient(gaia_server.app)

    response = client.post("/chat", json={"message": "hi", "history": []})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")

    payloads = [json.loads(line) for line in response.text.splitlines() if line.strip()]
    assert payloads[0] == {"delta": "Hello"}
    assert payloads[1] == {"delta": " world"}
    assert payloads[2] == {"response": "Hello world"}
