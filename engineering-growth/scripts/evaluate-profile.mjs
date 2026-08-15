import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, '..');
const stateDir = process.env.ENGINEERING_GROWTH_STATE_DIR || '/root/.openclaw/workspace/state/engineering-growth';
const model = JSON.parse(await fs.readFile(path.join(skillDir, 'config', 'capability-model.json'), 'utf8'));
const profilePath = path.join(stateDir, 'profile.json');
const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
const definitions = new Map(model.capabilities.map((item) => [item.id, item]));

async function readRecords(root) {
  const records = [];
  async function visit(current) {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      if (entry.isFile() && entry.name.endsWith('.json')) records.push(JSON.parse(await fs.readFile(fullPath, 'utf8')));
    }
  }
  await visit(root);
  return records;
}

const records = [
  ...(await readRecords(path.join(stateDir, 'evidence'))),
  ...(await readRecords(path.join(stateDir, 'practices'))),
  ...(await readRecords(path.join(stateDir, 'module-reviews'))),
].sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)));

const previousLevels = new Map(profile.capabilities.map((item) => [item.id, item.currentLevel]));
const gapRows = [];

for (const state of profile.capabilities) {
  const definition = definitions.get(state.id);
  if (!definition) continue;
  const signals = records.flatMap((record) => (record.capabilities ?? [])
    .filter((item) => item.id === state.id)
    .map((item) => ({ ...item, kind: record.kind, occurredAt: record.occurredAt, recordId: record.id })));

  if (signals.length === 0) continue;
  let weightedTotal = 0;
  let weightTotal = 0;
  const covered = new Set(state.coveredFundamentals ?? []);
  let missing = new Set(state.missingFundamentals ?? []);
  let coverageAssessed = Boolean(state.coverageAssessed);

  for (const signal of signals) {
    const weight = (model.evaluation.evidenceWeights[signal.kind] ?? 1) * (signal.independence ?? 0.5);
    const factor = model.evaluation.resultFactors[signal.result] ?? 0.5;
    weightedTotal += signal.levelSignal * weight * factor;
    weightTotal += weight;
    if (signal.result === 'pass' || signal.result === 'partial') {
      for (const id of signal.coveredFundamentals ?? []) covered.add(id);
    }
    if (signal.coverageComplete) {
      coverageAssessed = true;
      missing = new Set(signal.missingFundamentals ?? []);
      for (const id of signal.coveredFundamentals ?? []) covered.add(id);
    }
  }

  let calculatedLevel = Math.max(0, Math.min(5, Math.round(weightedTotal / Math.max(weightTotal, 0.001))));
  if (coverageAssessed) {
    const core = definition.fundamentals.filter((item) => item.core);
    const coveredCore = core.filter((item) => covered.has(item.id) && !missing.has(item.id)).length;
    const coverage = core.length ? coveredCore / core.length : 1;
    const gateLevel = Object.entries(model.evaluation.gateCoverage)
      .map(([level, required]) => ({ level: Number(level), required: Number(required) }))
      .filter((item) => coverage >= item.required)
      .sort((left, right) => right.level - left.level)[0]?.level ?? 0;
    calculatedLevel = Math.min(calculatedLevel, gateLevel);
  }

  const recentSignals = signals.slice(-model.evaluation.repeatedNegativeCount);
  if (recentSignals.length === model.evaluation.repeatedNegativeCount && recentSignals.every((item) => ['fail', 'partial'].includes(item.result) && item.levelSignal < state.currentLevel)) {
    calculatedLevel = Math.min(calculatedLevel, Math.max(0, state.currentLevel - 1));
  }

  const latestAt = signals.at(-1)?.occurredAt;
  const ageDays = latestAt ? (Date.now() - new Date(latestAt).getTime()) / 86400000 : Infinity;
  let confidence = weightTotal >= model.evaluation.confidenceWeights.high ? 'high' : weightTotal >= model.evaluation.confidenceWeights.medium ? 'medium' : 'low';
  if (ageDays > model.evaluation.staleAfterDays) confidence = confidence === 'high' ? 'medium' : 'low';

  state.currentLevel = calculatedLevel;
  state.targetLevel = Math.min(5, calculatedLevel + 1);
  state.confidence = confidence;
  state.coverageAssessed = coverageAssessed;
  state.coveredFundamentals = [...covered].sort();
  state.missingFundamentals = [...missing].sort();
  state.evidenceIds = [...new Set(signals.map((item) => item.recordId))];
  state.lastReviewedAt = latestAt;

  if (!coverageAssessed) {
    gapRows.push({ capabilityId: state.id, kind: 'unknown', message: '基础项尚未完成全面评价' });
  } else {
    for (const fundamentalId of missing) {
      const fundamental = definition.fundamentals.find((item) => item.id === fundamentalId);
      gapRows.push({ capabilityId: state.id, fundamentalId, kind: fundamental?.core ? 'core' : 'supporting', message: fundamental?.name ?? fundamentalId });
    }
  }
}

profile.updatedAt = new Date().toISOString();
await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });

const practices = records.filter((item) => item.kind === 'practice').slice(-50).reverse();
const moduleReviews = records.filter((item) => item.kind === 'module_review').slice(-20).reverse();
const exportData = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  profile: { name: profile.name, positioning: profile.positioning },
  capabilities: profile.capabilities.map((state) => ({
    ...state,
    name: definitions.get(state.id)?.name ?? state.id,
    category: definitions.get(state.id)?.category ?? '未分类',
    trend: state.currentLevel > (previousLevels.get(state.id) ?? 0) ? 'up' : state.currentLevel < (previousLevels.get(state.id) ?? 0) ? 'down' : 'stable',
  })),
  practiceHistory: practices.map((item) => ({ id: item.id, occurredAt: item.occurredAt, module: item.module, task: item.task })),
  moduleReviews: moduleReviews.map((item) => ({ id: item.id, occurredAt: item.occurredAt, module: item.module, summary: item.summary })),
  gaps: gapRows,
  trainingPriorities: gapRows
    .sort((left, right) => ({ core: 0, unknown: 1, supporting: 2 }[left.kind] - ({ core: 0, unknown: 1, supporting: 2 }[right.kind])))
    .slice(0, 12),
};

const exportDir = path.join(stateDir, 'exports');
await fs.mkdir(exportDir, { recursive: true, mode: 0o700 });
const exportPath = path.join(exportDir, 'profile-v1.json');
await fs.writeFile(exportPath, `${JSON.stringify(exportData, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ profilePath, exportPath, capabilities: profile.capabilities.length, gaps: gapRows.length }, null, 2));
