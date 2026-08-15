#!/usr/bin/env bash
set -euo pipefail

[[ $# -ge 2 && $# -le 3 ]] || {
  echo "用法：$0 <加密备份.tar.zst.age> <age 私钥文件> [--apply]" >&2
  exit 2
}

encrypted_backup="$1"
age_identity="$2"
apply_restore=false
[[ "${3:-}" == "--apply" ]] && apply_restore=true
[[ $# -eq 2 || "$apply_restore" == true ]] || {
  echo "未知参数" >&2
  exit 2
}

for command_name in age sqlite3 tar; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "缺少命令：$command_name" >&2
    exit 3
  }
done
[[ -f "$encrypted_backup" && -f "$age_identity" ]] || {
  echo "备份或私钥文件不存在" >&2
  exit 4
}

umask 077
workdir="$(mktemp -d)"
trap 'rm -rf -- "$workdir"' EXIT
archive="$workdir/backup.tar.zst"
extract_root="$workdir/extracted"
contents_manifest="$workdir/archive-contents.txt"
target="/root/.openclaw"
rollback="/root/.openclaw-before-restore-$(date +%Y%m%d-%H%M%S)"

age --decrypt --identity "$age_identity" --output "$archive" "$encrypted_backup"
tar --list --zstd --file "$archive" > "$contents_manifest"
grep -Eq '(^/|(^|/)\.\.(/|$))' "$contents_manifest" && {
  echo "归档包含不安全路径" >&2
  exit 5
}
mkdir -p "$extract_root"
tar --extract --zstd --file "$archive" --directory "$extract_root"
[[ -f "$extract_root/.openclaw/openclaw.json" && -f "$extract_root/.openclaw/workspace/MEMORY.md" ]] || {
  echo "归档缺少 OpenClaw 关键文件" >&2
  exit 6
}

while IFS= read -r -d '' db_path; do
  [[ "$(sqlite3 "$db_path" 'PRAGMA integrity_check;')" == "ok" ]] || {
    echo "SQLite 完整性检查失败：${db_path#"$extract_root/.openclaw/"}" >&2
    exit 7
  }
done < <(find "$extract_root/.openclaw" -type f -name '*.sqlite' -print0)

file_count="$(find "$extract_root/.openclaw" -type f | wc -l)"
echo "restore_target=$target"
echo "rollback_target=$rollback"
echo "archive_file_count=$file_count"

if [[ "$apply_restore" == false ]]; then
  echo "计划检查完成；未修改任何目标文件。"
  exit 0
fi

[[ "${EUID:-$(id -u)}" -eq 0 ]] || {
  echo "恢复必须由 root 执行" >&2
  exit 8
}
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet openclaw-gateway; then
  echo "openclaw-gateway 仍在运行，请先停止服务" >&2
  exit 8
fi
[[ -t 0 ]] || {
  echo "应用恢复需要交互式终端" >&2
  exit 8
}
read -r -p "输入 RESTORE 确认覆盖 $target：" confirmation
[[ "$confirmation" == "RESTORE" ]] || {
  echo "已取消恢复"
  exit 0
}
[[ ! -e "$rollback" ]] || {
  echo "回滚目录已存在：$rollback" >&2
  exit 8
}

if [[ -e "$target" ]]; then
  mv -- "$target" "$rollback"
fi
mv -- "$extract_root/.openclaw" "$target"
chown -R root:root "$target"

echo "恢复完成。原目录保存在：$rollback"
