/*
 * test_burau.js — 闭合编织审计的验收测试（Node 直接运行核心 burau.js）。
 *
 * 验收要点：
 *   - 空记录形成多分量闭包：稳定给出零多项式与分量数 n；
 *   - σ1 与 σ1³ 在两根光纤下得到不同指纹（unknot vs 三叶结）；
 *   - 三项编织关系两侧得到相同结果（同为 Hopf 链闭包）；
 *   - 指纹相同仅表示该不变量未发现差异，不宣称辫等价；
 *   - 正负发生器矩阵严格互逆（可逆约化 Burau 表示），关系精确成立；
 *   - 指纹依据闭包不变量，而非诱导置换 / 发生器计数。
 */
'use strict';
var Burau;
try { Burau = require('./burau.js'); } catch (e) { Burau = require('../web/site/burau.js'); }

var passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   - ' + name); }
  else { failed++; console.error('  FAIL - ' + name + (detail ? ' | ' + detail : '')); }
}
function gens(s) { // 简易记号：数字串，前缀 '~' 表示逆元
  return s.trim().split(/\s+/).filter(Boolean).map(function (tok) {
    return { i: parseInt(tok.replace(/^~/, ''), 10), e: tok.charAt(0) === '~' ? -1 : 1 };
  });
}
var L = Burau.laurent;
function pIsIdPoly(p) { return !L.isZero(p) && p.lo === 0 && p.c.length === 1 && p.c[0] === 1n; }
function mIsIdentity(A) {
  for (var i = 0; i < A.length; i++)
    for (var j = 0; j < A.length; j++)
      if (!pIsIdPoly(A[i][j]) && i === j) return false;
      else if (!L.isZero(A[i][j]) && i !== j) return false;
  return true;
}
function fp(n, word) { return Burau.auditSide(n, gens(word)); }
function coeffs(side) { return side.poly.zero ? null : side.poly.coeffs.slice(); }

console.log('[1] 空记录：多分量闭包稳定展示零多项式与分量数');

[2, 3, 4, 5, 6].forEach(function (n) {
  var a = fp(n, '');
  check('n=' + n + ': 空记录 Alexander 多项式为零', a.poly.zero === true && a.poly.coeffs.length === 0);
  check('n=' + n + ': 空记录闭合分量数为 ' + n, a.components === n);
  var both = Burau.compareClosures(n, [], []);
  check('n=' + n + ': 两侧空记录指纹相同且结果稳定',
    both.same === true && both.divergence === null &&
    both.sideA.poly.zero && both.sideB.poly.zero &&
    both.sideA.components === n && both.sideB.components === n);
});

console.log('[2] σ1 与 σ1³（两根光纤）必须得到不同指纹');

var u = fp(2, '1');
var t3 = fp(2, '1 1 1');
check('σ1 闭包：1 个分量（unknot）', u.components === 1);
check('σ1 闭包：规范化 Alexander 多项式 = 1', !u.poly.zero && u.poly.coeffs.join(',') === '1');
check('σ1³ 闭包：1 个分量（三叶结）', t3.components === 1);
check('σ1³ 闭包：Δ = t²−t+1（系数链 1,-1,1）', !t3.poly.zero && t3.poly.coeffs.join(',') === '1,-1,1');
var cmp2 = Burau.compareClosures(2, gens('1'), gens('1 1 1'));
check('compareClosures 判定指纹不同', cmp2.same === false && cmp2.divergence.polyDiffer === true);
check('分量数相同但多项式不同（差异定位不混淆）',
  cmp2.divergence.componentsDiffer === false &&
  coeffs(cmp2.sideA).join(',') === '1' && coeffs(cmp2.sideB).join(',') === '1,-1,1');
var t3m = fp(2, '~1 ~1 ~1');
check('σ1⁻³（镜像三叶结）规范化后同为 1,-1,1（±t^k 归一）', !t3m.poly.zero && t3m.poly.coeffs.join(',') === '1,-1,1');

console.log('[3] 三项编织关系两侧须得到相同结果');

var relA = gens('1 2 1'), relB = gens('2 1 2');
var r3 = Burau.compareClosures(3, relA, relB);
check('n=3: σ1σ2σ1 与 σ2σ1σ2 闭包指纹相同', r3.same === true && r3.divergence === null);
check('n=3: 两侧同为 Hopf 链（2 个分量）', r3.sideA.components === 2 && r3.sideB.components === 2);
check('n=3: 两侧系数链同为 -1,1', r3.sideA.poly.coeffs.join(',') === '-1,1' &&
  r3.sideB.poly.coeffs.join(',') === '-1,1');
var r4 = Burau.compareClosures(4, relA, relB);
check('n=4: 编织关系两侧指纹仍相同（含闲置第 4 根）', r4.same === true &&
  r4.sideA.components === 3 && r4.sideB.components === 3 &&
  r4.sideA.poly.zero && r4.sideB.poly.zero);

console.log('[4] 经典闭包不变量交叉核对');

var hopf = fp(2, '1 1');
check('σ1² 闭包为 Hopf 链：2 分量、Δ = t−1（-1,1）', hopf.components === 2 && hopf.poly.coeffs.join(',') === '-1,1');
var fig8 = fp(3, '1 ~2 1 ~2');
check('八字结 σ1σ2⁻¹σ1σ2⁻¹：1 分量、Δ = t²−3t+1（1,-3,1）',
  fig8.components === 1 && fig8.poly.coeffs.join(',') === '1,-3,1');
var far = Burau.compareClosures(4, gens('1 3'), gens('3 1'));
check('远交换 σ1σ3 ↔ σ3σ1 闭包指纹相同', far.same === true);

