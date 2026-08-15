# 运行与迁移

## 安装依赖

在 Skill 目录运行 `npm ci`。这是部署步骤，不属于每日研究任务。

## 初始化历史状态

先从示例创建本地观察池，并按个人需要修改；真实文件已被仓库忽略：

```bash
cd /root/.openclaw/workspace/skills/stock-research
test -e config/watchlist.json || install -m 600 config/watchlist.example.json config/watchlist.json
```

需要迁移历史状态时，将私有来源放在仓库外并显式传入：

```bash
node /root/.openclaw/workspace/skills/stock-research/scripts/migrate-legacy-state.mjs \
  --source /root/.openclaw/workspace/import/stock-research
```

脚本只创建不存在的文件，不覆盖已有状态。它会：

- 将旧 `prediction-log.md` 拆成独立预测文件；
- 将旧市场快照拆成每日文件；
- 复制 dated JSON 快照；
- 保留旧 validation 日志为只读归档；
- 复制知识笔记并写入迁移元数据。

也可通过 `STOCK_RESEARCH_LEGACY_SOURCE` 指定来源。私有历史状态不得放入可提交的 Skill 资源目录。

## 每日研究

```bash
cd /root/.openclaw/workspace/skills/stock-research
node scripts/collect-market-data.mjs
node scripts/research-status.mjs
```

采集脚本返回非零状态表示数据不完整。此时 Agent 可以记录失败和处理不依赖缺失数据的任务，但不能建立新预测。

## 可选仪表盘

仪表盘源码位于 `assets/dashboard/`，只读取状态目录。显式部署时运行：

```bash
/root/.openclaw/workspace/skills/stock-research/scripts/deploy-dashboard.sh
```

部署脚本从当前 NVM default 解析确定的 Node 路径，再生成 systemd unit；服务启动时不加载 NVM。Node 升级后重新执行部署脚本。

## cron

示例见 [cron-jobs.example.json](cron-jobs.example.json)。每日任务完成一轮后必须结束；不要在 Skill 中模拟永久任务或 token 窗口暂停。
