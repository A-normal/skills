import { stableId } from './state.mjs';

const CATEGORIES = new Set(['user_preference', 'agent_method', 'persona_self']);
const RELATIONS = new Set(['new_candidate', 'supports', 'contradicts', 'related', 'uncertain']);
const SOURCE_TYPES = new Set([
  'explicit_long_term_statement',
  'direct_feedback',
  'inferred_behavior',
  'verified_outcome',
  'user_review',
]);
const DECISION_ACTIONS = new Set(['accept', 'edit', 'reject', 'suppress', 'defer', 'supersede', 'external_modified', 'applied']);
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/u;

function requiredString(value, field, maxLength) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new Error(`${field} 必须是 1-${maxLength} 个字符的字符串`);
  }
}

function validIso(value, field) {
  requiredString(value, field, 80);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} 不是有效 ISO-8601 时间`);
}

export function candidateIdFor(observation) {
  return stableId('cand', [
    observation.category,
    observation.topicKey,
    observation.valueKey,
    observation.scope,
    observation.personaTargetRef ?? '',
  ]);
}

export function conflictGroupKey(observation) {
  return [
    observation.category,
    observation.topicKey,
    observation.scope,
    observation.personaTargetRef ?? '',
  ].join('\u001f');
}

export function validateObservation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('观察必须是对象');
  if (input.schemaVersion !== 1) throw new Error('观察 schemaVersion 必须为 1');
  requiredString(input.id, 'id', 160);
  if (!CATEGORIES.has(input.category)) throw new Error(`未知 category：${input.category}`);
  if (!KEY_PATTERN.test(input.topicKey ?? '')) throw new Error('topicKey 格式无效');
  if (!KEY_PATTERN.test(input.valueKey ?? '')) throw new Error('valueKey 格式无效');
  requiredString(input.claim, 'claim', 800);
  requiredString(input.scope, 'scope', 160);
  requiredString(input.summary, 'summary', 500);
  if (!RELATIONS.has(input.relation)) throw new Error(`未知 relation：${input.relation}`);
  if (!['normal', 'sensitive', 'forbidden'].includes(input.sensitivity)) throw new Error('sensitivity 无效');
  if (input.sensitivity !== 'normal') throw new Error(`默认隐私策略拒绝 ${input.sensitivity} 观察`);
  if (input.severity !== undefined && !['normal', 'high'].includes(input.severity)) throw new Error('severity 无效');
  if (input.category === 'persona_self') requiredString(input.personaTargetRef, 'personaTargetRef', 300);

  const source = input.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('source 必须是对象');
  requiredString(source.ref, 'source.ref', 400);
  requiredString(source.sessionRef, 'source.sessionRef', 300);
  validIso(source.occurredAt, 'source.occurredAt');
  if (!['user', 'assistant', 'tool'].includes(source.role)) throw new Error('source.role 无效');
  if (!SOURCE_TYPES.has(source.sourceType)) throw new Error('source.sourceType 无效');
  if (typeof source.topLevel !== 'boolean' || typeof source.quoted !== 'boolean') throw new Error('source.topLevel/quoted 必须是布尔值');
  if (!['primary_event', 'curator_output'].includes(source.origin)) throw new Error('source.origin 无效');
  if (source.origin !== 'primary_event') throw new Error('Curator 输出不能作为新证据');

  if (['explicit_long_term_statement', 'user_review'].includes(source.sourceType)) {
    if (source.role !== 'user' || !source.topLevel || source.quoted) {
      throw new Error(`${source.sourceType} 必须来自未引用的顶层用户消息`);
    }
  }
  if (source.sourceType === 'verified_outcome' && source.role !== 'tool') {
    throw new Error('verified_outcome 必须来自可验证 Tool 结果');
  }
  if (input.relation === 'contradicts' && (!Array.isArray(input.counterEvidenceFor) || input.counterEvidenceFor.length === 0)) {
    throw new Error('contradicts 必须提供 counterEvidenceFor');
  }
  if (input.counterEvidenceFor !== undefined) {
    if (!Array.isArray(input.counterEvidenceFor) || input.counterEvidenceFor.some((item) => typeof item !== 'string' || item.length > 80)) {
      throw new Error('counterEvidenceFor 无效');
    }
  }
  if (input.relatedCandidateIds !== undefined) {
    if (!Array.isArray(input.relatedCandidateIds) || input.relatedCandidateIds.some((item) => typeof item !== 'string' || item.length > 80)) {
      throw new Error('relatedCandidateIds 无效');
    }
  }
  if (input.relation === 'related' && (!Array.isArray(input.relatedCandidateIds) || input.relatedCandidateIds.length === 0)) {
    throw new Error('related 必须提供 relatedCandidateIds');
  }

  return {
    schemaVersion: 1,
    id: input.id,
    candidateId: candidateIdFor(input),
    category: input.category,
    topicKey: input.topicKey,
    valueKey: input.valueKey,
    claim: input.claim.trim(),
    scope: input.scope.trim(),
    ...(input.personaTargetRef ? { personaTargetRef: input.personaTargetRef } : {}),
    relation: input.relation,
    counterEvidenceFor: [...new Set(input.counterEvidenceFor ?? [])],
    relatedCandidateIds: [...new Set(input.relatedCandidateIds ?? [])],
    source: { ...source },
    summary: input.summary.trim(),
    sensitivity: input.sensitivity,
    severity: input.severity ?? 'normal',
  };
}

export function validateDecision(input, { allowApplied = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('决定必须是对象');
  if (input.schemaVersion !== 1) throw new Error('决定 schemaVersion 必须为 1');
  requiredString(input.id, 'id', 160);
  requiredString(input.candidateId, 'candidateId', 80);
  if (!DECISION_ACTIONS.has(input.action)) throw new Error(`未知 action：${input.action}`);
  if (input.action === 'applied' && !allowApplied) throw new Error('applied 只能由安全应用流程记录');
  validIso(input.decidedAt, 'decidedAt');
  if (!['user', 'external_workflow', 'profile_curator_apply'].includes(input.actor)) throw new Error('actor 无效');
  if (input.action === 'applied' && input.actor !== 'profile_curator_apply') throw new Error('applied actor 必须为 profile_curator_apply');
  if (input.actor === 'profile_curator_apply' && input.action !== 'applied') throw new Error('profile_curator_apply 只能记录 applied');
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 1000)) throw new Error('note 无效');
  if (input.replacementClaim !== undefined) requiredString(input.replacementClaim, 'replacementClaim', 800);
  return { ...input };
}

function uniqueRecentSessions(observations, cutoffMs) {
  return [...new Set(observations
    .filter((item) => Date.parse(item.source.occurredAt) >= cutoffMs)
    .map((item) => item.source.sessionRef))];
}

function latestByTime(items, getTime) {
  return [...items].sort((left, right) => getTime(left) - getTime(right)).at(-1);
}

function isExplicit(item) {
  return ['explicit_long_term_statement', 'user_review'].includes(item.source.sourceType);
}

function decisionStatus(decision) {
  return {
    accept: 'approved_external',
    edit: 'approved_external',
    reject: 'rejected',
    suppress: 'suppressed',
    defer: 'deferred',
    supersede: 'superseded',
    external_modified: 'external_modified',
    applied: 'promoted',
  }[decision?.action];
}

export function evaluateCandidates({ observations, decisions = [], config, asOf = new Date().toISOString(), initialPreview = false }) {
  const nowMs = Date.parse(asOf);
  if (!Number.isFinite(nowMs)) throw new Error('asOf 无效');
  const cutoffMs = nowMs - Number(config.evidenceWindowDays) * 86400000;
  const byCandidate = new Map();
  for (const raw of observations) {
    const item = validateObservation(raw);
    if (raw.candidateId && raw.candidateId !== item.candidateId) throw new Error(`状态中的 candidateId 与确定性计算不匹配：${raw.id}`);
    const list = byCandidate.get(item.candidateId) ?? [];
    list.push(item);
    byCandidate.set(item.candidateId, list);
  }

  const latestDecision = new Map();
  for (const rawDecision of decisions) {
    const decision = validateDecision(rawDecision, { allowApplied: true });
    const current = latestDecision.get(decision.candidateId);
    if (!current || Date.parse(decision.decidedAt) >= Date.parse(current.decidedAt)) latestDecision.set(decision.candidateId, decision);
  }

  const countersByCandidate = new Map();
  for (const item of observations) {
    if (item.relation !== 'contradicts') continue;
    for (const targetId of item.counterEvidenceFor ?? []) {
      const list = countersByCandidate.get(targetId) ?? [];
      list.push(item);
      countersByCandidate.set(targetId, list);
    }
  }

  const candidates = [];
  for (const [candidateId, allItems] of byCandidate) {
    const items = [...allItems].sort((left, right) => Date.parse(left.source.occurredAt) - Date.parse(right.source.occurredAt));
    const exemplar = items.at(-1);
    const countable = items.filter((item) => ['new_candidate', 'supports', 'contradicts'].includes(item.relation));
    const recentCountable = countable.filter((item) => Date.parse(item.source.occurredAt) >= cutoffMs);
    const recentSessions = uniqueRecentSessions(countable, cutoffMs);
    const explicitItems = countable.filter(isExplicit);
    const latestExplicit = latestByTime(explicitItems, (item) => Date.parse(item.source.occurredAt));
    const counters = (countersByCandidate.get(candidateId) ?? []).filter((item) => Date.parse(item.source.occurredAt) >= cutoffMs);
    const latestCounter = latestByTime(counters, (item) => Date.parse(item.source.occurredAt));
    const explicitResolvesCounter = Boolean(latestExplicit && latestCounter && Date.parse(latestExplicit.source.occurredAt) > Date.parse(latestCounter.source.occurredAt));
    const decision = latestDecision.get(candidateId);

    candidates.push({
      schemaVersion: 1,
      id: candidateId,
      category: exemplar.category,
      topicKey: exemplar.topicKey,
      valueKey: exemplar.valueKey,
      claim: decision?.action === 'edit' && decision.replacementClaim ? decision.replacementClaim : exemplar.claim,
      scope: exemplar.scope,
      ...(exemplar.personaTargetRef ? { personaTargetRef: exemplar.personaTargetRef } : {}),
      groupKey: conflictGroupKey(exemplar),
      firstSeen: items[0].source.occurredAt,
      lastSeen: exemplar.source.occurredAt,
      explicitLongTerm: Boolean(latestExplicit),
      latestExplicitAt: latestExplicit?.source.occurredAt ?? null,
      recentIndependentSessions: recentSessions.length,
      recentSessionRefs: recentSessions,
      evidenceRefs: [...new Set(items.map((item) => item.source.ref))],
      counterEvidenceRefs: [...new Set(counters.map((item) => item.source.ref))],
      hasUnresolvedCounterEvidence: counters.length > 0 && !explicitResolvesCounter,
      highSeverityVerifiedOutcome: items.some((item) => item.severity === 'high' && item.source.sourceType === 'verified_outcome'),
      latestDecision: decision ?? null,
      status: decisionStatus(decision) ?? 'observed',
      reasons: [],
    });
  }

  const groups = new Map();
  for (const candidate of candidates) {
    const list = groups.get(candidate.groupKey) ?? [];
    list.push(candidate);
    groups.set(candidate.groupKey, list);
  }

  const conflicts = [];
  for (const group of groups.values()) {
    const excluded = new Set(['rejected', 'suppressed', 'deferred', 'superseded', 'external_modified']);
    const active = group.filter((item) => !excluded.has(item.status)
      && (item.recentIndependentSessions > 0 || item.status === 'promoted'));
    const values = new Set(active.map((item) => item.valueKey));
    if (values.size <= 1) continue;
    const explicit = active.filter((item) => item.explicitLongTerm);
    let winner = null;
    let winnerKind = null;
    if (explicit.length > 0) {
      winner = [...explicit].sort((left, right) => Date.parse(left.latestExplicitAt) - Date.parse(right.latestExplicitAt)).at(-1);
      const sameTime = explicit.filter((item) => item.latestExplicitAt === winner.latestExplicitAt);
      if (sameTime.length > 1) winner = null;
      else winnerKind = 'explicit';
    } else {
      const promoted = active.filter((item) => item.status === 'promoted');
      if (promoted.length === 1) {
        winner = promoted[0];
        winnerKind = 'current_baseline';
      }
    }
    for (const candidate of active) {
      if (winner?.id === candidate.id) continue;
      candidate.status = winnerKind === 'explicit' ? 'superseded' : 'conflict';
      candidate.reasons.push(winnerKind === 'explicit'
        ? `被更明确的候选 ${winner.id} 取代`
        : '同一主题和作用域存在多个推断值');
    }
    if (winnerKind !== 'explicit') {
      conflicts.push({
        groupKey: group[0].groupKey,
        category: group[0].category,
        topicKey: group[0].topicKey,
        scope: group[0].scope,
        candidateIds: active.map((item) => item.id),
        currentActiveCandidateId: winnerKind === 'current_baseline' ? winner.id : null,
        status: 'awaiting_review',
      });
    }
  }

  for (const candidate of candidates) {
    const fixed = new Set(['approved_external', 'conflict', 'rejected', 'suppressed', 'deferred', 'superseded', 'external_modified']);
    if (fixed.has(candidate.status)) continue;
    if (candidate.hasUnresolvedCounterEvidence) {
      candidate.status = 'conflict';
      candidate.reasons.push('存在未被后续明确声明解决的反例');
      continue;
    }
    if (candidate.status === 'promoted') {
      candidate.reasons.push('已有安全应用记录');
      continue;
    }
    if (candidate.recentIndependentSessions === 0 && !candidate.explicitLongTerm) {
      candidate.status = 'dormant';
      candidate.reasons.push('滚动证据窗口内没有有效支持');
      continue;
    }

    let eligible = false;
    if (candidate.category === 'user_preference') {
      eligible = candidate.explicitLongTerm || candidate.recentIndependentSessions >= Number(config.requiredInferredUserSessions);
      if (eligible) {
        candidate.status = initialPreview ? 'preview_only' : 'eligible_auto_apply';
        candidate.reasons.push(candidate.explicitLongTerm ? '存在明确长期用户声明' : '达到独立会话晋升门槛');
      }
    } else if (candidate.category === 'agent_method') {
      eligible = candidate.explicitLongTerm
        || candidate.highSeverityVerifiedOutcome
        || candidate.recentIndependentSessions >= Number(config.requiredAgentMethodSessions);
      if (eligible) {
        candidate.status = 'review_required';
        candidate.reasons.push('工作方法只能生成外部审核提案');
      }
    } else if (candidate.category === 'persona_self') {
      eligible = candidate.explicitLongTerm || candidate.recentIndependentSessions >= Number(config.requiredPersonaSessions);
      if (eligible) {
        candidate.status = 'review_required';
        candidate.reasons.push('人格语义变化必须明确审核');
      }
    }
    if (!eligible) candidate.reasons.push('尚未达到当前类别的证据门槛');
  }

  candidates.sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    policyVersion: config.policyVersion,
    generatedAt: asOf,
    initialPreview,
    evidenceWindowStart: new Date(cutoffMs).toISOString(),
    candidates,
    conflicts,
    summary: {
      observations: observations.length,
      candidates: candidates.length,
      eligibleAutoApply: candidates.filter((item) => item.status === 'eligible_auto_apply').length,
      reviewRequired: candidates.filter((item) => item.status === 'review_required').length,
      conflicts: candidates.filter((item) => item.status === 'conflict').length,
      dormant: candidates.filter((item) => item.status === 'dormant').length,
    },
  };
}
