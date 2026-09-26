/*
 * worker.js — 复核计算线程：所有辫群归约均在此 Worker 内执行，
 * 主线程只负责收发消息，保证页面交互不被阻塞。
 */
/* global Braid */
importScripts('braid.js');

self.onmessage = function (e) {
  var msg = e.data || {};
  var id = msg.id, n = msg.n, gensA = msg.gensA, gensB = msg.gensB;
  try {
    var result = Braid.compare(n, gensA, gensB);
    self.postMessage({ id: id, ok: true, result: result });
  } catch (err) {
    self.postMessage({ id: id, ok: false, error: String((err && err.message) || err) });
  }
};
