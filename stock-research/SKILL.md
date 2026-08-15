---
name: stock-research
description: 维护个人 A股、港股和美股观察池的一轮式股票研究流程，包含行情与技术快照、可证伪假设、到期验证、知识沉淀、周报以及可选只读仪表盘。用于定时或按需完成有限研究任务、复核既有预测或更新研究状态；只用于学习研究，不执行交易，不提供个性化投资建议，当前数据不足时必须降级或停止生成新假设。
---

# 股票研究闭环

## 边界

- 每次调用只完成一轮有限研究并正常结束；cron 负责下次唤醒。
- 不执行交易、不移动资金、不提供个性化投资建议。
- 当前价格、趋势、财报日期、宏观事件和市场情绪必须使用带时间戳的当前数据。
- 行情或技术数据不完整时，不创建新预测。
- 新闻不可用时允许保存客观快照和验证既有技术假设，但禁止因果解释与事件驱动预测。
- 仪表盘是可选只读展示层，不修改研究状态，也不属于每日研究的必需步骤。

## 固定路径

- Skill：`/root/.openclaw/workspace/skills/stock-research`
- 状态：`/root/.openclaw/workspace/state/stock-research`
- 观察池：本地 `config/watchlist.json`，从 `config/watchlist.example.json` 初始化且不提交
- 预测：状态目录下的 `predictions/*.md`
- 快照：状态目录下的 `snapshots/*.json`

## 单轮研究流程

1. 读取 `config/watchlist.json`、状态摘要和所有到期预测。
2. 运行 `node scripts/collect-market-data.mjs`，确认输出的 `status` 与数据时间。
3. 获取可靠的当前新闻、指数、行业和宏观上下文；记录来源时间。
4. 优先验证到期预测，再决定是否建立新假设。
5. 新预测必须写入独立文件，包含标的、创建时间、数据时间、期限、复核时间、置信度、证据和失效条件。
6. 验证结果回写原预测文件，不另建重复的 validation 事实来源。
7. 只有出现可复用的新认识时才更新 `knowledge.md`。
8. 输出本轮数据完整性、验证结果、新假设、阻塞项和下一复核时间，然后结束。

先运行以下命令查看待复核预测：

```bash
node /root/.openclaw/workspace/skills/stock-research/scripts/research-status.mjs
```

## 假设纪律

- 使用固定的 setup-time 阈值，避免移动目标。
- 明确方向或情景、期限、置信度、失效条件和复核日期。
- 预测结果只能评价已声明时间窗，不能自动延伸为长期观点。
- 缺少新闻时，新技术假设必须标记 `context_incomplete: true`，且置信度只能为 `low`。
- 没有满足要求的 setup 时，明确记录“本轮不建立新预测”。

需要预测格式与数据降级规则时读取 [references/research-contract.md](references/research-contract.md)；需要初始化、迁移、cron 或仪表盘时读取 [references/operations.md](references/operations.md)。
