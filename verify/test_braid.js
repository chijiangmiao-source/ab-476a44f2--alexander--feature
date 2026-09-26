/*
 * test_braid.js — 辫群业务样例与代数性质的代码测试（Node 直接运行核心 braid.js）。
 * 伪随机仅用于生成测试用例（固定种子、可复现）；被测算法本身完全确定。
 */
'use strict';
var Braid;
try { Braid = require('./braid.js'); } catch (e) { Braid = require('../web/site/braid.js'); }

var passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   - ' + name); }
  else { failed++; console.error('  FAIL - ' + name + (detail ? ' | ' + detail : '')); }
}
function eqJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

console.log('[1] 业务样例');

// 样例一：四根光纤，远交换 σ1σ3 ↔ σ3σ1，两侧规范因子链必须相同
var r = Braid.compareWords(4, 'σ1 σ3', 'σ3 σ1');
check('n=4: σ1σ3 与 σ3σ1 等价', r.ok && r.equivalent);
check('n=4: 两侧规范因子链完全一致', r.ok && eqJson(r.nfA, r.nfB));

// 样例二：三项编织关系 σ1σ2σ1 ↔ σ2σ1σ2
r = Braid.compareWords(3, 'σ1 σ2 σ1', 'σ2 σ1 σ2');
check('n=3: σ1σ2σ1 与 σ2σ1σ2 等价', r.ok && r.equivalent);
check('n=3: σ1σ2σ1 归约为 Δ^1（规范链相同）', r.ok && r.nfA.delta === 1 && r.nfA.factors.length === 0 && eqJson(r.nfA, r.nfB));
r = Braid.compareWords(4, 'σ1 σ2 σ1', 'σ2 σ1 σ2');
check('n=4: σ1σ2σ1 与 σ2σ1σ2 等价', r.ok && r.equivalent && eqJson(r.nfA, r.nfB));

// 样例三：两根光纤，σ1σ1 与空记录 —— 诱导置换同为恒等，必须判不等价
r = Braid.compareWords(2, 'σ1 σ1', '');
check('n=2: σ1σ1 与空记录不等价', r.ok && !r.equivalent);
check('n=2: 两侧诱导置换均为恒等（不得据此误判）', r.ok && Braid.perms.isIdentity(r.permA) && Braid.perms.isIdentity(r.permB));
check('n=2: 首个分歧位于 Δ 指数层', r.ok && r.divergence && r.divergence.kind === 'delta');
check('n=2: σ1σ1 的规范形为 Δ^2', r.ok && r.nfA.delta === 2 && r.nfA.factors.length === 0);

console.log('[2] 逆元与混合符号');

r = Braid.compareWords(3, 'σ1 σ1^-1', '');
check('σ1σ1^-1 ≡ ε', r.ok && r.equivalent);
r = Braid.compareWords(3, 'σ1^-1 σ1', '');
check('σ1^-1σ1 ≡ ε', r.ok && r.equivalent);
r = Braid.compareWords(4, 'σ1 σ3^-1', 'σ3^-1 σ1');
check('σ1σ3^-1 ≡ σ3^-1σ1（远交换含逆元）', r.ok && r.equivalent);
r = Braid.compareWords(3, 'σ1 σ2 σ1 σ2^-1 σ1^-1 σ2^-1', '');
check('σ1σ2σ1·(σ2σ1σ2)^-1 ≡ ε', r.ok && r.equivalent);
r = Braid.compareWords(3, 'σ2^-1 σ1 σ2', 'σ1 σ2 σ1^-1');
check('σ2^-1σ1σ2 ≡ σ1σ2σ1^-1（共轭恒等式）', r.ok && r.equivalent);
r = Braid.compareWords(3, 'σ1 σ2 σ1 σ2 σ1 σ2', '');
check('Δ^2 = (σ1σ2)^3 的规范形为 Δ^2', r.ok && !r.equivalent && r.nfA.delta === 2 && r.nfA.factors.length === 0);

console.log('[3] 不等价判定与分歧定位');

