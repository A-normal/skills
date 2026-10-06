import path from 'node:path';
import { canonicalStringify, sha256Text, stableId } from './state.mjs';

const CATEGORIES = new Set(['user_preference', 'agent_method', 'persona_self']);
const RELATIONS = new Set(['new_candidate', 'supports', 'contradicts', 'related', 'uncertain']);
const SOURCE_TYPES = new Set([
  'explicit_long_term_statement',
  'direct_feedback',
  'inferred_behavior',
  'verified_outcome',
  'user_review',
  'assistant_reflection',
]);
const DECISION_ACTIONS = new Set([
  'accept',
  'edit',
  'reject',
  'suppress',
  'unsuppress',
  'defer',
  'supersede',
  'external_modified',
  'applied_external',
]);
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

function assertObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} 必须是对象`);
}

function assertExactKeys(value, allowed, required, field) {
  assertObject(value, field);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${field} 包含未知字段：${unknown.join(', ')}`);
  const missing = required.filter((key) => !(key in value));
  if (missing.length > 0) throw new Error(`${field} 缺少字段：${missing.join(', ')}`);
}

function requiredString(value, field, maxLength) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength || value.includes('\u0000')) {
    throw new Error(`${field} 必须是 1-${maxLength} 个字符的字符串`);
  }
  return value.trim();
}

function validIso(value, field, { nowMs, maxFutureSkewMinutes = 0 } = {}) {
  requiredString(value, field, 80);
  if (!ISO_8601_PATTERN.test(value)) throw new Error(`${field} 不是严格 ISO-8601 时间`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} 不是有效 ISO-8601 时间`);
  if (Number.isFinite(nowMs) && parsed > nowMs + maxFutureSkewMinutes * 60000) throw new Error(`${field} 超出允许的未来时间偏差`);
  return new Date(parsed).toISOString();
}

function uniqueStrings(value, field, maxItems = 100) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field} 必须是最多 ${maxItems} 项的数组`);
  const normalized = value.map((item, index) => requiredString(item, `${field}[${index}]`, 300));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} 不能包含重复值`);
  return normalized;
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} 必须是正整数`);
  return value;
}

function enumValue(value, allowed, field) {
  if (!allowed.includes(value)) throw new Error(`${field} 无效`);
  return value;
}

export function validateConfig(input) {
  const topKeys = [
    'schemaVersion', 'policyVersion', 'mode', 'evidenceWindowDays', 'requiredInferredUserSessions',
    'requiredAgentMethodSessions', 'requiredPersonaSessions', 'initialBackfillDays',
    'initialBackfillMaxSessions', 'maxRecordsPerRun', 'maxFutureSkewMinutes',
    'staleLockMinAgeSeconds', 'sensitiveEvidencePolicy', 'integration', 'taxonomy',
  ];
  assertExactKeys(input, topKeys, topKeys, 'config');
  if (input.schemaVersion !== 2) throw new Error('config schemaVersion 必须为 2；v1 状态不能静默迁移');
  requiredString(input.policyVersion, 'config.policyVersion', 40);
  if (input.mode !== 'proposal_only') throw new Error('v1.1 只允许 proposal_only 模式');
  for (const key of [
    'evidenceWindowDays', 'requiredInferredUserSessions', 'requiredAgentMethodSessions', 'requiredPersonaSessions',
    'initialBackfillDays', 'initialBackfillMaxSessions', 'maxRecordsPerRun', 'maxFutureSkewMinutes',
    'staleLockMinAgeSeconds',
  ]) positiveInteger(input[key], `config.${key}`);
  if (input.sensitiveEvidencePolicy !== 'reject') throw new Error('v1.1 只允许 sensitiveEvidencePolicy=reject');

  const integrationKeys = [
    'host', 'validatedHostBaseline', 'requiredTools', 'supplementalTools',
    'allowedAgents', 'allowedChatScopes', 'allowedChannels', 'allowedUserIds',
  ];
  assertExactKeys(input.integration, integrationKeys, integrationKeys, 'config.integration');
  if (input.integration.host !== 'openclaw') throw new Error('v1.1 只支持 OpenClaw');
  requiredString(input.integration.validatedHostBaseline, 'config.integration.validatedHostBaseline', 40);
  const requiredTools = uniqueStrings(input.integration.requiredTools, 'config.integration.requiredTools', 20);
  for (const tool of ['sessions_list', 'sessions_history']) {
    if (!requiredTools.includes(tool)) throw new Error(`config.integration.requiredTools 缺少 ${tool}`);
  }
  uniqueStrings(input.integration.supplementalTools, 'config.integration.supplementalTools', 20);
  uniqueStrings(input.integration.allowedAgents, 'config.integration.allowedAgents', 20);
  uniqueStrings(input.integration.allowedChatScopes, 'config.integration.allowedChatScopes', 20);
  uniqueStrings(input.integration.allowedChannels, 'config.integration.allowedChannels', 20);
  uniqueStrings(input.integration.allowedUserIds, 'config.integration.allowedUserIds', 100);
  if (!input.integration.allowedChatScopes.every((item) => item === 'direct')) throw new Error('v1.1 只允许 direct chat scope');

  const taxonomyKeys = ['allowedScopes', 'unknownTopicKey', 'userPreferenceTopics'];
  assertExactKeys(input.taxonomy, taxonomyKeys, taxonomyKeys, 'config.taxonomy');
  const allowedScopes = uniqueStrings(input.taxonomy.allowedScopes, 'config.taxonomy.allowedScopes', 50);
  if (allowedScopes.length === 0) throw new Error('config.taxonomy.allowedScopes 不能为空');
  if (!KEY_PATTERN.test(input.taxonomy.unknownTopicKey ?? '')) throw new Error('config.taxonomy.unknownTopicKey 格式无效');
  assertObject(input.taxonomy.userPreferenceTopics, 'config.taxonomy.userPreferenceTopics');
  for (const [topic, values] of Object.entries(input.taxonomy.userPreferenceTopics)) {
    if (!KEY_PATTERN.test(topic)) throw new Error(`用户偏好 topicKey 格式无效：${topic}`);
    const normalizedValues = uniqueStrings(values, `config.taxonomy.userPreferenceTopics.${topic}`, 50);
    if (normalizedValues.length === 0 || normalizedValues.some((item) => !KEY_PATTERN.test(item))) {
      throw new Error(`用户偏好 topic ${topic} 的 valueKey 无效`);
    }
  }
  if (!input.taxonomy.userPreferenceTopics[input.taxonomy.unknownTopicKey]?.includes('manual')) {
    throw new Error('unknownTopicKey 必须包含 manual valueKey');
  }
  return structuredClone(input);
}

