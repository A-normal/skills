# OpenClaw v1.1 集成

适用静态基线：OpenClaw `2026.9.5`、主代理 `main`、根目录 `/root/.openclaw`。版本或能力不匹配时失败关闭。

## 受控来源

必需工具：

1. `sessions_list`：枚举当前身份可见的 session；
2. `sessions_history`：按 session 读取有限历史并取得声明水位。

`memory_search`、`memory_get`、`sessions_search` 只能帮助发现候选或定位 session，不能证明从上次水位以来的消息已完整覆盖。

仅允许：

- agent ID 在 `allowedAgents` 中，默认只有 `main`；
- chat scope 为 `direct`；
- user ID 在安装后显式配置的 `allowedUserIds` 中。

排除群聊、其他用户、cron、hook、subagent 和无法确定参与者的 session。禁止直接解析或写入 OpenClaw/Codex SQLite、WAL/SHM 或 canonical transcript 内部表。

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
