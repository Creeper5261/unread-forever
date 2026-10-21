#!/usr/bin/env node
/**
 * core.js 的断言测试。零依赖，不需要 npm：
 *
 *   node script/test-core.mjs
 */

import assert from 'node:assert/strict';
import '../extension/core.js';

const core = globalThis.UnreadForeverCore;
const NOW = 1_700_000_000_000;
const now = () => NOW;
const rewrite = (url, base = 'https://message.bilibili.com/') => core.rewriteFeedUrl(url, { base, now });

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}`);
  }
}

console.log('core.js');

test('点赞：补合成 id 和 like_time，原参数保留', () => {
  const r = rewrite('https://api.bilibili.com/x/msgfeed/like?platform=web&build=0&mobi_app=web');
  assert.equal(r.type, 'like');
  const u = new URL(r.url);
  assert.equal(u.searchParams.get('id'), '9000000000000000000');
  assert.equal(u.searchParams.get('like_time'), '1700000000');
  assert.equal(u.searchParams.get('platform'), 'web');
});

test('回复 / @ 使用各自的 time 参数', () => {
  const reply = rewrite('https://api.bilibili.com/x/msgfeed/reply?platform=web');
  const at = rewrite('https://api.bilibili.com/x/msgfeed/at?platform=web');
  assert.equal(new URL(reply.url).searchParams.get('reply_time'), '1700000000');
  assert.equal(new URL(at.url).searchParams.get('at_time'), '1700000000');
});

test('已有 id 的翻页请求放行', () => {
  assert.equal(rewrite('https://api.bilibili.com/x/msgfeed/like?id=123&like_time=1'), null);
});

test('其它路径 / 域名不碰', () => {
  assert.equal(rewrite('https://api.bilibili.com/x/msgfeed/unread'), null);
  assert.equal(rewrite('https://api.bilibili.com/x/web-interface/nav'), null);
  assert.equal(rewrite('https://example.com/x/msgfeed/like'), null);
});

test('相对路径按当前页面解析', () => {
  const r = rewrite('/x/msgfeed/at?build=0', 'https://message.bilibili.com/message');
  assert.match(r.url, /^https:\/\/message\.bilibili\.com\/x\/msgfeed\/at\?/);
});

// fetch / XHR 挂钩
function fakeWindow() {
  const calls = [];
  return {
    calls,
    win: {
      location: { href: 'https://message.bilibili.com/' },
      URL,
      Request,
      fetch: async (input) => {
        calls.push(typeof input === 'string' ? input : input.url);
        return { ok: true };
      },
      XMLHttpRequest: class {
        open(_method, url) {
          calls.push(url);
        }
        send() {}
      },
    },
  };
}

test('fetch 被改写并计数', () => {
  const { win, calls } = fakeWindow();
  const api = core.installHooks(win, { now });
  // 同步断言：fetch 内部同步改写，返回的 Promise 不用等
  win.fetch('https://api.bilibili.com/x/msgfeed/like?platform=web');
  win.fetch('https://api.bilibili.com/x/msgfeed/unread');
  assert.equal(calls.length, 2);
  assert.match(calls[0], /[?&]id=9000000000000000000/);
  assert.equal(calls[1], 'https://api.bilibili.com/x/msgfeed/unread');
  assert.equal(api.rewrites(), 1);
});

test('XHR（axios 走的路径）被改写', () => {
  const { win, calls } = fakeWindow();
  const api = core.installHooks(win, { now });
  const xhr = new win.XMLHttpRequest();
  xhr.open('GET', 'https://api.bilibili.com/x/msgfeed/reply?platform=web');
  assert.match(calls[0], /[?&]id=9000000000000000000/);
  assert.match(calls[0], /[?&]reply_time=1700000000/);
  assert.equal(api.stats.byType.reply, 1);
});

test('重复注入不会重复包裹', () => {
  const { win } = fakeWindow();
  assert.equal(core.installHooks(win, { now }), core.installHooks(win, { now }));
});

test('onRewrite 收到类型和次数', () => {
  const { win } = fakeWindow();
  const events = [];
  core.installHooks(win, { now, onRewrite: (e) => events.push([e.type, e.count]) });
  win.fetch('https://api.bilibili.com/x/msgfeed/at?platform=web');
  win.fetch('https://api.bilibili.com/x/msgfeed/like?platform=web');
  assert.deepEqual(events, [
    ['at', 1],
    ['like', 2],
  ]);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error('\n' + f.name + '\n', f.err);
  process.exit(1);
}
