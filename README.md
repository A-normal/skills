# Personal Skills

这是一个个人 Skill 仓库，用于保存与实际环境、长期状态和个人工作方式绑定的 Agent 工作流。仓库中的 Skill 优先保证边界清晰、可恢复和可验证，不以通用产品化为目标。

## Skills

| Skill | 说明 |
| --- | --- |
| [`dev-workflow`](dev-workflow/README.md) | 以证据、风险门禁、开发合同和验证记录约束模块化软件开发的准备与执行。 |
| [`openclaw-backup`](openclaw-backup/SKILL.md) | 为 `/root/.openclaw` 创建、校验与恢复 age 加密的 GitHub Release 备份。 |
| [`stock-research`](stock-research/SKILL.md) | 维护有限单轮的股票研究、行情快照、可证伪假设、到期验证和可选只读仪表盘。 |
| [`engineering-growth`](engineering-growth/SKILL.md) | 记录练习与工程证据，按基础能力门槛自动评价、升降级并生成短板训练计划。 |

每个目录中的 `SKILL.md` 是 Agent 的入口，frontmatter `description` 定义触发条件和功能边界。`references/` 保存按需读取的细节，`scripts/` 保存确定性操作，`assets/` 只保存可复用的模板与展示资产。

## 状态与秘密

- Skill 实现保存在仓库中，可变状态写入 `/root/.openclaw/workspace/state/<skill-name>/`。
- OpenClaw 状态由 `openclaw-backup` 统一备份，更新 Skill 不应覆盖运行状态。
- GitHub Token、age 私钥等秘密不得提交到仓库。
- 个人观察池、历史研究、能力档案、练习记录和当前进度不得作为 Skill 资源提交；迁移时从仓库外显式传入。
- 当前约定从 `/library/github/token` 和 `/library/github/repo` 读取 GitHub 备份凭据；这些文件由外部系统迁移流程负责。

## 使用提示

- 使用前先阅读对应 `SKILL.md` 的安全边界和完成条件。
- 初始化、部署、上传、清理和恢复必须显式触发。
- 自动任务应执行有限的一轮工作并退出，持续性由调度器和持久化状态提供。
- 重要改动先在可控环境验证，不要把个人路径与规则当作通用默认值。

## 开发者

- GitHub：[@A-normal](https://github.com/A-normal)

## 许可证

本仓库采用 [GNU General Public License v3.0](LICENSE) 许可。
