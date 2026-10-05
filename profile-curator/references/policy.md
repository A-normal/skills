# 分类、提案与冲突策略

## 权威与信任

- 顶层、未引用、未转发的用户消息可以支持用户偏好、明确要求和审核意见。
- `USER.md`、`AGENTS.md`、`SOUL.md` 是当前行为基线，不是新证据。
- Curator 的摘要、候选、提案和日志不能反过来增加证据权重。
- v1.1 的 OpenClaw envelope 全部是 `declared`：CLI 能验证结构、一致性和去重，不能验证来源真实性。
- 所有类别只生成提案。正式文档修改由外部前台流程完成。

## user_preference

- 所有证据都必须来自 allowlist direct 会话中的顶层 user 消息。
- Assistant、Tool、quoted、forwarded 或非顶层内容不能建立或支持用户偏好。
- 明确长期声明单次可形成提案；推断偏好需在最近 90 天内至少三个独立 session 支持。
- 同一 source event 对同一 candidate 只计一次。
- 受控 taxonomy 外的内容使用 `other.review_only/manual`，只作自由文本审核提案。

## agent_method

- 明确用户要求可单次形成提案；普通方法需两个独立 session。
- 安全、权限、数据损坏或不可逆风险的单次 Tool `verified_outcome` 可以形成提案。
- Assistant 自述只能作为 `assistant_reflection + uncertain`，不计入门槛。
- 不自动修改 AGENTS.md 或任何 Skill。

## persona_self

- 必须包含声明的人格目标绝对路径与当前 SHA-256；这仍不是宿主证明。
- 普通人格变化需两个独立 session；明确用户审核可单次形成提案。
- Assistant 反思只能作为 `assistant_reflection + uncertain` 的非权威反思记录。
- 不自动修改 SOUL.md 或其他人格文件。

## 候选与正文

- candidate ID 来自类别、受控 topic/value、scope 和人格目标路径；未知偏好额外绑定初始 claim 哈希。
- observation ID 来自 source event 与 candidate，调用方不能自选 ID。
- candidate 的 canonical claim 取最早建立候选的 observation。后续 support 只增加证据，不能替换正文。
- `edit` 产生当前审核 revision 的显示文本，不改写历史 canonical claim。

## 冲突和时间

- 同一类别、topic、scope、人格路径下的不同 value 构成冲突组。
- 只有推断证据时全部暂停；更新的明确长期声明可以取代旧推断。
- 推断证据只在滚动 90 天窗口内计数。窗口外记录保留审计，不自动删除。
- `assistant_reflection` 不参与 session 门槛。
- 超出配置偏差的未来时间一律拒绝。

## 审核状态

| 动作 | 状态 | 后续 |
| --- | --- | --- |
| `accept` | `approved_external_pending_apply` | 持续显示，等待外部应用 |
| `edit` | `approved_external_pending_apply` | 显示 replacement claim，等待外部应用 |
| `reject` | `rejected_revision` | 只拒绝当前 revision；新证据可重开 |
| `defer` | `deferred` | 到期或新 revision 后重开 |
| `suppress` | `suppressed` | 跨 revision 持续，直到 `unsuppress` |
| `unsuppress` | 恢复确定性评价状态 | 不等同于接受 |
| `applied_external` | `applied_external` | 仅记录外部流程已经应用 |
| `external_modified` | `external_modified` | 外部内容优先，继续提示核对 |
| `supersede` | `superseded` | 外部流程声明候选已被取代 |

除 `suppress/unsuppress/supersede` 的候选级语义外，决定只作用于绑定的 proposal revision 与 candidate content hash。