function validatePersonaTarget(value) {
  assertExactKeys(value, ['path', 'sha256'], ['path', 'sha256'], 'personaTarget');
  const targetPath = requiredString(value.path, 'personaTarget.path', 500);
  if (!path.isAbsolute(targetPath)) throw new Error('personaTarget.path 必须是绝对路径');
  if (!SHA256_PATTERN.test(value.sha256 ?? '')) throw new Error('personaTarget.sha256 必须是 SHA-256');
  return { path: targetPath, sha256: value.sha256 };
}

export function sourceEventIdFor(observation) {
  const source = observation.evidence;
  return stableId('event', [source.host, source.sessionId, source.sessionKey, source.messageId, source.contentSha256]);
}

export function candidateIdFor(observation, config) {
  const personaPath = observation.personaTarget?.path ?? '';
  const reviewOnlyClaim = observation.category === 'user_preference'
    && observation.topicKey === config.taxonomy.unknownTopicKey
    ? sha256Text(observation.claim.trim())
    : '';
  return stableId('cand', [
    observation.category,
    observation.topicKey,
    observation.valueKey,
    observation.scope,
    personaPath,
    reviewOnlyClaim,
  ]);
}

export function conflictGroupKey(observation) {
  return [observation.category, observation.topicKey, observation.scope, observation.personaTarget?.path ?? ''].join('\u001f');
}

