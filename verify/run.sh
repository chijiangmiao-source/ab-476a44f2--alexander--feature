#!/bin/sh
# verify 入口：代码测试（等价复核 + 闭合编织审计）→ 页面构建产物检查 → 健康路径 HTTP 冒烟。
# 任一步失败即以非零退出码终止；全部通过输出成功并退出 0。
set -eu

echo "==> [1/4] 辫群等价复核代码测试（Garside 规范形）"
node /app/test_braid.js

echo "==> [2/4] 闭合编织审计代码测试（约化 Burau / Alexander 闭包指纹）"
node /app/test_burau.js

echo "==> [3/4] 页面构建产物检查"
node /app/check_artifacts.js

echo "==> [4/4] 健康路径 HTTP 冒烟"
node /app/smoke_health.js

echo "==> VERIFY 全部通过"
