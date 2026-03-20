/**
 * APEXFX PROXY SERVER — Production Ready
 * Deploy to Render.com (free) — zero dependencies, pure Node.js
 */

const http  = require("http");
const https = require("https");
const url   = require("url");

const PORT         = process.env.PORT     || 3001;
const OANDA_TOKEN  = process.env.OANDA_TOKEN   || "391364c0ba92bb6e2301f02126fa5424-5f926a79acd1d6e071cdb14946a52be4";
const OANDA_ACCT   = process.env.OANDA_ACCOUNT || "101-001-38845298-001";
const OANDA_REST   = "api-fxpractice.oanda.com";
const OANDA_STREAM = "stream-fxpractice.oanda.com";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function oandaRequest(host, path, res, streaming = false) {
  const req = https.request({
    hostname: host, path, method: "GET",
    headers: {
      "Authorization":          `Bearer ${OANDA_TOKEN}`,
      "Accept-Datetime-Format": "RFC3339",
      "Connection":             streaming ? "keep-alive" : "close",
    },
    timeout: 30000,
  }, (oandaRes) => {
    if (streaming) {
      res.writeHead(200, {
        ...CORS,
        "Content-Type":      "text/plain; charset=utf-8",
        "Cache-Control":     "no-cache",
        "Connection":        "keep-alive",
        "Transfer-Encoding": "chunked",
        "X-Accel-Buffering": "no",
      });
      oandaRes.on("data",  c => { try { res.write(c); } catch {} });
      oandaRes.on("end",   () => { try { res.end();   } catch {} });
      oandaRes.on("error", () => { try { res.end();   } catch {} });
      res.on("close", () => { try { req.destroy(); } catch {} });
    } else {
      let body = "";
      oandaRes.on("data", d => (body += d));
      oandaRes.on("end",  () => {
        res.writeHead(oandaRes.statusCode, { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-cache" });
        res.end(body);
      });
    }
  });
  req.on("timeout", () => { req.destroy(); try { res.writeHead(504, CORS); res.end("{}"); } catch {} });
  req.on("error",   e  => { console.error(e.message); try { if (!res.headersSent) { res.writeHead(502, CORS); res.end("{}"); } } catch {} });
  req.end();
}

const server = http.createServer((req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
  if (req.method !== "GET")     { res.writeHead(405, CORS); res.end(); return; }

  console.log(`[${new Date().toISOString()}] ${pathname}`);

  if (pathname === "/" || pathname === "/health") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", account: OANDA_ACCT, time: new Date().toISOString() }));
    return;
  }
  if (pathname === "/account") {
    oandaRequest(OANDA_REST, `/v3/accounts/${OANDA_ACCT}/summary`, res);
    return;
  }
  if (pathname === "/prices") {
    const inst = parsed.query.instruments || "XAU_USD,EUR_USD";
    oandaRequest(OANDA_REST, `/v3/accounts/${OANDA_ACCT}/pricing?instruments=${encodeURIComponent(inst)}`, res);
    return;
  }
  if (pathname === "/stream") {
    const inst = parsed.query.instruments || "XAU_USD,EUR_USD";
    oandaRequest(OANDA_STREAM, `/v3/accounts/${OANDA_ACCT}/pricing/stream?instruments=${encodeURIComponent(inst)}&snapshot=true`, res, true);
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ error: "Not found" }));
});

// ── Keep Render free tier awake (pings itself every 5 min) ──
const SELF_URL = process.env.SELF_URL;
if (SELF_URL) {
  const ping = () => {
    https.get(`${SELF_URL}/health`, (r) => {
      console.log(`[keep-alive] ${r.statusCode} @ ${new Date().toISOString()}`);
    }).on("error", (e) => {
      console.warn("[keep-alive] ping failed:", e.message);
    });
  };
  // Ping immediately on start, then every 5 minutes
  setTimeout(ping, 5000);
  setInterval(ping, 5 * 60 * 1000);
  console.log(`Keep-alive enabled → ${SELF_URL} (every 5 min)`);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`APEXFX Proxy running on port ${PORT} | Account: ${OANDA_ACCT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT",  () => server.close(() => process.exit(0)));
      
