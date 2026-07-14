import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

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
