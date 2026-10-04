import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyUserManagedSection } from '../scripts/lib/apply-user.mjs';
import { candidateIdFor, evaluateCandidates, validateObservation } from '../scripts/lib/engine.mjs';
import { initializeState, readJsonl, sha256Text, statePaths, writeJsonAtomic } from '../scripts/lib/state.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, '..');
const defaultConfigPath = path.join(skillDir, 'config', 'default.json');
const config = JSON.parse(await fs.readFile(defaultConfigPath, 'utf8'));

function observation({
  id,
  category = 'user_preference',
  topicKey = 'response.detail',
  valueKey = 'concise',
  claim = '默认先给结论并保持简洁',
  scope = 'global',
  sessionRef,
  occurredAt,
  sourceType = 'inferred_behavior',
  role = 'user',
  topLevel = true,
  quoted = false,
  relation = 'new_candidate',
  counterEvidenceFor = [],
  severity = 'normal',
  personaTargetRef,
}) {
  return {
    schemaVersion: 1,
    id,
    category,
    topicKey,
    valueKey,
    claim,
    scope,
    ...(personaTargetRef ? { personaTargetRef } : {}),
    relation,
    ...(counterEvidenceFor.length > 0 ? { counterEvidenceFor } : {}),
    source: {
      ref: `source:${id}`,
      sessionRef,
      occurredAt,
      role,
      sourceType,
      topLevel,
      quoted,
      origin: 'primary_event',
    },
    summary: `脱敏摘要 ${id}`,
    sensitivity: 'normal',
    severity,
  };
}

test('明确长期声明必须来自未引用的顶层用户消息', () => {
  const valid = observation({
    id: 'explicit-1',
    sessionRef: 'session-1',
    occurredAt: '2026-10-01T00:00:00.000Z',
    sourceType: 'explicit_long_term_statement',
  });
  assert.equal(validateObservation(valid).candidateId, candidateIdFor(valid));
  assert.throws(() => validateObservation({ ...valid, id: 'quoted', source: { ...valid.source, quoted: true } }), /顶层用户消息/u);
  assert.throws(() => validateObservation({ ...valid, id: 'assistant', source: { ...valid.source, role: 'assistant' } }), /顶层用户消息/u);
});

test('Curator 输出和缺少人格引用的 persona 观察会被拒绝', () => {
  const generated = observation({ id: 'generated', sessionRef: 's1', occurredAt: '2026-10-01T00:00:00.000Z' });
  generated.source.origin = 'curator_output';
  assert.throws(() => validateObservation(generated), /不能作为新证据/u);
  const persona = observation({ id: 'persona', category: 'persona_self', sessionRef: 's1', occurredAt: '2026-10-01T00:00:00.000Z' });
  assert.throws(() => validateObservation(persona), /personaTargetRef/u);
});

test('首次评价只预览，后续明确声明取得自动应用资格', () => {
  const items = [validateObservation(observation({
    id: 'explicit-2',
    sessionRef: 'session-1',
    occurredAt: '2026-10-01T00:00:00.000Z',
    sourceType: 'explicit_long_term_statement',
  }))];
  const preview = evaluateCandidates({ observations: items, config, asOf: '2026-10-04T00:00:00.000Z', initialPreview: true });
  assert.equal(preview.candidates[0].status, 'preview_only');
  const normal = evaluateCandidates({ observations: items, config, asOf: '2026-10-04T00:00:00.000Z', initialPreview: false });
  assert.equal(normal.candidates[0].status, 'eligible_auto_apply');
});

test('推断偏好按独立会话计数，达到三会话才晋升', () => {
  const items = [
    observation({ id: 'i1', sessionRef: 's1', occurredAt: '2026-09-01T00:00:00.000Z' }),
    observation({ id: 'i2', sessionRef: 's1', occurredAt: '2026-09-02T00:00:00.000Z', relation: 'supports' }),
    observation({ id: 'i3', sessionRef: 's2', occurredAt: '2026-09-03T00:00:00.000Z', relation: 'supports' }),
  ].map(validateObservation);
  let view = evaluateCandidates({ observations: items, config, asOf: '2026-10-04T00:00:00.000Z' });
  assert.equal(view.candidates[0].recentIndependentSessions, 2);
  assert.equal(view.candidates[0].status, 'observed');
  items.push(validateObservation(observation({ id: 'i4', sessionRef: 's3', occurredAt: '2026-09-04T00:00:00.000Z', relation: 'supports' })));
  view = evaluateCandidates({ observations: items, config, asOf: '2026-10-04T00:00:00.000Z' });
  assert.equal(view.candidates[0].recentIndependentSessions, 3);
  assert.equal(view.candidates[0].status, 'eligible_auto_apply');
});