export function validateCollectionReceipt(input, config, { now = new Date().toISOString() } = {}) {
  validateConfig(config);
  assertExactKeys(input, ['schemaVersion', 'runId', 'collectedAt', 'trust', 'host', 'hostVersion', 'sessions'], ['schemaVersion', 'runId', 'collectedAt', 'trust', 'host', 'hostVersion', 'sessions'], 'collection receipt');
  if (input.schemaVersion !== 2) throw new Error('collection receipt schemaVersion 必须为 2');
  if (!RUN_ID_PATTERN.test(input.runId ?? '')) throw new Error('collection receipt runId 无效');
  const nowMs = Date.parse(now);
  const collectedAt = validIso(input.collectedAt, 'collection receipt collectedAt', { nowMs, maxFutureSkewMinutes: config.maxFutureSkewMinutes });
  if (input.trust !== 'declared') throw new Error('v1.1 仅接受 declared evidence；host_attested 尚未实现');
  if (input.host !== config.integration.host) throw new Error('collection receipt host 与配置不匹配');
  if (input.hostVersion !== config.integration.validatedHostBaseline) throw new Error('collection receipt hostVersion 与已验证宿主基线不匹配');
  if (!Array.isArray(input.sessions) || input.sessions.length > config.initialBackfillMaxSessions) {
    throw new Error(`collection receipt sessions 超过 ${config.initialBackfillMaxSessions} 项`);
  }
  if (config.integration.allowedUserIds.length === 0) throw new Error('config.integration.allowedUserIds 为空，拒绝采集');
  if (config.integration.allowedChannels.length === 0) throw new Error('config.integration.allowedChannels 为空，拒绝采集');
  if (input.sessions.length === 0) throw new Error('collection receipt sessions 不能为空');
  const seen = new Set();
  const sessions = input.sessions.map((session, index) => {
    const field = `collection receipt sessions[${index}]`;
    const keys = [
      'sessionId', 'sessionKey', 'agentId', 'channel', 'chatScope', 'userId', 'createdActorId',
      'previousWatermark', 'observedThroughMessageId', 'backlogRemaining', 'complete',
      'historyTruncated', 'droppedMessages', 'contentTruncated', 'contentRedacted',
    ];
    assertExactKeys(session, keys, keys, field);
    const normalized = {
      sessionId: requiredString(session.sessionId, `${field}.sessionId`, 300),
      sessionKey: requiredString(session.sessionKey, `${field}.sessionKey`, 300),
      agentId: requiredString(session.agentId, `${field}.agentId`, 160),
      channel: requiredString(session.channel, `${field}.channel`, 80),
      chatScope: requiredString(session.chatScope, `${field}.chatScope`, 80),
      userId: requiredString(session.userId, `${field}.userId`, 300),
      createdActorId: requiredString(session.createdActorId, `${field}.createdActorId`, 300),
      previousWatermark: session.previousWatermark === null ? null : requiredString(session.previousWatermark, `${field}.previousWatermark`, 500),
      observedThroughMessageId: requiredString(session.observedThroughMessageId, `${field}.observedThroughMessageId`, 500),
      backlogRemaining: session.backlogRemaining,
      complete: session.complete,
      historyTruncated: session.historyTruncated,
      droppedMessages: session.droppedMessages,
      contentTruncated: session.contentTruncated,
      contentRedacted: session.contentRedacted,
    };
    if (!Number.isInteger(normalized.backlogRemaining) || normalized.backlogRemaining < 0) throw new Error(`${field}.backlogRemaining 无效`);
    for (const key of ['complete', 'historyTruncated', 'droppedMessages', 'contentTruncated', 'contentRedacted']) {
      if (typeof normalized[key] !== 'boolean') throw new Error(`${field}.${key} 必须是布尔值`);
    }
    if (!config.integration.allowedAgents.includes(normalized.agentId)) throw new Error(`${field}.agentId 不在 allowlist`);
    if (!config.integration.allowedChannels.includes(normalized.channel)) throw new Error(`${field}.channel 不在 allowlist`);
    if (!config.integration.allowedChatScopes.includes(normalized.chatScope)) throw new Error(`${field}.chatScope 不在 allowlist`);
    if (!config.integration.allowedUserIds.includes(normalized.userId)) throw new Error(`${field}.userId 不在 allowlist`);
    if (normalized.createdActorId !== normalized.userId) throw new Error(`${field}.createdActorId 与 userId 不匹配`);
    const expectedSessionKey = `agent:${normalized.agentId}:${normalized.channel}:${normalized.chatScope}:${normalized.userId}`;
    if (normalized.sessionKey !== expectedSessionKey) throw new Error(`${field}.sessionKey 与 agent/channel/scope/user 不匹配`);
    if (normalized.droppedMessages || normalized.contentTruncated || normalized.contentRedacted) {
      throw new Error(`${field} 历史包含丢失、内容截断或脱敏，拒绝采集和推进水位`);
    }
    if (normalized.complete && (normalized.historyTruncated || normalized.backlogRemaining !== 0)) {
      throw new Error(`${field}.complete 与 historyTruncated/backlogRemaining 矛盾`);
    }
    if (!normalized.complete && !normalized.historyTruncated && normalized.backlogRemaining === 0) {
      throw new Error(`${field} 声明不完整但未声明截断或 backlog`);
    }
    if (seen.has(normalized.sessionId)) throw new Error(`collection receipt 包含重复 sessionId：${normalized.sessionId}`);
    seen.add(normalized.sessionId);
    return normalized;
  });
  return { schemaVersion: 2, runId: input.runId, collectedAt, trust: 'declared', host: input.host, hostVersion: input.hostVersion, sessions };
}

