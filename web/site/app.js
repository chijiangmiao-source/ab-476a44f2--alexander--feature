/*
 * app.js — 主线程：输入校验、Worker 调度、结论渲染。
 *
 * 两类计算共用同一条 Worker 与同一套防过期覆盖契约：
 *   - compare：Garside 规范形等价复核；
 *   - closure：闭合编织审计（约化 Burau / Alexander 闭包指纹）。
 *
 * 防过期覆盖契约：
 *  - generation 随任何草稿变更 / 取消而递增；
 *  - 每次计算携带 (id, gen, type)，Worker 回包时若与当前活动请求不符则直接丢弃；
 *  - 因此草稿变更、取消或输入越界后，旧结果（含旧审计）绝不会覆盖新内容。
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
    cancelBtn: $('cancelBtn'),
    status: $('status'),
    result: $('result'),
    auditBtn: $('auditBtn'),
    auditStatus: $('auditStatus'),
    auditResult: $('auditResult'),
  };

  var PLACEHOLDER =
    '<p class="placeholder">填写两条记录后自动计算，也可点击「计算等价性」。空记录表示单位元（未发生任何交叉）。</p>';
  var AUDIT_PLACEHOLDER =
    '<p class="placeholder">两条束路记录填写后，点击「发起闭合审计」：将逐侧映射为约化 Burau 矩阵，' +
    '从闭包计算规范化 Alexander 多项式与闭合分量数。</p>';

  var SAMPLES = {
    '1': { n: '4', a: 'σ1 σ3', b: 'σ3 σ1' },
    '2': { n: '3', a: 'σ1 σ2 σ1', b: 'σ2 σ1 σ2' },
    '3': { n: '2', a: 'σ1 σ1', b: '' },
  };

  var requestSeq = 0;
  var activeCompare = null; // {id, gen}
  var activeAudit = null;   // {id, gen}
  var generation = 0;       // 草稿代际（两类任务共用）
  var debounceTimer = null;

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
    if (msg.kind === 'closure') {
      if (!activeAudit || msg.id !== activeAudit.id || activeAudit.gen !== generation) return; // 过期审计回包，丢弃
      activeAudit = null;
      setAuditBusy(false);
      if (!msg.ok) { showAuditFatal(msg.error || '未知错误'); return; }
      renderAudit(msg.result);
      return;
    }
    if (!activeCompare || msg.id !== activeCompare.id || activeCompare.gen !== generation) return; // 过期回包，丢弃
    activeCompare = null;
    setBusy(false);
    if (!msg.ok) { showFatal(msg.error || '未知错误'); return; }
    renderResult(msg.result);
  }
  function onWorkerError() {
    var hadCompare = !!activeCompare, hadAudit = !!activeAudit;
    activeCompare = null;
    activeAudit = null;
    setBusy(false);
    setAuditBusy(false);
    if (hadCompare) showFatal('后台计算线程异常，结论已作废。');
    if (hadAudit) showAuditFatal('后台计算线程异常，审计已作废。');
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
  function setAuditStatus(msg) { els.auditStatus.textContent = msg; }
  function setBusy(b) {
    els.computeBtn.disabled = b;
    els.cancelBtn.disabled = !b;
    if (b) setStatus('计算中…（在浏览器 Worker 内执行，界面保持可交互）');
  }
  function setAuditBusy(b) {
    els.auditBtn.disabled = b;
    if (b) setAuditStatus('闭合审计计算中…（在浏览器 Worker 内执行，界面保持可交互）');
  }
  function invalidatePending() {
    generation++;
    activeCompare = null;
    activeAudit = null;
  }
  function clearResult() {
    els.result.innerHTML = PLACEHOLDER;
    els.result.classList.remove('stale');
  }
  function clearAuditResult() {
    els.auditResult.innerHTML = AUDIT_PLACEHOLDER;
    els.auditResult.classList.remove('stale');
  }
  function markResultStale() {
    if (els.result.innerHTML.indexOf('placeholder') === -1) els.result.classList.add('stale');
  }
  function showFatal(msg) {
    clearResult();
    setStatus('计算失败：' + msg + '（旧结论已清除）');
  }
  function showAuditFatal(msg) {
    clearAuditResult();
    setAuditStatus('审计失败：' + msg + '（旧审计已清除）');
  }

  /* ---------------- 计算调度 ---------------- */
  function postTask(type, input) {
    var id = ++requestSeq;
    worker.postMessage({ id: id, type: type, n: input.n, gensA: input.gensA, gensB: input.gensB });
    return id;
  }
  function rejectInputs() {
    invalidatePending(); // 输入错误：在途旧任务（含旧审计）一律作废
    setBusy(false);
    setAuditBusy(false);
    clearResult();
    clearAuditResult(); // 输入越界：立即清除旧审计
    setStatus('输入存在错误：旧结论已清除，请修正后重新计算。');
    setAuditStatus('输入存在错误：旧审计已清除，请修正后重新发起。');
  }
  function compute() {
    var input = readInputs();
    if (!input.ok) { rejectInputs(); return; }
    activeCompare = { id: postTask('compare', input), gen: generation };
    setBusy(true);
  }
  function computeNow() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    compute();
  }
  function scheduleCompute() {
    invalidatePending();   // 草稿变更：旧请求（含旧审计）一律作废
    markResultStale();     // 旧结论标记为失效（不再可信）
    setBusy(false);
    setAuditBusy(false);
    clearAuditResult();    // 草稿变更：立即清除旧审计，阻止旧任务回包覆盖
    setAuditStatus('草稿已变更：旧审计已清除。');
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(compute, 350);
  }
  function runAudit() {
    var input = readInputs();
    if (!input.ok) { rejectInputs(); return; }
    activeAudit = { id: postTask('closure', input), gen: generation };
    setAuditBusy(true);
    setAuditStatus('');
  }
  function cancel() {
    invalidatePending();   // 取消：进行中的计算与审计结果都将被丢弃
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    setBusy(false);
    setAuditBusy(false);
    clearResult();
    clearAuditResult();
    setStatus('已取消：进行中的计算与旧结论均已作废，不会覆盖当前内容。');
    setAuditStatus('已取消：进行中的闭合审计与旧审计均已作废，不会覆盖当前内容。');
  }

  /* ---------------- 渲染：等价复核 ---------------- */
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

  /* ---------------- 渲染：闭合编织审计 ---------------- */
  function signedTerm(cStr, k) {
    var neg = cStr.charAt(0) === '-';
    var abs = neg ? cStr.slice(1) : cStr;
    var body = (k === 0) ? abs : abs + '·t' + mapDigits(k, SUP);
    return (neg ? '−' : '') + body;
  }
  // 系数链：t^0 起逐项一个 chip；零多项式给出单个零 chip
  function polyChips(poly, differ) {
    var cls = 'chips' + (differ ? ' diffchain' : '');
    if (poly.zero) {
      return '<div class="' + cls + '"><span class="chip identity">0（零多项式）</span></div>';
    }
    var chips = poly.coeffs.map(function (c, k) {
      return '<span class="chip" title="t 的 ' + k + ' 次项系数">' + esc(signedTerm(c, k)) + '</span>';
    });
    return '<div class="' + cls + '">' + chips.join('') + '</div>';
  }
  function fmtCoeffList(poly) {
    return poly.zero ? '0' : poly.coeffs.join(' , ');
  }
  function auditSideBlock(title, side, compsDiffer, polyDiffer) {
    return '<div class="side' + ((compsDiffer || polyDiffer) ? ' diff' : '') + '">' +
      '<h3>' + title + '</h3>' +
      '<div class="kv">闭合分量数：<b>' + side.components + '</b>' +
      (compsDiffer ? '（与对侧不同）' : '') + '</div>' +
      '<h3 class="fp-title">规范化 Alexander 多项式 Δ(t) 系数链</h3>' +
      polyChips(side.poly, polyDiffer) +
      '<div class="coeff-meta">系数链（按 t⁰ 升序）：' + esc(fmtCoeffList(side.poly)) +
      '；项数：' + (side.poly.zero ? 0 : side.poly.coeffs.length) + '</div></div>';
  }
  function renderAudit(r) {
    var html = [];
    var d = r.divergence;
    html.push('<div class="verdict ' + (r.same ? 'fp-same' : 'ne') + '">' +
      (r.same ? '＝ 闭合拓扑指纹相同（该不变量未发现差异）' : '≠ 闭合拓扑指纹不同') + '</div>');
    html.push('<div class="audit-sides">');
    html.push(auditSideBlock('记录 A 闭包', r.sideA, d && d.componentsDiffer, d && d.polyDiffer));
    html.push(auditSideBlock('记录 B 闭包', r.sideB, d && d.componentsDiffer, d && d.polyDiffer));
    html.push('</div>');

    if (r.same) {
      html.push('<div class="fp-note">两侧闭合分量数相同（' + r.sideA.components + '）且规范化 Alexander 多项式' +
        '系数链一致。<strong>该闭包不变量未发现差异，但不能据此宣称两条辫必然等价</strong>' +
        '（Alexander 多项式不区分某些不同的闭包；完整辫等价仍以上方 Garside 规范形复核为准）。</div>');
    } else {
      var lines = [];
      if (d.componentsDiffer) {
        lines.push('闭合分量数不同：记录 A 为 ' + r.sideA.components + '，记录 B 为 ' + r.sideB.components);
      }
      if (d.polyDiffer) {
        lines.push('规范化 Alexander 多项式系数链不同 —— 记录 A：[' + esc(fmtCoeffList(r.sideA.poly)) +
          ']，记录 B：[' + esc(fmtCoeffList(r.sideB.poly)) + ']');
      }
      html.push('<div class="divergence">差异定位（差异侧系数链已在上方红框标出）：' + esc(lines.join('；')) + '。</div>');
      html.push('<div class="fp-note">指纹由闭包的约化 Burau 矩阵精确计算，依据的是闭包不变量，' +
        '而非诱导置换或发生器计数：即使后两者相同，闭包指纹不同仍构成差异证据。</div>');
    }
    if (r.sideA.poly.zero || r.sideB.poly.zero) {
      html.push('<div class="warn">提示：空记录（单位元闭包）或多分量闭包的 Alexander 多项式恒为零，' +
        '此处稳定展示零多项式，分量数仍逐侧给出。</div>');
    }
    els.auditResult.innerHTML = html.join('');
    els.auditResult.classList.remove('stale');
    setAuditStatus('');
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
      setAuditBusy(false);
      clearAuditResult();
      setAuditStatus('');
      computeNow();
    });
  });
  els.strands.addEventListener('keydown', function (e) { if (e.key === 'Enter') computeNow(); });
  [els.recordA, els.recordB].forEach(function (el) {
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); computeNow(); }
    });
  });

  clearResult();
  clearAuditResult();
  computeNow(); // 页面载入即对预置示例给出等价复核结论（审计需手动发起）
})();
