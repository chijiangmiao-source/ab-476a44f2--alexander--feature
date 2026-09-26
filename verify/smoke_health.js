/*
 * smoke_health.js — 对健康路径执行 HTTP 冒烟（带有限次重试）。
 */
'use strict';
var BASE = (process.env.WEB_URL || 'http://web').replace(/\/+$/, '');

function attempt(n) {
  return fetch(BASE + '/healthz')
    .then(function (res) {
      return res.text().then(function (body) {
        if (res.status === 200 && /ok|available|healthy/i.test(body)) {
          console.log('  ok   - /healthz → ' + res.status + ' ' + body.trim());
          console.log('健康路径 HTTP 冒烟通过');
          process.exit(0);
        }
        throw new Error('HTTP ' + res.status + ': ' + body.trim());
      });
    })
    .catch(function (e) {
      if (n >= 10) {
        console.error('健康路径 HTTP 冒烟失败: ' + e.message);
        process.exit(1);
      }
      return new Promise(function (resolve) { setTimeout(resolve, 1000); }).then(function () {
        return attempt(n + 1);
      });
    });
}

attempt(1);
