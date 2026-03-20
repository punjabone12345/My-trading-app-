/**
 * APEXFX PROXY SERVER — Production Ready
 * Handles CORS, OANDA streaming, REST fallback
 * Compatible with Railway, Render, Fly.io, any VPS
 */

const http  = require("http");
const https = require("https");
const url   = require("url");

const PORT         = process.env.PORT || 3001;
const OANDA_TOKEN  = process.env.OANDA_TOKEN  || "391364c0ba92bb6e2301f02126fa5424-5f926a79acd1d6e071cdb14946a52be4";
const OANDA_ACCT   = process.env.OANDA_ACCOUNT || "101-001-38845298-001";
const OANDA_REST   = "api-fxpractice.oanda.com";
const OANDA_STREAM = "stream-fxpractice.oanda.com";

// Allow requests from any origin (PWA on any domain)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age":       "86400",
};

// ── HTTPS request to OANDA ────────────────────────────────────────────────────
function oandaRequest(host, path, res, streaming = false) {
  const options = {
    hostname: host,
    path,
    method:   "GET",
    headers: {
      "Authorization":          `Bearer ${OANDA_TOKEN}`,
      "Accept-Datetime-Format": "RFC3339",
      "Connection":             streaming ? "keep-alive" : "close",
    },
    timeout: 30000,
  };

  const req = https.request(options, (oandaRes) => {
    if (streaming) {
      res.writeHead(200, {
        ...CORS_HEADERS,
        "Content-Type":      "text/plain; charset=utf-8",
        "Cache-Control":     "no-cache, no-store",
        "Connection":        "keep-alive",
        "Transfer-Encoding": "chunked",
        "X-Accel-Buffering": "no",   // Disable nginx buffering
      });

      oandaRes.on("data",  chunk => { try { res.write(chunk); } catch {} });
      oandaRes.on("end",   ()    => { try { res.end();        } catch {} });
      oandaRes.on("error", ()    => { try { res.end();        } catch {} });

      // Clean up when client disconnects
      res.on("close",   () => { try { req.destroy(); } catch {} });
      res.on("finish",  () => { try { req.destroy(); } catch {} });

    } else {
      let body = "";
      oandaRes.on("data", d  => (body += d));
      oandaRes.on("end",  () => {
        res.writeHead(oandaRes.statusCode, {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        });
        res.end(body);
      });
    }
  });

  req.on("timeout", () => {
    req.destroy();
    try {
      res.writeHead(504, CORS_HEADERS);
      res.end(JSON.stringify({ error: "Gateway timeout" }));
    } catch {}
  });

  req.on("error", err => {
    console.error(`OANDA error [${host}${path}]:`, err.message);
    try {
      if (!res.headersSent) {
        res.writeHead(502, CORS_HEADERS);
        res.end(JSON.stringify({ error: err.message }));
      }
    } catch {}
  });

  req.end();
}

// ── Router ────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Only allow GET
  if (req.method !== "GET") {
    res.writeHead(405, CORS_HEADERS);
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  console.log(`[${new Date().toISOString()}] ${pathname} ${JSON.stringify(parsed.query)}`);

  // ── Health check (also prevents Render/Railway from sleeping) ──
  if (pathname === "/" || pathname === "/health") {
    res.writeHead(200, { ...CORS_HEADERS, "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status:  "ok",
      account: OANDA_ACCT,
      env:     "fxPractice",
      time:    new Date().toISOString(),
    }));
    return;
  }

  // ── Account summary ──
  if (pathname === "/account") {
    oandaRequest(OANDA_REST, `/v3/accounts/${OANDA_ACCT}/summary`, res);
    return;
  }

  // ── REST price snapshot ──
  if (pathname === "/prices") {
    const instruments = parsed.query.instruments || "XAU_USD,EUR_USD,GBP_USD,USD_JPY";
    oandaRequest(
      OANDA_REST,
      `/v3/accounts/${OANDA_ACCT}/pricing?instruments=${encodeURIComponent(instruments)}`,
      res
    );
    return;
  }

  // ── Live SSE stream ──
  if (pathname === "/stream") {
    const instruments = parsed.query.instruments || "XAU_USD,EUR_USD,GBP_USD,USD_JPY";
    oandaRequest(
      OANDA_STREAM,
      `/v3/accounts/${OANDA_ACCT}/pricing/stream?instruments=${encodeURIComponent(instruments)}&snapshot=true`,
      res,
      true
    );
    return;
  }

  // ── Instruments list ──
  if (pathname === "/instruments") {
    oandaRequest(OANDA_REST, `/v3/accounts/${OANDA_ACCT}/instruments`, res);
    return;
  }

  res.writeHead(404, { ...CORS_HEADERS, "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// Keep-alive ping so free-tier hosts don't sleep
// (Render free tier sleeps after 15min inactivity)
if (process.env.SELF_URL) {
  setInterval(() => {
    https.get(process.env.SELF_URL + "/health", () => {}).on("error", () => {});
  }, 10 * 60 * 1000); // ping every 10 minutes
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔══════════════════════════════════════════════╗
║         APEXFX PROXY  —  Production          ║
╠══════════════════════════════════════════════╣
║  Port:     ${String(PORT).padEnd(35)}║
║  Account:  ${OANDA_ACCT.padEnd(35)}║
║  Env:      fxTrade Practice                  ║
╚══════════════════════════════════════════════╝
`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT",  () => server.close(() => process.exit(0)));
