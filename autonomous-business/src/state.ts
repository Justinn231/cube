import fs from "node:fs";
import path from "node:path";
import type { CycleResult } from "./worker.js";

export interface State {
  startedAt: string;
  cyclesTotal: number;
  cyclesByStatus: Record<string, number>;
  lastCycle: CycleResult | null;
  lastReportDate: string; // YYYY-MM-DD in local time
  lastWarRoomDate?: string; // YYYY-MM-DD of the last war-room cycle
  currentBackoffMinutes: number;
}

export function loadState(dataDir: string): State {
  const file = path.join(dataDir, "state.json");
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8")) as State;
  }
  return {
    startedAt: new Date().toISOString(),
    cyclesTotal: 0,
    cyclesByStatus: {},
    lastCycle: null,
    lastReportDate: "",
    currentBackoffMinutes: 0,
  };
}

export function saveState(dataDir: string, state: State): void {
  fs.writeFileSync(
    path.join(dataDir, "state.json"),
    JSON.stringify(state, null, 2),
  );
}

export function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
