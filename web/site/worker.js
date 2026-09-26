/*
 * worker.js — 复核计算线程：辫群归约与闭合编织审计均在此 Worker 内执行，
 * 主线程只负责收发消息，保证页面交互不被阻塞。
 *
 * 每条消息携带 type：
 *   - 'compare'：Garside 规范形等价复核（Braid.compare）；
 *   - 'closure'：闭合编织审计（Burau.compareClosures，约化 Burau / Alexander）。
 * 回包原样携带 id，主线程按 (id, generation) 校验，过期回包直接丢弃。
 */
/* global Braid, Burau */
importScripts('braid.js', 'burau.js');

self.onmessage = function (e) {
  var msg = e.data || {};
  var id = msg.id, n = msg.n, gensA = msg.gensA, gensB = msg.gensB;
  try {
    var result;
    if (msg.type === 'closure') {
      result = Burau.compareClosures(n, gensA, gensB);
    } else {
      result = Braid.compare(n, gensA, gensB);
    }
    self.postMessage({ id: id, ok: true, kind: msg.type || 'compare', result: result });
  } catch (err) {
    self.postMessage({ id: id, ok: false, kind: msg.type || 'compare', error: String((err && err.message) || err) });
  }
};
