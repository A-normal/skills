# 运行、恢复与验收

## 初始化与升级

```bash
node scripts/profile-curator.mjs init
```

初始化只创建状态文件，不读取会话、不注册调度、不修改人格文档。随后在状态目录的 `config.json` 中填写 `integration.allowedChannels` 与 `integration.allowedUserIds`；普通用户不需要指定 USER/SOUL 路径。

v1 状态不能静默迁移：旧 observation 缺少 message ID、content hash、chat scope 与用户 allowlist 绑定。保留旧目录作审计，使用新的 v2 状态目录开始影子运行。旧 `apply-state.json`、`apply-pending.json` 和备份不会被删除。

## 一轮运行

```bash
node scripts/profile-curator.mjs begin-run --run-id weekly-2026-10-05

node scripts/profile-curator.mjs collect \
  --run-id weekly-2026-10-05 \
  --receipt /tmp/profile-curator-receipt.json \
  --input /tmp/profile-curator-observations.jsonl

node scripts/profile-curator.mjs evaluate \
  --run-id weekly-2026-10-05

node scripts/profile-curator.mjs render \
  --run-id weekly-2026-10-05

node scripts/profile-curator.mjs commit-run \
  --run-id weekly-2026-10-05
```

`collect` 验证 receipt 非空，检查 session key、agent、channel、chat scope、created actor 和 user 一致，并拒绝丢消息、eligible 内容截断或脱敏；随后从输入计算 observation ID。`evaluate` 把 config、observations 和 decisions 哈希写入 view。`render`、`commit-run` 会重新验证这些哈希；中途状态变化会使旧 view 失效。

`commit-run` 不接受调用方提供的记录数或水位，并拒绝 `sessionsScanned=0`。它提交 `collect` 已记录的数量、backlog 和 per-session declared watermark；不完整 session 保持旧水位，只有完整 session 才推进到 `observedThroughMessageId`。该水位只保证本地事务一致，不证明 OpenClaw 历史已完整枚举。

## 前台审核

从提案复制 candidate ID、proposal revision 和 content hash，按 [数据契约](data-contracts.md) 创建决定：

```bash
node scripts/profile-curator.mjs decide \
  --input /tmp/profile-curator-decision.json

node scripts/profile-curator.mjs render
```

存在 active run 时拒绝 `decide`，防止定时批次与前台审核并发。任何审核动作都不会修改正式文档。

## 状态与恢复

```bash
node scripts/profile-curator.mjs status
node scripts/profile-curator.mjs lock-status
```

运行异常后优先检查 active run。确认放弃时显式执行：

```bash
node scripts/profile-curator.mjs abort-run \
  --run-id weekly-2026-10-05 \
  --reason "已核对失败原因，重新采集"
```

锁恢复必须先用 `lock-status` 取得锁哈希。只有锁超过配置年龄、同一主机且 owner PID 已确认不存在时才允许：

```bash
node scripts/profile-curator.mjs recover-lock \
  --expected-sha256 <LOCK_SHA256>
```

无法证明 owner 已退出时不自动解锁；允许维护者在核对宿主状态后手工调整状态文件。不要清空整个状态目录来掩盖错误。

## 每周任务与日志

- 每轮最多处理 `maxRecordsPerRun` 条 observation，首次最多回看配置天数和 session 数。
- backlog 不为零时不推进水位；下一轮从原水位重读并依赖 observation 去重，直到完整覆盖。不得跳过未处理消息。
- 无新提案时任务可以静默；有提案或失败时在 Gateway 运行结果中给出摘要和路径。
- 投递渠道、后台模型和调度周期由外部 OpenClaw 配置决定。本 Skill 不写死 Telegram、DeepSeek 或其他服务。
- 示例只是一份待导入配置，不会自行安装或启动进程。

## 验收

```bash
npm test
npm run check
```

静态测试必须覆盖来源角色、quoted/forwarded、事件去重、canonical claim 冻结、未来时间、快照漂移、完整审核迁移、allowlist、锁恢复和已移除的自动写入命令。真实 OpenClaw 的 sessions 工具、Gateway 调度和 Workshop 打包仍需要部署环境验收。
