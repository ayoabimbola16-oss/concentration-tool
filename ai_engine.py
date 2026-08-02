#!/usr/bin/env python3
"""PlanTrack AI Co-Pilot API.

Run locally with:  python ai_engine.py --serve
Set AI_API_URL, AI_API_KEY and AI_MODEL to connect a hosted, OpenAI-compatible
model. Without them, the safe local planner still works.
"""

from __future__ import annotations

import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen


def clean_text(value: object, limit: int = 240) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def local_reply(prompt: str, context: dict) -> dict:
    """Useful offline fallback. It never invents private user data."""
    prompt = clean_text(prompt, 800)
    lower = prompt.lower()
    name = clean_text(context.get("user", {}).get("name", "there"), 60)
    pending = context.get("activity", {}).get("pending_count", 0)
    focused = context.get("focus", {}).get("minutes_today", 0)

    if any(word in lower for word in ("timetable", "schedule", "calendar")):
        rows = [
            ["09:00–10:30", "Top priority", "Deep work"],
            ["10:30–10:45", "Break", "Recovery"],
            ["10:45–12:00", "Next activity", "Focus"],
            ["16:30–16:45", "Review", "Plan tomorrow"],
        ]
        return {
            "reply": f"I made a focused starter schedule, {name}. It protects two deep-work blocks and a short review.",
            "action": {"type": "create_timetable", "title": "AI Focus Schedule", "columns": ["Time", "Activity", "Mode"], "rows": rows},
        }

    if any(word in lower for word in ("plan", "goal", "roadmap", "break down", "breakdown")):
        subject = clean_text(prompt, 90) or "My next goal"
        activities = [
            {"text": "Define the smallest useful outcome", "status": None},
            {"text": "Complete one 45-minute focus block", "status": None},
            {"text": "Review progress and choose the next step", "status": None},
        ]
        return {
            "reply": f"I turned “{subject}” into a small plan. Start with one concrete outcome, then build momentum.",
            "action": {"type": "create_plan", "title": "AI Plan: " + subject[:55], "activities": activities},
        }

    if any(word in lower for word in ("progress", "activity", "summary", "stats", "what have i")):
        return {
            "reply": f"Today you have focused for {focused} minutes and have {pending} unfinished activity item(s). Pick one important item, work on it for 25–45 minutes, then review.",
            "action": {"type": "open_focus"},
        }

    return {
        "reply": f"I’m here with you, {name}. Tell me the outcome you want, the time you have, and what is blocking you. I can turn it into a plan or a timetable. You currently have {pending} unfinished activity item(s).",
        "action": None,
    }


def hosted_reply(prompt: str, context: dict) -> dict | None:
    """Use a server-side API key only; never expose it in the browser."""
    api_url = os.getenv("AI_API_URL")
    api_key = os.getenv("AI_API_KEY")
    if not api_url or not api_key:
        return None

    system = (
        "You are PlanTrack's concise productivity co-pilot. Use only the supplied "
        "activity context. Be supportive, practical and conversational. Do not claim "
        "to have performed an action. Return JSON with reply (string) and optional "
        "action. Actions can be create_plan {title, activities:[{text,status}]} or "
        "create_timetable {title, columns, rows}."
    )
    payload = {
        "model": os.getenv("AI_MODEL", "gpt-4o-mini"),
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps({"prompt": prompt, "context": context})},
        ],
        "temperature": 0.5,
    }
    request = Request(
        api_url,
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=25) as response:
            body = json.loads(response.read().decode())
        content = body["choices"][0]["message"]["content"]
        result = json.loads(content)
        if isinstance(result.get("reply"), str):
            return {"reply": clean_text(result["reply"], 4000), "action": result.get("action")}
    except Exception:
        return None
    return None


def process_prompt(prompt: str, context: dict) -> dict:
    if not clean_text(prompt):
        return {"reply": "Tell me what you would like to achieve.", "action": None}
    return hosted_reply(prompt, context) or local_reply(prompt, context)


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", os.getenv("AI_ALLOWED_ORIGIN", "*"))
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        self.send_json(204, {})

    def do_POST(self) -> None:
        if self.path != "/api/ai":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            size = min(int(self.headers.get("Content-Length", "0")), 200_000)
            payload = json.loads(self.rfile.read(size).decode())
            self.send_json(200, process_prompt(payload.get("prompt", ""), payload.get("context", {})))
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "Invalid JSON"})

    def log_message(self, *_: object) -> None:
        pass


if __name__ == "__main__":
    if "--serve" in sys.argv:
        port = int(os.getenv("PORT", "8000"))
        print(f"PlanTrack AI API listening on http://localhost:{port}/api/ai")
        ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
    else:
        payload = json.loads(sys.stdin.read() or "{}")
        print(json.dumps(process_prompt(payload.get("prompt", ""), payload.get("context", {}))))
