"""The /events upgrade gate must FAIL CLOSED.

Raised in review of the catalog PR (NousResearch/hermes-agent#127990): the
try/except around the auth step wrapped the gate call itself, so a gate that
raised fell back to "accept if the client looks like loopback". Behind a loopback
reverse proxy every client looks like 127.0.0.1, so a gated dashboard would have
served board snapshots — task titles and bodies — without authentication.

Only the IMPORT may fall back; the gate itself is the decision.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

# The plugin backend lives in dashboard/; import it the way the gateway does.
PLUGIN_DIR = Path(__file__).resolve().parent.parent / "dashboard"
sys.path.insert(0, str(PLUGIN_DIR))

import plugin_ws  # noqa: E402


class FakeWS:
    """Just enough of a WebSocket for ``authorize()``: params, headers, client."""

    def __init__(self, *, host: str = "127.0.0.1", query=None, headers=None):
        self.query_params = query or {}
        self.headers = headers or {}
        self.client = types.SimpleNamespace(host=host)


def _core_with(gate):
    """A stand-in ``hermes_cli.web_server_chat`` whose gate is ``gate``."""
    mod = types.ModuleType("hermes_cli.web_server_chat")
    mod._ws_auth_ok = gate
    return mod


@pytest.fixture(autouse=True)
def no_env_token(monkeypatch):
    """The explicit token rule outranks the gate; keep it out of the way here."""
    monkeypatch.delenv(plugin_ws.WS_TOKEN_ENV, raising=False)


def test_a_gate_that_raises_refuses_even_a_loopback_client(monkeypatch):
    """The regression: this used to answer (True, 'loopback') from 127.0.0.1."""
    def boom(_ws):
        raise RuntimeError("gate exploded")

    monkeypatch.setitem(sys.modules, "hermes_cli.web_server_chat", _core_with(boom))
    assert plugin_ws.authorize(FakeWS(host="127.0.0.1")) == (False, "core_error")


def test_the_gate_decides_when_it_answers(monkeypatch):
    monkeypatch.setitem(sys.modules, "hermes_cli.web_server_chat", _core_with(lambda _ws: True))
    assert plugin_ws.authorize(FakeWS()) == (True, "core_gate")

    monkeypatch.setitem(sys.modules, "hermes_cli.web_server_chat", _core_with(lambda _ws: False))
    assert plugin_ws.authorize(FakeWS()) == (False, "core_reject")


def test_without_the_core_only_loopback_is_accepted(monkeypatch):
    """The import fallback stays narrow: loopback in, everyone else out."""
    monkeypatch.setitem(sys.modules, "hermes_cli.web_server_chat", None)  # import fails
    assert plugin_ws.authorize(FakeWS(host="127.0.0.1")) == (True, "loopback")
    assert plugin_ws.authorize(FakeWS(host="10.0.0.7")) == (False, "no_gate")


def test_the_explicit_env_token_wins_over_the_gate(monkeypatch):
    monkeypatch.setenv(plugin_ws.WS_TOKEN_ENV, "s3cret")
    monkeypatch.setitem(sys.modules, "hermes_cli.web_server_chat", _core_with(lambda _ws: True))
    assert plugin_ws.authorize(FakeWS(query={"token": "s3cret"})) == (True, "env_token")
    assert plugin_ws.authorize(FakeWS(query={"token": "wrong"})) == (False, "env_token_mismatch")
    assert plugin_ws.authorize(FakeWS()) == (False, "env_token_mismatch")
