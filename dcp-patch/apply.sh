#!/usr/bin/env bash
# 应用 adaptive-backoff 补丁到 DCP 插件
# 用法: ./apply.sh [DCP_DIR]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH="$SCRIPT_DIR/adaptive-backoff.patch"

# 默认 DCP 包位置（npm 缓存），可用参数覆盖
DCP_DIR="${1:-$HOME/.cache/opencode/packages/@tarquinen/opencode-dcp@3.1.14/node_modules/@tarquinen/opencode-dcp}"

if [ ! -f "$DCP_DIR/dist/index.js" ]; then
  echo "错误: 找不到 DCP 包: $DCP_DIR" >&2
  echo "请用参数指定 DCP 目录: $0 /path/to/opencode-dcp" >&2
  exit 1
fi

echo "应用补丁到: $DCP_DIR"
cd "$DCP_DIR"
patch -p1 < "$PATCH"

echo "验证语法..."
node --check dist/index.js
echo "补丁应用成功。"
