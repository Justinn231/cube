import http from "node:http";
import type { Config } from "./config.js";
import { Ledger } from "./ledger.js";
import { Relay } from "./relay.js";
import { loadState } from "./state.js";
import { log } from "./log.js";

// Read-only dashboard. Binds to localhost by default — expose it via an SSH
// tunnel or a reverse proxy with auth, never directly to the internet.
export function startDashboard(config: Config): http.Server {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/api/state") {
        return json(res, {
          state: loadState(config.dataDir),
          totals: new Ledger(config.dataDir).totals(),
          openAssists: new Relay(config.dataDir).list("open"),
        });
      }
      if (url.pathname === "/api/ledger") {
        return json(res, new Ledger(config.dataDir).readAll());
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderHtml(config));
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(err));
    }
  });
  server.listen(config.dashboardPort, "127.0.0.1", () =>
    log(`dashboard on http://127.0.0.1:${config.dashboardPort}`),
  );
  return server;
}

function json(res: http.ServerResponse, data: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

function renderHtml(config: Config): string {
  const totals = new Ledger(config.dataDir).totals();
  const state = loadState(config.dataDir);
  const open = new Relay(config.dataDir).list("open");
  const rows = new Ledger(config.dataDir)
    .readAll()
    .slice(-50)
    .reverse()
    .map(
      (e) =>
        `<tr><td>${e.ts}</td><td>${e.type}</td><td style="text-align:right">${e.amount.toFixed(2)}</td><td>${e.currency}</td><td>${esc(e.source)}</td><td>${esc(e.business ?? "")}</td><td>${e.verified ? "✅" : "❓"}</td><td>${esc(e.note ?? "")}</td></tr>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>Autonomous Business Console</title>
<style>body{font-family:system-ui;margin:2rem;max-width:70rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 8px;font-size:14px}h1{font-size:1.3rem}.k{color:#666}</style>
<h1>Autonomous Business Console</h1>
<p><span class="k">Income:</span> <b>${totals.income.toFixed(2)} ${config.currency}</b> (verified ${totals.verifiedIncome.toFixed(2)})
 · <span class="k">Expenses:</span> ${totals.expenses.toFixed(2)}
 · <span class="k">Net:</span> <b>${totals.net.toFixed(2)}</b></p>
<p><span class="k">Cycles:</span> ${state.cyclesTotal}
 · <span class="k">Last cycle:</span> ${state.lastCycle ? `${state.lastCycle.status} (${state.lastCycle.endedAt})` : "–"}
 · <span class="k">Up since:</span> ${state.startedAt}
 · <span class="k">Open assists:</span> ${open.length}</p>
${open.length ? `<ul>${open.map((r) => `<li>[${r.id}] (${esc(r.kind)}) ${esc(r.description)}</li>`).join("")}</ul>` : ""}
<h2 style="font-size:1.1rem">Ledger (last 50)</h2>
<table><tr><th>ts</th><th>type</th><th>amount</th><th>cur</th><th>source</th><th>business</th><th>verified</th><th>note</th></tr>${rows}</table>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
