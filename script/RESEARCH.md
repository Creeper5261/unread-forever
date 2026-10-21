# 研究：怎样拿到互动详情，又不推进已读游标

日期：2026-10-21 ｜ 账号：本人测试号 ｜ 结论先行：**可以，前提是列表请求必须带 `id` 参数。**

---

## 1. 结论

`/x/msgfeed/like`、`/x/msgfeed/reply`、`/x/msgfeed/at` 这三个接口有两种行为：

| 请求形态 | 服务端理解 | 是否推进已读游标 |
| --- | --- | --- |
| 不带 `id` | “用户打开了消息标签页” | **会**，`last_view_at` 立刻推到当前时间，红点归零 |
| 带 `id`（任意值） | “用户在往下翻页” | **不会**，只返回数据 |

因此：**第一页用一个比所有真实消息 id 都大的合成 id**（`9000000000000000000`），
服务端就会返回最新一页，同时完全不碰已读状态；后续翻页用返回的 `cursor.id`，同样安全。

工具里这条规则是强制的：`feedPage()` 没有 `id` 会直接抛错，连请求都不会发出去。

---

## 2. 怎么发现的

### 2.1 先看网页端到底调了什么

消息中心是独立前端 `message.bilibili.com`，主 bundle：

```
https://s1.hdslb.com/bfs/static/2233-monorepo/message-pc/static/js/index.beee4580.js
```

在里面搜 `msgfeed`，能定位到统一的请求封装：

```js
// 简化后的原代码
iw = (type, params = {}) => im.request({
  url: `/x/msgfeed/${type}`,
  params: { ...params, platform: 'web', build: 0, mobi_app: 'web' },
})
```

三个列表就是 `iw('like'|'reply'|'at')`。**整个 bundle 里没有任何“标记已读”的请求**：

- `msgfeed/update_cursor`、`msgfeed/read`、`msgfeed/mark_read` 都不存在（实测也是 404）；
- 唯一的 POST 是 `msgfeed/notice`（单条“不再通知”）和 `msgfeed/del`（删除）。

所以清理红点这件事，只可能是列表请求本身干的。

### 2.2 用 `last_view_at` 当探针

列表响应里带着 `data.last_view_at`（点赞在 `data.latest.last_view_at`）。
它记录“上次看到哪儿”，如果一次请求之后它变了，就说明这次请求推进了游标。

实测（时间戳为秒）：

```
第 1 次 GET like            → last_view_at = 1792568709   (now-1，是上一次的旧值)
300ms 后 GET /unread        → 未读仍为 0
2.5s 后 第 2 次 GET like    → last_view_at = 1792568711   (≈ 第 1 次请求的时间)
```

第二次拿到的值变成了第一次请求的时间 —— **每请求一次，游标就往前走一次**。

### 2.3 换客户端变体也没用

| 变体 | 结果 |
| --- | --- |
| `mobi_app=web&platform=web` | 推进 |
| `mobi_app=android&platform=android` | 推进 |
| `mobi_app=iphone&platform=iphone` | 推进 |
| 只带 `mobi_app=web`（无 platform） | 推进 |
| 只带 `build=0` | 推进 |
| 不带 Referer / Origin | 推进 |
| 补 `statistics={"appId":182}` | 推进 |
| 补 `web_location=333.7` | 推进 |
| `peek=1` / `read=0` / `no_read=1` | 推进 |

也就是说，换平台、换头、猜参数都躲不开。

### 2.4 关键：带 `id` 的请求不推进

对比同一接口的两种调用：

```
page1（不带 id）        → last_view_at 从 1792568967 变成 1792568989（推进了）
page2（带 cursor.id）   → 再取 page1，last_view_at 仍是 1792568989（没动）
```

于是想到：如果传一个**比所有消息都大的 id**，服务端会从“最新”开始返回，
但它依然认为是翻页。

```
GET /x/msgfeed/like?id=9000000000000000000&like_time=<now>
  → 返回 20 条，首条 id 与正常第一页完全一致
  → 连续调用两次，last_view_at 都是 1792569007，纹丝不动
```

`reply` 用同样方法验证（`id` + `reply_time`），拿到相同首条、20 条数据，
并且之后用无 id 请求检查，`last_view_at` 仍停在**带 id 请求之前**的时间 —— 没有推进。

`at` 的响应本来就不返回 `last_view_at`，但用交叉验证：
调用 `at` 前后，`reply` 的游标完全没变；且 `at` 的响应结构与前两者一致（`cursor` + `items`）。

---

## 3. 最终采用的请求方式

```text
第一页：?id=9000000000000000000&<timeKey>=<now>&build=0&mobi_app=web&platform=web
后续页：?id=<上页 cursor.id>&<timeKey>=<cursor.time>&build=0&mobi_app=web&platform=web
```

`timeKey`：`like_time` / `reply_time` / `at_time`。

三点注意：

1. **绝不能省略 `id`**（`core.js` 里只改写、不删除参数；服务端行为变了要重新验证）。
2. 合成 id 必须大于真实 id；当前真实 id 约 1.1e15，9e18 有足够余量。
3. 插件右下角会显示拦截次数，可以随时确认它在工作。

---

## 4. 复现方式

```bash
BILI_COOKIE="SESSDATA=..." node script/probe.mjs
```

脚本会连续发两次「带合成 id」的请求，比较返回里的 `last_view_at`：
相同即说明游标没动。加 `--unsafe` 会额外发一次不带 `id` 的请求做对照，
那一次会真的清掉「收到的赞」红点，慎用。