r = Braid.compareWords(3, 'σ1 σ2', 'σ2 σ1');
check('n=3: σ1σ2 与 σ2σ1 不等价', r.ok && !r.equivalent);
r = Braid.compareWords(2, 'σ1', 'σ1 σ1 σ1');
check('n=2: σ1 与 σ1^3 不等价', r.ok && !r.equivalent);
r = Braid.compareWords(3, 'σ1 σ2^-1', 'σ2^-1 σ1');
check('n=3: σ1σ2^-1 与 σ2^-1σ1 不等价', r.ok && !r.equivalent);
r = Braid.compareWords(3, 'σ1', 'σ2');
check('首个分歧为第 1 个规范因子', r.ok && !r.equivalent && r.divergence.kind === 'factor' && r.divergence.index === 0);
r = Braid.compareWords(3, 'σ1', 'σ1 σ1');
check('一侧为另一侧前缀时给出链长分歧', r.ok && !r.equivalent && r.divergence.kind === 'length' && r.divergence.index === 1);

console.log('[4] 输入校验');

var p = Braid.parse('σ3', 3);
check('发生器越界被定位（符号序号）', !p.ok && p.error.type === 'range' && p.error.index === 0);
p = Braid.parse('σ1 xyz', 3);
check('非法符号被定位', !p.ok && p.error.type === 'token' && p.error.index === 1);
p = Braid.parse(new Array(82).join('σ1 ').trim(), 3);
check('超过 80 个符号被拒绝', !p.ok && p.error.type === 'length');
p = Braid.parse('', 3);
check('空记录合法（单位元）', p.ok && p.gens.length === 0);
p = Braid.parse('σ1', 7);
check('根数超出 2–6 被拒绝', !p.ok && p.error.type === 'strands');
p = Braid.parse("σ1' σ2^{-1} σ1⁻¹ s2^-1", 3);
check('多种逆元记号均可解析', p.ok && p.gens.length === 4 && p.gens.every(function (g) { return g.e === -1; }));

console.log('[5] 代数性质（固定种子伪随机用例，算法本身确定）');

var seed = 20260925;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function randWord(n, len) {
  var g = [];
  for (var t = 0; t < len; t++) g.push({ i: 1 + Math.floor(rnd() * (n - 1)), e: rnd() < 0.5 ? 1 : -1 });
  return g;
}
function invert(w) { return w.slice().reverse().map(function (g) { return { i: g.i, e: -g.e }; }); }

var allOk = true, t, n;
for (t = 0; t < 150; t++) {
  n = 2 + Math.floor(rnd() * 5);
  var w = randWord(n, 1 + Math.floor(rnd() * 12));
  var nf = Braid.normalForm(n, w.concat(invert(w)));
  if (!(nf.delta === 0 && nf.factors.length === 0)) allOk = false;
}
check('150 例：w·w^-1 ≡ ε', allOk);

allOk = true;
for (t = 0; t < 120; t++) {
  n = 3 + Math.floor(rnd() * 4);
  var i = 1 + Math.floor(rnd() * (n - 2));
  var w1 = randWord(n, Math.floor(rnd() * 6));
  var w2 = randWord(n, Math.floor(rnd() * 6));
  var relA = [{ i: i, e: 1 }, { i: i + 1, e: 1 }, { i: i, e: 1 }];
  var relB = [{ i: i + 1, e: 1 }, { i: i, e: 1 }, { i: i + 1, e: 1 }];
  if (!eqJson(Braid.normalForm(n, w1.concat(relA, w2)), Braid.normalForm(n, w1.concat(relB, w2)))) allOk = false;
}
check('120 例：任意位置插入三项编织关系保持等价', allOk);

allOk = true;
for (t = 0; t < 120; t++) {
  n = 4 + Math.floor(rnd() * 3);
  var gi = 1 + Math.floor(rnd() * (n - 1));
  var gj = 1 + Math.floor(rnd() * (n - 1));
  if (Math.abs(gi - gj) < 2) gj = (gi + 2 <= n - 1) ? gi + 2 : gi - 2;
  if (gj < 1 || Math.abs(gi - gj) < 2) continue;
  var e1 = rnd() < 0.5 ? 1 : -1, e2 = rnd() < 0.5 ? 1 : -1;
  var u1 = randWord(n, Math.floor(rnd() * 5));
  var u2 = randWord(n, Math.floor(rnd() * 5));
  var a = Braid.normalForm(n, u1.concat([{ i: gi, e: e1 }, { i: gj, e: e2 }], u2));
  var b = Braid.normalForm(n, u1.concat([{ i: gj, e: e2 }, { i: gi, e: e1 }], u2));
  if (!eqJson(a, b)) allOk = false;
}
check('远交换（|i-j|≥2，含随机符号）保持等价', allOk);

console.log('[6] 规范形不变量与往返一致性');

