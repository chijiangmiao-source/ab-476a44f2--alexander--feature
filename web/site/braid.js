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

  /* ======================================================================
   * 闭合编织审计：约化 Burau 表示 → 闭包 Alexander 指纹
   *
   * 对每侧记录精确构造可逆的约化 Burau 矩阵 ρ(β) ∈ GL_{n-1}(Z[t,t^-1])，
   * 再由闭包公式（相差 ±t^k 的意义下）
   *
   *     Δ_{β̂}(t) = det(I_{n-1} − ρ(β)) / (1 + t + … + t^{n-1})
   *
   * 得到归一化 Alexander 多项式；闭包分量数 μ 为 β 诱导置换的循环数。
   * 该指纹是辫等价的必要非充分条件：指纹不同 => 闭包不同；指纹相同
   * 不得据此宣称两条辫等价。多分量分裂闭包（如空记录）行列式为零，
   * 稳定给出零多项式与分量数。所有系数均为精确 BigInt，不做浮点近似，
   * 也不使用诱导置换或发生器计数作为判据。
   * ==================================================================== */

  function BI(x) { return BigInt(x); }

  // Laurent 多项式：{e0: t 的最低次幂, c: BigInt 系数数组（c[i] 对应 t^(e0+i)）}
  function lp(e0, c) {
    var arr = c.slice();
    var lo = 0, hi = arr.length - 1;
    while (lo <= hi && arr[lo] === BI(0)) { lo++; e0++; }
    while (hi >= lo && arr[hi] === BI(0)) hi--;
    if (lo > hi) return { e0: 0, c: [BI(0)] };
    return { e0: e0, c: arr.slice(lo, hi + 1) };
  }
  var LP_ZERO = { e0: 0, c: [BI(0)] };
  var LP_ONE = { e0: 0, c: [BI(1)] };
  function lpIsZero(p) { return p.c.length === 1 && p.c[0] === BI(0); }
  function lpEq(a, b) {
    if (lpIsZero(a)) return lpIsZero(b);
    if (lpIsZero(b)) return false;
    if (a.e0 !== b.e0 || a.c.length !== b.c.length) return false;
    for (var i = 0; i < a.c.length; i++) if (a.c[i] !== b.c[i]) return false;
    return true;
  }
  function lpAdd(a, b) {
    if (lpIsZero(a)) return b;
    if (lpIsZero(b)) return a;
    var lo = Math.min(a.e0, b.e0);
    var hi = Math.max(a.e0 + a.c.length - 1, b.e0 + b.c.length - 1);
    var c = new Array(hi - lo + 1);
    for (var i = 0; i < c.length; i++) c[i] = BI(0);
    for (var ia = 0; ia < a.c.length; ia++) c[a.e0 - lo + ia] += a.c[ia];
    for (var ib = 0; ib < b.c.length; ib++) c[b.e0 - lo + ib] += b.c[ib];
    return lp(lo, c);
  }
  function lpNeg(a) { return lp(a.e0, a.c.map(function (v) { return -v; })); }
  function lpSub(a, b) { return lpAdd(a, lpNeg(b)); }
  function lpMul(a, b) {
    if (lpIsZero(a) || lpIsZero(b)) return LP_ZERO;
    var c = new Array(a.c.length + b.c.length - 1);
    for (var k = 0; k < c.length; k++) c[k] = BI(0);
    for (var i = 0; i < a.c.length; i++)
      for (var j = 0; j < b.c.length; j++) c[i + j] += a.c[i] * b.c[j];
    return lp(a.e0 + b.e0, c);
  }
  // 普通多项式（e0=0）的精确带余除法：不整除即抛出（理论上闭包公式必整除）
  function lpDivExact(a, b) {
    if (lpIsZero(a)) return LP_ZERO;
    if (a.e0 < 0 || b.e0 !== 0) throw new Error('polynomial division requires nonnegative powers');
    var A = a.c.slice(), B = b.c;
    var qdeg = A.length - B.length;
    if (qdeg < 0) throw new Error('polynomial division: degree too small');
    var q = new Array(qdeg + 1);
    for (var k2 = 0; k2 < q.length; k2++) q[k2] = BI(0);
    var lc = B[B.length - 1];
    for (var d = A.length - 1; d >= B.length - 1; d--) {
      var top = A[d];
      if (top === BI(0)) continue;
      if (top % lc !== BI(0)) throw new Error('polynomial division: leading coefficient indivisible');
      var qc = top / lc, qi = d - (B.length - 1);
      q[qi] = qc;
      for (var jj = 0; jj < B.length; jj++) A[qi + jj] -= qc * B[jj];
    }
    for (var r = 0; r < A.length; r++) if (A[r] !== BI(0)) throw new Error('polynomial division: nonzero remainder');
    return lp(a.e0, q);
  }

  // 矩阵（元素为 Laurent 多项式）
  function mIdent(m) {
    var M = [];
    for (var i = 0; i < m; i++) {
      var row = [];
      for (var j = 0; j < m; j++) row.push(i === j ? LP_ONE : LP_ZERO);
      M.push(row);
    }
    return M;
  }
  function mMul(A, B) {
    var s = A.length, C = [];
    for (var i = 0; i < s; i++) {
      var row = [];
      for (var j = 0; j < s; j++) {
        var acc = LP_ZERO;
        for (var k = 0; k < s; k++) acc = lpAdd(acc, lpMul(A[i][k], B[k][j]));
        row.push(acc);
      }
      C.push(row);
    }
    return C;
  }
  function mEq(A, B) {
    if (A.length !== B.length) return false;
    for (var i = 0; i < A.length; i++) for (var j = 0; j < A.length; j++)
      if (!lpEq(A[i][j], B[i][j])) return false;
    return true;
  }

  var LP_T = lp(1, [BI(1)]);
  var LP_TINV = lp(-1, [BI(1)]);
  var LP_NEGT = lp(1, [BI(-1)]);
  var LP_NEGTINV = lp(-1, [BI(-1)]);

  // 约化 Burau 生成元（m=n-1 维，右乘作用；与逆元成对精确互逆）
  function burauGen(n, k) {
    var m = n - 1, M = mIdent(m);
    if (m === 1) { M[0][0] = LP_NEGT; return M; }       // n=2：σ1 ↦ [-t]
    if (k === 1) { M[0][0] = LP_NEGT; M[0][1] = LP_ONE; }
    else if (k === n - 1) { M[m - 1][m - 2] = LP_T; M[m - 1][m - 1] = LP_NEGT; }
    else { M[k - 1][k - 2] = LP_T; M[k - 1][k - 1] = LP_NEGT; M[k - 1][k] = LP_ONE; }
    return M;
  }
  function burauGenInv(n, k) {
    var m = n - 1, M = mIdent(m);
    if (m === 1) { M[0][0] = LP_NEGTINV; return M; }    // σ1^-1 ↦ [-t^-1]
    if (k === 1) { M[0][0] = LP_NEGTINV; M[0][1] = LP_TINV; }
    else if (k === n - 1) { M[m - 1][m - 2] = LP_ONE; M[m - 1][m - 1] = LP_NEGTINV; }
    else { M[k - 1][k - 2] = LP_ONE; M[k - 1][k - 1] = LP_NEGTINV; M[k - 1][k] = LP_TINV; }
    return M;
  }
  function burauMatrix(n, gens) {
    if (!Number.isInteger(n) || n < MIN_STRANDS || n > MAX_STRANDS) throw new Error('strand count out of range');
    var M = mIdent(n - 1);
    for (var t = 0; t < gens.length; t++) {
      var g = gens[t];
      M = mMul(M, g.e < 0 ? burauGenInv(n, g.i) : burauGen(n, g.i));
    }
    return M;
  }

  // Leibniz 展开求行列式（m≤5，至多 5!=120 项，精确无除法、无主元选取）
  function detLaurent(M) {
    var s = M.length;
    function inversionSign(perm) {
      var inv = 0;
      for (var i = 0; i < s; i++) for (var j = i + 1; j < s; j++) if (perm[i] > perm[j]) inv++;
      return inv % 2 ? -1 : 1;
    }
    var det = LP_ZERO;
    (function go(k, perm, used, acc) {
      if (k === s) { det = lpAdd(det, inversionSign(perm) < 0 ? lpNeg(acc) : acc); return; }
      for (var v = 0; v < s; v++) if (!used[v]) {
        used[v] = true; perm[k] = v;
        go(k + 1, perm, used, lpMul(acc, M[k][v]));
        used[v] = false;
      }
    })(0, [], [], LP_ONE);
    return det;
  }

  function permutationCycles(p) {
    var seen = {}, mu = 0;
    for (var x = 0; x < p.length; x++) if (!seen[x + 1]) {
      mu++;
      var cur = x + 1;
      while (!seen[cur]) { seen[cur] = true; cur = p[cur - 1]; }
    }
    return mu;
  }

  // 归一化：商多项式已约去首尾零系数（其 c[0] 即最低次项），
  // Alexander 多项式只在 ±t^k 意义下唯一，故以最低次项为 t^0 并令其系数为正。
  function normalizeAlex(q) {
    var c = q.c;
    if (c[0] < BI(0)) c = c.map(function (v) { return -v; });
    return { e0: 0, c: c };
  }

  // 单侧闭包指纹：{components, alex: null(零多项式) | {e0:0,c:BigInt[]}, matrix}
  function closureFingerprint(n, gens) {
    var M = burauMatrix(n, gens);
    var m = n - 1;
    var I = mIdent(m), D = [];
    for (var i = 0; i < m; i++) {
      var row = [];
      for (var j = 0; j < m; j++) row.push(lpSub(I[i][j], M[i][j]));
      D.push(row);
    }
    var det = detLaurent(D);
    var components = permutationCycles(inducedPerm(n, gens));
    if (lpIsZero(det)) return { n: n, components: components, alex: null, matrix: M };

    // det 可能含负次幂；乘 t^{-e0}（Laurent 单位）化为普通多项式：
    // 乘幂后 det.c[i] 的指数恰由 e0+i 变为 i，故直接以 e0=0 重解释即可。
    // 商与真正的 Δ 仅差一个 t^k，归一化（忽略整体 t 平移）后无影响。
    var lifted = det.e0 < 0 ? lp(0, det.c) : det;
    var sCoeffs = new Array(n);
    for (var s2 = 0; s2 < n; s2++) sCoeffs[s2] = BI(1);
    var q = lpDivExact(lifted, lp(0, sCoeffs));
    return { n: n, components: components, alex: normalizeAlex(q), matrix: M };
  }

  // 双侧闭合编织审计
  function auditClosures(n, gensA, gensB) {
    var a = closureFingerprint(n, gensA);
    var b = closureFingerprint(n, gensB);
    var alexSame = (a.alex === null && b.alex === null) ||
      (a.alex !== null && b.alex !== null && lpEq(a.alex, b.alex));
    var compSame = a.components === b.components;
    var differences = [];
    if (!alexSame) differences.push('alexander');
    if (!compSame) differences.push('components');
    return {
      n: n,
      sideA: a,
      sideB: b,
      same: alexSame && compSame,
      alexSame: alexSame,
      compSame: compSame,
      differences: differences,
    };
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
    closureFingerprint: closureFingerprint,
    auditClosures: auditClosures,
    burauMatrix: burauMatrix,
    laurent: {
      lp: lp, lpEq: lpEq, lpAdd: lpAdd, lpSub: lpSub, lpMul: lpMul,
      lpDivExact: lpDivExact, lpIsZero: lpIsZero, detLaurent: detLaurent,
      mIdent: mIdent, mMul: mMul, mEq: mEq,
      burauGen: burauGen, burauGenInv: burauGenInv,
      permutationCycles: permutationCycles,
    },
    perms: {
      idPerm: idPerm, eqPerm: eqPerm, isIdentity: isIdentity, mul: mul,
      genPerm: genPerm, w0: w0, inverse: inverse, lengthPerm: lengthPerm,
      tau: tau, rightDescents: rightDescents, leftDescents: leftDescents,
    },
  };
});