function validateEvidence(input, config, nowMs) {
  const keys = [
    'trust', 'host', 'agentId', 'chatScope', 'userId', 'sessionId', 'sessionKey', 'messageId',
    'occurredAt', 'role', 'sourceType', 'topLevel', 'quoted', 'forwarded', 'contentSha256',
  ];
  assertExactKeys(input, keys, keys, 'evidence');
  if (input.trust !== 'declared') throw new Error('v1.1 仅接受 declared evidence');
  if (input.host !== config.integration.host) throw new Error('evidence.host 与配置不匹配');
  const evidence = {
    trust: 'declared',
    host: input.host,
    agentId: requiredString(input.agentId, 'evidence.agentId', 160),
    chatScope: requiredString(input.chatScope, 'evidence.chatScope', 80),
    userId: requiredString(input.userId, 'evidence.userId', 300),
    sessionId: requiredString(input.sessionId, 'evidence.sessionId', 300),
    sessionKey: requiredString(input.sessionKey, 'evidence.sessionKey', 300),
    messageId: requiredString(input.messageId, 'evidence.messageId', 500),
    occurredAt: validIso(input.occurredAt, 'evidence.occurredAt', { nowMs, maxFutureSkewMinutes: config.maxFutureSkewMinutes }),
    role: enumValue(input.role, ['user', 'assistant', 'tool'], 'evidence.role'),
    sourceType: enumValue(input.sourceType, [...SOURCE_TYPES], 'evidence.sourceType'),
    topLevel: input.topLevel,
    quoted: input.quoted,
    forwarded: input.forwarded,
    contentSha256: input.contentSha256,
  };
  for (const key of ['topLevel', 'quoted', 'forwarded']) {
    if (typeof evidence[key] !== 'boolean') throw new Error(`evidence.${key} 必须是布尔值`);
  }
  if (!SHA256_PATTERN.test(evidence.contentSha256 ?? '')) throw new Error('evidence.contentSha256 必须是 SHA-256');
  if (!config.integration.allowedAgents.includes(evidence.agentId)) throw new Error('evidence.agentId 不在 allowlist');
  if (!config.integration.allowedChatScopes.includes(evidence.chatScope)) throw new Error('evidence.chatScope 不在 allowlist');
  if (!config.integration.allowedUserIds.includes(evidence.userId)) throw new Error('evidence.userId 不在 allowlist');
  return evidence;
}

function validateUserAuthoredEvidence(evidence, label) {
  if (evidence.role !== 'user' || !evidence.topLevel || evidence.quoted || evidence.forwarded) {
    throw new Error(`${label} 必须来自未引用、未转发的顶层用户消息`);
  }
}