function deltaGens(nn) { return Braid.factorWord(Braid.perms.w0(nn)).map(function (k) { return { i: k, e: 1 }; }); }
function nfToGens(nn, nf) {
  var d = deltaGens(nn), g = [];
  for (var k = 0; k < Math.abs(nf.delta); k++) g = g.concat(nf.delta > 0 ? d : invert(d));
  nf.factors.forEach(function (f) {
    g = g.concat(Braid.factorWord(f).map(function (k2) { return { i: k2, e: 1 }; }));
  });
  return g;
}

allOk = true;
for (t = 0; t < 200; t++) {
  n = 2 + Math.floor(rnd() * 5);
  var ww = randWord(n, 1 + Math.floor(rnd() * 15));
  var nf2 = Braid.normalForm(n, ww);
  var W0 = Braid.perms.w0(n);
  for (var fi = 0; fi < nf2.factors.length; fi++) {
    var f = nf2.factors[fi];
    if (Braid.perms.isIdentity(f) || Braid.perms.eqPerm(f, W0)) allOk = false;           // 真简单元
    var wp = Braid.factorWord(f).reduce(function (acc, k) {
      return Braid.perms.mul(acc, Braid.perms.genPerm(n, k));
    }, Braid.perms.idPerm(n));
    if (!Braid.perms.eqPerm(wp, f)) allOk = false;                                       // 因子字回读一致
    if (fi + 1 < nf2.factors.length) {
      var pair = Braid.normalizePair(f, nf2.factors[fi + 1]);
      if (!eqJson(pair[0], f) || !eqJson(pair[1], nf2.factors[fi + 1])) allOk = false;   // 相邻对左权重
    }
  }
  if (!eqJson(Braid.normalForm(n, nfToGens(n, nf2)), nf2)) allOk = false;                // 规范形往返幂等
  if (!eqJson(Braid.normalForm(n, ww), nf2)) allOk = false;                              // 确定性
}
check('200 例：真简单元 / 左权重 / 因子字回读 / 往返幂等 / 确定性', allOk);

console.log('[7] 闭合编织审计：约化 Burau 表示');

function bnEq(arr, nums) {
  if (!arr || arr.length !== nums.length) return false;
  return arr.every(function (v, i) { return BigInt(nums[i]) === v; });
}
function alexEq(f, nums) { return f.alex !== null && bnEq(f.alex.c, nums); }
function W(s) {
  if (!s) return [];
  return s.trim().split(/\s+/).map(function (tok) {
    var inv = tok.indexOf('^') >= 0;
    return { i: parseInt(tok.split('^')[0].replace(/[^0-9]/g, ''), 10), e: inv ? -1 : 1 };
  });
}

// 生成元与其逆元必须精确互逆（表示可逆）
var invOk = true;
for (n = 2; n <= 6; n++) {
  for (var gg = 1; gg <= n - 1; gg++) {
    var I = Braid.laurent.mIdent(n - 1);
    var P2 = Braid.laurent.mMul(Braid.laurent.burauGen(n, gg), Braid.laurent.burauGenInv(n, gg));
    if (!Braid.laurent.mEq(P2, I)) invOk = false;
  }
}
check('各根数下 σi 与 σi^-1 的 Burau 矩阵精确互逆', invOk);

// 约化 Burau 表示满足辫关系（三项编织，正逆分别验证；以及远交换）
var repOk = true;
for (n = 2; n <= 6; n++) {
  for (var k2 = 1; k2 <= n - 2; k2++) {
    var A = Braid.burauMatrix(n, W('σ' + k2 + ' σ' + (k2 + 1) + ' σ' + k2));
    var B = Braid.burauMatrix(n, W('σ' + (k2 + 1) + ' σ' + k2 + ' σ' + (k2 + 1)));
    if (!Braid.laurent.mEq(A, B)) repOk = false;
    var Ai = Braid.burauMatrix(n, W('σ' + k2 + '^-1 σ' + (k2 + 1) + '^-1 σ' + k2 + '^-1'));
    var Bi = Braid.burauMatrix(n, W('σ' + (k2 + 1) + '^-1 σ' + k2 + '^-1 σ' + (k2 + 1) + '^-1'));
    if (!Braid.laurent.mEq(Ai, Bi)) repOk = false;
  }
  for (var i2 = 1; i2 <= n - 1; i2++) for (var j2 = i2 + 2; j2 <= n - 1; j2++) {
    var C = Braid.burauMatrix(n, W('σ' + i2 + ' σ' + j2));
    var D = Braid.burauMatrix(n, W('σ' + j2 + ' σ' + i2));
    if (!Braid.laurent.mEq(C, D)) repOk = false;
  }
}
check('Burau 矩阵满足三项编织关系（正/逆）与远交换', repOk);

