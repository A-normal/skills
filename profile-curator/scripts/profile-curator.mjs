#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyUserManagedSection } from './lib/apply-user.mjs';
import { evaluateCandidates, validateDecision, validateObservation } from './lib/engine.mjs';
import { renderProposal } from './lib/render.mjs';
import {
  DEFAULT_GENERATED_DIR,
  DEFAULT_STATE_DIR,
  acquireLock,
  appendJsonl,
  initializeState,
  pathExists,
  readJson,
  readJsonl,
  safeTimestamp,
  sha256File,
  statePaths,
  writeJsonAtomic,
} from './lib/state.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, '..');
const defaultConfigPath = path.join(skillDir, 'config', 'default.json');

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`未知参数：${token}`);
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return { command, options };
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requiredOption(options, key) {
  const value = options[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少 --${key}`);
  return value;
}

async function readStructuredInput(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Multiple JSON objects are accepted as JSONL below.
  }
  const records = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`输入第 ${index + 1} 行不是有效 JSON：${error.message}`);
    }
  }
  return records;
}

function validateConfig(config) {
  if (config.schemaVersion !== 1) throw new Error('config schemaVersion 必须为 1');
  for (const key of [
    'evidenceWindowDays',
    'requiredInferredUserSessions',
    'requiredAgentMethodSessions',
    'requiredPersonaSessions',
    'initialBackfillDays',
    'initialBackfillMaxSessions',
    'maxRecordsPerRun',
  ]) {
    if (!Number.isInteger(config[key]) || config[key] <= 0) throw new Error(`config.${key} 必须是正整数`);
  }
  if (!config.managedUserSection?.startMarker || !config.managedUserSection?.endMarker || !config.managedUserSection?.heading) {
    throw new Error('config.managedUserSection 不完整');
  }
  if (config.integration?.host !== 'openclaw' || typeof config.integration?.targets?.userPreference !== 'string') {
    throw new Error('config.integration OpenClaw 目标不完整');
  }
  if (config.managedUserSection.startMarker === config.managedUserSection.endMarker) throw new Error('受管区块起止标记不能相同');
  return config;
}

async function loadState(stateDir) {
  const paths = statePaths(stateDir);
  if (!(await pathExists(paths.config))) throw new Error(`状态未初始化：${stateDir}`);
  const config = validateConfig(await readJson(paths.config));
  return { paths, config };
}

async function withLock(stateDir, callback) {
  const release = await acquireLock(stateDir);
  try {
    return await callback();
  } finally {
    await release();
  }
}

async function commandInit(stateDir) {
  return withLock(stateDir, async () => {
    const paths = await initializeState(stateDir, defaultConfigPath);
    return { status: 'initialized', stateDir: paths.root, files: paths };
  });
}

async function commandIngest(stateDir, options) {
  const inputPath = requiredOption(options, 'input');
  return withLock(stateDir, async () => {
    const { paths, config } = await loadState(stateDir);
    const raw = await readStructuredInput(inputPath);
    if (raw.length > config.maxRecordsPerRun) throw new Error(`本轮输入 ${raw.length} 条，超过 maxRecordsPerRun=${config.maxRecordsPerRun}`);
    const existing = await readJsonl(paths.candidates);
    const now = new Date().toISOString();
    const normalized = raw.map(validateObservation);
    const knownById = new Map();
    const existingNormalized = existing.map((item) => {
      const validated = validateObservation(item);
      if (item.candidateId && item.candidateId !== validated.candidateId) throw new Error(`状态中的 candidateId 与确定性计算不匹配：${item.id}`);
      knownById.set(validated.id, validated);
      return validated;
    });
    const availableCandidateIds = new Set([
      ...existingNormalized.map((item) => item.candidateId),
      ...normalized.map((item) => item.candidateId),
    ]);
    for (const item of normalized) {
      for (const targetId of [...item.counterEvidenceFor, ...item.relatedCandidateIds]) {
        if (!availableCandidateIds.has(targetId)) throw new Error(`观察 ${item.id} 引用了不存在的候选：${targetId}`);
      }
    }
    const accepted = [];
    const skipped = [];
    for (const item of normalized) {
      const known = knownById.get(item.id);
      if (known) {
        if (canonicalStringify(known) !== canonicalStringify(item)) throw new Error(`观察 ID 冲突且内容不同：${item.id}`);
        skipped.push(item.id);
        continue;
      }
      accepted.push({ ...item, ingestedAt: now });
      knownById.set(item.id, item);
    }
    await appendJsonl(paths.candidates, accepted);
    return { status: 'ingested', received: raw.length, accepted: accepted.length, duplicateIds: skipped };
  });
}

async function commandEvaluate(stateDir, options) {
  return withLock(stateDir, async () => {
    const { paths, config } = await loadState(stateDir);
    const observations = await readJsonl(paths.candidates);
    const decisions = await readJsonl(paths.decisions);
    const lastRun = await readJson(paths.lastRun, { schemaVersion: 1, initialPreviewCompleted: false });
    const initialPreview = !lastRun.initialPreviewCompleted;
    const asOf = typeof options['as-of'] === 'string' ? new Date(options['as-of']).toISOString() : new Date().toISOString();
    const view = evaluateCandidates({ observations, decisions, config, asOf, initialPreview });
    await writeJsonAtomic(paths.currentView, view);
    return { status: 'evaluated', initialPreview, ...view.summary, currentView: paths.currentView };
  });
}

function validateRunResult(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('run result 必须是对象');
  if (input.schemaVersion !== 1) throw new Error('run result schemaVersion 必须为 1');
  if (typeof input.runId !== 'string' || input.runId.length === 0 || input.runId.length > 160) throw new Error('runId 无效');
  if (!Number.isFinite(Date.parse(input.completedAt))) throw new Error('completedAt 无效');
  if (!['no_change', 'updated', 'review_required'].includes(input.status)) throw new Error('run status 无效');
  if (!Number.isInteger(input.recordsProcessed) || input.recordsProcessed < 0) throw new Error('recordsProcessed 无效');
  if (!Number.isInteger(input.backlogRemaining) || input.backlogRemaining < 0) throw new Error('backlogRemaining 无效');
  if (!input.sourceWatermarks || typeof input.sourceWatermarks !== 'object' || Array.isArray(input.sourceWatermarks)) throw new Error('sourceWatermarks 无效');
  for (const [key, value] of Object.entries(input.sourceWatermarks)) {
    if (!key || typeof value !== 'string' || value.length > 500) throw new Error('sourceWatermarks 条目无效');
  }
  return { ...input };
}

async function commandCompleteRun(stateDir, options) {
  const inputPath = requiredOption(options, 'input');
  return withLock(stateDir, async () => {
    const { paths } = await loadState(stateDir);
    const input = await readStructuredInput(inputPath);
    if (input.length !== 1) throw new Error('complete-run 每次只接受一个运行结果');
    const run = validateRunResult(input[0]);
    const view = await readJson(paths.currentView);
    if (Date.parse(run.completedAt) < Date.parse(view.generatedAt)) throw new Error('completedAt 早于当前评价结果');
    const previous = await readJson(paths.lastRun, { schemaVersion: 1, initialPreviewCompleted: false });
    if (previous.runId === run.runId) {
      const same = previous.completedAt === run.completedAt
        && previous.status === run.status
        && previous.recordsProcessed === run.recordsProcessed
        && previous.backlogRemaining === run.backlogRemaining
        && canonicalStringify(previous.sourceWatermarks) === canonicalStringify(run.sourceWatermarks);
      if (!same) throw new Error(`runId 已存在但运行结果不同：${run.runId}`);
      return { status: 'existing', runId: run.runId };
    }
    if (previous.completedAt && Date.parse(run.completedAt) <= Date.parse(previous.completedAt)) {
      throw new Error('新的成功水位不能早于或等于上次成功运行');
    }
    await writeJsonAtomic(paths.lastRun, {
      ...run,
      initialPreviewCompleted: true,
      lastEvaluatedAt: view.generatedAt,
      summary: view.summary,
    });
    return { status: 'completed', runId: run.runId, sourceWatermarks: run.sourceWatermarks };
  });
}

async function commandRender(stateDir, generatedDir) {
  return withLock(stateDir, async () => {
    const { paths } = await loadState(stateDir);
    const view = await readJson(paths.currentView);
    const proposal = renderProposal(view);
    await fs.mkdir(generatedDir, { recursive: true, mode: 0o700 });
    const outputPath = path.join(generatedDir, `${view.generatedAt.slice(0, 10)}-${safeTimestamp(view.generatedAt)}-proposal.md`);
    if (await pathExists(outputPath)) {
      const existing = await fs.readFile(outputPath, 'utf8');
      if (existing !== proposal) throw new Error(`同名提案已存在但内容不同：${outputPath}`);
      return { status: 'existing', outputPath, bytes: Buffer.byteLength(proposal, 'utf8') };
    }
    await fs.writeFile(outputPath, proposal, { mode: 0o600, flag: 'wx' });
    return { status: 'rendered', outputPath, bytes: Buffer.byteLength(proposal, 'utf8') };
  });
}

async function commandDecide(stateDir, options) {
  const inputPath = requiredOption(options, 'input');
  return withLock(stateDir, async () => {
    const { paths } = await loadState(stateDir);
    const input = await readStructuredInput(inputPath);
    if (input.length !== 1) throw new Error('decide 每次只接受一个决定');
    const decision = validateDecision(input[0]);
    const candidates = await readJsonl(paths.candidates);
    if (!candidates.map(validateObservation).some((item) => item.candidateId === decision.candidateId)) throw new Error('决定引用的 candidateId 不存在');
    const decisions = await readJsonl(paths.decisions);
    const existingDecision = decisions.map((item) => validateDecision(item, { allowApplied: true })).find((item) => item.id === decision.id);
    if (existingDecision) {
      if (canonicalStringify(existingDecision) !== canonicalStringify(decision)) throw new Error(`决定 ID 冲突且内容不同：${decision.id}`);
      return { status: 'duplicate', decisionId: decision.id };
    }
    await appendJsonl(paths.decisions, [decision]);
    return { status: 'recorded', decisionId: decision.id, action: decision.action };
  });
}

async function commandApplyUser(stateDir, options) {
  const targetPath = requiredOption(options, 'target');
  const expectedSha256 = requiredOption(options, 'expected-sha256');
  const baselineReviewPath = requiredOption(options, 'baseline-review');
  return withLock(stateDir, async () => {
    const { paths, config } = await loadState(stateDir);
    if (path.resolve(targetPath) !== path.resolve(config.integration.targets.userPreference)) {
      throw new Error('apply-user 目标不等于当前 OpenClaw 集成声明的 USER.md');
    }
    if (options.apply && !config.autoApplyUserPreferences) throw new Error('config 禁止自动应用用户偏好');
    const view = await readJson(paths.currentView);
    const baselineReview = await readJson(baselineReviewPath);
    return applyUserManagedSection({
      stateDir,
      targetPath,
      expectedSha256,
      config,
      view,
      baselineReview,
      apply: Boolean(options.apply),
    });
  });
}

async function commandStatus(stateDir) {
  const { paths } = await loadState(stateDir);
  const [lastRun, view, applyState, observations, decisions] = await Promise.all([
    readJson(paths.lastRun, null),
    readJson(paths.currentView, null),
    readJson(paths.applyState, null),
    readJsonl(paths.candidates),
    readJsonl(paths.decisions),
  ]);
  return {
    status: lastRun?.lastStatus ?? 'initialized',
    stateDir,
    observations: observations.length,
    decisions: decisions.length,
    lastRun,
    currentSummary: view?.summary ?? null,
    lastAppliedAt: applyState?.appliedAt ?? null,
    lastAppliedTargetSha256: applyState?.afterSha256 ?? null,
  };
}

const { command, options } = parseArgs(process.argv.slice(2));
const stateDir = path.resolve(String(options['state-dir'] ?? process.env.PROFILE_CURATOR_STATE_DIR ?? DEFAULT_STATE_DIR));
const generatedDir = path.resolve(String(options['generated-dir'] ?? process.env.PROFILE_CURATOR_GENERATED_DIR ?? DEFAULT_GENERATED_DIR));

try {
  let result;
  if (command === 'init') result = await commandInit(stateDir);
  else if (command === 'ingest') result = await commandIngest(stateDir, options);
  else if (command === 'evaluate') result = await commandEvaluate(stateDir, options);
  else if (command === 'complete-run') result = await commandCompleteRun(stateDir, options);
  else if (command === 'render') result = await commandRender(stateDir, generatedDir);
  else if (command === 'decide') result = await commandDecide(stateDir, options);
  else if (command === 'apply-user') result = await commandApplyUser(stateDir, options);
  else if (command === 'status') result = await commandStatus(stateDir);
  else if (command === 'hash') result = { targetPath: requiredOption(options, 'target'), sha256: await sha256File(requiredOption(options, 'target')) };
  else throw new Error('用法：profile-curator.mjs <init|ingest|evaluate|render|complete-run|decide|apply-user|status|hash> [options]');
  output(result);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'failed', error: error.message }, null, 2)}\n`);
  process.exitCode = 1;
}