export function validateObservation(input, { config, now = new Date().toISOString(), stored = false } = {}) {
  validateConfig(config);
  const baseKeys = [
    'schemaVersion', 'category', 'topicKey', 'valueKey', 'claim', 'scope', 'personaTarget', 'relation',
    'counterEvidenceFor', 'relatedCandidateIds', 'evidence', 'summary', 'sensitivity', 'severity',
  ];
  const storedKeys = [...baseKeys, 'id', 'sourceEventId', 'candidateId', 'ingestedAt'];
  assertExactKeys(input, stored ? storedKeys : baseKeys, [
    'schemaVersion', 'category', 'topicKey', 'valueKey', 'claim', 'scope', 'relation', 'evidence',
    'summary', 'sensitivity',
  ], 'observation');
  if (input.schemaVersion !== 2) throw new Error('observation schemaVersion 必须为 2');
  if (!CATEGORIES.has(input.category)) throw new Error(`未知 category：${input.category}`);
  if (!KEY_PATTERN.test(input.topicKey ?? '')) throw new Error('topicKey 格式无效');
  if (!KEY_PATTERN.test(input.valueKey ?? '')) throw new Error('valueKey 格式无效');
  const claim = requiredString(input.claim, 'claim', 800);
  const scope = requiredString(input.scope, 'scope', 160);
  if (!config.taxonomy.allowedScopes.includes(scope)) throw new Error('scope 不在受控 taxonomy');
  if (!RELATIONS.has(input.relation)) throw new Error(`未知 relation：${input.relation}`);
  const summary = requiredString(input.summary, 'summary', 500);
  if (input.sensitivity !== 'normal') throw new Error(`隐私策略拒绝 ${input.sensitivity ?? '未知'} 观察`);
  const severity = input.severity ?? 'normal';
  enumValue(severity, ['normal', 'high'], 'severity');
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('now 无效');
  const evidence = validateEvidence(input.evidence, config, nowMs);

  let personaTarget;
  if (input.category === 'persona_self') personaTarget = validatePersonaTarget(input.personaTarget);
  else if (input.personaTarget !== undefined) throw new Error('只有 persona_self 可以提供 personaTarget');

  if (input.category === 'user_preference') {
    validateUserAuthoredEvidence(evidence, 'user_preference');
    if (['verified_outcome', 'assistant_reflection'].includes(evidence.sourceType)) throw new Error('user_preference 不接受 Tool 或 Assistant 来源');
    const allowedValues = config.taxonomy.userPreferenceTopics[input.topicKey];
    if (!allowedValues?.includes(input.valueKey)) throw new Error('user_preference topicKey/valueKey 不在受控 taxonomy');
  }
  if (['explicit_long_term_statement', 'direct_feedback', 'user_review'].includes(evidence.sourceType)) {
    validateUserAuthoredEvidence(evidence, evidence.sourceType);
  }
  if (evidence.sourceType === 'verified_outcome') {
    if (input.category !== 'agent_method' || evidence.role !== 'tool') throw new Error('verified_outcome 只允许 Tool 支持 agent_method');
  } else if (evidence.role === 'tool') {
    throw new Error('Tool 证据必须使用 verified_outcome');
  }
  if (evidence.sourceType === 'assistant_reflection') {
    if (!['agent_method', 'persona_self'].includes(input.category) || evidence.role !== 'assistant' || input.relation !== 'uncertain') {
      throw new Error('assistant_reflection 只允许作为 agent_method/persona_self 的 uncertain 反思');
    }
  } else if (evidence.role === 'assistant') {
    throw new Error('Assistant 证据必须使用 assistant_reflection，且不能计入晋升');
  }

  for (const field of ['counterEvidenceFor', 'relatedCandidateIds']) {
    if (!Array.isArray(input[field] ?? []) || (input[field] ?? []).some((item) => typeof item !== 'string' || item.length > 80)) {
      throw new Error(`${field} 无效`);
    }
  }
  const counterEvidenceFor = [...new Set(input.counterEvidenceFor ?? [])];
  const relatedCandidateIds = [...new Set(input.relatedCandidateIds ?? [])];
  if (input.relation === 'contradicts' && counterEvidenceFor.length === 0) throw new Error('contradicts 必须提供 counterEvidenceFor');
  if (input.relation === 'related' && relatedCandidateIds.length === 0) throw new Error('related 必须提供 relatedCandidateIds');

  const normalizedBase = {
    schemaVersion: 2,
    category: input.category,
    topicKey: input.topicKey,
    valueKey: input.valueKey,
    claim,
    scope,
    ...(personaTarget ? { personaTarget } : {}),
    relation: input.relation,
    counterEvidenceFor,
    relatedCandidateIds,
    evidence,
    summary,
    sensitivity: 'normal',
    severity,
  };
  const sourceEventId = sourceEventIdFor(normalizedBase);
  const candidateId = candidateIdFor(normalizedBase, config);
  const id = stableId('obs', [sourceEventId, candidateId]);
  if (stored) {
    if (input.id !== id || input.sourceEventId !== sourceEventId || input.candidateId !== candidateId) {
      throw new Error('状态中的 observation/sourceEvent/candidate ID 与确定性计算不匹配');
    }
    validIso(input.ingestedAt, 'ingestedAt');
  }
  return {
    ...normalizedBase,
    id,
    sourceEventId,
    candidateId,
    ...(stored ? { ingestedAt: input.ingestedAt } : {}),
  };
}