console.log('[8] 闭包指纹：空记录、已知纽结/链环、必备区分用例');

// 空记录 -> n 个分量的平凡闭包，零多项式
var emptyOk = true;
for (n = 2; n <= 6; n++) {
  var f0 = Braid.closureFingerprint(n, []);
  if (f0.alex !== null || f0.components !== n) emptyOk = false;
}
check('空记录稳定给出零多项式与 n 个闭合分量', emptyOk);

var fA, fB;
// n=2：σ1 闭包为平凡结（Δ=1，μ=1）
fA = Braid.closureFingerprint(2, W('σ1'));
check('σ1 闭包：Δ=1、μ=1', alexEq(fA, [1]) && fA.components === 1);
// n=2：σ1³ 闭包为三叶结（Δ=t²-t+1，μ=1）
fB = Braid.closureFingerprint(2, W('σ1 σ1 σ1'));
check('σ1³ 闭包：Δ=t²−t+1、μ=1', alexEq(fB, [1, -1, 1]) && fB.components === 1);
// 必备：σ1 与 σ1³ 在两根光纤下指纹必须不同
check('σ1 与 σ1³ 的指纹不同（关键区分用例）',
  !Braid.laurent.lpEq(fA.alex, fB.alex));
var au = Braid.auditClosures(2, W('σ1'), W('σ1 σ1 σ1'));
check('审计标出差异侧（differences 含 alexander）', !au.same && au.differences.indexOf('alexander') >= 0);

// σ1² 闭包为 Hopf 链环（Δ=1-t，μ=2）
var fH = Braid.closureFingerprint(2, W('σ1 σ1'));
check('σ1² 闭包：Δ=1−t、μ=2', alexEq(fH, [1, -1]) && fH.components === 2);
// 八字结 σ1 σ2^-1 σ1 σ2^-1（Δ=t²-3t+1，μ=1）
var f8 = Braid.closureFingerprint(3, W('σ1 σ2^-1 σ1 σ2^-1'));
check('八字结闭包：Δ=t²−3t+1、μ=1', alexEq(f8, [1, -3, 1]) && f8.components === 1);
// σ1σ2 闭包为平凡结
var fU = Braid.closureFingerprint(3, W('σ1 σ2'));
check('σ1σ2 闭包：Δ=1、μ=1', alexEq(fU, [1]) && fU.components === 1);
// 三项编织关系两侧闭包指纹相同（n=3 均为 Hopf 链环 1-t、μ=2；n=4 均为平凡结）
var brA = Braid.closureFingerprint(3, W('σ1 σ2 σ1'));
var brB = Braid.closureFingerprint(3, W('σ2 σ1 σ2'));
check('编织关系两侧（n=3）：指纹相同且为 1−t、μ=2',
  alexEq(brA, [1, -1]) && Braid.laurent.lpEq(brA.alex, brB.alex) &&
  brA.components === 2 && brB.components === 2);
var br4A = Braid.closureFingerprint(4, W('σ1 σ2 σ1'));
var br4B = Braid.closureFingerprint(4, W('σ2 σ1 σ2'));
check('编织关系两侧（n=4）：均为含自由光纤的三分量分裂闭包（零多项式、μ=3）',
  br4A.alex === null && br4B.alex === null &&
  br4A.components === 3 && br4B.components === 3);
var auditBr = Braid.auditClosures(3, W('σ1 σ2 σ1'), W('σ2 σ1 σ2'));
check('审计：编织关系两侧 same=true', auditBr.same && auditBr.differences.length === 0);

// 指纹相同不等于辫等价：n=2 σ1³ 与 σ1^-3（镜像）闭包同为三叶结指纹，但辫不等价
var mir = Braid.compareWords(2, 'σ1 σ1 σ1', 'σ1^-1 σ1^-1 σ1^-1');
var fm1 = Braid.closureFingerprint(2, W('σ1 σ1 σ1'));
var fm2 = Braid.closureFingerprint(2, W('σ1^-1 σ1^-1 σ1^-1'));
check('σ1³ 与 σ1⁻³ 指纹相同但辫不等价（指纹非充分条件）',
  mir.ok && !mir.equivalent && Braid.laurent.lpEq(fm1.alex, fm2.alex));

