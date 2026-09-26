/*
 * burau.js — 闭合编织审计：约化 Burau 表示、闭合分量数与规范化 Alexander 多项式。
 *
 * 审计目的：把每条重接记录精确映射为可逆的约化 Burau 矩阵，闭包后比较
 *   (1) 闭合分量数（由诱导置换的轮换数给出）；
 *   (2) 规范化一元 Alexander 多项式 Δ_L(t)。
 * 二者合称「闭合拓扑指纹」。它只是辫闭包的不变量：
 *   - 指纹不同 ⇒ 闭包确实不同（可作为差异证据，明确标出差异侧）；
 *   - 指纹相同 ⇒ 仅表示该不变量未发现差异，不能反推两条辫必然等价。
 *
 * 精确性：系数环为 Z[t, t^-1]，系数一律使用 BigInt 精确表示，
 * 不做浮点近似；每个 σi / σi^-1 的矩阵互为严格代数逆元。
 *
 * 同一份代码同时供浏览器 Worker（importScripts）与 Node 测试（require）使用。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Burau = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var MIN_STRANDS = 2;
  var MAX_STRANDS = 6;

  /* =====================================================================
   * Laurent 多项式  p(t) = Σ c[k] · t^k，紧凑表示 { lo: 最低次, c: BigInt[] }
   * 零多项式统一为 { lo: 0, c: [] }。所有运算不修改入参。
   * ===================================================================== */
  function P(lo, c) { return { lo: lo, c: c }; }
  function pZero() { return P(0, []); }
  function pOne() { return P(0, [1n]); }
  function pMonomial(k, v) { return v === 0n ? pZero() : P(k, [v]); }
  function pIsZero(p) { return p.c.length === 0; }
  function pHi(p) { return p.lo + p.c.length - 1; }
  function pClone(p) { return P(p.lo, p.c.slice()); }
  function pCoeff(p, k) {
    var j = k - p.lo;
    return (j >= 0 && j < p.c.length) ? p.c[j] : 0n;
  }
  // 去零（去首尾零系数；空多项式归零）
  function pTrim(p) {
    var c = p.c, lo = p.lo;
    var a = 0, b = c.length;
    while (a < b && c[a] === 0n) { a++; lo++; }
    while (a < b && c[b - 1] === 0n) b--;
    if (a === b) return P(0, []); // 全部系数为零：零多项式的 lo 固定为 0
    return P(lo, a === 0 && b === c.length ? c : c.slice(a, b));
  }
  function pNeg(p) { return P(p.lo, p.c.map(function (v) { return -v; })); }
  function pAdd(a, b) {
    if (pIsZero(a)) return pClone(b);
    if (pIsZero(b)) return pClone(a);
    var lo = Math.min(a.lo, b.lo), hi = Math.max(pHi(a), pHi(b));
    var c = [];
    for (var k = lo; k <= hi; k++) c.push(pCoeff(a, k) + pCoeff(b, k));
    return pTrim(P(lo, c));
  }
  function pSub(a, b) { return pAdd(a, pNeg(b)); }
  function pMul(a, b) {
    if (pIsZero(a) || pIsZero(b)) return pZero();
    var lo = a.lo + b.lo;
    var c = new Array(a.c.length + b.c.length - 1);
    for (var i = 0; i < c.length; i++) c[i] = 0n;
    for (var ia = 0; ia < a.c.length; ia++) {
      for (var ib = 0; ib < b.c.length; ib++) c[ia + ib] += a.c[ia] * b.c[ib];
    }
    return P(lo, c);
  }
  // 精确 Laurent 带余除法：要求余式为 0，否则抛错（分母首项系数须整除）。
  // 允许商含负次幂（Laurent 环），逐项消去被除式当前最高次。
  function pDivExact(a, b) {
    if (pIsZero(b)) throw new Error('除以零多项式');
    if (pIsZero(a)) return pZero();
    var r = pClone(a), q = pZero();
    var guard = 0;
    while (!pIsZero(r)) {
      if (++guard > 100000) throw new Error('Laurent 除法不收敛');
      var lcR = r.c[r.c.length - 1], lcB = b.c[b.c.length - 1];
      if (lcR % lcB !== 0n) {
        throw new Error('Alexander 提取失败：分子不能被几何级数 1+…+t^(n-1) 整除');
      }
      var f = lcR / lcB;
      var k = pHi(r) - pHi(b);
      var m = pMonomial(k, f);
      q = pAdd(q, m);
      r = pTrim(pSub(r, pMul(m, b)));
    }
    return q;
  }

  /* =====================================================================
   * Laurent 多项式矩阵（稠密，规模 ≤ (n-1)×(n-1) ≤ 5×5）
   * ===================================================================== */
  function mIdentity(size) {
    var A = [];
    for (var i = 0; i < size; i++) {
      A[i] = [];
      for (var j = 0; j < size; j++) A[i][j] = i === j ? pOne() : pZero();
    }
    return A;
  }
  function mMul(A, B) {
    var size = A.length, C = [];
    for (var i = 0; i < size; i++) {
      C[i] = [];
      for (var j = 0; j < size; j++) {
        var s = pZero();
        for (var k = 0; k < size; k++) s = pAdd(s, pMul(A[i][k], B[k][j]));
        C[i][j] = s;
      }
    }
    return C;
  }

  // 行列式：n ≤ 6 时矩阵至多 5×5（5! = 120 项），直接 Leibniz 展开，
  // 确定性、无主元选取、无除零风险；系数 BigInt 精确。
  function determinant(M) {
    var size = M.length;
    if (size === 0) return pOne();
    var perm = [], all = [];
    for (var i = 0; i < size; i++) perm.push(i);
    (function generate(k) {
      if (k === size) { all.push(perm.slice()); return; }
      for (var j = k; j < size; j++) {
        var tmp = perm[k]; perm[k] = perm[j]; perm[j] = tmp;
        generate(k + 1);
        tmp = perm[k]; perm[k] = perm[j]; perm[j] = tmp;
      }
    })(0);
    var total = pZero();
    all.forEach(function (q) {
      var inv = 0;
      for (var a = 0; a < size; a++)
        for (var b2 = a + 1; b2 < size; b2++) if (q[a] > q[b2]) inv++;
      var prod = pOne();
      for (var r = 0; r < size; r++) prod = pMul(prod, M[r][q[r]]);
      total = (inv % 2 === 0) ? pAdd(total, prod) : pSub(total, prod);
    });
    return total;
  }

  /* =====================================================================
   * 约化 Burau 表示  ρ: B_n → GL_{n-1}(Z[t, t^-1])
   *
   * 取标准约定（下标 1 基，σk 作用于第 k、k+1 根）：
   *   内部 2 ≤ k ≤ n-2：第 k 行三块为 (t, -t, 1)，其余同单位阵；
   *   k = 1     ：左上角块 [[-t, 1], [0, 1]]；
   *   k = n-1   ：右下角块 [[1, 0], [t, -t]]；
   *   n = 2     ：1×1 矩阵 [-t]。
   * 逆元矩阵为其严格代数逆（-t 的逆为 -t^-1，三块为 (1, -t^-1, t^-1)）。
   * ===================================================================== */
  var T = pMonomial(1, 1n);    //  t
  var NT = pMonomial(1, -1n);  // -t
  var TI = pMonomial(-1, 1n);  //  t^-1
  var NTI = pMonomial(-1, -1n);// -t^-1
  var ONE = pOne();

  function generatorMatrix(n, k, e) {
    if (!Number.isInteger(n) || n < MIN_STRANDS || n > MAX_STRANDS) {
      throw new Error('strand count out of range');
    }
    if (!Number.isInteger(k) || k < 1 || k > n - 1) throw new Error('generator index out of range');
    var pos = e > 0;
    var size = n - 1;
    var A = mIdentity(size);
    var set = function (i, j, v) { A[i][j] = v; };

    if (size === 1) { // n = 2
      set(0, 0, pos ? NT : NTI);
      return A;
    }
    if (k === 1) {
      if (pos) { set(0, 0, NT); set(0, 1, ONE); set(1, 0, pZero()); set(1, 1, ONE); }
      else     { set(0, 0, NTI); set(0, 1, TI); set(1, 0, pZero()); set(1, 1, ONE); }
    } else if (k === n - 1) {
      var r = size - 1;
      if (pos) { set(r - 1, r - 1, ONE); set(r - 1, r, pZero()); set(r, r - 1, T); set(r, r, NT); }
      else     { set(r - 1, r - 1, ONE); set(r - 1, r, pZero()); set(r, r - 1, ONE); set(r, r, NTI); }
    } else {
      var row = k - 1; // 子矩阵中的行（1 基 k → 0 基 k-1）
      if (pos) {
        set(row, k - 2, T); set(row, k - 1, NT); set(row, k, ONE);
      } else {
        set(row, k - 2, ONE); set(row, k - 1, NTI); set(row, k, TI);
      }
    }
    return A;
  }

  // 记录（{i,e} 序列，与 braid.js 同一格式）→ 约化 Burau 矩阵
  function reducedBurau(n, gens) {
    var M = mIdentity(n - 1);
    for (var t = 0; t < gens.length; t++) M = mMul(M, generatorMatrix(n, gens[t].i, gens[t].e));
    return M;
  }

  /* ---------------- 闭包分量数：诱导置换的轮换数 ---------------- */
  function inducedPermutation(n, gens) {
    var p = [];
    for (var i = 0; i < n; i++) p[i] = i + 1;
    gens.forEach(function (g) {
      var a = g.i - 1, b = g.i, tmp = p[a]; p[a] = p[b]; p[b] = tmp; // σ 与 σ^-1 诱导同一换位
    });
    return p;
  }
  function cycleCount(perm) {
    var seen = new Array(perm.length).fill(false);
    var c = 0;
    for (var i = 0; i < perm.length; i++) {
      if (seen[i]) continue;
      c++;
      var x = i;
      while (!seen[x]) { seen[x] = true; x = perm[x] - 1; }
    }
    return c;
  }

  /* ---------------- 规范化 Alexander 多项式 ----------------
   * Burau 恒等式（闭辫子 β ∈ B_n）：
   *     det(I - ρ(β)) = (1 + t + … + t^(n-1)) · Δ_cl(β)(t)   （单分量闭包）
   * 多分量闭包（含空记录）det 常为 0，此时 Alexander 多项式记为零多项式。
   * 规范化（Alexander 多项式仅在 ±t^k 意义下唯一）：
   *     平移使最低次为 0，再整体变号使最高次系数为正。
   * 返回 { zero, coeffs:String[] }，coeffs[k] 即 t^k 的系数。
   */
  function geometricSum(n) { return P(0, new Array(n).fill(1n)); }

  function normalizePolynomial(p) {
    var q = pTrim(pClone(p));
    if (pIsZero(q)) return { zero: true, coeffs: [] };
    q.lo = 0; // 平移至最低次 0（消去 ±t^k 歧义）
    if (q.c[q.c.length - 1] < 0n) q.c = q.c.map(function (v) { return -v; });
    return { zero: false, coeffs: q.c.map(function (v) { return v.toString(); }) };
  }

  function auditSide(n, gens) {
    if (!Number.isInteger(n) || n < MIN_STRANDS || n > MAX_STRANDS) {
      throw new Error('strand count out of range');
    }
    var size = n - 1;
    var M = reducedBurau(n, gens);

    var N = mIdentity(size);
    for (var i = 0; i < size; i++)
      for (var j = 0; j < size; j++) N[i][j] = pSub(N[i][j], M[i][j]);

    var numerator = determinant(N);
    var poly;
    if (pIsZero(numerator)) {
      poly = { zero: true, coeffs: [] }; // 空记录 / 多分量闭包：稳定给出零多项式
    } else {
      poly = normalizePolynomial(pDivExact(numerator, geometricSum(n)));
    }

    var components = cycleCount(inducedPermutation(n, gens));
    return { components: components, poly: poly };
  }

  function sameCoeffs(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // 双侧闭合编织审计：比较闭合分量数与规范化 Alexander 多项式（闭合拓扑指纹）
  function compareClosures(n, gensA, gensB) {
    var A = auditSide(n, gensA);
    var B = auditSide(n, gensB);
    var componentsDiffer = A.components !== B.components;
    var polyDiffer = !sameCoeffs(A.poly.coeffs, B.poly.coeffs) || A.poly.zero !== B.poly.zero;
    var same = !componentsDiffer && !polyDiffer;
    return {
      n: n,
      same: same,
      sideA: A,
      sideB: B,
      divergence: same ? null : { componentsDiffer: componentsDiffer, polyDiffer: polyDiffer },
    };
  }

  return {
    MIN_STRANDS: MIN_STRANDS,
    MAX_STRANDS: MAX_STRANDS,
    generatorMatrix: generatorMatrix,
    reducedBurau: reducedBurau,
    determinant: determinant,
    auditSide: auditSide,
    compareClosures: compareClosures,
    // 导出多项式工具供测试精确校验
    laurent: {
      P: P, zero: pZero, one: pOne, monomial: pMonomial, isZero: pIsZero,
      add: pAdd, sub: pSub, mul: pMul, divExact: pDivExact, clone: pClone,
      trim: pTrim, coeff: pCoeff,
    },
  };
});
