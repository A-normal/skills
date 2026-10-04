import fs from 'node:fs/promises';
import path from 'node:path';
import { pathExists, readJson, readJsonl, safeTimestamp, sha256Text, statePaths, writeJsonAtomic, writeJsonlAtomic } from './state.mjs';

function countOccurrences(text, token) {
  return text.split(token).length - 1;
}

function singleLine(text) {
  return text.replace(/[\r\n]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export function buildManagedBlock(config, candidates) {
  const { startMarker, endMarker, heading } = config.managedUserSection;
  const sorted = [...candidates].sort((left, right) => {
    const leftKey = `${left.scope}\u001f${left.topicKey}\u001f${left.id}`;
    const rightKey = `${right.scope}\u001f${right.topicKey}\u001f${right.id}`;
    return leftKey.localeCompare(rightKey);
  });
  const lines = [startMarker, heading];
  for (const candidate of sorted) {
    lines.push(`- [${singleLine(candidate.scope)}] ${singleLine(candidate.claim)} <!-- profile-curator:${candidate.id} -->`);
  }
  lines.push(endMarker);
  return `${lines.join('\n')}\n`;
}

export function replaceManagedBlock(original, config, block) {
  const { startMarker, endMarker } = config.managedUserSection;
  const starts = countOccurrences(original, startMarker);
  const ends = countOccurrences(original, endMarker);
  if (starts !== ends || starts > 1) throw new Error('USER.md 受管区块标记缺失或重复');
  if (starts === 0) {
    const separator = original.length === 0 || original.endsWith('\n\n') ? '' : original.endsWith('\n') ? '\n' : '\n\n';
    return `${original}${separator}${block}`;
  }
  const startIndex = original.indexOf(startMarker);
  const endIndex = original.indexOf(endMarker, startIndex);
  if (endIndex < startIndex) throw new Error('USER.md 受管区块结束标记位于开始标记之前');
  const afterEnd = endIndex + endMarker.length;
  const suffixStart = original[afterEnd] === '\r' && original[afterEnd + 1] === '\n'
    ? afterEnd + 2
    : original[afterEnd] === '\n' ? afterEnd + 1 : afterEnd;
  return `${original.slice(0, startIndex)}${block}${original.slice(suffixStart)}`;
}

export function validateManagedDocument(text, config) {
  if (text.includes('\u0000')) throw new Error('USER.md 包含 NUL 字符');
  const { startMarker, endMarker } = config.managedUserSection;
  if (countOccurrences(text, startMarker) !== 1 || countOccurrences(text, endMarker) !== 1) {
    throw new Error('USER.md 必须包含且只包含一个完整受管区块');
  }
  if (text.indexOf(startMarker) > text.indexOf(endMarker)) throw new Error('USER.md 受管区块顺序无效');
}

export async function applyUserManagedSection({
  stateDir,
  targetPath,
  expectedSha256,
  config,
  view,
  baselineReview,
  apply = false,
  now = new Date().toISOString(),
}) {
  if (path.basename(targetPath).toLowerCase() !== 'user.md') throw new Error('apply-user 只允许 USER.md');
  const targetStat = await fs.lstat(targetPath);
  if (!targetStat.isFile() || targetStat.isSymbolicLink()) throw new Error('USER.md 必须是普通文件且不能是符号链接');
  const original = await fs.readFile(targetPath, 'utf8');
  const beforeSha256 = sha256Text(original);
  if (!expectedSha256 || expectedSha256 !== beforeSha256) throw new Error('expected-sha256 与当前 USER.md 不匹配');
  if (!baselineReview || baselineReview.schemaVersion !== 1) throw new Error('缺少有效的 USER.md 语义基线审查');
  if (path.resolve(baselineReview.targetPath) !== path.resolve(targetPath)) throw new Error('基线审查目标与 USER.md 不匹配');
  if (baselineReview.targetSha256 !== beforeSha256) throw new Error('基线审查绑定的 USER.md 哈希已过期');
  if (!Number.isFinite(Date.parse(baselineReview.reviewedAt))) throw new Error('基线审查时间无效');

  const paths = statePaths(stateDir);
  if (await pathExists(paths.applyPending)) throw new Error('发现未完成的 apply-pending.json，需要先执行恢复检查');
  const previousApply = await readJson(paths.applyState, null);
  if (previousApply) {
    if (path.resolve(previousApply.targetPath) !== path.resolve(targetPath)) throw new Error('apply-state.json 的目标路径与本次目标不同');
    if (previousApply.afterSha256 !== beforeSha256) throw new Error('USER.md 自上次应用后被外部修改，禁止自动覆盖');
  } else if (original.includes(config.managedUserSection.startMarker) || original.includes(config.managedUserSection.endMarker)) {
    throw new Error('发现没有 apply-state 的既有受管区块，需要外部流程先确认归属');
  }

  const selected = view.candidates.filter((item) => item.category === 'user_preference'
    && ['eligible_auto_apply', 'promoted'].includes(item.status));
  const reviewItems = new Map();
  for (const item of baselineReview.items ?? []) {
    if (!item || typeof item.candidateId !== 'string' || reviewItems.has(item.candidateId)) throw new Error('基线审查包含无效或重复 candidateId');
    if (!['absent', 'managed_existing', 'already_present', 'conflict', 'uncertain'].includes(item.status)) throw new Error('基线审查状态无效');
    if (typeof item.summary !== 'string' || item.summary.length === 0 || item.summary.length > 500) throw new Error('基线审查摘要无效');
    reviewItems.set(item.candidateId, item);
  }
  for (const candidate of selected) {
    const review = reviewItems.get(candidate.id);
    if (!review) throw new Error(`基线审查缺少候选：${candidate.id}`);
    const allowedStatus = candidate.status === 'promoted' ? 'managed_existing' : 'absent';
    if (review.status !== allowedStatus) {
      throw new Error(`候选 ${candidate.id} 的基线状态为 ${review.status}，不能自动应用`);
    }
  }
  const block = buildManagedBlock(config, selected);
  const updated = replaceManagedBlock(original, config, block);
  validateManagedDocument(updated, config);
  const afterSha256 = sha256Text(updated);
  const preview = {
    targetPath,
    changed: afterSha256 !== beforeSha256,
    beforeSha256,
    afterSha256,
    candidateIds: selected.map((item) => item.id),
    applyRequested: apply,
  };
  if (!apply || !preview.changed) return preview;

  await fs.mkdir(paths.backups, { recursive: true, mode: 0o700 });
  const backupPath = path.join(paths.backups, `USER.${safeTimestamp(now)}.${beforeSha256.slice(0, 12)}.md`);
  await fs.writeFile(backupPath, original, { mode: targetStat.mode & 0o777, flag: 'wx' });

  const existingDecisions = await readJsonl(paths.decisions);
  await writeJsonAtomic(paths.applyPending, {
    schemaVersion: 1,
    targetPath: path.resolve(targetPath),
    createdAt: now,
    beforeSha256,
    afterSha256,
    backupPath,
  });

  const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.profile-curator.${process.pid}.tmp`);
  let replaced = false;
  try {
    await fs.writeFile(tempPath, updated, { mode: targetStat.mode & 0o777, flag: 'wx' });
    const tempReadback = await fs.readFile(tempPath, 'utf8');
    validateManagedDocument(tempReadback, config);
    if (sha256Text(tempReadback) !== afterSha256) throw new Error('临时文件写后哈希不匹配');
    await fs.rename(tempPath, targetPath);
    replaced = true;
    const finalReadback = await fs.readFile(targetPath, 'utf8');
    validateManagedDocument(finalReadback, config);
    if (sha256Text(finalReadback) !== afterSha256) throw new Error('正式文件写后哈希不匹配');
    const runId = `apply-${safeTimestamp(now)}`;
    const newlyApplied = selected.filter((item) => item.status === 'eligible_auto_apply');
    const decisions = newlyApplied.map((item) => ({
      schemaVersion: 1,
      id: `${runId}-${item.id}`,
      candidateId: item.id,
      action: 'applied',
      decidedAt: now,
      actor: 'profile_curator_apply',
      note: `安全应用到 USER.md；写前 ${beforeSha256}；写后 ${afterSha256}`,
      targetRevision: afterSha256,
    }));
    await writeJsonAtomic(paths.applyState, {
      schemaVersion: 1,
      targetPath: path.resolve(targetPath),
      appliedAt: now,
      beforeSha256,
      afterSha256,
      backupPath,
      candidateIds: selected.map((item) => item.id),
    });
    await writeJsonlAtomic(paths.decisions, [...existingDecisions, ...decisions]);
    await fs.rm(paths.applyPending, { force: true });

    return { ...preview, applied: true, backupPath, decisionsWritten: decisions.length };
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    const recoveryErrors = [];
    if (replaced) await fs.copyFile(backupPath, targetPath).catch((restoreError) => recoveryErrors.push(`目标恢复失败：${restoreError.message}`));
    if (previousApply) {
      await writeJsonAtomic(paths.applyState, previousApply).catch((restoreError) => recoveryErrors.push(`apply-state 恢复失败：${restoreError.message}`));
    } else {
      await fs.rm(paths.applyState, { force: true }).catch((restoreError) => recoveryErrors.push(`apply-state 清理失败：${restoreError.message}`));
    }
    await writeJsonlAtomic(paths.decisions, existingDecisions).catch((restoreError) => recoveryErrors.push(`decisions 恢复失败：${restoreError.message}`));
    if (recoveryErrors.length === 0) await fs.rm(paths.applyPending, { force: true }).catch(() => {});
    throw new Error(`USER.md 应用失败，已尝试恢复：${error.message}${recoveryErrors.length ? `；${recoveryErrors.join('；')}` : ''}`);
  }
}
