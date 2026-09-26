/*
 * app.js — 主线程：输入校验、Worker 调度、结论渲染。
 *
 * 防过期覆盖契约：
 *  - generation 随任何草稿变更 / 取消而递增；
 *  - 每次计算携带 (id, gen, kind)，Worker 回包时若与当前活动请求不符则直接丢弃；
 *  - 草稿变更、取消或输入越界后，旧审计立即清除，旧结果绝不会覆盖新内容。
 *
 * 两类任务：
 *  - compare：Garside 规范形等价复核（输入后自动计算）；
 *  - audit  ：闭合编织审计（复核员点击按钮发起，约化 Burau → Alexander 指纹）。
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    strands: $('strands'),
    recordA: $('recordA'),
    recordB: $('recordB'),
    errStrands: $('errStrands'),
    errA: $('errA'),
    errB: $('errB'),
    computeBtn: $('computeBtn'),
    auditBtn: $('auditBtn'),
    cancelBtn: $('cancelBtn'),
    status: $('status'),
    result: $('result'),
    audit: $('audit'),
  };

  var PLACEHOLDER =
    '<p class="placeholder">填写两条记录后自动计算，也可点击「计算等价性」。空记录表示单位元（未发生任何交叉）。</p>';
  var AUDIT_PLACEHOLDER =
    '<p class="placeholder">两条记录填写后，可点击「发起闭合编织审计」：' +
    '把每侧记录映射为可逆的约化 Burau 矩阵，由闭包计算规范化 Alexander 多项式与闭合分量数。</p>';

  var SAMPLES = {
    '1': { n: '4', a: 'σ1 σ3', b: 'σ3 σ1' },
    '2': { n: '3', a: 'σ1 σ2 σ1', b: 'σ2 σ1 σ2' },
    '3': { n: '2', a: 'σ1 σ1', b: '' },
  };

  var requestSeq = 0;
  var activeRequest = null; // {id, gen, kind}
  var generation = 0;       // 草稿代际
  var debounceTimer = null;
  var busyKind = null;      // 当前进行中的任务类型

  /* ---------------- Worker 生命周期 ---------------- */
  var worker = null;
  function spawnWorker() {
    if (worker) { try { worker.terminate(); } catch (_) { /* ignore */ } }
    worker = new Worker('worker.js');
    worker.onmessage = onWorkerMessage;
    worker.onerror = onWorkerError;
  }
  function onWorkerMessage(e) {
    var msg = e.data || {};
    // 过期回包（id / 代际 / 任务类型任一不符）直接丢弃
    if (!activeRequest || msg.id !== activeRequest.id ||
        activeRequest.gen !== generation || (msg.kind || 'compare') !== activeRequest.kind) return;
    var kind = activeRequest.kind;
    activeRequest = null;
    busyKind = null;
    setBusy(false);
    if (!msg.ok) { showFatal(kind, msg.error || '未知错误'); return; }
    if (kind === 'audit') renderAudit(msg.result);
    else renderResult(msg.result);
  }
  function onWorkerError() {
    if (activeRequest) {
      var kind = activeRequest.kind;
      activeRequest = null;
      busyKind = null;
      setBusy(false);
      showFatal(kind, '后台计算线程异常，结论已作废。');
    }
    spawnWorker(); // 重建线程，避免带病运行
  }
  spawnWorker();

  /* ---------------- 格式化 ---------------- */
  var SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '-': '₋' };
  var SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
  function mapDigits(v, table) {
    return String(v).split('').map(function (c) { return table[c] || c; }).join('');
  }
  function fmtGen(i) { return 'σ' + mapDigits(i, SUB); }
  function fmtDelta(k) { return 'Δ' + mapDigits(k, SUP); }
  function fmtPerm(p) { return '(' + p.join(' ') + ')'; }
  function fmtFactorWord(p) { return Braid.factorWord(p).map(fmtGen).join(' '); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // BigInt 系数转十进制字符串
  function biToStr(x) { return x.toString(); }

  // 规范化 Alexander 多项式（{e0:0,c:BigInt[]}）渲染；null = 零多项式
  function fmtAlex(alex) {
    if (alex === null) return '0';
    var terms = [];
    alex.c.forEach(function (v, i) {
      if (v === 0n) return;
      var sign = v < 0n ? '−' : (terms.length ? '+' : '');
      var av = v < 0n ? -v : v;
      var coef = (av === 1n && i > 0) ? '' : biToStr(av);
      var tpart = i === 0 ? '' : (i === 1 ? 't' : 't' + mapDigits(i, SUP));
      var body = coef + tpart || '1';
      terms.push(sign + body);
    });
    return terms.length ? terms.join(' ') : '0';
  }
  // 系数链：从 t^0 起逐项
  function fmtCoeffChain(alex) {
    if (alex === null) return null;
    return alex.c.map(biToStr);
  }

  /* ---------------- 输入校验（错误定位到具体字段与符号） ---------------- */
  function setErr(inputEl, errEl, msg) {
    errEl.textContent = msg;
    inputEl.classList.add('invalid');
  }
  function clearErrors() {
    [['strands', 'errStrands'], ['recordA', 'errA'], ['recordB', 'errB']].forEach(function (pair) {
      els[pair[0]].classList.remove('invalid');
      els[pair[1]].textContent = '';
    });
  }
  function readInputs() {
    clearErrors();
    var ok = true;
    var rawN = els.strands.value.trim();
    var n = NaN;
    if (rawN === '') {
      setErr(els.strands, els.errStrands, '空输入：请填写光纤根数（2–6 的整数）。');
      ok = false;
    } else if (!/^\d+$/.test(rawN) || (n = parseInt(rawN, 10)) < Braid.MIN_STRANDS || n > Braid.MAX_STRANDS) {
      setErr(els.strands, els.errStrands, '光纤根数须为 2–6 的整数。');
      ok = false;
    }
    var gensA = null, gensB = null;
    if (ok) {
      var pa = Braid.parse(els.recordA.value, n);
      if (!pa.ok) { setErr(els.recordA, els.errA, pa.error.message); ok = false; } else gensA = pa.gens;
      var pb = Braid.parse(els.recordB.value, n);
      if (!pb.ok) { setErr(els.recordB, els.errB, pb.error.message); ok = false; } else gensB = pb.gens;
    }
    return ok ? { ok: true, n: n, gensA: gensA, gensB: gensB } : { ok: false };
  }

  /* ---------------- 状态 ---------------- */
  function setStatus(msg) { els.status.textContent = msg; }
  function setBusy(b) {
    els.computeBtn.disabled = b;
    els.auditBtn.disabled = b;
    els.cancelBtn.disabled = !b;
    if (b) setStatus((busyKind === 'audit' ? '闭合编织审计' : '等价复核') +
      '计算中…（在浏览器 Worker 内执行，界面保持可交互）');
  }
  function invalidatePending() {
    generation++;
    activeRequest = null;
    busyKind = null;
  }
  function clearResult() {
    els.result.innerHTML = PLACEHOLDER;
    els.result.classList.remove('stale');
  }
  function clearAudit() {
    els.audit.innerHTML = AUDIT_PLACEHOLDER;
    els.audit.classList.remove('stale');
  }
  function markResultStale() {
    if (els.result.innerHTML.indexOf('placeholder') === -1) els.result.classList.add('stale');
  }
  function showFatal(kind, msg) {
    if (kind === 'audit') {
      clearAudit();
      setStatus('闭合编织审计失败：' + msg + '（旧审计已清除）');
    } else {
      clearResult();
      setStatus('计算失败：' + msg + '（旧结论已清除）');
    }
  }

  /* ---------------- 计算调度 ---------------- */
  function postJob(kind, input) {
    var id = ++requestSeq;
    activeRequest = { id: id, gen: generation, kind: kind };
    busyKind = kind;
    setBusy(true);
    worker.postMessage({ id: id, kind: kind, n: input.n, gensA: input.gensA, gensB: input.gensB });
  }
  function compute() {
    var input = readInputs();
    if (!input.ok) {
      invalidatePending();
      setBusy(false);
      clearResult(); // 输入错误：清除旧结论
      clearAudit();  // 输入越界：旧审计一并立即清除
      setStatus('输入存在错误：旧结论与旧审计已清除，请修正后重新计算。');
      return;
    }
    postJob('compare', input);
  }
  function computeNow() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    compute();
  }
  function scheduleCompute() {
    invalidatePending();   // 草稿变更：旧请求一律作废
    markResultStale();     // 旧等价结论标记为失效（不再可信）
    clearAudit();          // 草稿变更：旧审计立即清除，防止旧任务回包覆盖
    setBusy(false);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(compute, 350);
  }
  // 闭合编织审计：复核员显式发起
  function runAudit() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    var input = readInputs();
    if (!input.ok) {
      invalidatePending();
      setBusy(false);
      clearAudit();
      setStatus('输入存在错误：旧审计已清除，请修正后重新发起。');
      return;
    }
    clearAudit();
    els.audit.innerHTML = '<p class="placeholder">审计计算中…（约化 Burau 矩阵与闭包行列式在 Worker 内精确计算）</p>';
    postJob('audit', input);
  }
  function cancel() {
    invalidatePending();   // 取消：进行中的计算结果将被丢弃
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    setBusy(false);
    clearResult();
    clearAudit();          // 取消：旧审计立即清除
    setStatus('已取消：进行中的计算、旧结论与旧审计均已作废，不会覆盖当前内容。');
  }

  /* ---------------- 等价复核渲染（既有） ---------------- */
  function chainBlock(title, nf) {
    var chips = [];
    if (nf.delta === 0 && nf.factors.length === 0) {
      chips.push('<span class="chip identity">ε（单位元）</span>');
    } else {
      if (nf.delta !== 0) {
        chips.push('<span class="chip delta" title="Garside 元素 Δ 的幂次">' + esc(fmtDelta(nf.delta)) + '</span>');
      }
      nf.factors.forEach(function (f, i) {
        chips.push(
          '<span class="chip factor" title="规范因子 #' + (i + 1) + '">' +
          esc(fmtPerm(f)) + ' = ' + esc(fmtFactorWord(f)) + '</span>'
        );
      });
    }
    return '<div class="chain"><h3>' + title + '</h3>' +
      '<div class="chips">' + chips.join('<span class="dot">·</span>') + '</div>' +
      '<div class="meta">Δ 指数：' + nf.delta + '；规范因子数：' + nf.factors.length + '</div></div>';
  }

  function divergenceBlock(r) {
    var d = r.divergence;
    var text = '';
    if (d.kind === 'delta') {
      text = '首个分歧因子：Δ 指数层 —— 左侧 ' + fmtDelta(d.left) + '，右侧 ' + fmtDelta(d.right) + '。';
    } else if (d.kind === 'factor') {
      text = '首个分歧因子：第 ' + (d.index + 1) + ' 个规范因子 —— 左侧 ' + fmtPerm(d.left) +
        '（' + fmtFactorWord(d.left) + '），右侧 ' + fmtPerm(d.right) + '（' + fmtFactorWord(d.right) + '）。';
    } else {
      text = '首个分歧因子：第 ' + (d.index + 1) + ' 个规范因子 —— 一侧因子链已结束' +
        '（左侧共 ' + d.leftLength + ' 个因子，右侧共 ' + d.rightLength + ' 个因子）。';
    }
    return '<div class="divergence">' + esc(text) + '</div>';
  }

  function renderResult(r) {
    var html = [];
    html.push('<div class="verdict ' + (r.equivalent ? 'eq' : 'ne') + '">' +
      (r.equivalent ? '✓ 等价' : '✗ 不等价') + '</div>');
    html.push('<div class="chains">');
    html.push(chainBlock('记录 A 的规范因子链', r.nfA));
    html.push(chainBlock('记录 B 的规范因子链', r.nfB));
    html.push('</div>');

    var samePerm = Braid.perms.eqPerm(r.permA, r.permB);
    html.push('<div class="perms">诱导置换：A = ' + esc(fmtPerm(r.permA)) +
      '，B = ' + esc(fmtPerm(r.permB)) + (samePerm ? '（相同）' : '（不同）') + '</div>');

    if (r.equivalent) {
      html.push('<div class="ok-note">两侧规范因子链完全一致（Δ 指数与每个规范因子均相同），判定等价。</div>');
    } else {
      if (samePerm) {
        html.push('<div class="warn">注意：两侧诱导置换相同' +
          (Braid.perms.isIdentity(r.permA) ? '（同为恒等）' : '') +
          '，但规范因子链不同，故判定不等价 —— 等价性由规范形决定，不能仅凭诱导置换。</div>');
      }
      html.push(divergenceBlock(r));
    }
    els.result.innerHTML = html.join('');
    els.result.classList.remove('stale');
    setStatus('');
  }

  /* ---------------- 闭合编织审计渲染 ---------------- */
  function coefficientChain(alex) {
    var chain = fmtCoeffChain(alex);
    if (chain === null) return '<span class="chip zero-poly">0（零多项式）</span>';
    if (chain.length === 1 && chain[0] === '0') return '<span class="chip zero-poly">0（零多项式）</span>';
    return chain.map(function (coef, i) {
      return '<span class="chip coef" title="t' + mapDigits(i, SUP) + ' 的系数">' +
        '<span class="pw">' + (i === 0 ? '1' : 't' + (i === 1 ? '' : mapDigits(i, SUP))) + '</span>' +
        '<span class="cv">' + esc(coef) + '</span></span>';
    }).join('<span class="dot">·</span>');
  }

  function auditSideBlock(title, side, flags) {
    var cls = 'audit-side' + (flags.diff ? ' diff' : '');
    var badge = flags.diff ? '<span class="diff-badge">差异侧</span>' : '';
    var polyText = fmtAlex(side.alex);
    return '<div class="' + cls + '">' +
      '<h3>' + title + ' ' + badge + '</h3>' +
      '<div class="chips coeff-chain">' + coefficientChain(side.alex) + '</div>' +
      '<div class="meta">规范化 Alexander 多项式 Δ̂(t) = <span class="alex-expr">' + esc(polyText) + '</span></div>' +
      '<div class="meta">闭合分量数 μ = ' + side.components +
      (flags.compDiff ? ' <span class="comp-badge">分量数不同</span>' : '') + '</div>' +
      '</div>';
  }

  function renderAudit(r) {
    var html = [];
    var aDiff = !r.alexSame;                 // 多项式不同：两侧系数链都标注
    var sideDiff = aDiff || !r.compSame;     // 任一项不同：侧面板高亮
    html.push('<div class="verdict ' + (r.same ? 'eq' : 'ne') + '">' +
      (r.same ? '拓扑指纹：未发现差异' : '拓扑指纹：不同') + '</div>');
    html.push('<div class="chains">');
    html.push(auditSideBlock('记录 A 闭包', r.sideA, { diff: sideDiff, compDiff: !r.compSame }));
    html.push(auditSideBlock('记录 B 闭包', r.sideB, { diff: sideDiff, compDiff: !r.compSame }));
    html.push('</div>');

    if (r.same) {
      html.push('<div class="ok-note">两侧闭包的规范化 Alexander 多项式与闭合分量数均相同，' +
        '该不变量<b>未发现差异</b>。但 Alexander 指纹只是辫等价的必要非充分条件，' +
        '<b>不能据此宣称两条辫必然等价</b>；等价判定仍以 Garside 规范形为准。</div>');
    } else {
      var parts = [];
      if (!r.alexSame) parts.push('规范化 Alexander 多项式（系数链已在差异侧标出）');
      if (!r.compSame) parts.push('闭合分量数（A 为 ' + r.sideA.components + '，B 为 ' + r.sideB.components + '）');
      html.push('<div class="divergence">闭包拓扑指纹不同：差异位于' + parts.join('与') +
        '。该不变量依据约化 Burau 矩阵的闭包行列式计算，而非诱导置换或发生器计数。</div>');
    }
    els.audit.innerHTML = html.join('');
    els.audit.classList.remove('stale');
    setStatus('');
  }

  /* ---------------- 事件 ---------------- */
  [els.strands, els.recordA, els.recordB].forEach(function (el) {
    el.addEventListener('input', scheduleCompute);
  });
  els.computeBtn.addEventListener('click', computeNow);
  els.auditBtn.addEventListener('click', runAudit);
  els.cancelBtn.addEventListener('click', cancel);
  document.querySelectorAll('[data-sample]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var s = SAMPLES[btn.getAttribute('data-sample')];
      if (!s) return;
      els.strands.value = s.n;
      els.recordA.value = s.a;
      els.recordB.value = s.b;
      invalidatePending();
      clearAudit();
      computeNow();
    });
  });
  els.strands.addEventListener('keydown', function (e) { if (e.key === 'Enter') computeNow(); });
  [els.recordA, els.recordB].forEach(function (el) {
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) computeNow(); });
  });

  clearResult();
  clearAudit();
  computeNow(); // 页面载入即对预置示例给出结论
})();
