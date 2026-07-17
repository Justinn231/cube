import { loadConfig } from "./config.js";
import { Ledger } from "./ledger.js";
import { Relay } from "./relay.js";
import { Telegram } from "./telegram.js";

// Agent-facing CLI. The worker calls this from inside its cycles to record
// money movements, file human-in-the-loop requests, and notify the operator.
// Usage:
//   cli.js ledger add <income|expense> <amount> <source> [note...]
//   cli.js ledger list
//   cli.js ledger verify <id>          (humans/verifiers only)
//   cli.js relay request <kind> <description...>
//   cli.js relay list
//   cli.js notify <message...>
async function main(): Promise<void> {
  const config = loadConfig();
  const [group, action, ...rest] = process.argv.slice(2);
  const telegram = new Telegram(config.telegramBotToken, config.telegramChatId);

  if (group === "ledger" && action === "add") {
    const [type, amountStr, source, ...note] = rest;
    if ((type !== "income" && type !== "expense") || !amountStr || !source) {
      fail("usage: ledger add <income|expense> <amount> <source> [note...]");
    }
    const amount = Number(amountStr);
    if (
      type === "expense" &&
      amount > config.spendApprovalThreshold
    ) {
      const req = new Relay(config.dataDir).create(
        "spend-approval",
        `Spend ${amount} ${config.currency} on: ${source} ${note.join(" ")}`,
      );
      await telegram.send(
        `🙋 Spend approval needed [${req.id}]: ${req.description}\nReply /resolve ${req.id} <note> or /reject ${req.id} <reason>.`,
      );
      fail(
        `expense ${amount} ${config.currency} exceeds approval threshold ` +
          `(${config.spendApprovalThreshold}). Filed spend-approval request [${req.id}] — do not spend until it is resolved.`,
      );
    }
    const entry = new Ledger(config.dataDir).add({
      type: type as "income" | "expense",
      amount,
      currency: config.currency,
      source,
      note: note.join(" ") || undefined,
    });
    console.log(JSON.stringify(entry));
    if (type === "income") {
      await telegram.send(
        `💰 Income recorded (UNVERIFIED): ${amount} ${config.currency} from ${source}. Verify with /verify ${entry.id} after reconciling.`,
      );
    }
    return;
  }

  if (group === "ledger" && action === "list") {
    for (const e of new Ledger(config.dataDir).readAll()) {
      console.log(JSON.stringify(e));
    }
    return;
  }

  if (group === "ledger" && action === "verify") {
    const entry = new Ledger(config.dataDir).verify(rest[0] ?? "");
    if (!entry) fail(`no ledger entry ${rest[0]}`);
    console.log(JSON.stringify(entry));
    return;
  }

  if (group === "relay" && action === "request") {
    const [kind, ...desc] = rest;
    if (!kind || desc.length === 0) {
      fail("usage: relay request <kind> <description...>");
    }
    const req = new Relay(config.dataDir).create(kind, desc.join(" "));
    console.log(JSON.stringify(req));
    await telegram.send(
      `🙋 Assist needed [${req.id}] (${req.kind}): ${req.description}\nReply /resolve ${req.id} <note> or /reject ${req.id} <reason>.`,
    );
    return;
  }

  if (group === "relay" && action === "list") {
    for (const r of new Relay(config.dataDir).list()) {
      console.log(JSON.stringify(r));
    }
    return;
  }

  if (group === "notify") {
    const message = [action, ...rest].filter(Boolean).join(" ");
    if (!message) fail("usage: notify <message...>");
    await telegram.send(`📣 ${message}`);
    return;
  }

  fail(
    "usage: <ledger add|ledger list|ledger verify|relay request|relay list|notify> ...",
  );
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