// n=2 空记录 vs σ1σ1：诱导置换同为恒等，闭包指纹不同（零多项式/2 分量 vs 1−t/2 分量）
var ah = Braid.auditClosures(2, [], W('σ1 σ1'));
check('空记录 vs σ1σ1：指纹不同（零多项式 ≠ 1−t），分量数同为 2',
  !ah.same && !ah.alexSame && ah.compSame && ah.sideA.alex === null);

console.log('[9] 闭包不变量的代数性质（固定种子随机用例）');

seed = 987654321;
function closureOf(nn, ww) { return Braid.closureFingerprint(nn, ww); }
function sameFingerprint(x, y) {
  if (x.components !== y.components) return false;
  if (x.alex === null) return y.alex === null;
  return y.alex !== null && Braid.laurent.lpEq(x.alex, y.alex);
}

// 共轭不改变闭包指纹（Markov 共轭移动）
allOk = true;
for (t = 0; t < 120; t++) {
  n = 2 + Math.floor(rnd() * 5);
  var w0w = randWord(n, 1 + Math.floor(rnd() * 20));
  var gw = randWord(n, 1 + Math.floor(rnd() * 5));
  var conj = gw.concat(w0w, invert(gw));
  if (!sameFingerprint(closureOf(n, w0w), closureOf(n, conj))) allOk = false;
}
check('120 例：共轭闭包指纹一致', allOk);

// 三项编织关系 / 远交换插入任意位置保持闭包指纹
allOk = true;
for (t = 0; t < 120; t++) {
  n = 3 + Math.floor(rnd() * 4);
  var ii = 1 + Math.floor(rnd() * (n - 2));
  var base = randWord(n, Math.floor(rnd() * 8));
  var pos = Math.floor(rnd() * (base.length + 1));
  var rA2 = [{ i: ii, e: 1 }, { i: ii + 1, e: 1 }, { i: ii, e: 1 }];
  var rB2 = [{ i: ii + 1, e: 1 }, { i: ii, e: 1 }, { i: ii + 1, e: 1 }];
  var x1 = base.slice(0, pos).concat(rA2, base.slice(pos));
  var x2 = base.slice(0, pos).concat(rB2, base.slice(pos));
  if (!sameFingerprint(closureOf(n, x1), closureOf(n, x2))) allOk = false;
}
check('120 例：编织关系两侧闭包指纹相同', allOk);

allOk = true;
var skipped = 0;
for (t = 0; t < 120; t++) {
  n = 4 + Math.floor(rnd() * 3);
  var ga = 1 + Math.floor(rnd() * (n - 3));
  var gb2 = ga + 2;
  var ea = rnd() < 0.5 ? 1 : -1, eb = rnd() < 0.5 ? 1 : -1;
  var u = randWord(n, Math.floor(rnd() * 6));
  var v2 = randWord(n, Math.floor(rnd() * 6));
  var y1 = u.concat([{ i: ga, e: ea }, { i: gb2, e: eb }], v2);
  var y2 = u.concat([{ i: gb2, e: eb }, { i: ga, e: ea }], v2);
  if (!sameFingerprint(closureOf(n, y1), closureOf(n, y2))) allOk = false;
}
check('120 例：远交换两侧闭包指纹相同', allOk);

// Alexander 互反性 Δ(t)=±t^kΔ(t^-1)（非零多项式系数关于中心反对称/对称）
allOk = true;
var nonzeroSeen = 0;
for (t = 0; t < 300; t++) {
  n = 2 + Math.floor(rnd() * 5);
  var wr = randWord(n, 1 + Math.floor(rnd() * 24));
  var fr = closureOf(n, wr);
  if (fr.alex === null) continue;
  nonzeroSeen++;
  var c = fr.alex.c, d = c.length - 1, sgn = 0, okr = true;
  for (var ci = 0; ci <= d; ci++) {
    var l = c[ci], rr = c[d - ci], ss = 0;
    if (l === rr) ss = 1; else if (l === -rr) ss = -1; else { okr = false; break; }
    if (rr !== 0n) { if (sgn === 0) sgn = ss; else if (sgn !== ss) { okr = false; break; } }
  }
  if (!okr) allOk = false;
}
check('300 例中非零闭包指纹满足 Alexander 互反性（非零样本 ' + nonzeroSeen + '）', allOk && nonzeroSeen > 50);

console.log('');
console.log('辫群代码测试：通过 ' + passed + ' 项，失败 ' + failed + ' 项');
process.exit(failed ? 1 : 0);
