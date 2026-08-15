import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StockSDK } from 'stock-sdk';

const dashboardDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(dashboardDir, '..', '..');
const publicDir = path.join(dashboardDir, 'public');
const stateDir = process.env.STOCK_RESEARCH_STATE_DIR || '/root/.openclaw/workspace/state/stock-research';
const snapshotDir = path.join(stateDir, 'snapshots');
const watchlistPath = process.env.STOCK_RESEARCH_WATCHLIST || path.join(skillDir, 'config', 'watchlist.json');
const watchlist = JSON.parse(await fs.readFile(watchlistPath, 'utf8'));
const enabledSymbols = watchlist.symbols.filter((item) => item.enabled);
const symbolMap = new Map(enabledSymbols.map((item) => [item.technicalSymbol, item]));
const port = Number(process.env.PORT || 17110);

const sdk = new StockSDK({
  timeout: 10000,
  retry: { maxRetries: 2, baseDelay: 500 },
  rateLimit: { requestsPerSecond: 3, maxBurst: 3 },
});

const quoteCache = new Map();
const chartCache = new Map();

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function serveFile(res, filePath, contentType) {
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=60' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}

async function fetchQuotesForMarket(market) {
  const now = Date.now();
  const cached = quoteCache.get(market);
  if (cached && now - cached.fetchedAtMs < 15000) return cached;
  const items = enabledSymbols.filter((item) => item.market === market);
  const symbols = items.map((item) => item.quoteSymbol);
  try {
    let rows = [];
    if (market === 'A') rows = await sdk.getSimpleQuotes(symbols);
    if (market === 'HK') rows = await sdk.getHKQuotes(symbols);
    if (market === 'US') rows = await sdk.getUSQuotes(symbols);
    const result = { rows, fetchedAt: new Date().toISOString(), fetchedAtMs: now, stale: false, error: null };
    quoteCache.set(market, result);
    return result;
  } catch (error) {
    if (cached) return { ...cached, stale: true, error: error.message };
    return { rows: [], fetchedAt: new Date().toISOString(), fetchedAtMs: now, stale: true, error: error.message };
  }
}

async function fetchAllQuotes() {
  const groups = await Promise.all(['A', 'HK', 'US'].map(fetchQuotesForMarket));
  return {
    capturedAt: new Date().toISOString(),
    aShares: groups[0].rows,
    hk: groups[1].rows,
    us: groups[2].rows,
    markets: Object.fromEntries(['A', 'HK', 'US'].map((market, index) => [market, groups[index]])),
  };
}

function normalizeBar(row) {
  return {
    time: row.time || row.date,
    open: Number(row.open),
    close: Number(row.close),
    high: Number(row.high),
    low: Number(row.low),
    volume: Number(row.volume || 0),
    ma: row.ma || null,
    macd: row.macd || null,
    rsi: row.rsi || null,
  };
}

async function fetchChart(symbol, range) {
  const item = symbolMap.get(symbol);
  if (!item) return null;
  const cacheKey = `${symbol}:${range}`;
  const ttl = range === 'daily' ? 300000 : 30000;
  const cached = chartCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAtMs < ttl) return cached.data;
  let rows = [];
  if (range === 'daily') {
    rows = await sdk.getKlineWithIndicators(item.technicalSymbol, {
      market: item.market,
      period: 'daily',
      adjust: 'qfq',
      startDate: new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10),
      indicators: watchlist.indicators,
    });
  } else if (item.market === 'A') {
    rows = await sdk.getMinuteKline(item.technicalSymbol);
  } else if (item.market === 'HK') {
    rows = await sdk.getHKMinuteKline(item.technicalSymbol, { period: '1' });
  } else {
    rows = await sdk.getUSMinuteKline(item.technicalSymbol, { period: '1' });
  }
  const bars = rows.map(normalizeBar).filter((row) => Number.isFinite(row.close));
  const data = { symbol, label: item.label, market: item.market, range, bars, sourceTime: bars.at(-1)?.time || null };
  chartCache.set(cacheKey, { fetchedAtMs: Date.now(), data });
  return data;
}

async function latestSnapshot() {
  const files = (await fs.readdir(snapshotDir)).filter((name) => /^technical-snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse();
  if (!files.length) return null;
  return JSON.parse(await fs.readFile(path.join(snapshotDir, files[0]), 'utf8'));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') return serveFile(res, path.join(publicDir, 'index.html'), 'text/html; charset=utf-8');
    if (url.pathname === '/vendor/lightweight-charts.standalone.production.js') {
      return serveFile(res, path.join(skillDir, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js'), 'application/javascript');
    }
    if (url.pathname === '/api/quotes') return sendJson(res, await fetchAllQuotes());
    if (url.pathname === '/api/snapshot') {
      const data = await latestSnapshot();
      return data ? sendJson(res, data) : sendJson(res, { error: 'No snapshot available' }, 404);
    }
    if (url.pathname === '/api/chart') {
      const range = url.searchParams.get('range') === 'daily' ? 'daily' : 'intraday';
      const data = await fetchChart(url.searchParams.get('symbol') || 'sh000001', range);
      return data ? sendJson(res, data) : sendJson(res, { error: 'Unknown symbol' }, 404);
    }
    res.writeHead(404);
    res.end('Not Found');
  } catch (error) {
    console.error('请求处理失败：', error.message);
    sendJson(res, { error: 'Internal Server Error' }, 500);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`股票仪表盘运行于 http://127.0.0.1:${port}`);
});
