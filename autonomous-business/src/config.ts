import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  rootDir: string;
  dataDir: string;
  workspaceDir: string;
  promptsDir: string;
  timezone: string;
  workerCmd: string;
  workerName: string;
  cyclePauseSeconds: number;
  maxCycleMinutes: number;
  rateLimitBackoffMinutes: number;
  maxBackoffMinutes: number;
  dailyReportHour: number;
  dashboardPort: number;
  telegramBotToken: string;
  telegramChatId: string;
  spendApprovalThreshold: number;
  currency: string;
  ollamaUrl: string;
  localModel: string;
  localTimeoutSeconds: number;
}

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadConfig(): Config {
  const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const env = { ...parseEnvFile(path.join(rootDir, ".env")), ...process.env };
  const get = (key: string, fallback: string): string =>
    (env[key] ?? "").toString().trim() || fallback;
  const num = (key: string, fallback: number): number => {
    const v = Number(get(key, String(fallback)));
    return Number.isFinite(v) ? v : fallback;
  };

  const dataDir = path.resolve(rootDir, get("DATA_DIR", "data"));
  const config: Config = {
    rootDir,
    dataDir,
    workspaceDir: path.resolve(rootDir, get("WORKSPACE_DIR", "data/workspace")),
    promptsDir: path.join(rootDir, "prompts"),
    timezone: get("TZ", "Europe/Berlin"),
    workerCmd: get(
      "WORKER_CMD",
      // Default: Claude Code in non-interactive mode. The prompt is passed via $PROMPT_FILE.
      'claude -p "$(cat "$PROMPT_FILE")" --dangerously-skip-permissions',
    ),
    workerName: get("WORKER_NAME", "claude"),
    cyclePauseSeconds: num("CYCLE_PAUSE_SECONDS", 60),
    maxCycleMinutes: num("MAX_CYCLE_MINUTES", 120),
    rateLimitBackoffMinutes: num("RATE_LIMIT_BACKOFF_MINUTES", 30),
    maxBackoffMinutes: num("MAX_BACKOFF_MINUTES", 240),
    dailyReportHour: num("DAILY_REPORT_HOUR", 8),
    dashboardPort: num("DASHBOARD_PORT", 8788),
    telegramBotToken: get("TELEGRAM_BOT_TOKEN", ""),
    telegramChatId: get("TELEGRAM_CHAT_ID", ""),
    spendApprovalThreshold: num("SPEND_APPROVAL_THRESHOLD", 5),
    currency: get("CURRENCY", "USD"),
    ollamaUrl: get("OLLAMA_URL", "http://127.0.0.1:11434"),
    localModel: get("LOCAL_MODEL", ""),
    localTimeoutSeconds: num("LOCAL_TIMEOUT_SECONDS", 300),
  };

  process.env.TZ = config.timezone;
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.workspaceDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, "relay"), { recursive: true });
  return config;
}
