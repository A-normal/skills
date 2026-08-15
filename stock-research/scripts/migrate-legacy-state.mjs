import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, '..');

function resolveSourceDir() {
  const args = process.argv.slice(2);
  let source = process.env.STOCK_RESEARCH_LEGACY_SOURCE;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--source') throw new Error(`未知参数：${args[index]}`);
    source = args[index + 1];
    if (!source) throw new Error('--source 缺少目录路径');
    index += 1;
  }
  if (!source) {
    throw new Error('必须通过 --source 或 STOCK_RESEARCH_LEGACY_SOURCE 指定私有历史状态目录');
  }
  return path.resolve(source);
}

const sourceDir = resolveSourceDir();
const stateDir = process.env.STOCK_RESEARCH_STATE_DIR || '/root/.openclaw/workspace/state/stock-research';
const predictionDir = path.join(stateDir, 'predictions');
const marketDir = path.join(stateDir, 'market-snapshots');
const snapshotDir = path.join(stateDir, 'snapshots');
const archiveDir = path.join(stateDir, 'archive');

async function writeNew(filePath, content) {
  try {
    await fs.writeFile(filePath, content, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

function splitSections(content) {
  const matches = [...content.matchAll(/^## (.+)$/gm)];
  return matches.map((match, index) => ({
    title: match[1].trim(),
    body: content.slice(match.index, matches[index + 1]?.index ?? content.length).trim(),
  }));
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function yamlText(value) {
  return JSON.stringify(String(value));
}

await Promise.all([predictionDir, marketDir, snapshotDir, archiveDir].map((dir) => fs.mkdir(dir, { recursive: true, mode: 0o700 })));

const predictionLog = await fs.readFile(path.join(sourceDir, 'prediction-log.md'), 'utf8');
let importedPredictions = 0;
for (const section of splitSections(predictionLog)) {
  if (section.title.startsWith('YYYY-MM-DD')) continue;
  const date = section.title.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? 'undated';
  const reviewAt = [...section.body.matchAll(/Review date:\s*(\d{4}-\d{2}-\d{2})/gi)].at(-1)?.[1] ?? '';
  const confidence = [...section.body.matchAll(/Confidence:\s*(Low|Medium|High)/gi)].at(-1)?.[1]?.toLowerCase() ?? 'low';
  const outcome = [...section.body.matchAll(/Outcome:\s*([^\r\n]+)/gi)].at(-1)?.[1] ?? 'Pending';
  const status = /^pending\.?$/i.test(outcome.trim()) ? 'open' : 'closed';
  const id = `legacy-${date}-${hash(section.title)}`;
  const frontmatter = [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    `created_at: ${yamlText(section.title.split(' - ')[0])}`,
    `review_at: ${yamlText(reviewAt)}`,
    `status: ${status}`,
    `confidence: ${confidence}`,
    'context_incomplete: false',
    'legacy_import: true',
    '---',
    '',
  ].join('\n');
  if (await writeNew(path.join(predictionDir, `${id}.md`), `${frontmatter}${section.body}\n`)) importedPredictions += 1;
}

const marketLog = await fs.readFile(path.join(sourceDir, 'market-snapshots.md'), 'utf8');
let importedMarketSnapshots = 0;
for (const section of splitSections(marketLog)) {
  const date = section.title.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? 'undated';
  const fileName = `${date}-${hash(section.title)}.md`;
  if (await writeNew(path.join(marketDir, fileName), `${section.body}\n`)) importedMarketSnapshots += 1;
}

await writeNew(path.join(stateDir, 'knowledge.md'), await fs.readFile(path.join(sourceDir, 'knowledge.md'), 'utf8'));
await writeNew(path.join(archiveDir, 'legacy-validation.md'), await fs.readFile(path.join(sourceDir, 'validation.md'), 'utf8'));

let importedJsonSnapshots = 0;
for (const name of await fs.readdir(path.join(sourceDir, 'data'))) {
  if (!name.endsWith('.json')) continue;
  if (await writeNew(path.join(snapshotDir, name), await fs.readFile(path.join(sourceDir, 'data', name)))) importedJsonSnapshots += 1;
}

const migration = {
  schemaVersion: 1,
  migratedAt: new Date().toISOString(),
  source: 'external-legacy-source',
  importedPredictions,
  importedMarketSnapshots,
  importedJsonSnapshots,
  note: '旧 validation 日志仅作只读归档；迁移后的预测文件是后续状态事实来源。',
};
await writeNew(path.join(stateDir, 'migration.json'), `${JSON.stringify(migration, null, 2)}\n`);
console.log(JSON.stringify(migration, null, 2));
