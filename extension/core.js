/**
 * unread-forever 扩展核心逻辑（浏览器 / Node 通用）。
 *
 * 作用：把 B 站消息中心发出的
 *   GET /x/msgfeed/like|reply|at        ← 不带 id，服务端会推进已读游标
 * 改写成
 *   GET /x/msgfeed/like|reply|at?id=9000000000000000000&like_time=...
 * 服务端只会当成“往下翻页”，数据照常返回，已读状态不动。
 */
(function () {
  'use strict';

  var SYNTHETIC_ID = '9000000000000000000';
  var TIME_KEY = { like: 'like_time', reply: 'reply_time', at: 'at_time' };
  var FEED_PATH = /^\/x\/msgfeed\/(like|reply|at)\/?$/;
  var BILI_HOST = /(^|\.)bilibili\.com$/i;
  var HOOKED = '__unreadForeverHooked__';

  function rewriteFeedUrl(raw, options) {
    var opts = options || {};
    var now = typeof opts.now === 'function' ? opts.now : Date.now;
    var base =
      opts.base ||
      (typeof location !== 'undefined' && location.href) ||
      'https://message.bilibili.com/';

    var url;
    try {
      url = new URL(String(raw), base);
    } catch (err) {
      return null;
    }

    if (!BILI_HOST.test(url.hostname)) return null;

    var match = FEED_PATH.exec(url.pathname);
    if (!match) return null;

    // 已经带 id：说明是翻页请求，本来就不会推进游标，放行。
    if (url.searchParams.has('id')) return null;

    var type = match[1];
    url.searchParams.set('id', SYNTHETIC_ID);
    if (!url.searchParams.has(TIME_KEY[type])) {
      url.searchParams.set(TIME_KEY[type], String(Math.floor(now() / 1000)));
    }

    return { url: url.toString(), type: type };
  }

  function installHooks(win, options) {
    var opts = options || {};
    if (!win) return null;
    if (win[HOOKED]) return win[HOOKED];

    var stats = { count: 0, byType: { like: 0, reply: 0, at: 0 } };

    function hit(type) {
      stats.count += 1;
      stats.byType[type] = (stats.byType[type] || 0) + 1;
      if (typeof opts.onRewrite === 'function') {
        try {
          opts.onRewrite({ type: type, count: stats.count, stats: stats });
        } catch (err) {
          /* 回调出错不影响页面 */
        }
      }
    }

    function base() {
      return (win.location && win.location.href) || undefined;
    }

    function tryRewrite(raw) {
      var result = rewriteFeedUrl(raw, { base: base(), now: opts.now });
      if (result) hit(result.type);
      return result ? result.url : raw;
    }

    var origFetch = win.fetch;
    if (typeof origFetch === 'function') {
      win.fetch = function (input, init) {
        try {
          if (typeof input === 'string' || (win.URL && input instanceof win.URL)) {
            input = tryRewrite(String(input));
          } else if (input && typeof input === 'object' && typeof input.url === 'string') {
            var rewritten = tryRewrite(input.url);
            if (rewritten !== input.url) {
              input = new Request(rewritten, input);
            }
          }
        } catch (err) {
          /* 保持原请求 */
        }
        return origFetch.call(this, input, init);
      };
    }

    var XHR = win.XMLHttpRequest;
    if (XHR && XHR.prototype && typeof XHR.prototype.open === 'function') {
      var origOpen = XHR.prototype.open;
      XHR.prototype.open = function (method, url) {
        var args = Array.prototype.slice.call(arguments);
        try {
          args[1] = tryRewrite(String(url));
        } catch (err) {
          /* 保持原请求 */
        }
        return origOpen.apply(this, args);
      };
    }

    var api = {
      stats: stats,
      rewrites: function () {
        return stats.count;
      },
    };
    try {
      Object.defineProperty(win, HOOKED, { value: api, configurable: true });
    } catch (err) {
      /* 某些环境不允许扩展 window，忽略 */
    }
    return api;
  }

  var core = {
    SYNTHETIC_ID: SYNTHETIC_ID,
    rewriteFeedUrl: rewriteFeedUrl,
    installHooks: installHooks,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  try {
    globalThis.UnreadForeverCore = core;
  } catch (err) {
    /* ignore */
  }
})();
