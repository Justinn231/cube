import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface Draft {
  id: string;
  ts: string;
  channel: string; // e.g. "email", "marketplace-reply", "social-post"
  content: string;
  status: "pending" | "approved" | "rejected" | "sent";
  note?: string;
  settledTs?: string;
}

// Outbound-communication draft queue: the agent never sends external
// communication directly — it files a draft, the human approves or denies it
// via Telegram, and only then does the agent send it (and marks it sent).
export class Drafts {
  private dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "drafts");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private fileFor(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  submit(channel: string, content: string): Draft {
    const draft: Draft = {
      id: crypto.randomBytes(4).toString("hex"),
      ts: new Date().toISOString(),
      channel,
      content,
      status: "pending",
    };
    fs.writeFileSync(this.fileFor(draft.id), JSON.stringify(draft, null, 2));
    return draft;
  }

  list(status?: Draft["status"]): Draft[] {
    const all = fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map(
        (f) =>
          JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf8")) as Draft,
      )
      .sort((a, b) => a.ts.localeCompare(b.ts));
    return status ? all.filter((d) => d.status === status) : all;
  }

  setStatus(
    id: string,
    status: "approved" | "rejected" | "sent",
    note?: string,
  ): Draft | null {
    const file = this.fileFor(id);
    if (!fs.existsSync(file)) return null;
    const draft = JSON.parse(fs.readFileSync(file, "utf8")) as Draft;
    // Only approved drafts may be marked sent — sending is the agent's step,
    // approval is the human's, and the order is not negotiable.
    if (status === "sent" && draft.status !== "approved") return null;
    draft.status = status;
    if (note) draft.note = note;
    draft.settledTs = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(draft, null, 2));
    return draft;
  }
}
