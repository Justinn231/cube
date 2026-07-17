import { log } from "./log.js";

export type CommandHandler = (args: string) => Promise<string>;

// Thin Telegram Bot API client (no dependencies). If no token is configured,
// runs in disabled mode: outgoing messages go to the log only. This keeps the
// whole system runnable locally without any accounts.
export class Telegram {
  private token: string;
  private chatId: string;
  private offset = 0;
  private handlers = new Map<string, CommandHandler>();
  private polling = false;

  constructor(token: string, chatId: string) {
    this.token = token;
    this.chatId = chatId;
  }

  get enabled(): boolean {
    return Boolean(this.token && this.chatId);
  }

  private api(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  async send(text: string): Promise<void> {
    if (!this.enabled) {
      log(`[telegram:disabled] ${text}`);
      return;
    }
    try {
      const res = await fetch(this.api("sendMessage"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text }),
      });
      if (!res.ok) log(`telegram send failed: ${res.status} ${await res.text()}`);
    } catch (err) {
      log(`telegram send error: ${String(err)}`);
    }
  }

  on(command: string, handler: CommandHandler): void {
    this.handlers.set(command, handler);
  }

  startPolling(): void {
    if (!this.enabled || this.polling) return;
    this.polling = true;
    void this.pollLoop();
  }

  stopPolling(): void {
    this.polling = false;
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const res = await fetch(
          this.api(`getUpdates?timeout=50&offset=${this.offset}`),
        );
        if (!res.ok) {
          await sleep(10_000);
          continue;
        }
        const data = (await res.json()) as {
          result?: Array<{
            update_id: number;
            message?: { chat: { id: number }; text?: string };
          }>;
        };
        for (const update of data.result ?? []) {
          this.offset = update.update_id + 1;
          const msg = update.message;
          if (!msg?.text || String(msg.chat.id) !== this.chatId) continue;
          await this.dispatch(msg.text.trim());
        }
      } catch (err) {
        log(`telegram poll error: ${String(err)}`);
        await sleep(10_000);
      }
    }
  }

  private async dispatch(text: string): Promise<void> {
    if (!text.startsWith("/")) return;
    const space = text.indexOf(" ");
    const command = (space === -1 ? text : text.slice(0, space)).replace(
      /@\w+$/,
      "",
    );
    const args = space === -1 ? "" : text.slice(space + 1).trim();
    const handler = this.handlers.get(command);
    if (!handler) {
      await this.send(
        `Unknown command ${command}. Available: ${[...this.handlers.keys()].join(" ")}`,
      );
      return;
    }
    try {
      await this.send(await handler(args));
    } catch (err) {
      await this.send(`Error handling ${command}: ${String(err)}`);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
