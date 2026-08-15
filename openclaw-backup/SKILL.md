---
name: openclaw-backup
description: 为固定运行在 root 和 /root/.openclaw 的个人 OpenClaw 环境创建、校验与恢复 age 加密的 GitHub Release 备份。用于手动或定时执行 full/slim 备份、检查备份完整性、预览或应用保留策略、初始化公开 recipient，以及在明确确认后恢复 OpenClaw 数据；不负责整机、系统服务、/root/.codex 或外部 GitHub 凭据迁移。
---

# OpenClaw 加密备份

## 运行契约

- 固定备份 `/root/.openclaw`，不要扩展为整机迁移。
- 从 `/library/github/token` 读取 GitHub Token，从 `/library/github/repo` 读取单行 `owner/repository`。
- 从 `/root/.openclaw/workspace/state/openclaw-backup/age-recipient` 读取 age 公开 recipient。
- 永远不要读取、复制、记录或备份 age 私钥。
- 不要在回复、日志、命令回显或错误信息中输出 Token。
- 上传属于外部写入；只有用户明确要求备份或已配置的定时任务才能执行。
- 恢复会覆盖 OpenClaw 数据；先报告目标和回滚目录，再取得明确确认。

## 选择操作

### 初始化或诊断

仅在用户明确要求初始化时运行：

```bash
/root/.openclaw/workspace/skills/openclaw-backup/scripts/init-openclaw-backup.sh
```

现有环境默认只检查，不覆盖任何文件。定时任务缺少配置时直接失败，不进入交互。

### 创建备份

先明确选择 `slim` 或 `full`：

```bash
/root/.openclaw/workspace/skills/openclaw-backup/scripts/openclaw-backup.sh slim
/root/.openclaw/workspace/skills/openclaw-backup/scripts/openclaw-backup.sh full
```

- 人工运行默认只预览清理候选。
- 已确认的定时任务使用 `--prune` 自动应用分类保留策略。
- 只报告模式、资产名、本地路径、大小、SHA-256 和 Release URL；不要报告任何凭据。

### 校验或恢复

先用校验脚本完成解密、路径安全检查和 SQLite 完整性检查：

```bash
/root/.openclaw/workspace/skills/openclaw-backup/scripts/verify-openclaw-backup.sh ARCHIVE AGE_IDENTITY
```

恢复脚本默认只生成计划；`--apply` 仍要求终端确认：

```bash
/root/.openclaw/workspace/skills/openclaw-backup/scripts/restore-openclaw-backup.sh ARCHIVE AGE_IDENTITY
/root/.openclaw/workspace/skills/openclaw-backup/scripts/restore-openclaw-backup.sh ARCHIVE AGE_IDENTITY --apply
```

## 完成条件

- 本地加密文件存在且非空。
- 本地 SHA-256 已计算。
- GitHub 返回的远端资产名称、大小和状态与本地一致。
- 只有完成远端验证后才能清理旧备份。
- slim 与 full 分别保留 18 份和 4 份，不能混合排序清理。

需要配置路径、模式差异、定时任务或恢复细节时，读取 [references/operations.md](references/operations.md)。
