import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, '..');

function resolveSourceDir() {
  const args = process.argv.slice(2);
  let source = process.env.ENGINEERING_GROWTH_LEGACY_SOURCE;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--source') throw new Error(`未知参数：${args[index]}`);
    source = args[index + 1];
    if (!source) throw new Error('--source 缺少目录路径');
    index += 1;
  }
  if (!source) {
    throw new Error('必须通过 --source 或 ENGINEERING_GROWTH_LEGACY_SOURCE 指定私有历史状态目录');
  }
  return path.resolve(source);
}

const sourceDir = resolveSourceDir();
const model = JSON.parse(await fs.readFile(path.join(skillDir, 'config', 'capability-model.json'), 'utf8'));
const legacyProfile = JSON.parse(await fs.readFile(path.join(sourceDir, 'profile-data.json'), 'utf8'));
const stateDir = process.env.ENGINEERING_GROWTH_STATE_DIR || '/root/.openclaw/workspace/state/engineering-growth';

async function writeNew(filePath, content) {
  try {
    await fs.writeFile(filePath, content, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

for (const relative of ['cases', 'evidence', 'practices', 'module-reviews', 'exports', 'archive']) {
  await fs.mkdir(path.join(stateDir, relative), { recursive: true, mode: 0o700 });
}

for (const name of await fs.readdir(path.join(sourceDir, 'cases'))) {
  if (!name.endsWith('.md')) continue;
  await writeNew(path.join(stateDir, 'cases', name), await fs.readFile(path.join(sourceDir, 'cases', name)));
}
await writeNew(path.join(stateDir, 'archive', 'legacy-capability-board.md'), await fs.readFile(path.join(sourceDir, 'personal-capability-board.md')));

const legacyItems = legacyProfile.capabilities.flatMap((group) => group.items);
const capabilities = model.capabilities.map((definition) => {
  const matches = legacyItems.filter((item) => definition.legacyNames.includes(item.name));
  const strongest = matches.sort((left, right) => Number(right.score) - Number(left.score))[0];
  const level = strongest ? Math.max(0, Math.min(5, Math.floor(Number(strongest.score)))) : 0;
  return {
    id: definition.id,
    currentLevel: level,
    targetLevel: Math.min(5, level + 1),
    confidence: strongest ? 'medium' : 'low',
    coverageAssessed: false,
    coveredFundamentals: [],
    missingFundamentals: [],
    evidenceIds: strongest ? ['legacy-profile-baseline'] : [],
    lastReviewedAt: legacyProfile.updatedAt,
  };
});

const profile = {
  schemaVersion: 1,
  name: legacyProfile.name,
  positioning: legacyProfile.positioning,
  updatedAt: legacyProfile.updatedAt,
  capabilities,
};
await writeNew(path.join(stateDir, 'profile.json'), `${JSON.stringify(profile, null, 2)}\n`);

const baselineEvidence = {
  schemaVersion: 1,
  id: 'legacy-profile-baseline',
  kind: 'project',
  occurredAt: `${legacyProfile.updatedAt}T00:00:00+08:00`,
  source: '旧能力面板与三个项目案例',
  capabilities: capabilities.filter((item) => item.currentLevel > 0).map((item) => ({
    id: item.id,
    levelSignal: item.currentLevel,
    result: 'pass',
    independence: 0.8,
    coveredFundamentals: [],
  })),
};
await writeNew(path.join(stateDir, 'evidence', 'legacy-profile-baseline.json'), `${JSON.stringify(baselineEvidence, null, 2)}\n`);

const migration = {
  schemaVersion: 1,
  migratedAt: new Date().toISOString(),
  source: 'external-legacy-source',
  cases: 3,
  note: '旧小数评分已向下转换为整数基线；基础项尚未完成全面评价，因此不会因缺少历史字段自动降级。',
};
await writeNew(path.join(stateDir, 'migration.json'), `${JSON.stringify(migration, null, 2)}\n`);
console.log(JSON.stringify(migration, null, 2));
