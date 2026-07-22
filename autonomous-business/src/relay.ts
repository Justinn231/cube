import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface RelayRequest {
  id: string;
  ts: string;
  kind: string; // e.g. "account", "api-key", "kyc", "spend-approval"
  description: string;
  status: "open" | "resolved" | "rejected";
  resolution?: string;
  resolvedTs?: string;
}

// Human-in-the-loop request queue ("Relay"): the agent files structured
// requests for things only a human can do (accounts, KYC, API keys, spend
// approvals). Humans resolve them via Telegram /resolve or /reject.
export class Relay {
  private dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "relay");
  }

  private fileFor(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  create(kind: string, description: string): RelayRequest {
    const req: RelayRequest = {
      id: crypto.randomBytes(4).toString("hex"),
      ts: new Date().toISOString(),
      kind,
      description,
      status: "open",
    };
    fs.writeFileSync(this.fileFor(req.id), JSON.stringify(req, null, 2));
    return req;
  }

  list(status?: RelayRequest["status"]): RelayRequest[] {
    if (!fs.existsSync(this.dir)) return [];
    const all = fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map(
        (f) =>
          JSON.parse(
            fs.readFileSync(path.join(this.dir, f), "utf8"),
          ) as RelayRequest,
      )
      .sort((a, b) => a.ts.localeCompare(b.ts));
    return status ? all.filter((r) => r.status === status) : all;
  }

  settle(
    id: string,
    status: "resolved" | "rejected",
    resolution: string,
  ): RelayRequest | null {
    const file = this.fileFor(id);
    if (!fs.existsSync(file)) return null;
    const req = JSON.parse(fs.readFileSync(file, "utf8")) as RelayRequest;
    req.status = status;
    req.resolution = resolution;
    req.resolvedTs = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(req, null, 2));
    return req;
  }
}
