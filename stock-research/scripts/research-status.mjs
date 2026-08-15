import fs from 'node:fs/promises';
import path from 'node:path';

const stateDir = process.env.STOCK_RESEARCH_STATE_DIR || '/root/.openclaw/workspace/state/stock-research';
const predictionDir = path.join(stateDir, 'predictions');

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return Object.fromEntries(match[1].split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(':');
    if (separator < 0) return [];
    return [[line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')]];
  }));
}

let files = [];
try {
  files = (await fs.readdir(predictionDir)).filter((name) => name.endsWith('.md')).sort();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const today = new Date().toISOString().slice(0, 10);
const records = [];
for (const file of files) {
  const metadata = parseFrontmatter(await fs.readFile(path.join(predictionDir, file), 'utf8'));
  records.push({
    file,
    id: metadata.id ?? file.replace(/\.md$/, ''),
    symbolId: metadata.symbol_id ?? null,
    status: metadata.status ?? 'unknown',
    reviewAt: metadata.review_at ?? null,
    due: metadata.status === 'open' && metadata.review_at && metadata.review_at <= today,
  });
}

console.log(JSON.stringify({
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  total: records.length,
  open: records.filter((record) => record.status === 'open').length,
  due: records.filter((record) => record.due),
}, null, 2));
