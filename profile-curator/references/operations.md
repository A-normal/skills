# 运行、恢复与验收

## 初始化

在 Skill 目录运行：

```bash
node scripts/profile-curator.mjs init
```

默认只创建 `/root/.openclaw/workspace/state/profile-curator` 下不存在的状态文件，不覆盖已有配置。可用 `PROFILE_CURATOR_STATE_DIR` 和 `PROFILE_CURATOR_GENERATED_DIR` 指定测试目录。

`config.json` 内的 `integration.targets.userPreference` 是宿主集成自动提供的目标，不要求普通用户配置。声明式手动适配可以修改它，但应用命令拒绝写入任何与当前声明不一致的路径。

初始化不会注册 Gateway automation，也不会读取会话或修改正式文档。

## 提取和写入观察

通过 OpenClaw 受控检索获得本轮记录后，由 Agent 生成符合 `schemas/observation.schema.json` 的脱敏 JSON 数组或 JSONL：

```bash
node scripts/profile-curator.mjs ingest --input /tmp/profile-curator-observations.jsonl
```

脚本拒绝：

- `curator_output`；
- `sensitive` 或 `forbidden`；
- 缺少来源、会话或有效时间的记录；
- 缺少 `personaTargetRef` 的 `persona_self`；
- 冒充明确声明的非顶层、引用或非用户消息。

重复观察 ID 不会再次写入或计数。

## 评价与提案

```bash
node scripts/profile-curator.mjs evaluate
node scripts/profile-curator.mjs render
node scripts/profile-curator.mjs status
```

首次 `evaluate` 只产生 `preview_only` 和审核提案。只有整轮成功执行 `complete-run` 后，`initialPreviewCompleted` 才置为 `true`；评价、提案或写入失败时，下一轮仍保持预览模式。

`render` 只写审核 Markdown，不修改正式文档。

## 提交成功水位

所有允许的提案和应用步骤成功后，创建符合 `schemas/run-result.schema.json` 的运行结果：

```json
{
  "schemaVersion": 1,
  "runId": "weekly-2026-10-04",
  "completedAt": "2026-10-04T10:15:00+08:00",
  "status": "updated",
  "recordsProcessed": 42,
  "backlogRemaining": 0,
  "sourceWatermarks": {
    "sessions": "opaque-openclaw-watermark"
  }
}
```

然后运行：

```bash
node scripts/profile-curator.mjs complete-run \
  --input /tmp/profile-curator-run-result.json
```

只有 `complete-run` 写入 `last-run.json`。运行失败时不要调用它；下次从此前成功水位重新读取，并依靠观察 ID 幂等去重。

## USER.md 安全应用

先取得当前哈希并预览：

```bash
node scripts/profile-curator.mjs hash \
  --target /root/.openclaw/workspace/USER.md
```

读取当前 `USER.md` 作为权威基线但不把它当作新证据。为所有待应用和已受管候选生成符合 `schemas/baseline-review.schema.json` 的审查文件，并绑定上一步 SHA-256。只有新候选为 `absent`、已应用候选为 `managed_existing` 时才允许继续；`already_present`、`conflict` 和 `uncertain` 必须进入提案或外部处理。

然后预览：

```bash
node scripts/profile-curator.mjs apply-user \
  --target /root/.openclaw/workspace/USER.md \
  --expected-sha256 <CURRENT_SHA256> \
  --baseline-review /tmp/profile-curator-baseline-review.json
```

确认预览只涉及 `profile-curator` 受管区块后，定时任务才可执行：

```bash
node scripts/profile-curator.mjs apply-user \
  --target /root/.openclaw/workspace/USER.md \
  --expected-sha256 <CURRENT_SHA256> \
  --baseline-review /tmp/profile-curator-baseline-review.json \
  --apply
```

应用保护：

- 只接受 `current-view.json` 中的 `eligible_auto_apply` 或已经 `applied` 且仍有效的用户偏好；
- 基线审查目标、哈希和候选集合必须与当前应用一致；
- 第一次应用添加唯一受管区块；
- 后续运行要求目标哈希等于 `apply-state.json` 中的上次写后哈希；
- 用户手工修改后自动应用失败，并要求外部流程处理；
- 写入前在状态目录保存带时间戳备份；
- 临时文件与目标位于同一目录，完成校验后原子替换；
- 写后哈希和区块结构校验失败时恢复备份；
- `SOUL.md`、`AGENTS.md`、`IDENTITY.md` 和 Skill 路径永远不被此命令接受。

## 审核决定

从 `schemas/decision.schema.json` 创建单个 JSON 决定后运行：

```bash
node scripts/profile-curator.mjs decide --input /tmp/profile-curator-decision.json
```

`accept`、`edit`、`reject`、`suppress` 和 `defer` 来自用户；外部维护流程可以记录 `supersede` 或 `external_modified`。`applied` 只由安全应用命令写入。

## 每周任务与 backlog

- 每轮最多处理配置中的 `maxRecordsPerRun`。
- 成功批次才推进调用方维护的受控搜索水位。
- 未处理记录保留为 backlog，不跳过。
- 连续多周存在 backlog 时只建议调整周期或单轮上限；不得自动修改调度。

## 恢复

状态或写入异常时：

1. 停止自动应用，保留定时任务结果和状态目录；
2. 运行 `status` 检查最后成功评价和候选数量；
3. 验证 `config.json`、`current-view.json` 和 JSONL 是否可解析；
4. 如果存在 `apply-pending.json`，先比较其中的写前/写后哈希、备份和正式文档，再由前台流程完成恢复；
5. 对正式文档比较 `apply-state.json` 与当前哈希；
6. 如需恢复正式文档，选择 `backups/` 中明确的一份，由外部前台流程确认后恢复；
7. 修复兼容性后先执行一次只读评价和提案渲染；
8. 用户明确恢复后，再启用自动应用。

不要清空状态来掩盖 Schema、兼容性或写入失败。

## 验收

在开发或升级后运行：

```bash
npm test
npm run check
```

还应使用临时 OpenClaw 目录验证：首次预览、三会话晋升、冲突阻止、重复输入幂等、哈希冲突、备份、写入和外部修改保护。静态测试不能替代真实 OpenClaw 的受控搜索和 Gateway automation 验收。
