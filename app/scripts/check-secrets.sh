#!/bin/sh
# ==================================================================
# 密钥泄露检查（提交前 / CI 通用）
# ==================================================================
# 用途：扫描将被提交的文件，发现明文密钥就中断提交。
# 用法：
#   sh app/scripts/check-secrets.sh           # 检查 git 暂存区（pre-commit 用）
#   sh app/scripts/check-secrets.sh --all     # 检查工作区全部被跟踪文件
#   sh app/scripts/check-secrets.sh f1 f2     # 检查指定文件
#
# 设计原则：
#   1. 只报告「文件 + 行号 + 命中类型」，**绝不打印命中的密钥本身**
#      （否则这个检查脚本自己就成了泄露源）。
#   2. 误报用白名单文件 app/.secretsignore 排除（一行一个路径片段）。
# ==================================================================

set -u
FAIL=0

# 该仓库目录属主与当前用户可能不一致（Windows 多账户常见），
# 不加 safe.directory 会让所有 git 调用直接报错。
GIT="git -c safe.directory=*"

ROOT=$($GIT rev-parse --show-toplevel 2>/dev/null) || ROOT=""
if [ -z "$ROOT" ]; then
  # 关键：git 不可用时**必须拦截**，不能静默放行。
  # 否则检查脚本会在"看起来通过"的状态下形同不存在。
  echo ""
  echo "  ✗ 无法访问 git 仓库，密钥检查未能执行，提交已阻止。"
  echo "    修复：git config --global --add safe.directory \"$(pwd)\""
  echo ""
  exit 1
fi
cd "$ROOT" || exit 1

IGNORE_FILE="app/.secretsignore"

# 待检查文件清单
if [ "${1:-}" = "--all" ]; then
  FILES=$($GIT ls-files)
elif [ $# -gt 0 ] && [ "${1:-}" != "--all" ]; then
  FILES="$*"
else
  FILES=$($GIT diff --cached --name-only --diff-filter=ACM 2>/dev/null)
fi

[ -z "$FILES" ] && { echo "  ✓ 密钥检查通过（无可检查文件）"; exit 0; }

is_ignored() {
  [ -f "$IGNORE_FILE" ] || return 1
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    case "$1" in *"$pat"*) return 0 ;; esac
  done < "$IGNORE_FILE"
  return 1
}

# 只扫文本类文件，跳过二进制与图片
for f in $FILES; do
  [ -f "$f" ] || continue
  case "$f" in
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.woff|*.woff2|*.ttf|*.mp4|*.mov|*.wav|*.mp3|*.glb|*.zip) continue ;;
  esac
  is_ignored "$f" && continue

  # 1) 模型密钥：sk- 开头 20 位以上
  if grep -nE "sk-[A-Za-z0-9]{20,}" "$f" >/dev/null 2>&1; then
    echo "  [密钥] $f"
    grep -nE "sk-[A-Za-z0-9]{20,}" "$f" | cut -d: -f1 | sed 's/^/         行 /'
    FAIL=1
  fi

  # 2) service_role 等高权限标识
  if grep -nE "\"service_role\"|SUPABASE_SERVICE_ROLE" "$f" >/dev/null 2>&1; then
    echo "  [高权限标识] $f"
    FAIL=1
  fi

  # 3) JWT（云端 anon/service key 常见形态）
  if grep -nE "eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}" "$f" >/dev/null 2>&1; then
    echo "  [JWT] $f"
    FAIL=1
  fi
done

if [ "$FAIL" -eq 1 ]; then
  echo ""
  echo "  ✗ 检测到疑似密钥，提交已阻止。"
  echo "    处理方式：把密钥移到 app/.env（已被 .gitignore 忽略），"
  echo "    若该密钥已经出现在提交历史里，请立即到平台轮换，仅删除文件是不够的。"
  echo ""
  exit 1
fi

echo "  ✓ 密钥检查通过（未发现明文密钥）"
exit 0
