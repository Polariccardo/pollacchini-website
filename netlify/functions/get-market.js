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
// Timeframes for the headline change, returns table, and global selector.
const WINDOWS = { d1: 1, d7: 7, d30: 30, m3: 91, m6: 182, m12: 365 };

// ── Symbol config ── the ONLY place tickers/labels/units/groups live.
// Add a metric here and the API + page pick it up automatically.
//   unit "index"   → plain number, 2 decimals       (indices)
//   unit "usd"     → $ prefix (+ optional suffix)    (ETFs, commodities, crypto)
//   unit "percent" → value is already a % yield       (yields)
//   unit "fx"      → 4-decimal rate, no symbol         (EUR/USD)
//   unit "bps"     → basis points, absolute change     (2s10s curve — derived)
//   unit "ratio"   → plain ratio, % change             (copper/gold — derived)
//   cat "hidden"   → fetched but not displayed (feeds a derived metric)
const SYMBOLS = [
  // Cost of Capital — yields + credit
  { symbol: "2YY=F", label: "US 2Y Yield",  unit: "percent", cat: "cost-of-capital" },
  { symbol: "^TNX",  label: "US 10Y Yield", unit: "percent", cat: "cost-of-capital" },
  { symbol: "^TYX",  label: "US 30Y Yield", unit: "percent", cat: "cost-of-capital" },
  { symbol: "HYG",   label: "High-Yield Credit",       unit: "usd", cat: "cost-of-capital" },
  { symbol: "LQD",   label: "Investment-Grade Credit", unit: "usd", cat: "cost-of-capital" },

  // Macro
  { symbol: "^GSPC",    label: "S&P 500",          unit: "index", cat: "macro" },
  { symbol: "^STOXX",   label: "STOXX Europe 600", unit: "index", cat: "macro" },
  { symbol: "GC=F",     label: "Gold",             unit: "usd", suffix: "/oz",  cat: "macro" },
  { symbol: "BZ=F",     label: "Brent Crude",      unit: "usd", suffix: "/bbl", cat: "macro" },
  { symbol: "HG=F",     label: "Copper",           unit: "usd", suffix: "/lb",  cat: "macro" },
  { symbol: "BTC-USD",  label: "Bitcoin",          unit: "usd", cat: "macro" },
  { symbol: "^VIX",     label: "VIX",              unit: "index", cat: "macro" },
  { symbol: "EURUSD=X", label: "EUR / USD",        unit: "fx",  cat: "macro" },

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
  { key: "cost-of-capital", label: "Cost of Capital" },
  { key: "macro",           label: "Macro" },
  { key: "sectors",         label: "Sectors — SPDR Select ETFs" },
];

// Why each metric matters, in plain language anyone new to finance can follow.
// Keyed by symbol; sectors deliberately have none.
const INFO = {
  "2YY=F": "This is what the US government pays to borrow money for 2 years. It moves with what people expect central banks to do with interest rates soon, so it's the quickest hint of where borrowing costs are heading. If a company has loans whose rate can change, this is roughly what they follow.",
  "^TNX": "What the US government pays to borrow for 10 years. It's treated as the 'safe' baseline interest rate that everything else is compared against. When it rises, borrowing gets more expensive everywhere and companies — especially fast-growing ones — are worth a bit less. It's one of the most-watched numbers in all of finance.",
  "^TYX": "What the government pays to borrow for a very long time — 30 years. Because it looks so far ahead, it reflects what people expect for growth and inflation over the long run, and whether today's inflation is seen as temporary or here to stay.",
  "HYG": "A fund holding bonds from riskier companies. When its price falls, it means lenders want to be paid more to lend to weaker borrowers — a sign that money is getting harder and pricier to raise. A useful early warning that lending conditions are tightening.",
  "LQD": "A fund holding bonds from financially strong companies. It shows what safe, solid businesses pay to borrow. A sharp drop means even reliable borrowers face higher costs — a signal that financial conditions are tightening across the board.",
  "CURVE_2S10S": "The gap between the 10-year and 2-year government interest rates. Normally longer loans cost more, so the gap is positive. When it flips negative (short-term costs more than long-term), it has warned of nearly every past recession. A quick one-number health check on the economy.",
  "^GSPC": "The index of the 500 biggest US companies — the main scoreboard for how the US stock market is doing. When it's rising, investors are optimistic and companies tend to be valued more generously, which matters whether you're public or raising money privately.",
  "^STOXX": "A broad index of 600 large European companies — basically Europe's version of the S&P 500. It's the home-market scoreboard for a Europe-based business and a read on how European investors are feeling.",
  "GC=F": "The classic 'safe haven.' People buy gold when they worry about inflation, the value of currencies, or global instability. So a rising gold price is a handy hint that investors are getting nervous.",
  "BZ=F": "The main global oil price. It feeds straight into fuel, shipping and manufacturing costs, so it affects most companies' expenses — and it's a live read on how strong global demand is.",
  "HG=F": "Copper goes into almost everything that gets built, so its price rises and falls with the health of the global economy — that's why it's nicknamed 'Dr. Copper.' Rising copper usually means growth is picking up; falling copper hints at a slowdown before the official data shows it.",
  "BTC-USD": "The largest cryptocurrency, and a fast (if jumpy) gauge of how much appetite investors have for risk. It tends to climb when money is cheap and plentiful, and to fall first when conditions tighten — a quick sentiment thermometer.",
  "EURUSD=X": "How many dollars one euro buys — the most important exchange rate for a European company that earns or spends in dollars. It changes what your dollar sales and costs are worth back in euros, which is why it matters for pricing and planning.",
  "COPPER_GOLD": "Copper (which rises when growth is strong) divided by gold (which rises when people are fearful). Together they make a simple 'growth vs. fear' gauge: rising means optimism, falling means caution.",
  "COPPER_BRENT": "Copper compared with oil — two things that both get more expensive when the economy is strong. Looking at them together helps show whether growth is genuinely strong, or whether prices are just being pushed up by costly energy.",
  "^VIX": "Often called the market's 'fear gauge.' It measures how big a swing investors expect in the stock market over the next month. Low means calm and confident; a spike means fear — and when fear is high, it gets harder to raise money or get deals done.",
};

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

  return {
    symbol: cfg.symbol,
    label: cfg.label,
    unit: cfg.unit || "index",
    suffix: cfg.suffix || "",
    cat: cfg.cat,
    info: INFO[cfg.symbol],
    current,
    changePct: changes.d30, // default headline change (the client can switch timeframe)
    changes,
    history, // full ~1y daily series; the client slices it to the selected window
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

// Absolute change (current − past), in the series' own units. Used for spreads
// where a percentage change would be meaningless (e.g. a 0.5→0.6pp curve move).
function absChange(history, current, days) {
  if (current == null || !history.length) return null;
  const cutoff = history.at(-1).t - days * DAY;
  let base = history[0].c;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].t <= cutoff) { base = history[i].c; break; }
  }
  return Number((current - base).toFixed(1));
}

