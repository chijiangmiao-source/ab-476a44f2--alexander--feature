/*
 * app.js — 主线程：输入校验、Worker 调度、结论渲染。
 *
 * 防过期覆盖契约：
 *  - generation 随任何草稿变更 / 取消而递增；
 *  - 每次计算携带 (id, gen)，Worker 回包时若与当前活动请求不符则直接丢弃；
 *  - 因此草稿变更或取消后，旧结果绝不会覆盖新内容。
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
  };

  var PLACEHOLDER =
    '<p class="placeholder">填写两条记录后自动计算，也可点击「计算等价性」。空记录表示单位元（未发生任何交叉）。</p>';

  var SAMPLES = {
    '1': { n: '4', a: 'σ1 σ3', b: 'σ3 σ1' },
    '2': { n: '3', a: 'σ1 σ2 σ1', b: 'σ2 σ1 σ2' },
    '3': { n: '2', a: 'σ1 σ1', b: '' },
  };

  var requestSeq = 0;
  var activeRequest = null; // {id, gen}
  var generation = 0;       // 草稿代际
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
    if (!activeRequest || msg.id !== activeRequest.id || activeRequest.gen !== generation) return; // 过期回包，丢弃
    activeRequest = null;
    setBusy(false);
    if (!msg.ok) { showFatal(msg.error || '未知错误'); return; }
    renderResult(msg.result);
  }
  function onWorkerError() {
    if (activeRequest) {
      activeRequest = null;
      setBusy(false);
      showFatal('后台计算线程异常，结论已作废。');
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
    els.cancelBtn.disabled = !b;
    if (b) setStatus('计算中…（在浏览器 Worker 内执行，界面保持可交互）');
  }
  function invalidatePending() {
    generation++;
    activeRequest = null;
  }
  function clearResult() {
    els.result.innerHTML = PLACEHOLDER;
    els.result.classList.remove('stale');
  }
  function markResultStale() {
    if (els.result.innerHTML.indexOf('placeholder') === -1) els.result.classList.add('stale');
  }
  function showFatal(msg) {
    clearResult();
    setStatus('计算失败：' + msg + '（旧结论已清除）');
  }

  /* ---------------- 计算调度 ---------------- */
  function compute() {
    var input = readInputs();
    if (!input.ok) {
      invalidatePending();
      setBusy(false);
      clearResult(); // 输入错误：清除旧结论
      setStatus('输入存在错误：旧结论已清除，请修正后重新计算。');
      return;
    }
    var id = ++requestSeq;
    activeRequest = { id: id, gen: generation };
    setBusy(true);
    worker.postMessage({ id: id, n: input.n, gensA: input.gensA, gensB: input.gensB });
  }
  function computeNow() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    compute();
  }
  function scheduleCompute() {
    invalidatePending();   // 草稿变更：旧请求一律作废
    markResultStale();     // 旧结论标记为失效（不再可信）
    setBusy(false);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(compute, 350);
  }
  function cancel() {
    invalidatePending();   // 取消：进行中的计算结果将被丢弃
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    setBusy(false);
    clearResult();
    setStatus('已取消：进行中的计算与旧结论均已作废，不会覆盖当前内容。');
  }

  /* ---------------- 渲染 ---------------- */
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

  /* ---------------- 事件 ---------------- */
  [els.strands, els.recordA, els.recordB].forEach(function (el) {
    el.addEventListener('input', scheduleCompute);
  });
  els.computeBtn.addEventListener('click', computeNow);
  els.cancelBtn.addEventListener('click', cancel);
  document.querySelectorAll('[data-sample]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var s = SAMPLES[btn.getAttribute('data-sample')];
      if (!s) return;
      els.strands.value = s.n;
      els.recordA.value = s.a;
      els.recordB.value = s.b;
      invalidatePending();
      computeNow();
    });
  });
  els.strands.addEventListener('keydown', function (e) { if (e.key === 'Enter') computeNow(); });
  [els.recordA, els.recordB].forEach(function (el) {
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) computeNow(); });
  });

  clearResult();
  computeNow(); // 页面载入即对预置示例给出结论
})();
