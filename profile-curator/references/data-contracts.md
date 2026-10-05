# v2 数据契约

脚本中的严格校验器是唯一运行时权威。本文件说明输入形状，但不能替代脚本校验。所有对象拒绝未知字段。

## 信任边界

当前 OpenClaw Skill 只能产生 `trust: "declared"` 的采集回执。它表示 Agent 声称字段来自受控工具结果，不表示 CLI 能验证来源真实性。`host_attested` 预留给未来宿主侧确定性 collector；v1.1 不接受该值，也不据此执行任何正式文档写入。

## Collection receipt

`collect --receipt` 接受单个对象：

```json
{
  "schemaVersion": 2,
  "runId": "weekly-2026-10-05",
  "collectedAt": "2026-10-05T10:05:00+08:00",
  "trust": "declared",
  "host": "openclaw",
  "hostVersion": "2026.9.5",
  "sessions": [
    {
      "sessionId": "opaque-session-id",
      "sessionKey": "opaque-session-key",
      "agentId": "main",
      "chatScope": "direct",
      "userId": "configured-user-id",
      "previousWatermark": null,
      "observedThroughMessageId": "opaque-message-id",
      "backlogRemaining": 0,
      "complete": true
    }
  ]
}
```

只有 allowlist 中的 agent、direct chat 和用户可以进入回执。水位是调用方声明值，状态中会明确标记为 `declared`，不能描述成已证明的完整覆盖。

## Observation

`collect --input` 接受 JSON 数组或 JSONL。调用方不提供 observation ID、candidate ID 或 source event ID；CLI 根据 envelope 计算：

```json
{
  "schemaVersion": 2,
  "category": "user_preference",
  "topicKey": "communication.response_detail",
  "valueKey": "concise",
  "claim": "默认先给结论并保持简洁",
  "scope": "communication",
  "relation": "new_candidate",
  "evidence": {
    "trust": "declared",
    "host": "openclaw",
    "agentId": "main",
    "chatScope": "direct",
    "userId": "configured-user-id",
    "sessionId": "opaque-session-id",
    "sessionKey": "opaque-session-key",
    "messageId": "opaque-message-id",
    "occurredAt": "2026-10-05T09:00:00+08:00",
    "role": "user",
    "sourceType": "inferred_behavior",
    "topLevel": true,
    "quoted": false,
    "forwarded": false,
    "contentSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "summary": "用户多次要求回答先给结论",
  "sensitivity": "normal",
  "severity": "normal"
}
```

`user_preference` 的所有证据必须来自顶层、未引用、未转发的 user 消息。Assistant 和 Tool 不能支撑用户偏好。未知偏好主题只能使用 `topicKey: "other.review_only"` 与 `valueKey: "manual"`，并始终保持人工提案。

`persona_self` 额外要求：

```json
{
  "personaTarget": {
    "path": "/root/.openclaw/workspace/SOUL.md",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}
```

该目标仍是声明值；v1.1 只在提案中显示，不写入目标。

## Decision

前台审核输入必须绑定当前 candidate 内容和 proposal revision：

```json
{
  "schemaVersion": 2,
  "id": "review-2026-10-05-1",
  "candidateId": "cand-...",
  "proposalRevision": "proposal-...",
  "candidateContentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "action": "accept",
  "decidedAt": "2026-10-05T11:00:00+08:00",
  "actor": "user_claimed",
  "note": "已在前台核对"
}
```

支持动作：`accept`、`edit`、`reject`、`suppress`、`unsuppress`、`defer`、`supersede`、`external_modified`、`applied_external`。`edit` 需要 `replacementClaim`；`defer` 需要 `deferUntil`；`applied_external` 需要 `targetRef` 和 `targetSha256`。

`actor` 仍是声明来源，不是密码学证明。定时任务不得运行 `decide`。