export function validateDecision(input, { now = new Date().toISOString() } = {}) {
  const keys = [
    'schemaVersion', 'id', 'candidateId', 'proposalRevision', 'candidateContentHash', 'action',
    'decidedAt', 'actor', 'note', 'replacementClaim', 'deferUntil', 'targetRef', 'targetSha256',
  ];
  assertExactKeys(input, keys, ['schemaVersion', 'id', 'candidateId', 'proposalRevision', 'candidateContentHash', 'action', 'decidedAt', 'actor'], 'decision');
  if (input.schemaVersion !== 2) throw new Error('decision schemaVersion 必须为 2');
  requiredString(input.id, 'decision.id', 160);
  requiredString(input.candidateId, 'decision.candidateId', 80);
  requiredString(input.proposalRevision, 'decision.proposalRevision', 80);
  if (!SHA256_PATTERN.test(input.candidateContentHash ?? '')) throw new Error('decision.candidateContentHash 必须是 SHA-256');
  if (!DECISION_ACTIONS.has(input.action)) throw new Error(`未知 action：${input.action}`);
  const nowMs = Date.parse(now);
  const decidedAt = validIso(input.decidedAt, 'decision.decidedAt', { nowMs, maxFutureSkewMinutes: 5 });
  enumValue(input.actor, ['user_claimed', 'external_workflow_claimed'], 'decision.actor');
  if (input.note !== undefined) requiredString(input.note, 'decision.note', 1000);
  if (input.action === 'edit') requiredString(input.replacementClaim, 'decision.replacementClaim', 800);
  else if (input.replacementClaim !== undefined) throw new Error('只有 edit 可以提供 replacementClaim');
  if (input.action === 'defer') {
    const deferUntil = validIso(input.deferUntil, 'decision.deferUntil');
    if (Date.parse(deferUntil) <= Date.parse(decidedAt)) throw new Error('decision.deferUntil 必须晚于 decidedAt');
  } else if (input.deferUntil !== undefined) throw new Error('只有 defer 可以提供 deferUntil');
  if (input.action === 'applied_external') {
    requiredString(input.targetRef, 'decision.targetRef', 500);
    if (!SHA256_PATTERN.test(input.targetSha256 ?? '')) throw new Error('decision.targetSha256 必须是 SHA-256');
  } else if (input.targetRef !== undefined || input.targetSha256 !== undefined) {
    throw new Error('只有 applied_external 可以提供 targetRef/targetSha256');
  }
  return { ...input, decidedAt, ...(input.deferUntil ? { deferUntil: new Date(Date.parse(input.deferUntil)).toISOString() } : {}) };
}

function latestByTime(items, getTime) {
  return [...items].sort((left, right) => getTime(left) - getTime(right)).at(-1);
}

function isExplicit(item) {
  return ['explicit_long_term_statement', 'user_review'].includes(item.evidence.sourceType);
}

function uniqueRecentSessions(items, cutoffMs) {
  return [...new Set(items.filter((item) => Date.parse(item.evidence.occurredAt) >= cutoffMs).map((item) => item.evidence.sessionId))];
}

function decisionStatus(decision, asOfMs) {
  if (!decision) return null;
  if (decision.action === 'defer' && Date.parse(decision.deferUntil) <= asOfMs) return null;
  return {
    accept: 'approved_external_pending_apply',
    edit: 'approved_external_pending_apply',
    reject: 'rejected_revision',
    suppress: 'suppressed',
    unsuppress: null,
    defer: 'deferred',
    supersede: 'superseded',
    external_modified: 'external_modified',
    applied_external: 'applied_external',
  }[decision.action];
}

