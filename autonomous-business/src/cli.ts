import { loadConfig } from "./config.js";
import { Ledger } from "./ledger.js";
import { Relay } from "./relay.js";
import { Drafts } from "./drafts.js";
import { recordDecision } from "./decisions.js";
import { Telegram } from "./telegram.js";
import { localGenerate } from "./localllm.js";

// Agent-facing CLI. The worker calls this from inside its cycles to record
// money movements, file human-in-the-loop requests, and notify the operator.
// Usage:
//   cli.js ledger add <income|expense> <amount> <source> [note...] [--business=<name>]
//   cli.js ledger list
//   cli.js ledger verify <id>          (humans/verifiers only)
//   cli.js relay request <kind> <description...>
//   cli.js relay list
//   cli.js draft submit <channel> <content...>  (stdin, if piped, is the content)
//   cli.js draft list [status]
//   cli.js draft mark-sent <id>        (only allowed for approved drafts)
//   cli.js decide <decision text...>
//   cli.js notify <message...>
//   cli.js local <prompt...>          (stdin, if piped, is appended as context)
async function main(): Promise<void> {
  const config = loadConfig();
  const argv = process.argv.slice(2);
  let business: string | undefined;
  const positional = argv.filter((a) => {
    if (a.startsWith("--business=")) {
      business = a.slice("--business=".length) || undefined;
      return false;
    }
    return true;
  });
  const [group, action, ...rest] = positional;
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
      business,
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

  if (group === "draft" && action === "submit") {
    const [channel, ...words] = rest;
    if (!channel) fail("usage: draft submit <channel> <content...> (or pipe content)");
    const stdin = process.stdin.isTTY ? "" : await readStdin();
    const content = stdin || words.join(" ");
    if (!content) fail("draft content missing (argument or stdin)");
    const draft = new Drafts(config.dataDir).submit(channel, content);
    console.log(JSON.stringify(draft));
    const preview = content.length > 400 ? content.slice(0, 400) + "…" : content;
    await telegram.send(
      `✍️ Draft [${draft.id}] (${channel}) awaiting approval:\n${preview}\nReply /approve ${draft.id} or /deny ${draft.id} <reason>.`,
    );
    return;
  }

  if (group === "draft" && action === "list") {
    const status = rest[0] as
      | "pending"
      | "approved"
      | "rejected"
      | "sent"
      | undefined;
    for (const d of new Drafts(config.dataDir).list(status)) {
      console.log(JSON.stringify(d));
    }
    return;
  }

  if (group === "draft" && action === "mark-sent") {
    const draft = new Drafts(config.dataDir).setStatus(rest[0] ?? "", "sent");
    if (!draft) {
      fail(
        `cannot mark ${rest[0]} as sent (unknown id, or draft not in approved state)`,
      );
    }
    console.log(JSON.stringify(draft));
    return;
  }

  if (group === "decide") {
    const text = [action, ...rest].filter(Boolean).join(" ");
    if (!text) fail("usage: decide <decision text...>");
    console.log(recordDecision(config.dataDir, text));
    return;
  }

  if (group === "local") {
    const prompt = [action, ...rest].filter(Boolean).join(" ");
    if (!prompt) fail("usage: local <prompt...>  (pipe extra context via stdin)");
    const stdin = process.stdin.isTTY ? "" : await readStdin();
    const full = stdin ? `${prompt}\n\n---\nInput:\n${stdin}` : prompt;
    const out = await localGenerate(config.ollamaUrl, config.localModel, full, {
      timeoutMs: config.localTimeoutSeconds * 1000,
    });
    console.log(out.trim());
    return;
  }

  if (group === "notify") {
    const message = [action, ...rest].filter(Boolean).join(" ");
    if (!message) fail("usage: notify <message...>");
    await telegram.send(`📣 ${message}`);
    return;
  }

  fail(
    "usage: <ledger add|ledger list|ledger verify|relay request|relay list|draft submit|draft list|draft mark-sent|decide|notify|local> ...",
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
