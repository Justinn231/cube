import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface LedgerEntry {
  id: string;
  ts: string;
  type: "income" | "expense";
  amount: number;
  currency: string;
  source: string;
  // Which micro-business in the portfolio this entry belongs to (per-business
  // P&L drives the war-room kill/scale decisions).
  business?: string;
  ref?: string;
  note?: string;
  // Entries written by the agent start unverified. A human (or an external
  // verifier that reconciles against Stripe/wallet/marketplace records)
  // flips this — never the agent itself.
  verified: boolean;
}

export class Ledger {
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "ledger.jsonl");
  }

  add(
    entry: Omit<LedgerEntry, "id" | "ts" | "verified">,
  ): LedgerEntry {
    if (!Number.isFinite(entry.amount) || entry.amount <= 0) {
      throw new Error(`invalid amount: ${entry.amount}`);
    }
    const full: LedgerEntry = {
      id: crypto.randomBytes(6).toString("hex"),
      ts: new Date().toISOString(),
      verified: false,
      ...entry,
    };
    fs.appendFileSync(this.file, JSON.stringify(full) + "\n");
    return full;
  }

  readAll(): LedgerEntry[] {
    if (!fs.existsSync(this.file)) return [];
    return fs
      .readFileSync(this.file, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as LedgerEntry);
  }

  verify(id: string): LedgerEntry | null {
    const entries = this.readAll();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;
    entry.verified = true;
    fs.writeFileSync(
      this.file,
      entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
    return entry;
  }

  totals(): {
    income: number;
    expenses: number;
    verifiedIncome: number;
    net: number;
    entries: number;
  } {
    let income = 0;
    let expenses = 0;
    let verifiedIncome = 0;
    const all = this.readAll();
    for (const e of all) {
      if (e.type === "income") {
        income += e.amount;
        if (e.verified) verifiedIncome += e.amount;
      } else {
        expenses += e.amount;
      }
    }
    return {
      income,
      expenses,
      verifiedIncome,
      net: income - expenses,
      entries: all.length,
    };
  }

  totalsByBusiness(): Map<
    string,
    { income: number; expenses: number; net: number }
  > {
    const out = new Map<
      string,
      { income: number; expenses: number; net: number }
    >();
    for (const e of this.readAll()) {
      const key = e.business ?? "(untagged)";
      const t = out.get(key) ?? { income: 0, expenses: 0, net: 0 };
      if (e.type === "income") t.income += e.amount;
      else t.expenses += e.amount;
      t.net = t.income - t.expenses;
      out.set(key, t);
    }
    return out;
  }
}
