#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateCandidates,
  validateCollectionReceipt,
  validateConfig,
  validateDecision,
  validateObservation,
} from './lib/engine.mjs';
import { renderProposal } from './lib/render.mjs';
import {
  DEFAULT_GENERATED_DIR,
  DEFAULT_STATE_DIR,
  acquireLock,
  canonicalStringify,
  hashStateInputs,
  initializeState,
  inspectLock,
  pathExists,
  readJson,
  readJsonl,
  recoverStaleLock,
  safeTimestamp,
  sha256File,
  sha256Text,
  statePaths,
  writeJsonAtomic,
  writeJsonlAtomic,
} from './lib/state.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, '..');
const defaultConfigPath = path.join(skillDir, 'references', 'default-config.json');
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/u;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`未知参数：${token}`);
    const key = token.slice(2);
    if (key in options) throw new Error(`重复参数：--${key}`);
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

function requiredOption(options, key) {
  const value = options[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少 --${key}`);
  return value;
}

function validateRunId(value) {
  if (!RUN_ID_PATTERN.test(value ?? '')) throw new Error('run-id 格式无效');
  return value;
}

function validIso(value, field) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${field} 无效`);
  return new Date(Date.parse(value)).toISOString();
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

async function loadState(stateDir) {
  const paths = statePaths(stateDir);
  if (!(await pathExists(paths.config))) throw new Error(`状态未初始化：${stateDir}`);
  const rawConfig = await readJson(paths.config);
  if (rawConfig.schemaVersion === 1) {
    throw new Error('检测到 v1 状态。其来源元数据无法满足 v2 契约；请保留旧目录并使用新的 v2 状态目录，禁止静默迁移');
  }
  const config = validateConfig(rawConfig);
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

function hashesEqual(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

async function assertStateHashes(paths, expected, label) {
  const current = await hashStateInputs(paths);
  if (!hashesEqual(current, expected)) throw new Error(`${label} 后状态输入已变化，旧快照失效`);
  return current;
}

async function commandInit(stateDir) {
  return withLock(stateDir, async () => {
    const paths = await initializeState(stateDir, defaultConfigPath);
    const config = validateConfig(await readJson(paths.config));
    return {
      status: 'initialized',
      mode: config.mode,
      stateDir: paths.root,
      userAllowlistConfigured: config.integration.allowedUserIds.length > 0,
      files: paths,
    };
  });
}

async function commandBeginRun(stateDir, options) {
  const runId = validateRunId(requiredOption(options, 'run-id'));
  return withLock(stateDir, async () => {
    const { paths, config } = await loadState(stateDir);
    if (config.integration.allowedUserIds.length === 0) throw new Error('先在 config.json 中配置 allowedUserIds');
    if (config.integration.allowedChannels.length === 0) throw new Error('先在 config.json 中配置 allowedChannels');
    if (await pathExists(paths.activeRun)) {
      const active = await readJson(paths.activeRun);
      throw new Error(`已有未完成运行：${active.runId}`);
    }
    const startedAt = options['started-at'] ? validIso(options['started-at'], 'started-at') : new Date().toISOString();
    if (Date.parse(startedAt) > Date.now() + config.maxFutureSkewMinutes * 60000) throw new Error('started-at 超出允许的未来时间偏差');
    const baseHashes = await hashStateInputs(paths);
    const active = {
      schemaVersion: 2,
      runId,
      phase: 'begun',
      startedAt,
      evidenceTrust: 'declared',
      baseHashes,
    };
    await writeJsonAtomic(paths.activeRun, active);
    return { status: 'begun', runId, phase: active.phase, baseHashes };
  });
}

function observationComparable(item) {
  const { ingestedAt, ...rest } = item;
  return rest;
}

function receiptSessionMap(receipt) {
  return new Map(receipt.sessions.map((item) => [item.sessionId, item]));
}

async function commandCollect(stateDir, options) {
  const runId = validateRunId(requiredOption(options, 'run-id'));
  const receiptPath = requiredOption(options, 'receipt');
  const inputPath = requiredOption(options, 'input');
  return withLock(stateDir, async () => {
    const { paths, config } = await loadState(stateDir);
    const active = await readJson(paths.activeRun, null);
    if (!active || active.runId !== runId || active.phase !== 'begun') throw new Error('collect 需要匹配的 begun active run');
    await assertStateHashes(paths, active.baseHashes, 'begin-run');

    const receiptInput = await readStructuredInput(receiptPath);
    if (receiptInput.length !== 1) throw new Error('receipt 每次只接受一个对象');
    const receipt = validateCollectionReceipt(receiptInput[0], config);
    if (receipt.runId !== runId) throw new Error('receipt.runId 与 active run 不匹配');
    if (Date.parse(receipt.collectedAt) < Date.parse(active.startedAt)) throw new Error('receipt.collectedAt 早于 begin-run');

    const raw = await readStructuredInput(inputPath);
    if (raw.length > config.maxRecordsPerRun) throw new Error(`本轮输入 ${raw.length} 条，超过 maxRecordsPerRun=${config.maxRecordsPerRun}`);
    const normalized = raw.map((item) => validateObservation(item, { config, now: receipt.collectedAt }));
    const sessions = receiptSessionMap(receipt);
    for (const item of normalized) {
      const session = sessions.get(item.evidence.sessionId);
      if (!session) throw new Error(`观察引用了 receipt 中不存在的 session：${item.evidence.sessionId}`);
      for (const key of ['sessionKey', 'agentId', 'chatScope', 'userId']) {
        if (item.evidence[key] !== session[key]) throw new Error(`观察 evidence.${key} 与 receipt 不匹配`);
      }
    }

    const lastRun = await readJson(paths.lastRun);
    for (const session of receipt.sessions) {
      const previous = lastRun.sourceWatermarks?.[session.sessionId] ?? null;
      if (session.previousWatermark !== previous) throw new Error(`session ${session.sessionId} 的 previousWatermark 与最后成功水位不一致`);
    }
    if (!lastRun.completedAt) {
      const cutoff = Date.parse(receipt.collectedAt) - config.initialBackfillDays * 86400000;
      if (normalized.some((item) => Date.parse(item.evidence.occurredAt) < cutoff)) {
        throw new Error(`首次回看不得超过 ${config.initialBackfillDays} 天`);
      }
    }

    const existingRaw = await readJsonl(paths.observations);
    const existing = existingRaw.map((item) => validateObservation(item, { config, now: receipt.collectedAt, stored: true }));
    const candidateRoots = new Set([
      ...existing.map((item) => item.candidateId),
      ...normalized.filter((item) => ['new_candidate', 'contradicts', 'uncertain'].includes(item.relation)).map((item) => item.candidateId),
    ]);
    const availableCandidateIds = new Set([...candidateRoots, ...normalized.map((item) => item.candidateId)]);
    for (const item of normalized) {
      if (item.relation === 'supports' && !candidateRoots.has(item.candidateId)) {
        throw new Error(`supports 观察没有已存在或同批 new_candidate：${item.id}`);
      }
      for (const targetId of [...item.counterEvidenceFor, ...item.relatedCandidateIds]) {
        if (!availableCandidateIds.has(targetId)) throw new Error(`观察 ${item.id} 引用了不存在的候选：${targetId}`);
      }
    }

    const knownById = new Map(existing.map((item) => [item.id, item]));
    const accepted = [];
    const duplicates = [];
    for (const item of normalized) {
      const known = knownById.get(item.id);
      if (known) {
        if (canonicalStringify(observationComparable(known)) !== canonicalStringify(item)) {
          throw new Error(`同一 source event 与 candidate 产生了不同观察：${item.id}`);
        }
        duplicates.push(item.id);
        continue;
      }
      const stored = { ...item, ingestedAt: receipt.collectedAt };
      accepted.push(stored);
      knownById.set(item.id, stored);
    }
    await writeJsonlAtomic(paths.observations, [...existingRaw, ...accepted]);
    const collectionStateHashes = await hashStateInputs(paths);
    const sourceWatermarks = Object.fromEntries(receipt.sessions.map((item) => [
      item.sessionId,
      item.complete ? item.observedThroughMessageId : item.previousWatermark,
    ]));
    const nextActive = {
      ...active,
      phase: 'collected',
      collectedAt: receipt.collectedAt,
      receiptSha256: sha256Text(canonicalStringify(receipt)),
      collectionStateHashes,
      recordsProcessed: raw.length,
      recordsAccepted: accepted.length,
      duplicateObservationIds: duplicates,
      sessionsScanned: receipt.sessions.length,
      backlogRemaining: receipt.sessions.reduce((sum, item) => sum + item.backlogRemaining, 0),
      coverageComplete: receipt.sessions.every((item) => item.complete),
      sourceWatermarks,
      sourceWatermarksTrust: 'declared',
    };
    await writeJsonAtomic(paths.activeRun, nextActive);
    return {
      status: 'collected',
      runId,
      received: raw.length,
      accepted: accepted.length,
      duplicateObservationIds: duplicates,
      sessionsScanned: nextActive.sessionsScanned,
      backlogRemaining: nextActive.backlogRemaining,
    };
  });
}

async function commandEvaluate(stateDir, options) {
  const runId = validateRunId(requiredOption(options, 'run-id'));
  return withLock(stateDir, async () => {
    const { paths, config } = await loadState(stateDir);
    const active = await readJson(paths.activeRun, null);
    if (!active || active.runId !== runId || active.phase !== 'collected') throw new Error('evaluate 需要匹配的 collected active run');
    const inputHashes = await assertStateHashes(paths, active.collectionStateHashes, 'collect');
    const asOf = options['as-of'] ? validIso(options['as-of'], 'as-of') : new Date().toISOString();
    if (Date.parse(asOf) < Date.parse(active.collectedAt)) throw new Error('as-of 早于 collectedAt');
    if (Date.parse(asOf) > Date.now() + config.maxFutureSkewMinutes * 60000) throw new Error('as-of 超出允许的未来时间偏差');
    const observations = await readJsonl(paths.observations);
    const decisions = await readJsonl(paths.decisions);
    const view = evaluateCandidates({ observations, decisions, config, asOf, runId, inputHashes });
    await writeJsonAtomic(paths.currentView, view);
    const viewSha256 = sha256Text(canonicalStringify(view));
    await writeJsonAtomic(paths.activeRun, { ...active, phase: 'evaluated', evaluatedAt: view.generatedAt, inputHashes, viewSha256 });
    return { status: 'evaluated', runId, viewSha256, ...view.summary };
  });
}

async function verifyCurrentView(paths, view, expectedViewSha256 = null) {
  await assertStateHashes(paths, view.inputHashes, 'evaluate');
  const viewSha256 = sha256Text(canonicalStringify(view));
  if (expectedViewSha256 && viewSha256 !== expectedViewSha256) throw new Error('current-view.json 与 active run 记录不匹配');
  return viewSha256;
}

async function writeProposal(generatedDir, view, viewSha256) {
  const proposal = renderProposal(view);
  await fs.mkdir(generatedDir, { recursive: true, mode: 0o700 });
  const runPart = view.runId ?? 'review';
  const outputPath = path.join(generatedDir, `${view.generatedAt.slice(0, 10)}-${runPart}-${viewSha256.slice(0, 12)}-proposal.md`);
  if (await pathExists(outputPath)) {
    const existing = await fs.readFile(outputPath, 'utf8');
    if (existing !== proposal) throw new Error(`同名提案已存在但内容不同：${outputPath}`);
    return { status: 'existing', outputPath, proposalSha256: sha256Text(proposal), bytes: Buffer.byteLength(proposal, 'utf8') };
  }
  await fs.writeFile(outputPath, proposal, { mode: 0o600, flag: 'wx' });
  return { status: 'rendered', outputPath, proposalSha256: sha256Text(proposal), bytes: Buffer.byteLength(proposal, 'utf8') };
}

async function commandRender(stateDir, generatedDir, options) {
  return withLock(stateDir, async () => {
    const { paths } = await loadState(stateDir);
    const view = await readJson(paths.currentView);
    const active = await readJson(paths.activeRun, null);
    if (active) {
      const runId = validateRunId(requiredOption(options, 'run-id'));
      if (active.runId !== runId || active.phase !== 'evaluated') throw new Error('render 需要匹配的 evaluated active run');
      const viewSha256 = await verifyCurrentView(paths, view, active.viewSha256);
      const rendered = await writeProposal(generatedDir, view, viewSha256);
      await writeJsonAtomic(paths.activeRun, {
        ...active,
        phase: 'rendered',
        renderedAt: new Date().toISOString(),
        proposalPath: rendered.outputPath,
        proposalSha256: rendered.proposalSha256,
      });
      return { ...rendered, runId };
    }
    const viewSha256 = await verifyCurrentView(paths, view);
    return writeProposal(generatedDir, view, viewSha256);
  });
}

async function commandCommitRun(stateDir, options) {
  const runId = validateRunId(requiredOption(options, 'run-id'));
  return withLock(stateDir, async () => {
    const { paths } = await loadState(stateDir);
    const runPath = path.join(paths.runs, `${runId}.json`);
    const active = await readJson(paths.activeRun, null);
    if (!active) {
      if (await pathExists(runPath)) {
        const archived = await readJson(runPath);
        return { status: 'existing', runId, runStatus: archived.status };
      }
      throw new Error('commit-run 需要匹配的 rendered 或 committing active run');
    }
    if (active.runId !== runId || !['rendered', 'committing'].includes(active.phase)) {
      throw new Error('commit-run 需要匹配的 rendered 或 committing active run');
    }
    if (!Number.isInteger(active.sessionsScanned) || active.sessionsScanned <= 0) {
      throw new Error('commit-run 拒绝提交 sessionsScanned=0 的空覆盖运行');
    }
    const view = await readJson(paths.currentView);
    const viewSha256 = await verifyCurrentView(paths, view, active.viewSha256);
    if (!(await pathExists(active.proposalPath))) throw new Error('提案文件不存在，拒绝提交水位');
    if (await sha256File(active.proposalPath) !== active.proposalSha256) throw new Error('提案文件已变化，拒绝提交水位');
    const status = active.phase === 'committing'
      ? active.status
      : view.summary.actionable > 0 ? 'review_required' : 'no_change';
    const completedAt = active.phase === 'committing' ? active.completedAt : new Date().toISOString();
    const committing = active.phase === 'committing' ? active : {
      ...active,
      phase: 'committing',
      status,
      completedAt,
      viewSha256,
      summary: view.summary,
    };
    if (active.phase !== 'committing') await writeJsonAtomic(paths.activeRun, committing);
    const completed = {
      ...committing,
      phase: 'committed',
    };
    if (await pathExists(runPath)) {
      const archived = await readJson(runPath);
      if (canonicalStringify(archived) !== canonicalStringify(completed)) throw new Error(`run archive 已存在但内容不同：${runId}`);
    } else {
      await writeJsonAtomic(runPath, completed);
    }
    await writeJsonAtomic(paths.lastRun, {
      schemaVersion: 2,
      runId,
      lastStatus: status,
      completedAt,
      recordsProcessed: committing.recordsProcessed,
      recordsAccepted: committing.recordsAccepted,
      sessionsScanned: committing.sessionsScanned,
      backlogRemaining: committing.backlogRemaining,
      coverageComplete: committing.coverageComplete,
      sourceWatermarks: committing.sourceWatermarks,
      sourceWatermarksTrust: 'declared',
      viewSha256,
      proposalSha256: committing.proposalSha256,
      summary: view.summary,
    });
    await fs.rm(paths.activeRun);
    return {
      status: 'committed',
      runId,
      runStatus: status,
      recordsProcessed: committing.recordsProcessed,
      backlogRemaining: committing.backlogRemaining,
      coverageComplete: committing.coverageComplete,
      sourceWatermarks: committing.sourceWatermarks,
      sourceWatermarksTrust: 'declared',
    };
  });
}

async function commandDecide(stateDir, options) {
  const inputPath = requiredOption(options, 'input');
  return withLock(stateDir, async () => {
    const { paths, config } = await loadState(stateDir);
    if (await pathExists(paths.activeRun)) throw new Error('存在 active run；先完成或显式 abort-run，再记录前台审核');
    const input = await readStructuredInput(inputPath);
    if (input.length !== 1) throw new Error('decide 每次只接受一个决定');
    const decision = validateDecision(input[0]);
    const view = await readJson(paths.currentView);
    const decisions = await readJsonl(paths.decisions);
    const existing = decisions.find((item) => item.id === decision.id);
    if (existing) {
      if (canonicalStringify(existing) !== canonicalStringify(decision)) throw new Error(`决定 ID 冲突且内容不同：${decision.id}`);
      const observations = await readJsonl(paths.observations);
      const inputHashes = await hashStateInputs(paths);
      const asOfMs = Math.max(Date.parse(view.generatedAt), Date.parse(decision.decidedAt));
      const reconciledView = evaluateCandidates({
        observations,
        decisions,
        config,
        asOf: new Date(asOfMs).toISOString(),
        runId: view.runId,
        inputHashes,
      });
      await writeJsonAtomic(paths.currentView, reconciledView);
      const reconciled = reconciledView.candidates.find((item) => item.id === decision.candidateId);
      return { status: 'duplicate', decisionId: decision.id, candidateStatus: reconciled?.status ?? null };
    }
    await verifyCurrentView(paths, view);
    const candidate = view.candidates.find((item) => item.id === decision.candidateId);
    if (!candidate) throw new Error('决定引用的 candidateId 不存在');
    if (candidate.proposalRevision !== decision.proposalRevision
      || candidate.candidateContentHash !== decision.candidateContentHash) {
      throw new Error('决定绑定的 proposal revision 或 candidate content hash 已过期');
    }
    if (['accept', 'edit'].includes(decision.action)
      && !['proposal_pending_review', 'external_modified'].includes(candidate.status)) {
      throw new Error(`当前候选状态 ${candidate.status} 不允许 ${decision.action}`);
    }
    if (decision.action === 'applied_external' && candidate.status !== 'approved_external_pending_apply') {
      throw new Error('applied_external 只能记录已批准且等待外部应用的候选');
    }
    if (decision.action === 'unsuppress' && candidate.status !== 'suppressed') {
      throw new Error('unsuppress 只能用于 suppressed 候选');
    }
    if (decision.action === 'suppress' && candidate.status === 'suppressed') {
      throw new Error('候选已经处于 suppressed 状态');
    }
    await writeJsonlAtomic(paths.decisions, [...decisions, decision]);
    const observations = await readJsonl(paths.observations);
    const inputHashes = await hashStateInputs(paths);
    const asOfMs = Math.max(Date.parse(view.generatedAt), Date.parse(decision.decidedAt));
    const updatedView = evaluateCandidates({
      observations,
      decisions: [...decisions, decision],
      config,
      asOf: new Date(asOfMs).toISOString(),
      runId: view.runId,
      inputHashes,
    });
    await writeJsonAtomic(paths.currentView, updatedView);
    const updated = updatedView.candidates.find((item) => item.id === decision.candidateId);
    return { status: 'recorded', decisionId: decision.id, action: decision.action, candidateStatus: updated.status };
  });
}

async function commandAbortRun(stateDir, options) {
  const runId = validateRunId(requiredOption(options, 'run-id'));
  const reason = requiredOption(options, 'reason');
  if (reason.length > 500) throw new Error('reason 过长');
  return withLock(stateDir, async () => {
    const { paths } = await loadState(stateDir);
    const active = await readJson(paths.activeRun, null);
    if (!active || active.runId !== runId) throw new Error('没有匹配的 active run');
    const runPath = path.join(paths.runs, `${runId}.aborted.${safeTimestamp()}.json`);
    await writeJsonAtomic(runPath, { ...active, phase: 'aborted', abortedAt: new Date().toISOString(), reason });
    await fs.rm(paths.activeRun);
    return { status: 'aborted', runId, runPath };
  });
}

async function commandStatus(stateDir) {
  const { paths, config } = await loadState(stateDir);
  const [lastRun, activeRun, view, observations, decisions, lock] = await Promise.all([
    readJson(paths.lastRun, null),
    readJson(paths.activeRun, null),
    readJson(paths.currentView, null),
    readJsonl(paths.observations),
    readJsonl(paths.decisions),
    inspectLock(stateDir),
  ]);
  return {
    status: activeRun ? `active:${activeRun.phase}` : (lastRun?.lastStatus ?? 'initialized'),
    mode: config.mode,
    evidenceTrust: 'declared',
    stateDir,
    userAllowlistConfigured: config.integration.allowedUserIds.length > 0,
    observations: observations.length,
    decisions: decisions.length,
    activeRun,
    lastRun,
    currentSummary: view?.summary ?? null,
    lock,
    legacyStateDetected: await pathExists(paths.legacyCandidates)
      || await pathExists(paths.legacyApplyState)
      || await pathExists(paths.legacyApplyPending),
  };
}

async function commandRecoverLock(stateDir, options) {
  const expectedSha256 = requiredOption(options, 'expected-sha256');
  const { config } = await loadState(stateDir);
  const minAgeSeconds = options['min-age-seconds'] === undefined
    ? config.staleLockMinAgeSeconds
    : Number(options['min-age-seconds']);
  if (!Number.isInteger(minAgeSeconds) || minAgeSeconds <= 0) throw new Error('min-age-seconds 必须是正整数');
  return recoverStaleLock(stateDir, { expectedSha256, minAgeSeconds });
}

const { command, options } = parseArgs(process.argv.slice(2));
const stateDir = path.resolve(String(options['state-dir'] ?? process.env.PROFILE_CURATOR_STATE_DIR ?? DEFAULT_STATE_DIR));
const generatedDir = path.resolve(String(options['generated-dir'] ?? process.env.PROFILE_CURATOR_GENERATED_DIR ?? DEFAULT_GENERATED_DIR));

try {
  let result;
  if (command === 'init') result = await commandInit(stateDir);
  else if (command === 'begin-run') result = await commandBeginRun(stateDir, options);
  else if (command === 'collect') result = await commandCollect(stateDir, options);
  else if (command === 'evaluate') result = await commandEvaluate(stateDir, options);
  else if (command === 'render') result = await commandRender(stateDir, generatedDir, options);
  else if (command === 'commit-run') result = await commandCommitRun(stateDir, options);
  else if (command === 'decide') result = await commandDecide(stateDir, options);
  else if (command === 'abort-run') result = await commandAbortRun(stateDir, options);
  else if (command === 'status') result = await commandStatus(stateDir);
  else if (command === 'lock-status') result = await inspectLock(stateDir);
  else if (command === 'recover-lock') result = await commandRecoverLock(stateDir, options);
  else throw new Error('用法：profile-curator.mjs <init|begin-run|collect|evaluate|render|commit-run|decide|abort-run|status|lock-status|recover-lock> [options]');
  output(result);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'failed', error: error.message }, null, 2)}\n`);
  process.exitCode = 1;
}