// Pair two series by calendar day → [{t, a, b}]. Day-bucketing (not exact
// timestamp) is required because different exchanges stamp their daily bars at
// different times (e.g. ^TNX vs the 2Y yield future).
function align(a, b) {
  if (!a || !b) return [];
  const bMap = new Map(b.history.map(p => [Math.floor(p.t / DAY), p.c]));
  const out = [];
  for (const p of a.history) {
    const bc = bMap.get(Math.floor(p.t / DAY));
    if (bc != null) out.push({ t: p.t, a: p.c, b: bc });
  }
  return out;
}

// 2s10s curve = 10Y − 2Y, expressed in basis points; change shown absolutely.
function deriveCurve(ten, two, meta) {
  if (!ten || !two || ten.current == null || two.current == null) return null;
  const al = align(ten, two);
  if (al.length < 2) return null;
  const history = al.map(x => ({ t: x.t, c: Number(((x.a - x.b) * 100).toFixed(1)) }));
  const current = Number(((ten.current - two.current) * 100).toFixed(1));
  const changes = {};
  for (const [k, days] of Object.entries(WINDOWS)) changes[k] = absChange(history, current, days);
  return { symbol: meta.symbol, label: meta.label, info: meta.info, unit: "bps", changeAbs: true, cat: meta.cat, current, changePct: changes.d30, changes, history };
}

// Commodity ratio (growth-vs-fear barometer); change shown as %. Scaled to a
// readable magnitude (the absolute level of a cross-unit ratio is arbitrary).
function deriveRatio(num, den, meta, scale = 1) {
  if (!num || !den || num.current == null || den.current == null) return null;
  const al = align(num, den);
  if (al.length < 2) return null;
  const history = al.map(x => ({ t: x.t, c: Number((x.a / x.b * scale).toFixed(3)) }));
  const current = Number((num.current / den.current * scale).toFixed(3));
  const changes = {};
  for (const [k, days] of Object.entries(WINDOWS)) changes[k] = pctChange(history, current, days);
  return { symbol: meta.symbol, label: meta.label, info: meta.info, unit: "ratio", cat: meta.cat, current, changePct: changes.d30, changes, history };
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

    // Derived metrics, appended to the end of their group.
    const bySym = Object.fromEntries(ok.map(it => [it.symbol, it]));
    const curve = deriveCurve(bySym["^TNX"], bySym["2YY=F"], { symbol: "CURVE_2S10S", label: "2s10s Curve", cat: "cost-of-capital", info: INFO.CURVE_2S10S });
    if (curve) ok.push(curve); else failed.push("CURVE_2S10S");
    const cgRatio = deriveRatio(bySym["HG=F"], bySym["GC=F"], { symbol: "COPPER_GOLD", label: "Copper / Gold", cat: "macro", info: INFO.COPPER_GOLD }, 1000);
    if (cgRatio) ok.push(cgRatio); else failed.push("COPPER_GOLD");
    const cbRatio = deriveRatio(bySym["HG=F"], bySym["BZ=F"], { symbol: "COPPER_BRENT", label: "Copper / Brent", cat: "macro", info: INFO.COPPER_BRENT }, 100);
    if (cbRatio) ok.push(cbRatio); else failed.push("COPPER_BRENT");

    // Bucket into groups, preserving GROUPS order; drop empty groups.
    // (Items with cat "hidden", e.g. copper, match no group and drop out.)
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
