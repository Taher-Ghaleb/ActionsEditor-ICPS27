from __future__ import annotations

import json
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "actions-editor.sqlite"
HOST = "127.0.0.1"
PORT = 8787


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ratings (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
              feedback TEXT,
              source TEXT NOT NULL DEFAULT 'actions-editor',
              created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


def insert_rating(rating: int, feedback: str | None) -> int:
    created_at = datetime.now(timezone.utc).isoformat()
    normalized_feedback = (feedback or "").strip()

    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            """
            INSERT INTO ratings (rating, feedback, created_at)
            VALUES (?, ?, ?)
            """,
            (rating, normalized_feedback or None, created_at),
        )
        conn.commit()
        return int(cursor.lastrowid)


# ============================================================
# AI proxy — stateless "bring your own key" forwarding
# ============================================================
#
# POST /api/ai/chat forwards a single chat-completion request to
# whatever OpenAI-compatible endpoint the caller names (OpenAI
# itself, or any compatible self-hosted/third-party server) using
# the caller's own API key, and returns the reply. Nothing about
# the request — the key, the messages, the model, the response —
# is written to disk, logged, or stored in the database above.
# This exists only because a handful of providers (OpenAI among
# them) don't support calling their API directly from a browser.
# Do not add logging of
# request bodies to this code path — that would defeat the point.

ALLOWED_BASE_URL_PREFIXES = ("https://", "http://127.0.0.1", "http://localhost")


class ProxyValidationError(Exception):
    pass


def build_forward_request(payload: dict) -> tuple[str, dict, bytes]:
    """Pure, side-effect-free: turns the client's payload into the
    (url, headers, body) to forward. Raises ProxyValidationError on
    anything malformed so the caller can return a 400."""
    base_url = str(payload.get("baseUrl") or "").rstrip("/")
    api_key = payload.get("apiKey") or ""
    model = payload.get("model") or ""
    messages = payload.get("messages") or []

    if not base_url:
        raise ProxyValidationError("Missing baseUrl")
    if not base_url.startswith(ALLOWED_BASE_URL_PREFIXES):
        raise ProxyValidationError(
            "baseUrl must be an https:// URL, or a local "
            "http://127.0.0.1 / http://localhost endpoint"
        )
    if not api_key:
        raise ProxyValidationError("Missing apiKey")
    if not model:
        raise ProxyValidationError("Missing model")
    if not isinstance(messages, list) or not messages:
        raise ProxyValidationError("Missing messages")

    url = f"{base_url}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    body = json.dumps({"model": model, "messages": messages}).encode("utf-8")
    return url, headers, body


def extract_reply_text(response_json: dict) -> str:
    """Pure: pulls the assistant reply out of an OpenAI-compatible
    chat-completion response body. Raises ProxyValidationError if
    the shape doesn't match what was expected."""
    choices = response_json.get("choices") or []
    if not choices:
        raise ProxyValidationError("Provider response had no choices")
    message = choices[0].get("message") or {}
    text = message.get("content") or ""
    if not text:
        raise ProxyValidationError("Provider response had empty content")
    return text


class Handler(BaseHTTPRequestHandler):
    server_version = "ActionsEditorBackend/1.0"

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self._send_json(200, {"ok": True, "database": str(DB_PATH)})
            return

        # /api/ai/chat and /api/ratings only accept POST — a bare GET to
        # either (e.g. opening the URL directly in a browser to "check"
        # it) is a very easy way to see a 404 and assume the endpoint is
        # broken, when it's actually just the wrong HTTP method. Say so
        # explicitly instead of a generic "Not found".
        if self.path in ("/api/ai/chat", "/api/ratings"):
            self._send_json(405, {
                "error": f'{self.path} only accepts POST requests. '
                         "This route is called by the app itself — there's "
                         "nothing to see by visiting it directly in a browser."
            })
            return

        self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path == "/api/ai/chat":
            self._handle_ai_chat()
            return

        if self.path != "/api/ratings":
            self._send_json(404, {"error": "Not found"})
            return

        try:
            payload = self._read_json()
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON payload"})
            return

        rating = payload.get("rating")
        feedback = payload.get("feedback", "")

        if not isinstance(rating, int) or not 1 <= rating <= 5:
            self._send_json(400, {"error": "Rating must be an integer between 1 and 5"})
            return

        if not isinstance(feedback, str):
            self._send_json(400, {"error": "Feedback must be a string"})
            return

        row_id = insert_rating(rating, feedback)
        self._send_json(201, {"ok": True, "id": row_id})

    def _handle_ai_chat(self) -> None:
        try:
            payload = self._read_json()
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON payload"})
            return

        try:
            url, headers, body = build_forward_request(payload)
        except ProxyValidationError as exc:
            self._send_json(400, {"error": str(exc)})
            return

        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                response_body = response.read()
        except urllib.error.HTTPError as exc:
            message = f"Provider returned HTTP {exc.code}"
            try:
                error_payload = json.loads(exc.read().decode("utf-8"))
                message = (error_payload.get("error") or {}).get("message", message) \
                    if isinstance(error_payload.get("error"), dict) else message
            except Exception:
                pass
            status = exc.code if 400 <= exc.code < 600 else 502
            self._send_json(status, {"error": message})
            return
        except urllib.error.URLError as exc:
            self._send_json(502, {"error": f"Could not reach provider: {exc.reason}"})
            return

        try:
            parsed = json.loads(response_body.decode("utf-8"))
            text = extract_reply_text(parsed)
        except (json.JSONDecodeError, ProxyValidationError) as exc:
            self._send_json(502, {"error": f"Unexpected provider response: {exc}"})
            return

        self._send_json(200, {"text": text})


def main() -> None:
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Actions Editor backend listening on http://{HOST}:{PORT}")
    print(f"SQLite database: {DB_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
