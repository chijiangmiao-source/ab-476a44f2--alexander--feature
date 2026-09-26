#!/bin/sh
# verify 入口：先跑辫群业务样例代码测试，再查页面构建产物，最后对健康路径做 HTTP 冒烟。
# 任一步失败即以非零退出码终止；全部通过输出成功并退出 0。
set -eu

echo "==> [1/3] 辫群业务样例代码测试"
node /app/test_braid.js

echo "==> [2/3] 页面构建产物检查"
node /app/check_artifacts.js

echo "==> [3/3] 健康路径 HTTP 冒烟"
node /app/smoke_health.js

echo "==> VERIFY 全部通过"