export function evaluateCandidates({ observations, decisions = [], config, asOf = new Date().toISOString(), runId = null, inputHashes = null }) {
  validateConfig(config);
  const nowMs = Date.parse(asOf);
  if (!Number.isFinite(nowMs)) throw new Error('asOf 无效');
  const normalizedObservations = observations.map((item) => validateObservation(item, { config, now: asOf, stored: true }));
  const normalizedDecisions = decisions.map((item) => validateDecision(item, { now: asOf }));
  const cutoffMs = nowMs - config.evidenceWindowDays * 86400000;

  const byCandidate = new Map();
  for (const item of normalizedObservations) {
    const list = byCandidate.get(item.candidateId) ?? [];
    list.push(item);
    byCandidate.set(item.candidateId, list);
  }
  const countersByCandidate = new Map();
  for (const item of normalizedObservations) {
    if (item.relation !== 'contradicts') continue;
    for (const targetId of item.counterEvidenceFor) {
      const list = countersByCandidate.get(targetId) ?? [];
      list.push(item);
      countersByCandidate.set(targetId, list);
    }
  }

  const candidates = [];
  for (const [candidateId, candidateItems] of byCandidate) {
    const items = [...candidateItems].sort((left, right) => {
      const time = Date.parse(left.evidence.occurredAt) - Date.parse(right.evidence.occurredAt);
      return time || left.id.localeCompare(right.id);
    });
    const canonical = [...items]
      .filter((item) => item.relation === 'new_candidate')
      .sort((left, right) => {
        const ingestion = Date.parse(left.ingestedAt) - Date.parse(right.ingestedAt);
        const occurrence = Date.parse(left.evidence.occurredAt) - Date.parse(right.evidence.occurredAt);
        return ingestion || occurrence || left.id.localeCompare(right.id);
      })[0] ?? items[0];
    const latest = items.at(-1);
    const countable = items.filter((item) => ['new_candidate', 'supports', 'contradicts'].includes(item.relation)
      && item.evidence.sourceType !== 'assistant_reflection');
    const recentSessions = uniqueRecentSessions(countable, cutoffMs);
    const explicitItems = countable.filter(isExplicit);
    const latestExplicit = latestByTime(explicitItems, (item) => Date.parse(item.evidence.occurredAt));
    const counters = (countersByCandidate.get(candidateId) ?? []).filter((item) => Date.parse(item.evidence.occurredAt) >= cutoffMs);
    const latestCounter = latestByTime(counters, (item) => Date.parse(item.evidence.occurredAt));
    const explicitResolvesCounter = Boolean(latestExplicit && latestCounter
      && Date.parse(latestExplicit.evidence.occurredAt) > Date.parse(latestCounter.evidence.occurredAt));
    const personaTarget = latest.personaTarget ?? canonical.personaTarget;
    const candidate = {
      schemaVersion: 2,
      id: candidateId,
      category: canonical.category,
      topicKey: canonical.topicKey,
      valueKey: canonical.valueKey,
      canonicalClaim: canonical.claim,
      displayClaim: canonical.claim,
      scope: canonical.scope,
      ...(personaTarget ? { personaTarget } : {}),
      groupKey: conflictGroupKey(canonical),
      firstSeen: items[0].evidence.occurredAt,
      lastSeen: latest.evidence.occurredAt,
      explicitLongTerm: Boolean(latestExplicit),
      latestExplicitAt: latestExplicit?.evidence.occurredAt ?? null,
      recentIndependentSessions: recentSessions.length,
      recentSessionIds: recentSessions,
      evidenceEventIds: [...new Set(items.map((item) => item.sourceEventId))].sort(),
      counterEvidenceEventIds: [...new Set(counters.map((item) => item.sourceEventId))].sort(),
      hasUnresolvedCounterEvidence: counters.length > 0 && !explicitResolvesCounter,
      highSeverityVerifiedOutcome: items.some((item) => item.severity === 'high' && item.evidence.sourceType === 'verified_outcome'),
      assistantReflectionOnly: countable.length === 0
        && items.some((item) => item.evidence.sourceType === 'assistant_reflection'),
      evidenceTrust: 'declared',
      status: 'observed',
      reasons: [],
    };
    candidate.candidateContentHash = sha256Text(canonicalStringify({
      category: candidate.category,
      topicKey: candidate.topicKey,
      valueKey: candidate.valueKey,
      canonicalClaim: candidate.canonicalClaim,
      scope: candidate.scope,
      personaTarget: candidate.personaTarget ?? null,
    }));
    candidates.push(candidate);
  }

  const groups = new Map();
  for (const candidate of candidates) {
    const list = groups.get(candidate.groupKey) ?? [];
    list.push(candidate);
    groups.set(candidate.groupKey, list);
  }
  const conflicts = [];
  for (const group of groups.values()) {
    const active = group.filter((item) => item.recentIndependentSessions > 0 || item.explicitLongTerm);
    if (new Set(active.map((item) => item.valueKey)).size <= 1) continue;
    const explicit = active.filter((item) => item.explicitLongTerm);
    let winner = null;
    if (explicit.length > 0) {
      winner = [...explicit].sort((left, right) => Date.parse(left.latestExplicitAt) - Date.parse(right.latestExplicitAt)).at(-1);
      if (explicit.filter((item) => item.latestExplicitAt === winner.latestExplicitAt).length > 1) winner = null;
    }
    for (const candidate of active) {
      if (winner?.id === candidate.id) continue;
      candidate.status = winner ? 'superseded' : 'conflict';
      candidate.reasons.push(winner ? `被更明确的候选 ${winner.id} 取代` : '同一主题和作用域存在多个候选值');
    }
    if (!winner) {
      conflicts.push({
        groupKey: group[0].groupKey,
        category: group[0].category,
        topicKey: group[0].topicKey,
        scope: group[0].scope,
        candidateIds: active.map((item) => item.id).sort(),
        status: 'awaiting_review',
      });
    }
  }

  for (const candidate of candidates) {
    if (['conflict', 'superseded'].includes(candidate.status)) continue;
    if (candidate.hasUnresolvedCounterEvidence) {
      candidate.status = 'conflict';
      candidate.reasons.push('存在未被后续明确声明解决的反例');
      continue;
    }
    if (candidate.assistantReflectionOnly) {
      candidate.status = 'reflection_note';
      candidate.reasons.push('仅有不计权的 Assistant 反思');
      continue;
    }
    if (candidate.recentIndependentSessions === 0 && !candidate.explicitLongTerm) {
      candidate.status = 'dormant';
      candidate.reasons.push('滚动证据窗口内没有有效支持');
      continue;
    }
    let eligible = false;
    if (candidate.category === 'user_preference') {
      eligible = candidate.explicitLongTerm || candidate.recentIndependentSessions >= config.requiredInferredUserSessions;
    } else if (candidate.category === 'agent_method') {
      eligible = candidate.explicitLongTerm || candidate.highSeverityVerifiedOutcome
        || candidate.recentIndependentSessions >= config.requiredAgentMethodSessions;
    } else if (candidate.category === 'persona_self') {
      eligible = candidate.explicitLongTerm || candidate.recentIndependentSessions >= config.requiredPersonaSessions;
    }
    if (eligible) {
      candidate.status = 'proposal_pending_review';
      candidate.reasons.push('达到提案门槛；v1.1 不自动修改正式文档');
      if (candidate.category === 'user_preference' && candidate.topicKey === config.taxonomy.unknownTopicKey) {
        candidate.reasons.push('未知 taxonomy 主题只能人工审核');
      }
    } else {
      candidate.reasons.push('尚未达到当前类别的提案门槛');
    }
  }

  for (const candidate of candidates) {
    candidate.proposalRevision = stableId('proposal', [
      config.policyVersion,
      candidate.id,
      candidate.candidateContentHash,
      candidate.status,
      candidate.evidenceEventIds.join(','),
      candidate.counterEvidenceEventIds.join(','),
    ]);
    const candidateDecisions = normalizedDecisions.filter((item) => item.candidateId === candidate.id);
    const latestPersistent = latestByTime(
      candidateDecisions.filter((item) => ['suppress', 'unsuppress', 'supersede'].includes(item.action)),
      (item) => Date.parse(item.decidedAt),
    );
    const exact = latestByTime(candidateDecisions.filter((item) => item.proposalRevision === candidate.proposalRevision
      && item.candidateContentHash === candidate.candidateContentHash), (item) => Date.parse(item.decidedAt));
    if (latestPersistent?.action === 'suppress') {
      candidate.status = 'suppressed';
      candidate.latestDecision = latestPersistent;
      candidate.reasons.push('候选被显式抑制，直到 unsuppress');
      continue;
    }
    if (latestPersistent?.action === 'supersede') {
      candidate.status = 'superseded';
      candidate.latestDecision = latestPersistent;
      candidate.reasons.push('候选被外部流程标记为已取代');
      continue;
    }
    const decidedStatus = decisionStatus(exact, nowMs);
    if (decidedStatus) {
      candidate.status = decidedStatus;
      candidate.latestDecision = exact;
      if (exact.action === 'edit') candidate.displayClaim = exact.replacementClaim;
      candidate.reasons.push(`当前 proposal revision 已执行 ${exact.action}`);
    } else if (exact?.action === 'defer') {
      candidate.reasons.push('defer 已到期，候选重新进入提案流程');
    } else if (latestPersistent?.action === 'unsuppress') {
      candidate.latestDecision = latestPersistent;
      candidate.reasons.push('候选已解除抑制');
    }
  }

  candidates.sort((left, right) => left.id.localeCompare(right.id));
  const actionableStatuses = new Set([
    'proposal_pending_review', 'conflict', 'reflection_note', 'approved_external_pending_apply',
    'external_modified', 'deferred',
  ]);
  return {
    schemaVersion: 2,
    policyVersion: config.policyVersion,
    mode: 'proposal_only',
    runId,
    generatedAt: new Date(nowMs).toISOString(),
    evidenceWindowStart: new Date(cutoffMs).toISOString(),
    evidenceTrust: 'declared',
    ...(inputHashes ? { inputHashes } : {}),
    candidates,
    conflicts,
    summary: {
      observations: normalizedObservations.length,
      candidates: candidates.length,
      actionable: candidates.filter((item) => actionableStatuses.has(item.status)).length,
      pendingReview: candidates.filter((item) => item.status === 'proposal_pending_review').length,
      approvedPendingExternalApply: candidates.filter((item) => item.status === 'approved_external_pending_apply').length,
      conflicts: candidates.filter((item) => item.status === 'conflict').length,
      dormant: candidates.filter((item) => item.status === 'dormant').length,
      suppressed: candidates.filter((item) => item.status === 'suppressed').length,
    },
  };
}
