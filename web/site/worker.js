/*
 * worker.js — 复核计算线程：所有辫群归约均在此 Worker 内执行，
 * 主线程只负责收发消息，保证页面交互不被阻塞。
 *
 * 支持两类任务（msg.kind）：
 *   - 'compare'：Garside 规范形等价复核（既有）；
 *   - 'audit'  ：闭合编织审计（约化 Burau → 闭包 Alexander 指纹）。
 * 两类回包均携带 id，由主线程按 (id, generation) 校验，过期即丢弃。
 */
/* global Braid */
importScripts('braid.js');

self.onmessage = function (e) {
  var msg = e.data || {};
  var id = msg.id, n = msg.n, gensA = msg.gensA, gensB = msg.gensB;
  try {
    var result;
    if (msg.kind === 'audit') {
      result = Braid.auditClosures(n, gensA, gensB);
    } else {
      result = Braid.compare(n, gensA, gensB);
    }
    self.postMessage({ id: id, kind: msg.kind || 'compare', ok: true, result: result });
  } catch (err) {
    self.postMessage({ id: id, kind: msg.kind || 'compare', ok: false, error: String((err && err.message) || err) });
  }
};
