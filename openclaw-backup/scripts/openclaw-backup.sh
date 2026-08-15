#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="/root/.openclaw/workspace/state/openclaw-backup"
CONFIG_FILE="$STATE_DIR/config.env"
RECIPIENT_FILE="$STATE_DIR/age-recipient"
GITHUB_DIR="/library/github"
GITHUB_TOKEN_FILE="$GITHUB_DIR/token"
GITHUB_REPO_FILE="$GITHUB_DIR/repo"

[[ -f "$CONFIG_FILE" ]] || {
  echo "缺少配置文件：$CONFIG_FILE" >&2
  exit 2
}

# 配置文件只允许保存非敏感参数。
source "$CONFIG_FILE"

: "${BACKUP_ROOT:=/root/.openclaw}"
: "${BACKUP_DIR:=/root/.openclaw-backups}"
: "${SLIM_RETENTION_COUNT:=18}"
: "${FULL_RETENTION_COUNT:=4}"
: "${TZ_NAME:=Asia/Shanghai}"
: "${ZSTD_LEVEL:=10}"

mode="${1:-}"
[[ "$mode" == "slim" || "$mode" == "full" ]] || {
  echo "用法：$0 <slim|full> [--prune]" >&2
  exit 2
}
shift

apply_prune=false
if [[ "${1:-}" == "--prune" ]]; then
  apply_prune=true
  shift
fi
[[ $# -eq 0 ]] || {
  echo "存在未知参数" >&2
  exit 2
}

required_commands=(age comm curl find jq rsync sha256sum sqlite3 stat tar zstd)
for command_name in "${required_commands[@]}"; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "缺少命令：$command_name" >&2
    exit 3
  }
done

check_secret_file() {
  local path="$1"
  [[ -f "$path" ]] || {
    echo "缺少凭据文件：$path" >&2
    exit 4
  }
  [[ "$(stat -c '%U' "$path")" == "root" && "$(stat -c '%a' "$path")" == "600" ]] || {
    echo "凭据文件必须归 root 所有且权限为 600：$path" >&2
    exit 4
  }
}

[[ -d "$GITHUB_DIR" ]] || {
  echo "缺少 GitHub 配置目录：$GITHUB_DIR" >&2
  exit 4
}
[[ "$(stat -c '%U' "$GITHUB_DIR")" == "root" && "$(stat -c '%a' "$GITHUB_DIR")" == "700" ]] || {
  echo "GitHub 配置目录必须归 root 所有且权限为 700：$GITHUB_DIR" >&2
  exit 4
}
check_secret_file "$GITHUB_TOKEN_FILE"
check_secret_file "$GITHUB_REPO_FILE"
check_secret_file "$RECIPIENT_FILE"

