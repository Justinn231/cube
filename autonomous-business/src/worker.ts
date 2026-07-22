import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Config } from "./config.js";
import { Ledger } from "./ledger.js";
import { Relay } from "./relay.js";
import { Drafts } from "./drafts.js";
import { recentDecisions } from "./decisions.js";
import { FILLER_BRIEFING_FILE } from "./filler.js";
import { log } from "./log.js";

export type CycleStatus = "ok" | "rate-limited" | "error" | "timeout";

export interface CycleResult {
  status: CycleStatus;
  exitCode: number | null;
  startedAt: string;
  endedAt: string;
  outputTail: string;
}

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /usage.?limit/i,
  /quota.{0,20}exceeded/i,
  /\b429\b/,
  /overloaded/i,
  /limit (?:reached|exceeded)/i,
];

// One worker cycle: assemble the goal prompt with current business state,
// hand it to the configured agent CLI, and classify how the run ended so the
// supervisor can decide between "next cycle", "back off", or "escalate".
export async function runCycle(
  config: Config,
  opts: { warRoom?: boolean } = {},
): Promise<CycleResult> {
  const startedAt = new Date().toISOString();
  const promptFile = path.join(config.dataDir, "cycle-prompt.md");
  fs.writeFileSync(promptFile, buildCyclePrompt(config, opts));

  const logFile = path.join(
    config.dataDir,
    "logs",
    `cycle-${startedAt.replace(/[:.]/g, "-")}.log`,
  );
  const out = fs.createWriteStream(logFile);
  let tail = "";
  const append = (chunk: Buffer): void => {
    out.write(chunk);
    tail = (tail + chunk.toString()).slice(-8000);
  };

  const child = spawn("sh", ["-c", config.workerCmd], {
    cwd: config.workspaceDir,
    env: { ...process.env, PROMPT_FILE: promptFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  const timeoutMs = config.maxCycleMinutes * 60_000;
  const exitCode = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      log(`cycle exceeded ${config.maxCycleMinutes}min, killing worker`);
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      append(Buffer.from(`spawn error: ${String(err)}\n`));
      resolve(null);
    });
  });
  out.end();

  const endedAt = new Date().toISOString();
  let status: CycleStatus = "ok";
  if (child.killed) status = "timeout";
  else if (RATE_LIMIT_PATTERNS.some((p) => p.test(tail))) status = "rate-limited";
  else if (exitCode !== 0) status = "error";

  return { status, exitCode, startedAt, endedAt, outputTail: tail };
}

function buildCyclePrompt(
  config: Config,
  opts: { warRoom?: boolean } = {},
): string {
  const goal = readPrompt(config, "GOAL.md");
  const rules = readPrompt(config, "OPERATING_RULES.md");
  const ledger = new Ledger(config.dataDir);
  const relay = new Relay(config.dataDir);
  const drafts = new Drafts(config.dataDir);
  const totals = ledger.totals();
  const byBusiness = [...ledger.totalsByBusiness().entries()]
    .sort((a, b) => b[1].net - a[1].net)
    .map(
      ([name, t]) =>
        `  - ${name}: income ${t.income.toFixed(2)}, expenses ${t.expenses.toFixed(2)}, net ${t.net.toFixed(2)}`,
    );
  const approvedDrafts = drafts.list("approved");
  const pendingDrafts = drafts.list("pending");
  const decisions = recentDecisions(config.dataDir);
  const openRequests = relay.list("open");
  const recentlySettled = relay
    .list()
    .filter((r) => r.status !== "open")
    .slice(-5);
  const steer = consumeSteer(config);
  const cliPath = path.join(config.rootDir, "dist", "cli.js");

  return [
    goal,
    "\n---\n",
    rules.replaceAll("{CLI}", `node ${cliPath}`),
    "\n---\n",
    "# Current state",
    `- Time: ${new Date().toString()} (timezone: ${config.timezone})`,
    `- Workspace (your cwd, persistent between cycles): ${config.workspaceDir}`,
    `- Ledger: income ${totals.income.toFixed(2)} (${totals.verifiedIncome.toFixed(2)} verified), expenses ${totals.expenses.toFixed(2)}, net ${totals.net.toFixed(2)} ${config.currency}`,
    `- Local model tier: ${config.localModel ? `${config.localModel} via \`node ${cliPath} local "<prompt>"\` (cheap but weak — delegation rules apply)` : "not configured"}`,
    `- Portfolio P&L (${config.currency}):\n${byBusiness.length ? byBusiness.join("\n") : "  (no tagged entries yet — tag every ledger entry with --business=<name>)"}`,
    `- Approved drafts READY TO SEND (send them, then \`draft mark-sent <id>\`):\n${formatDrafts(approvedDrafts)}`,
    `- Drafts pending human approval (do NOT send, do NOT block):\n${formatDrafts(pendingDrafts)}`,
    `- Recent decisions from the log:\n${decisions.length ? decisions.map((d) => `  ${d}`).join("\n") : "  (none)"}`,
    fs.existsSync(path.join(config.workspaceDir, FILLER_BRIEFING_FILE))
      ? `- A local-model briefing exists at ./${FILLER_BRIEFING_FILE} (untrusted draft from backoff idle time — skim it, verify before acting, delete it once absorbed).`
      : "",
    `- Open relay requests (waiting on human, do NOT block on these):\n${formatRequests(openRequests)}`,
    `- Recently settled relay requests:\n${formatRequests(recentlySettled)}`,
    opts.warRoom
      ? [
          "\n# WAR ROOM — portfolio review (do this FIRST today)",
          "Analyze the ledger per business: net, trend, and effort vs. return.",
          "For every business decide explicitly: SCALE (verifiably positive margin), KEEP (inconclusive, cheap to run), or KILL (negative after a fair trial).",
          "Do not touch what verifiably works. Record every decision with `decide <text>` including the evidence. Then act on the decisions.",
        ].join("\n")
      : "",
    steer
      ? `\n# Steer message from the operator (highest priority)\n${steer}`
      : "",
  ].join("\n");
}

function formatDrafts(drafts: Array<{ id: string; channel: string; content: string }>): string {
  if (drafts.length === 0) return "  (none)";
  return drafts
    .map(
      (d) =>
        `  - [${d.id}] (${d.channel}) ${d.content.length > 120 ? d.content.slice(0, 120) + "…" : d.content}`,
    )
    .join("\n");
}

function formatRequests(
  requests: Array<{ id: string; kind: string; description: string; status: string; resolution?: string }>,
): string {
  if (requests.length === 0) return "  (none)";
  return requests
    .map(
      (r) =>
        `  - [${r.id}] (${r.kind}, ${r.status}) ${r.description}${r.resolution ? ` -> ${r.resolution}` : ""}`,
    )
    .join("\n");
}

function readPrompt(config: Config, name: string): string {
  const file = path.join(config.promptsDir, name);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

// The operator's daily steer message is consumed exactly once: it is injected
// into the next cycle's prompt and then archived.
function consumeSteer(config: Config): string {
  const file = path.join(config.dataDir, "steer.md");
  if (!fs.existsSync(file)) return "";
  const content = fs.readFileSync(file, "utf8").trim();
  if (content) {
    fs.appendFileSync(
      path.join(config.dataDir, "steer-archive.md"),
      `\n## ${new Date().toISOString()}\n${content}\n`,
    );
    fs.writeFileSync(file, "");
  }
  return content;
}

export function addSteer(config: Config, text: string): void {
  fs.appendFileSync(path.join(config.dataDir, "steer.md"), text + "\n");
}
