/**
 * 在页面里安装请求改写 + 右下角状态标。
 * 由 manifest 在 document_start 时以 MAIN world 注入，早于 B 站自己的脚本。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var core = window.UnreadForeverCore;
  if (!core) return;

  var count = 0;
  var badge = null;

  function label() {
    return count > 0 ? '红点守护中 · 已拦截 ' + count + ' 次' : '红点守护中';
  }

  function paint() {
    if (badge) badge.textContent = label();
  }

  function mount() {
    if (badge || !document.body) return;
    badge = document.createElement('div');
    badge.id = 'unread-forever-badge';
    badge.textContent = label();
    badge.title = 'unread-forever：列表请求已改写为翻页请求，B 站不会推进已读游标。';
    badge.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483000',
      'padding:5px 10px',
      'border-radius:999px',
      'font:12px/1.4 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      'color:#fb7299',
      'background:rgba(20,18,26,.82)',
      'border:1px solid rgba(251,114,153,.45)',
      'box-shadow:0 4px 18px rgba(0,0,0,.35)',
      'pointer-events:none',
      'user-select:none',
      'backdrop-filter:blur(6px)',
    ].join(';');
    document.body.appendChild(badge);
  }

  core.installHooks(window, {
    onRewrite: function (event) {
      count = event.count;
      paint();
    },
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
