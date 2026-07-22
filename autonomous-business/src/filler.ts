import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import { Ledger } from "./ledger.js";
import { Relay } from "./relay.js";
import { Drafts } from "./drafts.js";
import { recentDecisions } from "./decisions.js";
import { localGenerate } from "./localllm.js";
import { log } from "./log.js";

export const FILLER_BRIEFING_FILE = "FILLER_BRIEFING.md";

// Filler cycle: while the worker is stuck in a rate-limit backoff, the local
// model turns idle time into a housekeeping briefing for the next real cycle.
// It only ever consolidates state we hand it — no tools, no decisions, and the
// output is stamped as an untrusted draft.
export function buildFillerPrompt(inputs: {
  notes: string;
  decisions: string[];
  totalsLine: string;
  openAssists: string[];
  pendingDrafts: string[];
}): string {
  return [
    "You are the cheap local assistant of an autonomous business system. The",
    "main agent is paused by a rate limit; prepare a short briefing for its",
    "next cycle. Use ONLY the information below — do not invent facts, names,",
    "numbers, or URLs. Output markdown with exactly these sections:",
    "## State summary (3-5 bullets)",
    "## Suggested next actions (top 3, from the notes/decisions only)",
    "## Open questions / loose ends",
    "",
    `Ledger: ${inputs.totalsLine}`,
    `Recent decisions:\n${inputs.decisions.map((d) => `- ${d}`).join("\n") || "- (none)"}`,
    `Open human requests:\n${inputs.openAssists.map((a) => `- ${a}`).join("\n") || "- (none)"}`,
    `Drafts pending approval:\n${inputs.pendingDrafts.map((d) => `- ${d}`).join("\n") || "- (none)"}`,
    "",
    "Worker notes (may be long, consolidate):",
    inputs.notes || "(no notes yet)",
  ].join("\n");
}

export async function runFillerCycle(config: Config): Promise<boolean> {
  if (!config.localModel) return false;
  try {
    const notesFile = path.join(config.workspaceDir, "NOTES.md");
    const notes = fs.existsSync(notesFile)
      ? fs.readFileSync(notesFile, "utf8").slice(-12_000)
      : "";
    const totals = new Ledger(config.dataDir).totals();
    const prompt = buildFillerPrompt({
      notes,
      decisions: recentDecisions(config.dataDir),
      totalsLine: `income ${totals.income.toFixed(2)} (${totals.verifiedIncome.toFixed(2)} verified), expenses ${totals.expenses.toFixed(2)}, net ${totals.net.toFixed(2)} ${config.currency}`,
      openAssists: new Relay(config.dataDir)
        .list("open")
        .map((r) => `[${r.id}] (${r.kind}) ${r.description}`),
      pendingDrafts: new Drafts(config.dataDir)
        .list("pending")
        .map((d) => `[${d.id}] (${d.channel}) ${d.content.slice(0, 120)}`),
    });
    const briefing = await localGenerate(
      config.ollamaUrl,
      config.localModel,
      prompt,
      { timeoutMs: config.localTimeoutSeconds * 1000 },
    );
    fs.writeFileSync(
      path.join(config.workspaceDir, FILLER_BRIEFING_FILE),
      [
        `> UNTRUSTED DRAFT from the local model (${config.localModel}),`,
        `> generated ${new Date().toISOString()} during a rate-limit backoff.`,
        `> Verify every claim against ledger/relay state before acting on it.`,
        "",
        briefing.trim(),
        "",
      ].join("\n"),
    );
    log("filler cycle: briefing written by local model");
    return true;
  } catch (err) {
    log(`filler cycle skipped: ${String(err)}`);
    return false;
  }
}
