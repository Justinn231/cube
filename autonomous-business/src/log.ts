import fs from "node:fs";
import path from "node:path";

let logFile: string | null = null;

export function initLog(dataDir: string, name: string): void {
  logFile = path.join(dataDir, "logs", `${name}.log`);
}

export function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, line + "\n");
}
