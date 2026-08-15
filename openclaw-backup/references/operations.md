# 运行说明

## 固定路径

| 用途 | 路径 | 是否进入 OpenClaw 备份 |
| --- | --- | --- |
| GitHub Token | `/library/github/token` | 否 |
| GitHub 仓库 | `/library/github/repo` | 否 |
| age 公开 recipient | `/root/.openclaw/workspace/state/openclaw-backup/age-recipient` | 是 |
| 非敏感备份配置 | `/root/.openclaw/workspace/state/openclaw-backup/config.env` | 是 |
| 本地加密归档 | `/root/.openclaw-backups` | 否 |

`/library/github` 必须归 `root` 所有且权限为 `700`；其中两个文件权限为 `600`。`repo` 文件使用单行 `owner/repository` 格式。

## 模式

- `full`：保存整个 `/root/.openclaw`。
- `slim`：排除 npm 依赖、会话、临时目录和 workspace 内的 `node_modules`，保留记忆、Skill、配置、研究状态和能力状态。
- 两种模式都先复制到单一 staging 树，并通过 SQLite 在线快照替换已知运行中数据库。

## 初始化

初始化脚本不生成 age 密钥，只接受用户提供的 recipient。已存在的文件不会被覆盖。用户应在初始化后自行执行一次完整的加密、解密和内容校验。

定时任务不得调用初始化脚本。缺少文件、所有者或权限不符合要求时应直接失败并告警。

## 定时任务命令

每周 slim：

```bash
/root/.openclaw/workspace/skills/openclaw-backup/scripts/openclaw-backup.sh slim --prune
```

每季度 full：

```bash
/root/.openclaw/workspace/skills/openclaw-backup/scripts/openclaw-backup.sh full --prune
```

定时任务提示词应引用当前 Skill 路径，不写死模型名称，也不要要求 Agent 输出 Token、recipient 或私钥。

## 恢复

1. 通过外部安全方式取得 age 私钥和 GitHub 下载凭据。
2. 下载选定资产并核对预期 SHA-256。
3. 运行校验脚本。
4. 运行恢复脚本的默认计划模式，检查目标和回滚路径。
5. 停止 `openclaw-gateway`；恢复脚本不会替用户停止服务。
6. 明确确认后使用 `--apply`。
7. 检查 `/root/.openclaw` 权限、OpenClaw 服务、日志和关键状态文件。

系统服务、Nginx、Node、证书、`/root/.codex` 和 `/library/github` 由外部系统迁移流程负责。
