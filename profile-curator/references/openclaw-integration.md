# OpenClaw v1 集成

适用基线：OpenClaw `2026.9.5`，主代理 `main`，根目录 `/root/.openclaw`。版本或能力不匹配时失败关闭；不要猜测兼容。

## 受控来源

按以下顺序读取证据：

1. `memory_search`、`memory_get`、`sessions_search` 等 OpenClaw 受控能力；
2. `/root/.openclaw/workspace/MEMORY.md` 与 `workspace/memory/**/*.md`，仅作为原始事实或来源定位；
3. 只有诊断兼容性时才查看数据库 schema 和状态。

禁止直接解析或写入：

- `/root/.openclaw/agents/main/agent/openclaw-agent.sqlite`；
- `/root/.openclaw/state/openclaw.sqlite`；
- `agents/main/agent/codex-home/*.sqlite`；
- SQLite 的 WAL/SHM 文件；
- canonical transcript 的任何内部表。

## 正式目标

| 语义类别 | OpenClaw 目标 | 写入边界 |
| --- | --- | --- |
| `user_preference` | `/root/.openclaw/workspace/USER.md` | 仅受管区块，满足安全写入条件后可自动应用 |
| `agent_method` | `AGENTS.md` 或外部维护指定的 Skill | 只生成提案 |
| `persona_self` | 由 OpenClaw 返回的本地人格目标，通常包含 `SOUL.md` | 只生成提案；不得由定时任务应用 |

不要自动整理 `IDENTITY.md`、`MEMORY.md` 或 `DREAMS.md`。它们可以帮助定位原始证据或发现现有基线，但不能增加候选权重。

## 工具状态

默认业务状态：

```text
/root/.openclaw/workspace/state/profile-curator/
├── config.json
├── candidates.jsonl
├── decisions.jsonl
├── current-view.json
├── last-run.json
├── apply-state.json
├── apply-pending.json          # 仅在未完成写入事务时存在
├── backups/
└── locks/
```

默认提案输出：

```text
/root/.openclaw/workspace/generated/profile-curator/
└── YYYY-MM-DD-<run-id>-proposal.md
```

这些状态只属于当前 OpenClaw 安装，不与其他工具共享。不要把候选写入 `workspace/memory/`，否则它会提前进入语义索引并造成自证循环。

## Gateway automation

- 自动化必须由 OpenClaw Gateway 注册和执行，不使用系统 crontab 或常驻进程。
- 使用 `sessionTarget: isolated` 和有限 `timeoutSeconds`。
- 默认每周运行一次；修改周期必须来自用户明确要求。
- Skill 文件存在并不等于自动化已经注册。
- 不要直接写入 `openclaw.sqlite` 的 `cron_jobs`。使用 OpenClaw 支持的 Gateway automation 管理接口导入或创建任务。
- 定时任务没有新证据时静默退出；重要变化和失败写入任务结果及 Curator 审计。

示例见 [cron-jobs.example.json](cron-jobs.example.json)。示例不会自行安装。

宿主能力和路径声明见 `integrations/openclaw/manifest.json`。它是 Skill 内置集成契约，不是对外服务，也不会自行执行。

## 能力检查

定时运行前确认：

- 受控检索工具仍可用且返回来源、会话、角色和时间；
- 能区分顶层用户发言、引用内容、Assistant 和 Tool；
- 状态目录可安全读写；
- `USER.md` 是普通 Markdown 文件而非符号链接到插件目录；
- Node.js 可运行本 Skill 的无依赖脚本；
- 自动应用时可以执行版本检查、备份、同目录原子替换和写后验证。

缺少读取能力时停止分析；缺少安全写入能力时降级为提案模式。

## 手动覆盖

路径或目标发现异常时，可以在当前安装的 `config.json` 增加受 Schema 限制的声明式覆盖。不得在配置中嵌入 Shell 命令。协议或记录格式变化必须更新集成代码。

修复后先运行只读预览并报告：最后成功水位、backlog、未审核提案和目标版本。用户明确恢复后才重新启用自动处理。
