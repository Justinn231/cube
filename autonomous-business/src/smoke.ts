import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Ledger } from "./ledger.js";
import { Relay } from "./relay.js";
import { Drafts } from "./drafts.js";
import { recordDecision, recentDecisions } from "./decisions.js";
import { localGenerate } from "./localllm.js";
import { buildFillerPrompt, runFillerCycle, FILLER_BRIEFING_FILE } from "./filler.js";
import type { Config } from "./config.js";

// Minimal smoke test for the pure components (no network, no worker):
//   npm run build && npm run smoke
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-smoke-"));
fs.mkdirSync(path.join(dir, "relay"), { recursive: true });

const ledger = new Ledger(dir);
const income = ledger.add({ type: "income", amount: 4, currency: "USD", source: "task-market", business: "bounties", note: "telegram forwarder bounty" });
ledger.add({ type: "expense", amount: 0.5, currency: "USD", source: "image-gen credits", business: "bounties" });
assert.equal(ledger.readAll().length, 2);
assert.equal(ledger.totals().income, 4);
assert.equal(ledger.totals().expenses, 0.5);
assert.equal(ledger.totals().verifiedIncome, 0);
assert.equal(ledger.verify(income.id)?.verified, true);
assert.equal(ledger.totals().verifiedIncome, 4);
assert.equal(ledger.verify("nope"), null);
assert.throws(() => ledger.add({ type: "income", amount: -1, currency: "USD", source: "x" }));

const byBusiness = ledger.totalsByBusiness();
assert.equal(byBusiness.get("bounties")?.net, 3.5);
ledger.add({ type: "income", amount: 1, currency: "USD", source: "x" });
assert.equal(ledger.totalsByBusiness().get("(untagged)")?.income, 1);

const relay = new Relay(dir);
const req = relay.create("api-key", "Need a fal.ai API key in .env as FAL_KEY");
assert.equal(relay.list("open").length, 1);
assert.equal(relay.settle(req.id, "resolved", "added to .env")?.status, "resolved");
assert.equal(relay.list("open").length, 0);
assert.equal(relay.list().length, 1);
assert.equal(relay.settle("nope", "resolved", "x"), null);

// Draft queue: pending → approved → sent; sending unapproved drafts is refused.
const drafts = new Drafts(dir);
const draft = drafts.submit("email", "Hi, here is your deliverable.");
assert.equal(drafts.list("pending").length, 1);
assert.equal(drafts.setStatus(draft.id, "sent"), null); // not approved yet
assert.equal(drafts.setStatus(draft.id, "approved")?.status, "approved");
assert.equal(drafts.setStatus(draft.id, "sent")?.status, "sent");
const denied = drafts.submit("social-post", "Buy now!!!");
assert.equal(drafts.setStatus(denied.id, "rejected", "too spammy")?.status, "rejected");
assert.equal(drafts.setStatus(denied.id, "sent"), null); // rejected stays unsendable
assert.equal(drafts.list().length, 2);

// Decision log.
recordDecision(dir, "KILL supplements: -40 USD after 3 weeks of ads");
recordDecision(dir, "SCALE bounties: net +3.50 USD, best $/h");
assert.equal(recentDecisions(dir).length, 2);
assert.match(recentDecisions(dir)[1]!, /SCALE bounties/);

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
// Filler cycle: prompt stays grounded, briefing lands in the workspace as an
// untrusted draft, and a missing local model is a clean no-op.
const fillerPrompt = buildFillerPrompt({
  notes: "working on logo bounty",
  decisions: ["- [ts] SCALE bounties"],
  totalsLine: "income 4.00, net 3.50 USD",
  openAssists: [],
  pendingDrafts: [],
});
assert.match(fillerPrompt, /do not invent facts/);
assert.match(fillerPrompt, /working on logo bounty/);

const workspace = path.join(dir, "workspace");
fs.mkdirSync(workspace, { recursive: true });
const fillerConfig = {
  rootDir: dir,
  dataDir: dir,
  workspaceDir: workspace,
  promptsDir: dir,
  timezone: "Europe/Berlin",
  workerCmd: "true",
  workerName: "test",
  cyclePauseSeconds: 1,
  maxCycleMinutes: 1,
  rateLimitBackoffMinutes: 1,
  maxBackoffMinutes: 1,
  dailyReportHour: 23,
  dashboardPort: 0,
  telegramBotToken: "",
  telegramChatId: "",
  spendApprovalThreshold: 5,
  currency: "USD",
  ollamaUrl: `http://127.0.0.1:${port}`,
  localModel: "gemma3:4b-it-qat",
  localTimeoutSeconds: 10,
  warRoomWeekday: 0,
} satisfies Config;
assert.equal(await runFillerCycle(fillerConfig), true);
const briefing = fs.readFileSync(path.join(workspace, FILLER_BRIEFING_FILE), "utf8");
assert.match(briefing, /UNTRUSTED DRAFT/);
assert.match(briefing, /^echo: /m);
assert.equal(await runFillerCycle({ ...fillerConfig, localModel: "" }), false);

mock.close();

fs.rmSync(dir, { recursive: true, force: true });
console.log("smoke: all assertions passed");
