# 同步辐射光纤束路重接 · 辫群等价复核

以辫群 B_n 的 **Garside 左贪婪规范形** 精确判定两条光纤重接记录是否等价的静态页面应用。
归约为确定性精确算法：不使用有限次试变换、不使用随机改写、也不仅比较诱导置换。

## 功能

- 光纤根数 n 可填 2–6（按固定顺序编号 1…n）。
- 两条记录支持带正负号发生器：`σ1…σ(n-1)`（或 `s1`、裸数字），逆元写作 `σ1^-1`、`σ1^{-1}`、`σ1'`、`σ1⁻¹`；空记录表示单位元；每条记录 ≤ 80 个符号。
- 精确处理逆元（`σᵢ⁻¹ = Δ⁻¹·∂σᵢ`，Δ 左移施加 τ 自同构）、远交换与三项编织关系。
- 等价时展示两侧完全相同的规范因子链 `Δ^k · A₁ … A_m`；不等价时展示不同规范链并定位**首个分歧因子**（Δ 指数层 / 第 k 个规范因子 / 链长差异）。
- 即使两侧诱导置换同为恒等（如 n=2 时 `σ1 σ1` 与空记录），只要规范链不同即判不等价。
- 空输入、发生器越界、记录超长：错误定位到具体字段与符号，并清除旧结论。
- 草稿变更或取消后，旧结果不会覆盖新内容（请求序号 + 代际双重校验，过期回包直接丢弃）。
- 复核计算在浏览器 Web Worker 中执行，界面保持可交互。

## 运行

```bash
# 启动静态页面（端口可用 APP_PORT 配置，默认 8080）
APP_PORT=8080 docker compose up --build web

# 页面：http://localhost:8080/   健康路径：http://localhost:8080/healthz
```

## 验证（verify 服务）

```bash
docker compose up --build --exit-code-from verify
```

verify 依次执行，全部完成后退出并以退出码报告成功（0）或失败（非 0）：

1. **代码测试**：以辫群业务样例运行核心算法测试
   （`σ1σ3≡σ3σ1`、`σ1σ2σ1≡σ2σ1σ2`、`σ1σ1≢ε` 且诱导置换同为恒等、逆元/远交换/编织关系代数性质、规范形不变量）；
2. **构建产物检查**：确认页面及 `braid.js` / `worker.js` / `app.js` 已由 web 服务正确提供；
3. **健康路径冒烟**：对 `/healthz` 执行 HTTP 检查。

## 结构

```
docker-compose.yml      # web（nginx 静态服务 + /healthz）与 verify（一次性验证）
web/
  Dockerfile            # nginx:alpine 托管静态页面
  nginx.conf            # 静态资源 + 健康路径
  site/
    index.html          # 页面
    app.js              # 主线程：校验、调度、渲染、防过期覆盖
    worker.js           # Web Worker：复核计算
    braid.js            # 辫群核心（Garside 规范形，页面与测试共用）
verify/
  Dockerfile            # node:20-alpine
  run.sh                # 测试 → 产物检查 → 健康冒烟，依次执行
  test_braid.js         # 业务样例与代数性质测试
  check_artifacts.js    # 构建产物 HTTP 检查
  smoke_health.js       # /healthz 冒烟
```