test('窗口外推断证据动态显示 dormant', () => {
  const item = validateObservation(observation({ id: 'old', sessionRef: 'old-session', occurredAt: '2025-01-01T00:00:00.000Z' }));
  const view = evaluateCandidates({ observations: [item], config, asOf: '2026-10-04T00:00:00.000Z' });
  assert.equal(view.candidates[0].status, 'dormant');
});

test('同一主题和作用域的多个推断值会暂停晋升', () => {
  const items = [];
  for (const [valueKey, prefix] of [['concise', 'c'], ['detailed', 'd']]) {
    for (let index = 1; index <= 3; index += 1) {
      items.push(validateObservation(observation({
        id: `${prefix}${index}`,
        valueKey,
        claim: valueKey === 'concise' ? '默认简洁' : '默认详细解释',
        sessionRef: `${prefix}-session-${index}`,
        occurredAt: `2026-09-0${index}T00:00:00.000Z`,
        relation: index === 1 ? 'new_candidate' : 'supports',
      })));
    }
  }
  const view = evaluateCandidates({ observations: items, config, asOf: '2026-10-04T00:00:00.000Z' });
  assert.equal(view.conflicts.length, 1);
  assert.deepEqual(new Set(view.candidates.map((item) => item.status)), new Set(['conflict']));
});

test('明确长期声明取代同范围的推断值', () => {
  const inferred = validateObservation(observation({ id: 'inferred', valueKey: 'concise', sessionRef: 's1', occurredAt: '2026-09-01T00:00:00.000Z' }));
  const explicit = validateObservation(observation({
    id: 'explicit-new',
    valueKey: 'detailed',
    claim: '以后默认详细解释',
    sessionRef: 's2',
    occurredAt: '2026-10-01T00:00:00.000Z',
    sourceType: 'explicit_long_term_statement',
  }));
  const view = evaluateCandidates({ observations: [inferred, explicit], config, asOf: '2026-10-04T00:00:00.000Z' });
  assert.equal(view.candidates.find((item) => item.valueKey === 'detailed').status, 'eligible_auto_apply');
  assert.equal(view.candidates.find((item) => item.valueKey === 'concise').status, 'superseded');
});

test('严重且已验证的方法事件单次即可形成提案', () => {
  const item = validateObservation(observation({
    id: 'method-risk',
    category: 'agent_method',
    topicKey: 'filesystem.delete',
    valueKey: 'verify-target',
    claim: '递归删除前必须验证绝对目标范围',
    sessionRef: 'tool-run-1',
    occurredAt: '2026-10-02T00:00:00.000Z',
    sourceType: 'verified_outcome',
    role: 'tool',
    topLevel: false,
    severity: 'high',
  }));
  const view = evaluateCandidates({ observations: [item], config, asOf: '2026-10-04T00:00:00.000Z' });
  assert.equal(view.candidates[0].status, 'review_required');
});

