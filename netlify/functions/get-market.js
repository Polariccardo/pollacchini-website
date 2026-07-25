// netlify/functions/get-market.js
// Fetches live market data from Yahoo Finance for the /dashboard page.
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
const RANGE = "1mo";
const INTERVAL = "1d";
const SEVEN_DAYS = 7 * 24 * 60 * 60; // seconds — change window

// ── Symbol config ── the ONLY place tickers/labels/units live.
// Add a metric here and both the API and the page pick it up. `unit`:
//   "index"   → plain number, 2 decimals            (S&P, Nasdaq)
//   "usd"     → $ prefix                             (Bitcoin, Gold, Brent)
//   "percent" → value is already a percentage yield  (10Y)
const HEADLINE = [
  { symbol: "^GSPC",   label: "S&P 500",     unit: "index" },
  { symbol: "^IXIC",   label: "Nasdaq",      unit: "index" },
  { symbol: "BTC-USD", label: "Bitcoin",     unit: "usd"   },
  { symbol: "GC=F",    label: "Gold",        unit: "usd", suffix: "/oz"  },
  { symbol: "BZ=F",    label: "Brent Crude", unit: "usd", suffix: "/bbl" },
  { symbol: "^TNX",    label: "US 10Y Yield", unit: "percent" },
];

// SPDR sector ETFs — the "industries trend" heatmap.
const SECTORS = [
  { symbol: "XLK",  label: "Technology" },
  { symbol: "XLV",  label: "Health Care" },
  { symbol: "XLF",  label: "Financials" },
  { symbol: "XLY",  label: "Consumer Disc." },
  { symbol: "XLC",  label: "Communication" },
  { symbol: "XLI",  label: "Industrials" },
  { symbol: "XLP",  label: "Consumer Staples" },
  { symbol: "XLE",  label: "Energy" },
  { symbol: "XLU",  label: "Utilities" },
  { symbol: "XLRE", label: "Real Estate" },
  { symbol: "XLB",  label: "Materials" },
];

async function fetchSymbol(cfg) {
  const url = `${YAHOO}/${encodeURIComponent(cfg.symbol)}?range=${RANGE}&interval=${INTERVAL}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo ${res.status} for ${cfg.symbol}`);

  const json = await res.json();
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

  // 7-day change: compare against the last close on or before 7 days ago.
  // Falls back to the earliest point we have if the series is shorter.
  let base = history[0]?.c;
  if (history.length) {
    const cutoff = history.at(-1).t - SEVEN_DAYS;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].t <= cutoff) { base = history[i].c; break; }
    }
  }
  const changePct = current != null && base ? ((current - base) / base) * 100 : null;

  return {
    symbol: cfg.symbol,
    label: cfg.label,
    unit: cfg.unit || "index",
    suffix: cfg.suffix || "",
    current,
    changePct: changePct != null ? Number(changePct.toFixed(2)) : null,
    history,
  };
}

async function fetchGroup(configs) {
  const settled = await Promise.allSettled(configs.map(fetchSymbol));
  const ok = [];
  const failed = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") ok.push(r.value);
    else { failed.push(configs[i].symbol); console.error("get-market:", r.reason?.message); }
  });
  return { ok, failed };
}

export const handler = async () => {
  try {
    const [headline, sectors] = await Promise.all([
      fetchGroup(HEADLINE),
      fetchGroup(SECTORS),
    ]);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        // 1h fresh at the CDN, plus a day of stale-while-revalidate as a safety net.
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
      body: JSON.stringify({
        updatedAt: new Date().toISOString(),
        headline: headline.ok,
        sectors: sectors.ok,
        failed: [...headline.failed, ...sectors.failed],
      }),
    };
  } catch (err) {
    console.error("get-market fatal:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
