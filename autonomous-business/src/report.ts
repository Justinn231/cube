import type { Config } from "./config.js";
import type { State } from "./state.js";
import { Ledger } from "./ledger.js";
import { Relay } from "./relay.js";
import { Drafts } from "./drafts.js";

export function buildDailyReport(config: Config, state: State): string {
  const ledger = new Ledger(config.dataDir);
  const totals = ledger.totals();
  const byBusiness = [...ledger.totalsByBusiness().entries()].sort(
    (a, b) => b[1].net - a[1].net,
  );
  const relay = new Relay(config.dataDir);
  const open = relay.list("open");
  const pendingDrafts = new Drafts(config.dataDir).list("pending");
  const statusCounts = Object.entries(state.cyclesByStatus)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return [
    `📊 Daily report (${new Date().toLocaleString("de-DE", { timeZone: config.timezone })})`,
    ``,
    `💰 Revenue: ${totals.income.toFixed(2)} ${config.currency} (verified: ${totals.verifiedIncome.toFixed(2)})`,
    `💸 Expenses: ${totals.expenses.toFixed(2)} ${config.currency}`,
    `🧾 Net: ${totals.net.toFixed(2)} ${config.currency} (${totals.entries} ledger entries)`,
    byBusiness.length
      ? `🏪 Portfolio:\n${byBusiness.map(([n, t]) => `  - ${n}: net ${t.net.toFixed(2)}`).join("\n")}`
      : ``,
    `✍️ Drafts awaiting approval: ${pendingDrafts.length}${pendingDrafts.length ? " (see /drafts)" : ""}`,
    ``,
    `🔁 Cycles: ${state.cyclesTotal} total (${statusCounts || "none yet"})`,
    `🤖 Worker: ${config.workerName}`,
    `🆙 Supervisor up since: ${state.startedAt}`,
    `🙋 Open assists: ${open.length}${open.length ? "\n" + open.map((r) => `  - [${r.id}] (${r.kind}) ${r.description}`).join("\n") : ""}`,
    ``,
    `Unverified income is a claim, not money — reconcile against Stripe/wallet and /verify <id> it.`,
  ].join("\n");
}