test('USER.md 应用先预览、备份并阻止覆盖外部修改', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-curator-test-'));
  const stateDir = path.join(root, 'state');
  const targetPath = path.join(root, 'USER.md');
  try {
    await initializeState(stateDir, defaultConfigPath);
    await fs.writeFile(targetPath, '# USER\n\nExisting text.\n', { mode: 0o600 });
    const item = validateObservation(observation({
      id: 'apply-explicit',
      sessionRef: 's1',
      occurredAt: '2026-10-01T00:00:00.000Z',
      sourceType: 'explicit_long_term_statement',
    }));
    const view = evaluateCandidates({ observations: [item], config, asOf: '2026-10-04T00:00:00.000Z' });
    await writeJsonAtomic(statePaths(stateDir).currentView, view);
    const original = await fs.readFile(targetPath, 'utf8');
    const expectedSha256 = sha256Text(original);
    const baselineReview = {
      schemaVersion: 1,
      targetPath,
      targetSha256: expectedSha256,
      reviewedAt: '2026-10-04T00:59:00.000Z',
      items: [{ candidateId: view.candidates[0].id, status: 'absent', summary: '当前 USER.md 不含同义或冲突规则' }],
    };
    await assert.rejects(
      applyUserManagedSection({
        stateDir,
        targetPath,
        expectedSha256,
        config,
        view,
        baselineReview: {
          ...baselineReview,
          items: [{ candidateId: view.candidates[0].id, status: 'conflict', summary: '与人工规则冲突' }],
        },
      }),
      /不能自动应用/u,
    );
    const preview = await applyUserManagedSection({ stateDir, targetPath, expectedSha256, config, view, baselineReview });
    assert.equal(preview.changed, true);
    assert.equal(await fs.readFile(targetPath, 'utf8'), original);

    const applied = await applyUserManagedSection({ stateDir, targetPath, expectedSha256, config, view, baselineReview, apply: true, now: '2026-10-04T01:00:00.000Z' });
    assert.equal(applied.applied, true);
    const updated = await fs.readFile(targetPath, 'utf8');
    assert.match(updated, /profile-curator:user-preferences:start/u);
    assert.match(updated, /默认先给结论并保持简洁/u);
    assert.equal((await readJsonl(statePaths(stateDir).decisions)).at(-1).action, 'applied');
    assert.equal((await fs.readdir(statePaths(stateDir).backups)).length, 1);

    await fs.appendFile(targetPath, '\nManual edit.\n');
    const externallyChanged = await fs.readFile(targetPath, 'utf8');
    const changedReview = {
      ...baselineReview,
      targetSha256: sha256Text(externallyChanged),
      reviewedAt: '2026-10-04T01:01:00.000Z',
      items: [{ candidateId: view.candidates[0].id, status: 'managed_existing', summary: '候选仍在受管区块中' }],
    };
    await assert.rejects(
      applyUserManagedSection({ stateDir, targetPath, expectedSha256: sha256Text(externallyChanged), config, view, baselineReview: changedReview, apply: true }),
      /外部修改/u,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('CLI 支持初始化、幂等摄取、首次预览、后续评价与幂等渲染', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-curator-cli-'));
  const stateDir = path.join(root, 'state');
  const generatedDir = path.join(root, 'generated');
  const inputPath = path.join(root, 'observations.json');
  const runResultPath = path.join(root, 'run-result.json');
  const cliPath = path.join(skillDir, 'scripts', 'profile-curator.mjs');
  const runRaw = (...args) => spawnSync(process.execPath, [cliPath, ...args, '--state-dir', stateDir, '--generated-dir', generatedDir], {
      encoding: 'utf8',
    });
  const run = (...args) => {
    const result = runRaw(...args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  try {
    const item = observation({
      id: 'cli-explicit',
      sessionRef: 'cli-session',
      occurredAt: '2026-10-01T00:00:00.000Z',
      sourceType: 'explicit_long_term_statement',
    });
    await fs.writeFile(inputPath, `${JSON.stringify(item, null, 2)}\n`);
    assert.equal(run('init').status, 'initialized');
    assert.equal(run('ingest', '--input', inputPath).accepted, 1);
    assert.equal(run('ingest', '--input', inputPath).accepted, 0);
    await fs.writeFile(inputPath, `${JSON.stringify({ ...item, claim: '同一 ID 的不同内容' }, null, 2)}\n`);
    assert.notEqual(runRaw('ingest', '--input', inputPath).status, 0);
    const first = run('evaluate', '--as-of', '2026-10-04T00:00:00.000Z');
    assert.equal(first.initialPreview, true);
    assert.equal(run('evaluate', '--as-of', '2026-10-04T00:00:00.000Z').initialPreview, true);
    await fs.writeFile(runResultPath, `${JSON.stringify({
      schemaVersion: 1,
      runId: 'run-1',
      completedAt: '2026-10-04T00:01:00.000Z',
      status: 'updated',
      recordsProcessed: 1,
      backlogRemaining: 0,
      sourceWatermarks: { sessions: 'cursor-1' },
    }, null, 2)}\n`);
    assert.equal(run('complete-run', '--input', runResultPath).status, 'completed');
    assert.equal(run('complete-run', '--input', runResultPath).status, 'existing');
    await fs.writeFile(runResultPath, `${JSON.stringify({
      schemaVersion: 1,
      runId: 'run-1',
      completedAt: '2026-10-04T00:01:00.000Z',
      status: 'updated',
      recordsProcessed: 1,
      backlogRemaining: 1,
      sourceWatermarks: { sessions: 'cursor-1' },
    }, null, 2)}\n`);
    assert.notEqual(runRaw('complete-run', '--input', runResultPath).status, 0);
    const second = run('evaluate', '--as-of', '2026-10-04T00:00:00.000Z');
    assert.equal(second.initialPreview, false);
    assert.equal(second.eligibleAutoApply, 1);
    assert.equal(run('render').status, 'rendered');
    assert.equal(run('render').status, 'existing');
    assert.equal(run('status').currentSummary.eligibleAutoApply, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
