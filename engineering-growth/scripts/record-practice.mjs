import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('用法：node record-practice.mjs <practice.json>');
const record = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.resolve(scriptDir, '..', 'config', 'capability-model.json');
const model = JSON.parse(await fs.readFile(modelPath, 'utf8'));
const definitions = new Map(model.capabilities.map((item) => [item.id, item]));
const stateDir = process.env.ENGINEERING_GROWTH_STATE_DIR || '/root/.openclaw/workspace/state/engineering-growth';

if (record.schemaVersion !== 1 || record.kind !== 'practice' || !record.id || !record.occurredAt || !record.module || !record.task) {
  throw new Error('练习记录缺少必填字段');
}
if (!Array.isArray(record.capabilities) || record.capabilities.length === 0) throw new Error('练习记录至少关联一项能力');
for (const signal of record.capabilities) {
  const definition = definitions.get(signal.id);
  if (!definition) throw new Error(`未知能力：${signal.id}`);
  if (!Number.isInteger(signal.levelSignal) || signal.levelSignal < 0 || signal.levelSignal > 5) throw new Error(`levelSignal 无效：${signal.id}`);
  if (!['pass', 'partial', 'blocked', 'fail'].includes(signal.result)) throw new Error(`result 无效：${signal.id}`);
  if (typeof signal.independence !== 'number' || signal.independence < 0 || signal.independence > 1) throw new Error(`independence 无效：${signal.id}`);
  const fundamentalIds = new Set(definition.fundamentals.map((item) => item.id));
  for (const id of signal.coveredFundamentals ?? []) {
    if (!fundamentalIds.has(id)) throw new Error(`未知基础项：${signal.id}/${id}`);
  }
}

const year = record.occurredAt.slice(0, 4);
const outputDir = path.join(stateDir, 'practices', year);
await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
const outputPath = path.join(outputDir, `${record.id}.json`);
await fs.writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(outputPath);