GITHUB_TOKEN="$(<"$GITHUB_TOKEN_FILE")"
GITHUB_REPO="$(<"$GITHUB_REPO_FILE")"
[[ -n "$GITHUB_TOKEN" ]] || {
  echo "GitHub Token 为空" >&2
  exit 4
}
[[ "$GITHUB_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  echo "GitHub 仓库格式无效" >&2
  exit 4
}
grep -Eq '^age1[0-9a-z]+$' "$RECIPIENT_FILE" || {
  echo "age recipient 文件格式无效" >&2
  exit 4
}
[[ -d "$BACKUP_ROOT" ]] || {
  echo "备份根目录不存在：$BACKUP_ROOT" >&2
  exit 5
}
[[ "$SLIM_RETENTION_COUNT" =~ ^[1-9][0-9]*$ && "$FULL_RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]] || {
  echo "保留数量必须为正整数" >&2
  exit 5
}

umask 077
mkdir -p "$BACKUP_DIR"

date_id="$(TZ="$TZ_NAME" date +%Y-%m-%d-%H%M%S)"
tag="openclaw-${mode}-backup-$date_id"
asset_name="openclaw-${mode}-backup-$date_id.tar.zst.age"
workdir="$(mktemp -d "$BACKUP_DIR/.work-$date_id.XXXXXX")"
archive="$workdir/openclaw-${mode}-backup-$date_id.tar.zst"
encrypted="$BACKUP_DIR/$asset_name"
snapshot_root="$workdir/snapshot-root"
snapshot_tree="$snapshot_root/.openclaw"
contents_manifest="$workdir/archive-contents.txt"
snapshot_files_manifest="$workdir/snapshot-files.txt"
api="https://api.github.com"

cleanup() {
  [[ -n "${workdir:-}" && -d "$workdir" && "$workdir" == "$BACKUP_DIR"/.work-* ]] && rm -rf -- "$workdir"
}
trap cleanup EXIT

# 运行中的 SQLite 数据库必须通过在线快照进入暂存树。
consistent_db_paths=(
  "state/openclaw.sqlite"
  "agents/main/agent/openclaw-agent.sqlite"
  "agents/main/agent/codex-home/goals_1.sqlite"
  "agents/main/agent/codex-home/memories_1.sqlite"
)

rsync_args=(--archive --protect-args)
for relative_db_path in "${consistent_db_paths[@]}"; do
  rsync_args+=(
    "--exclude=/$relative_db_path"
    "--exclude=/$relative_db_path-wal"
    "--exclude=/$relative_db_path-shm"
  )
done

if [[ "$mode" == "slim" ]]; then
  rsync_args+=(
    '--exclude=/npm/'
    '--exclude=/agents/main/agent/codex-home/.tmp/'
    '--exclude=/agents/main/agent/codex-home/sessions/'
    '--exclude=/agents/main/sessions/'
    '--exclude=/workspace/generated/**/sessions/'
    '--exclude=/workspace/**/node_modules/'
  )
fi

mkdir -p "$snapshot_tree"
rsync "${rsync_args[@]}" "$BACKUP_ROOT/" "$snapshot_tree/"

for relative_db_path in "${consistent_db_paths[@]}"; do
  source_db="$BACKUP_ROOT/$relative_db_path"
  [[ -f "$source_db" ]] || continue
  snapshot_db="$snapshot_tree/$relative_db_path"
  mkdir -p "$(dirname "$snapshot_db")"
  sqlite3 "$source_db" ".backup '$snapshot_db'"
  [[ "$(sqlite3 "$snapshot_db" 'PRAGMA integrity_check;')" == "ok" ]] || {
    echo "SQLite 快照完整性检查失败：$relative_db_path" >&2
    exit 7
  }
done

tar \
  --create \
  --directory "$snapshot_root" \
  --warning=no-file-changed \
  --acls \
  --xattrs \
  .openclaw \
  | zstd -T0 "-$ZSTD_LEVEL" -o "$archive"

tar --list --zstd --file "$archive" > "$contents_manifest"
find "$snapshot_tree" -type f -printf '.openclaw/%P\n' | LC_ALL=C sort > "$snapshot_files_manifest"
missing_files="$(comm -23 "$snapshot_files_manifest" <(LC_ALL=C sort "$contents_manifest"))"
[[ -z "$missing_files" ]] || {
  echo "归档缺少 staging 文件" >&2
  printf '%s\n' "$missing_files" >&2
  exit 8
}

required_archive_paths=(
  ".openclaw/openclaw.json"
  ".openclaw/workspace/MEMORY.md"
  ".openclaw/workspace/memory/"
  ".openclaw/workspace/skills/"
  ".openclaw/workspace/state/"
)
for required_path in "${required_archive_paths[@]}"; do
  grep -Fxq "$required_path" "$contents_manifest" || {
    echo "归档缺少关键路径：$required_path" >&2
    exit 8
  }
done

if [[ "$mode" == "slim" ]] && grep -Eq '^\.openclaw/(npm/|agents/main/sessions/|agents/main/agent/codex-home/(\.tmp|sessions)/|workspace/.*/node_modules/|workspace/generated/.*/sessions/)' "$contents_manifest"; then
  echo "slim 归档包含了应排除的运行目录" >&2
  exit 8
fi

age -R "$RECIPIENT_FILE" -o "$encrypted" "$archive"
rm -f -- "$archive"

size_bytes="$(stat -c '%s' "$encrypted")"
sha256="$(sha256sum "$encrypted" | awk '{print $1}')"
[[ -s "$encrypted" && -n "$sha256" ]] || {
  echo "本地加密归档校验失败" >&2
  exit 9
}

release_json="$(jq -n \
  --arg tag "$tag" \
  --arg name "$tag" \
  --arg body "Encrypted $mode OpenClaw backup. size_bytes: $size_bytes. sha256: $sha256." \
  '{tag_name:$tag,name:$name,body:$body,draft:false,prerelease:false}' \
  | curl -fsS \
    -X POST \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$api/repos/$GITHUB_REPO/releases" \
    -d @-)"

release_id="$(jq -r '.id // empty' <<<"$release_json")"
upload_url="$(jq -r '.upload_url // empty' <<<"$release_json" | sed 's/{.*//')"
html_url="$(jq -r '.html_url // empty' <<<"$release_json")"
[[ -n "$release_id" && -n "$upload_url" && -n "$html_url" ]] || {
  echo "创建 GitHub Release 失败" >&2
  exit 10
}

uploaded_asset_json="$(curl -fsS \
  -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"$encrypted" \
  "$upload_url?name=$asset_name")"

remote_name="$(jq -r '.name // empty' <<<"$uploaded_asset_json")"
remote_size="$(jq -r '.size // empty' <<<"$uploaded_asset_json")"
remote_state="$(jq -r '.state // empty' <<<"$uploaded_asset_json")"
[[ "$remote_name" == "$asset_name" && "$remote_size" == "$size_bytes" && "$remote_state" == "uploaded" ]] || {
  echo "GitHub 远端资产校验失败" >&2
  exit 10
}

verified_asset_count="$(curl -fsS \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$api/repos/$GITHUB_REPO/releases/$release_id/assets" \
  | jq --arg name "$asset_name" --argjson size "$size_bytes" '[.[] | select(.name == $name and .size == $size and .state == "uploaded")] | length')"
