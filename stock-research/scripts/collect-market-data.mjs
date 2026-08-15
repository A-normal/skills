import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StockSDK } from 'stock-sdk';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, '..');
const stateDir = process.env.STOCK_RESEARCH_STATE_DIR || '/root/.openclaw/workspace/state/stock-research';
const snapshotDir = path.join(stateDir, 'snapshots');
const watchlistPath = process.env.STOCK_RESEARCH_WATCHLIST || path.join(skillDir, 'config', 'watchlist.json');
const watchlist = JSON.parse(await fs.readFile(watchlistPath, 'utf8'));
const enabledSymbols = watchlist.symbols.filter((item) => item.enabled);

const sdk = new StockSDK({
  timeout: 12000,
  retry: { maxRetries: 3, baseDelay: 500 },
  rateLimit: { requestsPerSecond: 3, maxBurst: 3 },
});

function dateInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: watchlist.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function dateOneYearAgo() {
  const value = new Date();
  value.setUTCFullYear(value.getUTCFullYear() - 1);
  return value.toISOString().slice(0, 10);
}

async function collectQuoteGroup(market, items) {
  const symbols = items.map((item) => item.quoteSymbol);
  if (market === 'A') return sdk.getSimpleQuotes(symbols);
  if (market === 'HK') return sdk.getHKQuotes(symbols);
  if (market === 'US') return sdk.getUSQuotes(symbols);
  throw new Error(`不支持的市场：${market}`);
}

function compactBar(bar) {
  return {
    date: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    changePercent: bar.changePercent,
    volume: bar.volume,
    ma: bar.ma,
    macd: bar.macd,
    rsi: bar.rsi,
    atr: bar.atr,
    boll: bar.boll,
  };
}

await fs.mkdir(snapshotDir, { recursive: true });
const capturedAt = new Date().toISOString();
const dateId = dateInShanghai();
const quoteSnapshot = { schemaVersion: 1, capturedAt, status: 'complete', markets: {}, errors: [] };

for (const market of ['A', 'HK', 'US']) {
  const items = enabledSymbols.filter((item) => item.market === market);
  if (!items.length) continue;
  try {
    quoteSnapshot.markets[market] = {
      symbols: items.map((item) => item.id),
      rows: await collectQuoteGroup(market, items),
    };
  } catch (error) {
    quoteSnapshot.status = 'incomplete';
    quoteSnapshot.errors.push({ market, message: error.message });
  }
}

const technicalSnapshot = {
  schemaVersion: 1,
  capturedAt,
  status: 'complete',
  indicators: watchlist.indicators,
  symbols: [],
  errors: [],
};

for (const item of enabledSymbols) {
  try {
    const rows = await sdk.getKlineWithIndicators(item.technicalSymbol, {
      market: item.market,
      period: 'daily',
      adjust: 'qfq',
      startDate: dateOneYearAgo(),
      indicators: watchlist.indicators,
    });
    technicalSnapshot.symbols.push({
      id: item.id,
      label: item.label,
      symbol: item.technicalSymbol,
      market: item.market,
      bars: rows.length,
      previous: rows.at(-2) ? compactBar(rows.at(-2)) : null,
      latest: rows.at(-1) ? compactBar(rows.at(-1)) : null,
    });
  } catch (error) {
    technicalSnapshot.status = 'incomplete';
    technicalSnapshot.errors.push({ symbolId: item.id, message: error.message });
  }
}

const quotePath = path.join(snapshotDir, `quote-snapshot-${dateId}.json`);
const technicalPath = path.join(snapshotDir, `technical-snapshot-${dateId}.json`);
await fs.writeFile(quotePath, `${JSON.stringify(quoteSnapshot, null, 2)}\n`, { mode: 0o600 });
await fs.writeFile(technicalPath, `${JSON.stringify(technicalSnapshot, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify({
  capturedAt,
  status: quoteSnapshot.status === 'complete' && technicalSnapshot.status === 'complete' ? 'complete' : 'incomplete',
  quotePath,
  technicalPath,
  quoteErrors: quoteSnapshot.errors,
  technicalErrors: technicalSnapshot.errors,
}, null, 2));

if (quoteSnapshot.status !== 'complete' || technicalSnapshot.status !== 'complete') {
  process.exitCode = 2;
}
