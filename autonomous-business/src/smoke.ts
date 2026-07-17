import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Ledger } from "./ledger.js";
import { Relay } from "./relay.js";
import { localGenerate } from "./localllm.js";

// Minimal smoke test for the pure components (no network, no worker):
//   npm run build && npm run smoke
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-smoke-"));
fs.mkdirSync(path.join(dir, "relay"), { recursive: true });

const ledger = new Ledger(dir);
const income = ledger.add({ type: "income", amount: 4, currency: "USD", source: "task-market", note: "telegram forwarder bounty" });
ledger.add({ type: "expense", amount: 0.5, currency: "USD", source: "image-gen credits" });
assert.equal(ledger.readAll().length, 2);
assert.equal(ledger.totals().income, 4);
assert.equal(ledger.totals().expenses, 0.5);
assert.equal(ledger.totals().verifiedIncome, 0);
assert.equal(ledger.verify(income.id)?.verified, true);
assert.equal(ledger.totals().verifiedIncome, 4);
assert.equal(ledger.verify("nope"), null);
assert.throws(() => ledger.add({ type: "income", amount: -1, currency: "USD", source: "x" }));

const relay = new Relay(dir);
const req = relay.create("api-key", "Need a fal.ai API key in .env as FAL_KEY");
assert.equal(relay.list("open").length, 1);
assert.equal(relay.settle(req.id, "resolved", "added to .env")?.status, "resolved");
assert.equal(relay.list("open").length, 0);
assert.equal(relay.list().length, 1);
assert.equal(relay.settle("nope", "resolved", "x"), null);

// Local model client against a mock Ollama server.
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body) as { model: string; prompt: string };
    assert.equal(req.url, "/api/generate");
    assert.equal(parsed.model, "gemma3:4b-it-qat");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ response: `echo: ${parsed.prompt}` }));
  });
});
await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
const port = (mock.address() as { port: number }).port;
const reply = await localGenerate(
  `http://127.0.0.1:${port}`,
  "gemma3:4b-it-qat",
  "ping",
);
assert.equal(reply, "echo: ping");
await assert.rejects(
  localGenerate(`http://127.0.0.1:${port}`, "", "ping"),
  /no local model configured/,
);
await assert.rejects(
  localGenerate("http://127.0.0.1:9", "gemma3:4b-it-qat", "ping"),
  /unreachable/,
);
mock.close();

fs.rmSync(dir, { recursive: true, force: true });
console.log("smoke: all assertions passed");
