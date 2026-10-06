# OpenClaw v1.1 集成

适用静态基线：OpenClaw `2026.9.5`、主代理 `main`、根目录 `/root/.openclaw`。版本或能力不匹配时失败关闭。

## 受控来源

必需工具：

1. `sessions_list`：枚举当前身份可见的 session；
2. `sessions_history`：按 session 读取有限历史并取得声明水位。

`memory_search`、`memory_get`、`sessions_search` 只能帮助发现候选或定位 session，不能证明从上次水位以来的消息已完整覆盖。

仅允许：

- agent ID 在 `allowedAgents` 中，默认只有 `main`；
- channel 在 `allowedChannels` 中；
- chat scope 为 `direct`；
- user ID 在安装后显式配置的 `allowedUserIds` 中。

排除群聊、其他用户、cron、hook、subagent 和无法确定参与者的 session。禁止直接解析或写入 OpenClaw/Codex SQLite、WAL/SHM 或 canonical transcript 内部表。

### 当前会话映射与分页

- Telegram direct 在 `sessions_list` 中属于 `kind: other`，不得使用 `kinds:["main"]` 过滤。分页读取全部列表页并按 `agentId + key + sessionId` 去重。
- 只接受同时满足 `key = agent:<agentId>:<channel>:direct:<userId>`、返回的 `channel` 命中 allowlist、`createdActor.type = human` 且 `createdActor.id = userId` 的会话。具体 channel 与 user ID 只写入安装后的 state 配置，不进入可分发 Skill 源码。
- `sessions_history` 普通读取必须用 `offset`/`nextOffset` 逐页推进；`messageId` 仅用于精确锚定与核验，不能声称等价于“水位之后的完整增量”。
- 每页记录 `truncated`、`droppedMessages`、`contentTruncated`、`contentRedacted`。`droppedMessages`、eligible user 内容截断或任何内容脱敏时失败关闭；不提交水位。
- 有正常 backlog 时允许 `complete:false`，但水位保持 `previousWatermark`。只有所有页读完、`backlogRemaining=0` 且完整性标志干净时，才把 `observedThroughMessageId` 提升为新水位。
- 列表或历史总量在分页期间变化时，停止本轮并从新快照重试；不要把 live offset 漂移解释成完整覆盖。

## 真实性边界

Agent 调用工具后再生成 JSON，CLI 无法证明 JSON 没有被 Agent 改写。因此当前 manifest 声明 `currentTrust: declared` 和 `hostAttestationAvailable: false`。

未来只有宿主侧确定性 collector、签名 envelope 或只读官方消息 API 才能提供 `host_attested`。在此之前不得恢复自动写入，即使 session 数、哈希和水位全部通过本地检查。

## 状态

```text
/root/.openclaw/workspace/state/profile-curator/
├── config.json
├── observations.jsonl
├── decisions.jsonl
├── current-view.json
├── last-run.json
├── active-run.json           # 仅在单轮事务未完成时存在
├── runs/
└── locks/
```

提案默认输出到：

```text
/root/.openclaw/workspace/generated/profile-curator/
```

这些文件属于当前 OpenClaw 安装，不跨工具共享。不要写入 `workspace/memory/`，否则会造成自证循环。

## Gateway automation

- 由 OpenClaw Gateway 注册有限任务，不使用系统 crontab 或常驻进程。
- 默认每周一次；修改周期必须来自用户明确要求。
- 使用 isolated session 和有限 timeout。
- 无变化静默；有提案或失败时把摘要写入 Gateway 结果日志。
- 定时任务只能运行 begin/collect/evaluate/render/commit，不得运行 decide 或修改正式文档。
- Skill 文件和示例存在不等于任务已注册。

示例见 [cron-jobs.example.json](cron-jobs.example.json)，宿主声明见 [openclaw-manifest.json](openclaw-manifest.json)。

## 手动适配

宿主标识或会话分类异常时，可修改当前安装的 `config.json` allowlist 与受控 taxonomy。不得在配置中嵌入 shell 命令。协议或工具返回格式变化需要更新集成代码；不要通过放宽 role、chat scope 或 user 校验绕过。
