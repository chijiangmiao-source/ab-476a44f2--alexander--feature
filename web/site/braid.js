/*
 * braid.js — 辫群 B_n 字问题的精确求解（Garside / Thurston 左贪婪规范形）。
 *
 * 每个辫可唯一写成  Δ^delta · A1 A2 … Am ，其中：
 *   - Δ 为 Garside 半扭（对应最长置换 w0）；
 *   - 每个 Ai 为真简单元（≠ 1、≠ Δ），与置换一一对应；
 *   - 相邻对 (Ai, Ai+1) 左权重（left-weighted）。
 * 两条字等价 当且仅当 规范形逐项相同。算法为确定性精确归约：
 * 不使用有限次试变换、不使用随机改写、也不仅比较诱导置换。
 *
 * 同一份代码同时供浏览器 Worker（importScripts）与 Node 测试（require）使用。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Braid = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var MIN_STRANDS = 2;
  var MAX_STRANDS = 6;
  var MAX_SYMBOLS = 80;

  /* ---------------- 置换与简单元 ----------------
   * 简单元 ↔ {1..n} 的置换；置换用一维数组 p 表示，p[i] 为 i+1 的像（1 基）。
   * 字 g1 g2 … 的诱导置换按右乘累积：perm(w·σk) = perm(w)·s_k。
   */
  function idPerm(n) { var p = new Array(n); for (var i = 0; i < n; i++) p[i] = i + 1; return p; }
  function eqPerm(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function isIdentity(p) { for (var i = 0; i < p.length; i++) if (p[i] !== i + 1) return false; return true; }
  // 复合 mul(p, q) = p∘q ：先作用 q，再作用 p
  function mul(p, q) {
    var n = p.length, r = new Array(n);
    for (var i = 0; i < n; i++) r[i] = p[q[i] - 1];
    return r;
  }
  // 基本换位 s_k（交换 k 与 k+1，1 基）
  function genPerm(n, k) { var p = idPerm(n); p[k - 1] = k + 1; p[k] = k; return p; }
  // 最长元 w0（对应 Δ）
  function w0(n) { var p = new Array(n); for (var i = 0; i < n; i++) p[i] = n - i; return p; }
  function inverse(p) {
    var inv = new Array(p.length);
    for (var i = 0; i < p.length; i++) inv[p[i] - 1] = i + 1;
    return inv;
  }
  function lengthPerm(p) {
    var c = 0;
    for (var i = 0; i < p.length; i++) for (var j = i + 1; j < p.length; j++) if (p[i] > p[j]) c++;
    return c;
  }
  // τ(π) = w0·π·w0 ：Δ 共轭诱导的自同构（σi ↦ σ_{n-i}）
  function tau(p) {
    var n = p.length, r = new Array(n);
    for (var i = 0; i < n; i++) r[i] = n + 1 - p[n - 1 - i];
    return r;
  }
  // 右下降集 R(p) = {k : p(k) > p(k+1)} —— σk 可作为 p 的右因子
  function rightDescents(p) {
    var d = [];
    for (var k = 1; k < p.length; k++) if (p[k - 1] > p[k]) d.push(k);
    return d;
  }
  // 左下降集 L(p) = {k : p^{-1}(k) > p^{-1}(k+1)} —— σk 可作为 p 的左因子
  function leftDescents(p) {
    var inv = inverse(p), d = [];
    for (var k = 1; k < p.length; k++) if (inv[k - 1] > inv[k]) d.push(k);
    return d;
  }

  /* ---------------- 输入解析 ----------------
   * 记号：σ1…σ_{n-1}（亦接受 s1、S1 或裸数字）；逆元后缀：^-1、^{-1}、'、⁻¹。
   * 空记录合法（单位元）。错误返回可定位信息（字段内第几个符号、原记号）。
   */
  var TOKEN_RE = /^[σΣsS]?(\d{1,2})(\^\{?-1\}?|⁻¹|')?$/;

  function parse(text, n) {
    if (!Number.isInteger(n) || n < MIN_STRANDS || n > MAX_STRANDS) {
      return { ok: false, error: { type: 'strands', message: '光纤根数须为 ' + MIN_STRANDS + '–' + MAX_STRANDS + ' 的整数' } };
    }
    var trimmed = String(text == null ? '' : text).trim();
    if (trimmed === '') return { ok: true, gens: [], tokens: [] };
    var tokens = trimmed.split(/[\s,，、]+/);
    var gens = [];
    for (var t = 0; t < tokens.length; t++) {
      var tok = tokens[t];
      var m = TOKEN_RE.exec(tok);
      if (!m) {
        return { ok: false, error: { type: 'token', index: t, token: tok, message: '第 ' + (t + 1) + ' 个符号「' + tok + '」无法识别' } };
      }
      var i = parseInt(m[1], 10);
      if (i < 1 || i > n - 1) {
        return { ok: false, error: { type: 'range', index: t, token: tok, message: '第 ' + (t + 1) + ' 个符号「' + tok + '」发生器越界：' + n + ' 根光纤仅允许 σ1…σ' + (n - 1) } };
      }
      gens.push({ i: i, e: m[2] ? -1 : 1 });
    }
    if (gens.length > MAX_SYMBOLS) {
      return { ok: false, error: { type: 'length', message: '记录含 ' + gens.length + ' 个符号，超过上限 ' + MAX_SYMBOLS } };
    }
    return { ok: true, gens: gens, tokens: tokens };
  }

  /* ---------------- 左权重化 ----------------
   * 对 (a(α), a(β))：只要 β 的某个左因子 σk 不能留在 β（k ∈ L(β) \ R(α)），
   * 就把它从 β 左端移到 α 右端。β 的长度严格下降，必终止；
   * 结果为该乘积的左权重分解。
   */
  function normalizePair(alpha, beta) {
    var n = alpha.length;
    var a = alpha.slice(), b = beta.slice();
    for (;;) {
      var Lb = leftDescents(b);
      var Ra = {};
      rightDescents(a).forEach(function (k) { Ra[k] = true; });
      var k = -1;
      for (var t = 0; t < Lb.length; t++) { if (!Ra[Lb[t]]) { k = Lb[t]; break; } }
      if (k < 0) break;
      a = mul(a, genPerm(n, k)); // a 吸收 σk
      b = mul(genPerm(n, k), b); // b 去掉左因子 σk
    }
    return [a, b];
  }

  /* ---------------- 规范形 ----------------
   * 1) 负号字母：σi^{-1} = ∂σi·Δ^{-1} = Δ^{-1}·τ(∂σi)（∂σi 为补简单元，σi·∂σi = Δ）；
   *    Δ^{-1} 左移穿越已有因子时施加 τ。
   * 2) 反复：把等于 Δ 的因子吸收进指数（前方因子施加 τ），
   *    并对首个非左权重相邻对做局部规范化、删去单位因子。
   *    度量 (非Δ总长, 长度序列字典序) 保证终止；结果唯一。
   */
  function normalForm(n, gens) {
    if (!Number.isInteger(n) || n < MIN_STRANDS || n > MAX_STRANDS) throw new Error('strand count out of range');
    var W0 = w0(n);
    var delta = 0;
    var factors = [];
    for (var t = 0; t < gens.length; t++) {
      var g = gens[t];
      if (g.e > 0) {
        factors.push(genPerm(n, g.i));
      } else {
        // σi^{-1} = ∂σi·Δ^{-1} = Δ^{-1}·τ(∂σi)；Δ^{-1} 左移穿越已有因子时施加 τ。
        // τ(∂σi) 的置换为 w0∘s_i（因 τ(∂σi) = w0·(s_i·w0)·w0 = w0·s_i）。
        delta -= 1;
        factors = factors.map(tau);
        var complement = mul(W0, genPerm(n, g.i));
        if (!isIdentity(complement)) factors.push(complement);
      }
    }
    factors = factors.filter(function (p) { return !isIdentity(p); });

    var guard = 0;
    for (;;) {
      if (++guard > 200000) throw new Error('normalization did not converge');
      var wi = -1;
      for (var i = 0; i < factors.length; i++) if (eqPerm(factors[i], W0)) { wi = i; break; }
      if (wi >= 0) {
        factors.splice(wi, 1);
        delta += 1;
        for (var j = 0; j < wi; j++) factors[j] = tau(factors[j]);
        continue;
      }
      var changed = false;
      for (var k = 0; k + 1 < factors.length; k++) {
        var pair = normalizePair(factors[k], factors[k + 1]);
        if (!eqPerm(pair[0], factors[k]) || !eqPerm(pair[1], factors[k + 1])) {
          factors[k] = pair[0];
          factors[k + 1] = pair[1];
          factors = factors.filter(function (p) { return !isIdentity(p); });
          changed = true;
          break;
        }
      }
      if (!changed) break;
    }
    return { delta: delta, factors: factors };
  }

  // 字的诱导置换（符号正负无关：σi 与 σi^{-1} 均诱导 s_i）
  function inducedPerm(n, gens) {
    var p = idPerm(n);
    for (var t = 0; t < gens.length; t++) p = mul(p, genPerm(n, gens[t].i));
    return p;
  }

  // 简单元的确定性正向字：反复剥离最靠左的右下降
  function factorWord(p) {
    var n = p.length;
    var cur = p.slice();
    var seq = [];
    for (;;) {
      var d = rightDescents(cur);
      if (d.length === 0) break;
      seq.push(d[0]);
      cur = mul(cur, genPerm(n, d[0]));
    }
    return seq.reverse();
  }

  // 首个分歧：先比 Δ 指数，再逐项比规范因子，最后比因子数
  function firstDivergence(a, b) {
    if (a.delta !== b.delta) return { kind: 'delta', left: a.delta, right: b.delta };
    var m = Math.min(a.factors.length, b.factors.length);
    for (var i = 0; i < m; i++) {
      if (!eqPerm(a.factors[i], b.factors[i])) return { kind: 'factor', index: i, left: a.factors[i], right: b.factors[i] };
    }
    if (a.factors.length !== b.factors.length) {
      return { kind: 'length', index: m, leftLength: a.factors.length, rightLength: b.factors.length };
    }
    return null;
  }

  function compare(n, gensA, gensB) {
    var nfA = normalForm(n, gensA);
    var nfB = normalForm(n, gensB);
    var equivalent = nfA.delta === nfB.delta &&
      nfA.factors.length === nfB.factors.length &&
      nfA.factors.every(function (f, i) { return eqPerm(f, nfB.factors[i]); });
    return {
      n: n,
      equivalent: equivalent,
      nfA: nfA,
      nfB: nfB,
      divergence: equivalent ? null : firstDivergence(nfA, nfB),
      permA: inducedPerm(n, gensA),
      permB: inducedPerm(n, gensB),
    };
  }

  function compareWords(n, textA, textB) {
    var pa = parse(textA, n);
    if (!pa.ok) return { ok: false, side: 'A', error: pa.error };
    var pb = parse(textB, n);
    if (!pb.ok) return { ok: false, side: 'B', error: pb.error };
    var r = compare(n, pa.gens, pb.gens);
    r.ok = true;
    return r;
  }

  return {
    MIN_STRANDS: MIN_STRANDS,
    MAX_STRANDS: MAX_STRANDS,
    MAX_SYMBOLS: MAX_SYMBOLS,
    parse: parse,
    normalForm: normalForm,
    compare: compare,
    compareWords: compareWords,
    factorWord: factorWord,
    inducedPerm: inducedPerm,
    normalizePair: normalizePair,
    perms: {
      idPerm: idPerm, eqPerm: eqPerm, isIdentity: isIdentity, mul: mul,
      genPerm: genPerm, w0: w0, inverse: inverse, lengthPerm: lengthPerm,
      tau: tau, rightDescents: rightDescents, leftDescents: leftDescents,
    },
  };
});
