# script —— 验证脚本与实验记录

这个目录和插件运行无关，只是把「怎么确认 B 站列表接口会推游标、又怎么绕开」的过程留个底。
全部是纯 Node 脚本，不需要 npm、不需要装依赖。

## 文件

| 文件 | 作用 |
| --- | --- |
| `RESEARCH.md` | 完整实验记录：从 bundle 定位接口、`last_view_at` 探针、无效变体清单、`id` 开关 |
| `probe.mjs` | 实测脚本：对比「不带 id」和「带合成 id」两种请求对已读游标的影响 |
| `test-core.mjs` | `core.js` 的断言测试（URL 改写、fetch/XHR 挂钩），`node script/test-core.mjs` 直接跑 |

## 复现

```bash
export BILI_COOKIE="SESSDATA=..."   # PowerShell: $env:BILI_COOKIE="SESSDATA=..."
node script/test-core.mjs           # 纯逻辑，不需要 Cookie
node script/probe.mjs               # 需要 Cookie；会读一次列表验证游标是否变化
```

`probe.mjs` 默认只发「带 id」的安全请求，不会清红点。
加 `--unsafe` 才会发一次不带 `id` 的请求做对照——**那一次会把对应分类的红点清掉**，慎用。

## 实验过程（简版）

1. 抓 `message.bilibili.com` 的主 bundle，确认前端没有任何“标记已读”的请求；
   只有 `/x/msgfeed/like|reply|at` 三个列表 GET。
2. 用响应里的 `last_view_at` 当探针：不带 `id` 连调两次，第二次返回的时间戳变成了第一次请求的时间
   —— 证明是列表请求本身在推进游标。
3. 把客户端变体试了一遍（android / iphone / 无 platform / 无 Referer / `statistics` / `web_location` /
   `peek=1` / `read=0`），**全部推进**。
4. 换成带 `id` 的请求：连续两次调用 `last_view_at` 完全相同，返回的首条与正常首页一致
   —— 数据照拿，游标不动。
5. 用超大 `id` 当第一页游标，就能在“翻页”语义下拿到最新 20 条。

细节（含时间戳、请求参数、被否掉的假设）见 [RESEARCH.md](RESEARCH.md)。