[[ "$verified_asset_count" == "1" ]] || {
  echo "GitHub 二次资产校验失败" >&2
  exit 10
}

retention_count="$SLIM_RETENTION_COUNT"
[[ "$mode" == "full" ]] && retention_count="$FULL_RETENTION_COUNT"

mapfile -t remote_prune_rows < <(
  curl -fsS \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$api/repos/$GITHUB_REPO/releases?per_page=100" \
    | jq -r \
      --arg prefix "openclaw-${mode}-backup-" \
      --argjson keep "$retention_count" \
      '[.[] | select(.tag_name | startswith($prefix))] | sort_by(.created_at) | reverse | .[$keep:][]? | "\(.id)\t\(.tag_name)"'
)

mapfile -t local_prune_paths < <(
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "openclaw-${mode}-backup-*.tar.zst.age" -printf '%T@\t%p\n' \
    | sort -rn \
    | awk -F '\t' -v keep="$retention_count" 'NR > keep {print $2}'
)

if [[ "$apply_prune" == true ]]; then
  for row in "${remote_prune_rows[@]}"; do
    release_to_delete="${row%%$'\t'*}"
    tag_to_delete="${row#*$'\t'}"
    curl -fsS -X DELETE \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "$api/repos/$GITHUB_REPO/releases/$release_to_delete" >/dev/null
    curl -fsS -X DELETE \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "$api/repos/$GITHUB_REPO/git/refs/tags/$tag_to_delete" >/dev/null || true
  done
  for local_path in "${local_prune_paths[@]}"; do
    [[ "$local_path" == "$BACKUP_DIR"/openclaw-"$mode"-backup-*.tar.zst.age ]] || continue
    rm -f -- "$local_path"
  done
else
  for row in "${remote_prune_rows[@]}"; do
    echo "remote_prune_preview=${row#*$'\t'}"
  done
  for local_path in "${local_prune_paths[@]}"; do
    echo "local_prune_preview=$local_path"
  done
fi

echo "mode=$mode"
echo "asset=$asset_name"
echo "path=$encrypted"
echo "size_bytes=$size_bytes"
echo "sha256=$sha256"
echo "release=$html_url"
