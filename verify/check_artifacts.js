/*
 * check_artifacts.js — 检查页面构建产物：静态资源必须已由 web 服务正确提供。
 */
'use strict';
var BASE = (process.env.WEB_URL || 'http://web').replace(/\/+$/, '');
var failed = 0;

function expectAsset(path, substrings) {
  return fetch(BASE + path)
    .then(function (res) {
      return res.text().then(function (text) {
        if (res.status !== 200) throw new Error('HTTP ' + res.status);
        if (text.length < 50) throw new Error('内容过短（' + text.length + ' 字节）');
        substrings.forEach(function (s) {
          if (text.indexOf(s) === -1) throw new Error('缺少关键片段「' + s + '」');
        });
        console.log('  ok   - ' + path + '（' + text.length + ' 字节）');
      });
    })
    .catch(function (e) {
      failed++;
      console.error('  FAIL - ' + path + ': ' + e.message);
    });
}

Promise.resolve()
  .then(function () { return expectAsset('/', ['braid.js', 'app.js', '光纤根数']); })
  .then(function () { return expectAsset('/braid.js', ['normalForm', 'normalizePair']); })
  .then(function () { return expectAsset('/worker.js', ['importScripts', 'onmessage']); })
  .then(function () { return expectAsset('/app.js', ['new Worker', 'generation']); })
  .then(function () {
    if (failed) {
      console.error('页面构建产物检查失败（' + failed + ' 项）');
      process.exit(1);
    }
    console.log('页面构建产物检查通过');
  });
