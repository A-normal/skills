# 研究记录契约

## 数据完整性

| 情况 | 允许行为 | 禁止行为 |
| --- | --- | --- |
| 行情和技术数据完整 | 保存快照、验证预测、创建合格新假设 | 无时间戳的当前断言 |
| 部分行情或技术数据缺失 | 保存失败状态、处理不依赖缺失数据的到期任务 | 创建新预测、把局部数据当作全市场结论 |
| 新闻或 Web 搜索缺失 | 保存客观快照、验证纯技术阈值 | 催化剂、因果解释、事件驱动预测 |
| 数据时间无法确认 | 记录阻塞 | 使用该数据进行当前市场判断 |

## 预测 frontmatter

- `schema_version`：当前为 `1`。
- `id`：稳定且唯一，推荐 `YYYY-MM-DD-symbol-setup`。
- `symbol_id`：必须来自本地 `config/watchlist.json`；字段结构参考 `config/watchlist.example.json`。
- `created_at`：建立预测的时间。
- `data_at`：预测实际使用的数据时间。
- `review_at`：下一次必须复核的日期。
- `status`：`open`、`closed` 或 `invalidated`。
- `confidence`：`low`、`medium` 或 `high`。
- `context_incomplete`：新闻或必要上下文缺失时为 `true`。

正文必须包含假设、期限、失效条件、证据和验证。最终验证直接写回原文件，并将 `status` 更新为 `closed` 或 `invalidated`。

## 知识沉淀

只有跨单日、可复用的方法认识才能进入 `knowledge.md`。不要把每日行情描述复制成知识。每条方法修正应能追溯到至少一个预测 ID 或模块化复核。
