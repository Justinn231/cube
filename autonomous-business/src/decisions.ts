import fs from "node:fs";
import path from "node:path";

// Append-only decision log ("archives"): every pivot, kill, and scale
// decision is recorded here so future war-room reviews build on documented
// history instead of whatever fits in the context window.
export function recordDecision(dataDir: string, text: string): string {
  const line = `- [${new Date().toISOString()}] ${text.replace(/\n+/g, " ").trim()}`;
  fs.appendFileSync(path.join(dataDir, "decisions.md"), line + "\n");
  return line;
}

export function recentDecisions(dataDir: string, count = 5): string[] {
  const file = path.join(dataDir, "decisions.md");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .slice(-count);
}
