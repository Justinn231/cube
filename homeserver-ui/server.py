import asyncio
import json
import os
from pathlib import Path
from typing import AsyncGenerator

import anthropic
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "")
PORT = int(os.environ.get("PORT", 8080))

raw_allowlist = os.environ.get("ALLOWED_COMMANDS", "").strip()
COMMAND_ALLOWLIST: list[str] | None = (
    [c.strip() for c in raw_allowlist.split(",") if c.strip()] or None
)

anthropic_client = anthropic.Anthropic(api_key=API_KEY)
app = FastAPI()

SYSTEM_PROMPT = """Du bist ein hilfreicher Homeserver-Assistent. Du hast direkten Zugriff auf den Server und kannst:
- Shell-Befehle ausführen (run_command)
- Dateien lesen (read_file)
- Dateien schreiben (write_file)

Antworte immer auf Deutsch. Sei präzise und erkläre kurz, was du getan hast.
Bei destruktiven Aktionen (Löschen, Überschreiben wichtiger Dateien, Neustarts) frage vorher nach."""

TOOLS = [
    {
        "name": "run_command",
        "description": "Führt einen Shell-Befehl auf dem Server aus und gibt stdout/stderr zurück.",
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Der auszuführende Shell-Befehl"}
            },
            "required": ["command"],
        },
    },
    {
        "name": "read_file",
        "description": "Liest den Inhalt einer Datei vom Server.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "write_file",
        "description": "Schreibt Inhalt in eine Datei (überschreibt bestehende Datei).",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
    },
]


async def execute_tool(name: str, inputs: dict) -> str:
    try:
        if name == "run_command":
            cmd = inputs["command"]
            if COMMAND_ALLOWLIST and not any(cmd.strip().startswith(a) for a in COMMAND_ALLOWLIST):
                return f"Fehler: Befehl nicht erlaubt. Erlaubte Präfixe: {', '.join(COMMAND_ALLOWLIST)}"
            proc = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30.0)
            result = stdout.decode(errors="replace")
            if stderr:
                result += "\n[stderr]: " + stderr.decode(errors="replace")
            return result or "(kein Output)"

        elif name == "read_file":
            return Path(inputs["path"]).read_text(errors="replace")

        elif name == "write_file":
            p = Path(inputs["path"])
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(inputs["content"])
            return f"Datei '{inputs['path']}' erfolgreich geschrieben."

    except asyncio.TimeoutError:
        return "Fehler: Befehl hat das Timeout (30 s) überschritten."
    except Exception as e:
        return f"Fehler: {type(e).__name__}: {e}"

    return f"Unbekanntes Tool: {name}"


def sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def agentic_loop(messages: list[dict]) -> AsyncGenerator[str, None]:
    if not API_KEY or API_KEY.startswith("sk-ant-dein"):
        yield sse({"type": "text_delta", "text": "⚠️ Kein gültiger ANTHROPIC_API_KEY in der .env hinterlegt.\n\nBitte unter https://console.anthropic.com einen Key erstellen und in homeserver-ui/.env eintragen."})
        yield sse({"type": "done"})
        return

    while True:
        tool_use_blocks: list[anthropic.types.ToolUseBlock] = []

        with anthropic_client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=8192,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        ) as stream:
            current_tool_name: str | None = None

            for event in stream:
                if event.type == "content_block_start":
                    block = event.content_block
                    if block.type == "tool_use":
                        current_tool_name = block.name
                        yield sse({"type": "tool_start", "name": block.name, "id": block.id})

                elif event.type == "content_block_delta":
                    delta = event.delta
                    if delta.type == "text_delta":
                        yield sse({"type": "text_delta", "text": delta.text})

                elif event.type == "content_block_stop":
                    current_tool_name = None

            response = stream.get_final_message()

        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            yield sse({"type": "done"})
            return

        if response.stop_reason != "tool_use":
            yield sse({"type": "done"})
            return

        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                output = await execute_tool(block.name, block.input)
                yield sse({"type": "tool_result", "name": block.name, "output": output[:3000]})
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": output,
                })

        messages.append({"role": "user", "content": tool_results})


async def verify_token(request: Request):
    if not AUTH_TOKEN:
        return
    header = request.headers.get("Authorization", "")
    if header != f"Bearer {AUTH_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


STATIC_DIR = Path(__file__).parent / "static"


@app.get("/")
async def index():
    return HTMLResponse((STATIC_DIR / "index.html").read_text())


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/chat")
async def chat(request: ChatRequest, _: None = Depends(verify_token)):
    messages = request.history + [{"role": "user", "content": request.message}]
    return StreamingResponse(
        agentic_loop(messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=False)