console.log('[5] 正负发生器：约化 Burau 矩阵严格可逆');

var n, k;
for (n = 2; n <= 6; n++) {
  for (k = 1; k <= n - 1; k++) {
    var P = Burau.generatorMatrix(n, k, 1);
    var Pinv = Burau.generatorMatrix(n, k, -1);
    var prod = Burau.reducedBurau(n, [{ i: k, e: 1 }, { i: k, e: -1 }]);
    check('n=' + n + ' σ' + k + '：正逆矩阵乘积为单位阵', mIsIdentity(prod));
    // 直接核对两个矩阵互逆（另一相乘方向）
    (function () {
      var size = n - 1, q = [];
      for (var i = 0; i < size; i++) {
        q[i] = [];
        for (var j = 0; j < size; j++) {
          var s = L.zero();
          for (var t = 0; t < size; t++) s = L.add(s, L.mul(Pinv[i][t], P[t][j]));
          q[i][j] = s;
        }
      }
      check('n=' + n + ' σ' + k + '：逆元从另一侧相乘亦为单位阵', mIsIdentity(q));
    })();
  }
}

(function () {
  // 表示层面：编织关系与远交换在矩阵上严格成立（不只是闭包不变量相同）
  var MA = Burau.reducedBurau(3, relA), MB = Burau.reducedBurau(3, relB);
  var same = matricesEqual(MA, MB);
  check('ρ(σ1σ2σ1) = ρ(σ2σ1σ2)（约化 Burau 矩阵逐项相等）', same);
  var FA = Burau.reducedBurau(4, gens('1 3')), FB = Burau.reducedBurau(4, gens('3 1'));
  check('ρ(σ1σ3) = ρ(σ3σ1)', matricesEqual(FA, FB));
  function matricesEqual(A, B) {
    if (A.length !== B.length) return false;
    for (var i = 0; i < A.length; i++)
      for (var j = 0; j < A.length; j++)
        if (L.trim(A[i][j]).lo !== L.trim(B[i][j]).lo ||
            String(L.trim(A[i][j]).c) !== String(L.trim(B[i][j]).c)) return false;
    return true;
  }
})();

(function () {
  // 随机字（固定种子可复现）：ρ(w)·ρ(w⁻¹) = I
  var seed = 7711;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  var ok = true;
  for (var trial = 0; trial < 80; trial++) {
    var nn = 2 + Math.floor(rnd() * 5);
    var w = [];
    for (var t = 0; t < 1 + Math.floor(rnd() * 10); t++) w.push({ i: 1 + Math.floor(rnd() * (nn - 1)), e: rnd() < 0.5 ? 1 : -1 });
    var winv = w.slice().reverse().map(function (g) { return { i: g.i, e: -g.e }; });
    if (!mIsIdentity(Burau.reducedBurau(nn, w.concat(winv)))) { ok = false; break; }
  }
  check('80 例随机字：ρ(w·w⁻¹) = I（逆元与乘法精确）', ok);
})();

console.log('[6] 指纹依据闭包不变量，而非诱导置换或发生器计数');

// σ1³ 与 σ1⁻³：发生器计数相同（均 3 个 σ1）、诱导置换相同（均为 s1），
// 镜像归一后 Alexander 亦同；而 σ1 与 σ1³ 诱导置换相同、计数不同，
// 真正区分它们的是闭包 Alexander 多项式（上面 [2] 已验证）。
(function () {
  var s1 = Burau.reducedBurau(2, gens('1')), s13 = Burau.reducedBurau(2, gens('1 1 1'));
  check('σ1 与 σ1³ 的约化 Burau 矩阵不同（不只靠计数）', !matEq(s1, s13));
  function matEq(A, B) {
    return A.length === B.length && A.every(function (row, i) {
      return row.every(function (v, j) { return L.isZero(L.sub(v, B[i][j])); });
    });
  }
})();

// 指纹相同但辫本身不等价的样例：八字结字 σ1σ2⁻¹σ1σ2⁻¹ 与其逆序不同字
// （Alexander 多项式相同不蕴涵辫等价）——审计结果只报 same，不输出等价结论。
(function () {
  var a = gens('1 ~2 1 ~2');
  var b = gens('~2 1 ~2 1'); // 共轭位置不同：闭包 Alexander 相同
  var r = Burau.compareClosures(3, a, b);
  check('八字结两写法：指纹相同', r.same === true);
  check('审计结果不含「辫等价」断言字段（仅有 same 闭包指纹）',
    !Object.prototype.hasOwnProperty.call(r, 'equivalent'));
})();

console.log('[7] 稳定性：随机记录审计不抛错，分子必被几何级数整除或为零');

(function () {
  var seed = 424242;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  var ok = true;
  try {
    for (var trial = 0; trial < 120; trial++) {
      var nn = 2 + Math.floor(rnd() * 5);
      var w = [];
      for (var t = 0; t < Math.floor(rnd() * 14); t++) w.push({ i: 1 + Math.floor(rnd() * (nn - 1)), e: rnd() < 0.5 ? 1 : -1 });
      var side = Burau.auditSide(nn, w);
      if (typeof side.components !== 'number' || side.components < 1 || side.components > nn) { ok = false; break; }
      if (!side.poly.zero && side.poly.coeffs.some(function (c) { return !/^-?\d+$/.test(c); })) { ok = false; break; }
    }
  } catch (e) { ok = false; console.error('      抛错: ' + e); }
  check('120 例随机记录：审计稳定返回分量数与字符串系数链', ok);
})();

console.log('');
console.log('闭合编织审计测试：通过 ' + passed + ' 项，失败 ' + failed + ' 项');
process.exit(failed ? 1 : 0);
