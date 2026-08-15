# 状态与命令

## 状态布局

```text
/root/.openclaw/workspace/state/engineering-growth/
├── profile.json
├── cases/
├── evidence/
├── practices/YYYY/
├── module-reviews/YYYY/
├── exports/profile-v1.json
└── archive/
```

## 首次迁移

将私有历史状态放在仓库外，并显式传给迁移脚本：

```bash
node /root/.openclaw/workspace/skills/engineering-growth/scripts/migrate-legacy-state.mjs \
  --source /root/.openclaw/workspace/import/engineering-growth
node /root/.openclaw/workspace/skills/engineering-growth/scripts/evaluate-profile.mjs
```

迁移脚本不覆盖现有文件。旧能力面板保存到只读归档，三个项目案例进入 `cases/`，旧展示 JSON 只用于建立初始整数等级。
也可通过 `ENGINEERING_GROWTH_LEGACY_SOURCE` 指定来源。私有历史状态不得放入可提交的 Skill 资源目录。

## 记录练习

从 `assets/templates/practice.json` 创建输入文件后运行：

```bash
node scripts/record-practice.mjs /tmp/practice.json
```

记录文件使用 `wx` 创建，重复 ID 会失败，保证每次练习都有独立痕迹。

## 记录模块评价

从 `assets/templates/module-review.json` 创建输入文件后运行：

```bash
node scripts/record-module-review.mjs /tmp/module-review.json
```

只有模块评价可以声明 `coverageComplete: true` 并明确哪些基础项已经覆盖或缺失。

## 自动定级与导出

```bash
node scripts/evaluate-profile.mjs
```

脚本更新 `profile.json`，并生成 `exports/profile-v1.json`。独立能力面板只能读取导出文件，不能直接修改评分状态。
