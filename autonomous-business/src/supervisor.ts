import { loadConfig } from "./config.js";
import { initLog, log } from "./log.js";
import { Ledger } from "./ledger.js";
import { Relay } from "./relay.js";
import { Drafts } from "./drafts.js";
import { Telegram, sleep } from "./telegram.js";
import { runCycle, addSteer } from "./worker.js";
import { runFillerCycle } from "./filler.js";
import { loadState, saveState, localDate } from "./state.js";
import { buildDailyReport } from "./report.js";
import { startDashboard } from "./dashboard.js";

// The supervisor is the long-lived process (run it under systemd). It owns the
// worker goal-loop, the Telegram nervous system, the dashboard, and the daily
// report — and it is what turns rate limits and crashes into backoff+retry
// instead of silent death.
async function main(): Promise<void> {
  const config = loadConfig();
  initLog(config.dataDir, "supervisor");
  const state = loadState(config.dataDir);
  const ledger = new Ledger(config.dataDir);
  const relay = new Relay(config.dataDir);
  const drafts = new Drafts(config.dataDir);
  const telegram = new Telegram(config.telegramBotToken, config.telegramChatId);

  telegram.on("/steer", async (args) => {
    if (!args) return "Usage: /steer <instruction for the next cycle>";
    addSteer(config, args);
    return "Steer message queued for the next cycle.";
  });
  telegram.on("/status", async () => buildDailyReport(config, state));
  telegram.on("/assists", async () => {
    const open = relay.list("open");
    return open.length
      ? open.map((r) => `[${r.id}] (${r.kind}) ${r.description}`).join("\n")
      : "No open assists.";
  });
  telegram.on("/resolve", async (args) => {
    const [id, ...rest] = args.split(" ");
    if (!id) return "Usage: /resolve <id> <note>";
    const req = relay.settle(id, "resolved", rest.join(" ") || "done");
    return req ? `Resolved [${req.id}].` : `No request with id ${id}.`;
  });
  telegram.on("/reject", async (args) => {
    const [id, ...rest] = args.split(" ");
    if (!id) return "Usage: /reject <id> <reason>";
    const req = relay.settle(id, "rejected", rest.join(" ") || "rejected");
    return req ? `Rejected [${req.id}].` : `No request with id ${id}.`;
  });
  telegram.on("/drafts", async () => {
    const pending = drafts.list("pending");
    return pending.length
      ? pending
          .map(
            (d) =>
              `[${d.id}] (${d.channel})\n${d.content.length > 500 ? d.content.slice(0, 500) + "…" : d.content}`,
          )
          .join("\n---\n")
      : "No pending drafts.";
  });
  telegram.on("/approve", async (args) => {
    const [id, ...rest] = args.split(" ");
    if (!id) return "Usage: /approve <draft-id> [note]";
    const draft = drafts.setStatus(id, "approved", rest.join(" ") || undefined);
    return draft
      ? `Approved draft [${draft.id}] — the worker will send it next cycle.`
      : `No draft with id ${id}.`;
  });
  telegram.on("/deny", async (args) => {
    const [id, ...rest] = args.split(" ");
    if (!id) return "Usage: /deny <draft-id> <reason>";
    const draft = drafts.setStatus(id, "rejected", rest.join(" ") || "denied");
    return draft ? `Denied draft [${draft.id}].` : `No draft with id ${id}.`;
  });
  telegram.on("/verify", async (args) => {
    const id = args.split(" ")[0];
    if (!id) return "Usage: /verify <ledger-entry-id>";
    const entry = ledger.verify(id);
    return entry
      ? `Verified [${entry.id}] ${entry.type} ${entry.amount} ${entry.currency}.`
      : `No ledger entry with id ${id}.`;
  });
  telegram.startPolling();

  const dashboard = startDashboard(config);
  log(
    `supervisor started (worker=${config.workerName}, telegram=${telegram.enabled ? "on" : "off"})`,
  );
  await telegram.send(
    `🟢 Supervisor started. Worker: ${config.workerName}. Commands: /steer /status /assists /resolve /reject /verify /drafts /approve /deny`,
  );

  let running = true;
  const stop = (): void => {
    running = false;
    telegram.stopPolling();
    dashboard.close();
    log("supervisor stopping");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const maxCycles = Number(process.env.MAX_CYCLES ?? Infinity);

  while (running && state.cyclesTotal < maxCycles) {
    await maybeSendDailyReport(config, state, telegram);

    const today = localDate();
    const warRoom =
      new Date().getDay() === config.warRoomWeekday &&
      state.lastWarRoomDate !== today;
    log(`cycle ${state.cyclesTotal + 1} starting${warRoom ? " (war room)" : ""}`);
    const result = await runCycle(config, { warRoom });
    if (warRoom) state.lastWarRoomDate = today;
    state.cyclesTotal += 1;
    state.cyclesByStatus[result.status] =
      (state.cyclesByStatus[result.status] ?? 0) + 1;
    state.lastCycle = result;
    log(`cycle finished: ${result.status} (exit=${result.exitCode})`);

    if (result.status === "rate-limited") {
      state.currentBackoffMinutes = Math.min(
        state.currentBackoffMinutes > 0
          ? state.currentBackoffMinutes * 2
          : config.rateLimitBackoffMinutes,
        config.maxBackoffMinutes,
      );
      await telegram.send(
        `⏳ Rate limit hit. Backing off ${state.currentBackoffMinutes}min, then resuming automatically.`,
      );
    } else {
      if (result.status !== "ok") {
        await telegram.send(
          `⚠️ Cycle ended with status "${result.status}" (exit=${result.exitCode}). Restarting after pause. Tail:\n${result.outputTail.slice(-500)}`,
        );
      }
      state.currentBackoffMinutes = 0;
    }
    saveState(config.dataDir, state);

    const pauseMs =
      state.currentBackoffMinutes > 0
        ? state.currentBackoffMinutes * 60_000
        : config.cyclePauseSeconds * 1_000;
    // Rate-limit backoff idle time is handed to the local model for a
    // housekeeping briefing (filler cycle) — once per backoff.
    if (state.currentBackoffMinutes > 0) await runFillerCycle(config);
    // Sleep in small slices so SIGTERM stops us promptly.
    const until = Date.now() + pauseMs;
    while (running && Date.now() < until) await sleep(1_000);
  }
  stop();
}

async function maybeSendDailyReport(
  config: ReturnType<typeof loadConfig>,
  state: ReturnType<typeof loadState>,
  telegram: Telegram,
): Promise<void> {
  const today = localDate();
  if (
    state.lastReportDate !== today &&
    new Date().getHours() >= config.dailyReportHour
  ) {
    await telegram.send(buildDailyReport(config, state));
    state.lastReportDate = today;
    saveState(config.dataDir, state);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
