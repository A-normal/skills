#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 2 ]] || {
  echo "用法：$0 <加密备份.tar.zst.age> <age 私钥文件>" >&2
  exit 2
}

encrypted_backup="$1"
age_identity="$2"

for command_name in age tar sqlite3; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "缺少命令：$command_name" >&2
    exit 3
  }
done

[[ -f "$encrypted_backup" ]] || {
  echo "找不到加密备份" >&2
  exit 4
}
[[ -f "$age_identity" ]] || {
  echo "找不到 age 私钥文件" >&2
  exit 4
}

umask 077
workdir="$(mktemp -d)"
trap 'rm -rf -- "$workdir"' EXIT
archive="$workdir/backup.tar.zst"
contents_manifest="$workdir/archive-contents.txt"
extract_root="$workdir/extracted"

age --decrypt --identity "$age_identity" --output "$archive" "$encrypted_backup"
tar --list --zstd --file "$archive" > "$contents_manifest"

grep -Eq '(^/|(^|/)\.\.(/|$))' "$contents_manifest" && {
  echo "归档包含不安全路径" >&2
  exit 5
}

for required_path in \
  .openclaw/openclaw.json \
  .openclaw/workspace/MEMORY.md \
  .openclaw/workspace/memory/ \
  .openclaw/workspace/skills/ \
  .openclaw/workspace/state/; do
  grep -Fxq "$required_path" "$contents_manifest" || {
    echo "归档缺少关键路径：$required_path" >&2
    exit 6
  }
done

mkdir -p "$extract_root"
tar --extract --zstd --file "$archive" --directory "$extract_root"

for relative_db_path in \
  state/openclaw.sqlite \
  agents/main/agent/openclaw-agent.sqlite \
  agents/main/agent/codex-home/goals_1.sqlite \
  agents/main/agent/codex-home/memories_1.sqlite; do
  db_path="$extract_root/.openclaw/$relative_db_path"
  [[ -f "$db_path" ]] || continue
  [[ "$(sqlite3 "$db_path" 'PRAGMA integrity_check;')" == "ok" ]] || {
    echo "SQLite 完整性检查失败：$relative_db_path" >&2
    exit 7
  }
done

echo "已验证加密 OpenClaw 备份：$(basename "$encrypted_backup")"
