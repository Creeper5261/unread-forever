#!/usr/bin/env node
/**
 * 实测：B 站的消息列表请求，带不带 `id` 对已读游标的影响。
 *
 *   node script/probe.mjs              # 只发带 id 的安全请求
 *   node script/probe.mjs --unsafe     # 额外发一次不带 id 的请求做对照（会清红点！）
 *
 * Cookie 通过环境变量 BILI_COOKIE 或 --cookie 传入。
 * 没有任何依赖，Node 18+ 直接跑。
 */

import process from 'node:process';

const SYNTHETIC_ID = '9000000000000000000';
const TYPE = 'like';
const TIME_KEY = { like: 'like_time', reply: 'reply_time', at: 'at_time' };

const args = process.argv.slice(2);
const unsafe = args.includes('--unsafe');
const cookieArg = args.find((a) => a.startsWith('--cookie='))?.slice('--cookie='.length);
const cookie = process.env.BILI_COOKIE || cookieArg || '';

if (!cookie) {
  console.error('缺少 Cookie。用法：');
  console.error('  BILI_COOKIE="SESSDATA=..." node script/probe.mjs');
  process.exit(1);
}

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
  Cookie: cookie,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);

async function get(base, path, params) {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: 'HTML', status: res.status };
  }
}

async function unread() {
  const res = await get('https://api.vc.bilibili.com', '/x/im/web/msgfeed/unread', { build: 0, mobi_app: 'web' });
  return res.code === 0 ? res.data : { error: res.code };
}

const feed = (extra) =>
  get('https://api.bilibili.com', `/x/msgfeed/${TYPE}`, {
    build: 0,
    mobi_app: 'web',
    platform: 'web',
    ...extra,
  });

const lastViewAt = (res) => res?.data?.latest?.last_view_at ?? res?.data?.last_view_at ?? null;

const pad = (s, n) => String(s).padEnd(n);

console.log('目标：/x/msgfeed/' + TYPE + '（' + (unsafe ? '含危险对照' : '仅安全请求') + '）\n');

const u0 = await unread();
console.log('未读数（开始）:', u0);

// 1) 带 id 的两次请求
const safe1 = await feed({ id: SYNTHETIC_ID, [TIME_KEY[TYPE]]: now() });
const t1 = now();
await sleep(2000);
const safe2 = await feed({ id: SYNTHETIC_ID, [TIME_KEY[TYPE]]: now() });
const t2 = now();

const items = safe1?.data?.total?.items ?? safe1?.data?.items ?? [];
console.log('\n[安全请求] 带 id');
console.log('  code       :', safe1.code);
console.log('  条目数     :', items.length);
console.log('  last_view_at:', lastViewAt(safe1), '→', lastViewAt(safe2));
console.log('  两次是否一致:', lastViewAt(safe1) === lastViewAt(safe2) ? '是（游标没动）' : '否（游标被推进）');
console.log('  当前时间   :', t1, '/', t2);

// 2) 可选：不带 id 的危险对照
if (unsafe) {
  console.log('\n[危险对照] 不带 id —— 这一步会把「收到的赞」的红点清掉');
  const before = await unread();
  const res = await feed({});
  await sleep(2000);
  const after = await unread();
  console.log('  code        :', res.code);
  console.log('  未读 before :', before);
  console.log('  未读 after  :', after);
  console.log('  last_view_at:', lastViewAt(res));

  const probe = await feed({ id: SYNTHETIC_ID, [TIME_KEY[TYPE]]: now() });
  console.log('  再读一次带 id 的 last_view_at:', lastViewAt(probe), '（应≈危险请求的时间）');
}

console.log('\n结论：带 id 的请求不改变已读游标；不带 id 的请求会推进它。');
