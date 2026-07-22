// Local model tier via Ollama (e.g. gemma3:4b-it-qat). This is the cheap,
// weaker tier: no tool access, low temperature, and its output is always a
// draft the main agent must review — see OPERATING_RULES.md.
export interface LocalOptions {
  system?: string;
  timeoutMs?: number;
  maxTokens?: number;
}

export async function localGenerate(
  ollamaUrl: string,
  model: string,
  prompt: string,
  opts: LocalOptions = {},
): Promise<string> {
  if (!model) {
    throw new Error(
      "no local model configured (set LOCAL_MODEL in .env, e.g. gemma3:4b-it-qat)",
    );
  }
  const res = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      system: opts.system,
      stream: false,
      // Low temperature: we want deterministic mechanical work, not creativity —
      // small models hallucinate enough as it is.
      options: { temperature: 0.2, num_predict: opts.maxTokens ?? 2048 },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 300_000),
  }).catch((err) => {
    throw new Error(
      `local model unreachable at ${ollamaUrl} (is Ollama running? \`ollama serve\` / \`ollama pull ${model}\`): ${String(err)}`,
    );
  });
  if (!res.ok) {
    throw new Error(`ollama error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { response?: string };
  if (typeof data.response !== "string") {
    throw new Error("ollama returned no response field");
  }
  return data.response;
}
