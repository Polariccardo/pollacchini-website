// netlify/functions/get-market.js
// Fetches live market data from Yahoo Finance for the homepage Markets section.
// Dependency-free (native fetch, ESM handler) to match the other functions.
//
// Freshness: the response carries `s-maxage=3600`, so Netlify's CDN serves a
// cached copy for one hour and only re-hits Yahoo on the first request after
// it expires. That gives hourly refresh without a scheduled function or commits.
//
// Yahoo's chart API is unofficial. Individual symbols are fetched independently
// and a single failure never fails the whole response — the symbol is simply
// omitted and the page renders the rest.

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";
const RANGE = "1y";       // fetch a year so we can compute up to 12-month change
const INTERVAL = "1d";
const DAY = 24 * 60 * 60; // seconds
const CHART_DAYS = 31;    // front chart shows ~last 30 days (aligns with 30d change)
// Timeframes shown on the back of each card.
const WINDOWS = { d1: 1, d7: 7, d30: 30, m3: 91, m6: 182, m12: 365 };

// ── Symbol config ── the ONLY place tickers/labels/units/groups live.
// Add a metric here and the API + page pick it up automatically.
//   unit "index"   → plain number, 2 decimals       (indices)
//   unit "usd"     → $ prefix (+ optional suffix)    (ETFs, commodities, crypto)
//   unit "percent" → value is already a % yield       (10Y)
//   cat            → which group the card renders under (see GROUPS below)
const SYMBOLS = [
  // Markets — broad equity indices, global
  { symbol: "^GSPC",   label: "S&P 500",            unit: "index", cat: "markets" },
  { symbol: "^IXIC",   label: "Nasdaq",             unit: "index", cat: "markets" },
  { symbol: "^STOXX",  label: "STOXX Europe 600",   unit: "index", cat: "markets" },
  { symbol: "^N225",   label: "Nikkei 225 · Asia",  unit: "index", cat: "markets" },
  { symbol: "^BVSP",   label: "Bovespa · Brazil",   unit: "index", cat: "markets" },

  // Commodities (incl. crypto)
  { symbol: "GC=F",    label: "Gold",        unit: "usd", suffix: "/oz",  cat: "commodities" },
  { symbol: "SI=F",    label: "Silver",      unit: "usd", suffix: "/oz",  cat: "commodities" },
  { symbol: "HG=F",    label: "Copper",      unit: "usd", suffix: "/lb",  cat: "commodities" },
  { symbol: "BZ=F",    label: "Brent Crude", unit: "usd", suffix: "/bbl", cat: "commodities" },
  { symbol: "BTC-USD", label: "Bitcoin",     unit: "usd", cat: "commodities" },

  // Rates — US Treasury yields
  { symbol: "2YY=F",   label: "US 2Y Yield",  unit: "percent", cat: "rates" },
  { symbol: "^TNX",    label: "US 10Y Yield", unit: "percent", cat: "rates" },
  { symbol: "^TYX",    label: "US 30Y Yield", unit: "percent", cat: "rates" },

  // Sectors — SPDR select-sector ETFs
  { symbol: "XLK",  label: "Technology",       unit: "usd", cat: "sectors" },
  { symbol: "XLV",  label: "Health Care",      unit: "usd", cat: "sectors" },
  { symbol: "XLF",  label: "Financials",       unit: "usd", cat: "sectors" },
  { symbol: "XLY",  label: "Consumer Disc.",   unit: "usd", cat: "sectors" },
  { symbol: "XLC",  label: "Communication",    unit: "usd", cat: "sectors" },
  { symbol: "XLI",  label: "Industrials",      unit: "usd", cat: "sectors" },
  { symbol: "XLP",  label: "Consumer Staples", unit: "usd", cat: "sectors" },
  { symbol: "XLE",  label: "Energy",           unit: "usd", cat: "sectors" },
  { symbol: "XLU",  label: "Utilities",        unit: "usd", cat: "sectors" },
  { symbol: "XLRE", label: "Real Estate",      unit: "usd", cat: "sectors" },
  { symbol: "XLB",  label: "Materials",        unit: "usd", cat: "sectors" },
];

// Group order + display labels for the page.
const GROUPS = [
  { key: "markets",     label: "Markets — Global Equity Indices" },
  { key: "commodities", label: "Commodities" },
  { key: "rates",       label: "Rates — US Treasury Yields" },
  { key: "sectors",     label: "Sectors — SPDR Select ETFs" },
];

// Fetch JSON with a hard per-request timeout + one retry. Without the timeout,
// a single hanging Yahoo request would stall the whole function past Netlify's
// ~10s limit and surface as a 5xx ("Data unavailable") on the page.
async function fetchJson(url, { attempts = 2, timeoutMs = 3500 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 250));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function fetchSymbol(cfg) {
  const url = `${YAHOO}/${encodeURIComponent(cfg.symbol)}?range=${RANGE}&interval=${INTERVAL}`;
  const json = await fetchJson(url);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${cfg.symbol}`);

  const meta = result.meta;
  const stamps = result.timestamp || [];
  const rawCloses = result.indicators?.quote?.[0]?.close || [];

  // Keep only complete points, preserving time alignment.
  const history = [];
  for (let i = 0; i < stamps.length; i++) {
    const c = rawCloses[i];
    if (c != null) history.push({ t: stamps[i], c: Number(c.toFixed(4)) });
  }

  const current = meta.regularMarketPrice ?? history.at(-1)?.c ?? null;

  // % change over each timeframe, computed from the full-year series.
  const changes = {};
  for (const [k, days] of Object.entries(WINDOWS)) changes[k] = pctChange(history, current, days);

  // Front chart only carries the most recent ~30 days (keeps payload small and
  // aligns the line with the 30-day headline change).
  const chartHistory = history.length
    ? history.filter(p => p.t >= history.at(-1).t - CHART_DAYS * DAY)
    : history;

  return {
    symbol: cfg.symbol,
    label: cfg.label,
    unit: cfg.unit || "index",
    suffix: cfg.suffix || "",
    cat: cfg.cat,
    current,
    changePct: changes.d30, // headline change, aligned with the chart window
    changes,
    history: chartHistory,
  };
}

// % change of `current` vs the last close on or before `days` ago.
// Falls back to the earliest point available if the series is shorter.
function pctChange(history, current, days) {
  if (current == null || !history.length) return null;
  const cutoff = history.at(-1).t - days * DAY;
  let base = history[0].c;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].t <= cutoff) { base = history[i].c; break; }
  }
  if (!base) return null;
  return Number(((current - base) / base * 100).toFixed(2));
}

export const handler = async () => {
  try {
    const settled = await Promise.allSettled(SYMBOLS.map(fetchSymbol));
    const ok = [];
    const failed = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") ok.push(r.value);
      else { failed.push(SYMBOLS[i].symbol); console.error("get-market:", r.reason?.message); }
    });

    // Bucket into groups, preserving GROUPS order; drop empty groups.
    const groups = GROUPS
      .map(g => ({ key: g.key, label: g.label, items: ok.filter(it => it.cat === g.key) }))
      .filter(g => g.items.length);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
      body: JSON.stringify({
        updatedAt: new Date().toISOString(),
        groups,
        failed,
      }),
    };
  } catch (err) {
    console.error("get-market fatal:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
