# 文章内容获取、解析与刷新机制优化技术方案

## 目标

基于当前 Firefly Feeds 代码库，对「文章正文获取、文章刷新、图片解析」做一次系统性优化。

目标不是大规模重构，而是简化正文来源模型，提高完整性、稳定性和图片质量，并修复目前已经确认存在的问题。

## 一、核心内容模型

请把文章正文来源明确分成两类：

1. 有 article URL
2. 没有 article URL

规则非常明确：

有 article URL：

- Original page 是正文的首选和权威来源。
- Feed 返回的正文只用于即时展示和 fallback。
- 只要存在 article URL，就允许尝试从原网页获取正文。
- 不再根据 Feed 的 full / summary / truncated 状态决定“是否需要抓原文”。

没有 article URL：

- 直接使用 Feed 提供的内容。
- Feed content 就是这篇文章的 canonical reading body。
- 不做 original extraction。
- 不做 article-level revalidation。
- 不显示 Open original 等依赖 URL 的操作。

也就是说：

有 URL：
Original page > Feed content

没有 URL：
Feed content = canonical content

但注意，“Original page 优先”指数据来源优先级，不代表 UI 必须等待网络。

打开文章时必须优先保证立即可读：

- 如果本地已有原文缓存，立即显示本地缓存。
- 如果只有 Feed 内容，立即显示 Feed 内容。
- 同时后台静默获取 Original page。
- 获取成功后更新缓存。
- 获取失败则继续使用 Feed 内容。

不要为了等待原网页而阻塞文章打开。

## 二、Article identity 和 Article URL 必须彻底分离

Article identity 回答：

“这是不是同一篇文章？”

Article URL 回答：

“从哪里获取原文？”

两者不要混为一谈。

Article identity 建议采用：

Atom：

1. entry.id
2. article alternate URL
3. title + published time
4. stable content fallback

RSS：

1. guid
2. article link
3. title + published time
4. stable content fallback

统一生成：

itemId = hash(identity)
articleId = `${sourceId}~${itemId}`

注意：

- Atom 的 `<id>` 必须作为 publisher-provided stable ID 使用。
- RSS 的 `<guid>` 优先于 URL。
- URL 可以变化，但 publisher id 往往保持稳定。
- 不要使用 item index 作为最终 fallback，因为 Feed 新增文章后 index 会漂移。
- fallback 可以使用 title + publishedAt，必要时再结合 normalized content/summary prefix。

Article URL 单独存储在 link 字段中，用于：

- Original extraction
- Open original
- Article revalidation

不要把 URL 直接当作唯一 Article ID。

## 三、删除旧 Article ID 兼容逻辑

目前还没有真实用户，因此不需要保留旧版本 Article ID 的迁移兼容。

删除类似：

- byLink bridge
- 为旧 ID 保留 recordId 的逻辑
- 相关兼容注释
- 仅为历史 ID 迁移存在的测试

reconcile 时可以直接使用当前正式规则生成的：

`${sourceId}~${itemId}`

不要为了还不存在的用户数据增加永久复杂度。

## 四、正文更新采用整篇替换

不要实现：

- paragraph diff
- block patch
- DOM diff
- incremental content merge
- 为正文更新设计复杂 hash diff

当 Original page 发生变化时：

HTML
→ Readability
→ Block[]
→ 整篇重新生成
→ 替换文章正文相关内容

保持不变：

- article id
- sourceId
- read / saved / later 等 ReadingRecord

可以更新：

- title
- author
- body
- lead image
- reading time
- contentState
- extraction metadata
- freshness metadata

正文是可重新抓取的 cache，不需要做精细 patch。

## 五、Article-level stale-while-revalidate

Source refresh 和 Article refresh 是两套不同生命周期，不要混在一起。

当前已有 Source refresh 机制继续保留，例如：

- 定时 source stale
- startup sweep
- visibility change refresh
- 单 source 手动 refresh
- refresh all

它负责：

- 获取新的 Feed entries
- 更新 Feed metadata
- 更新 Feed fallback content

Article-level refresh 单独负责：

- 用户真正阅读的 Original page 是否发生变化

文章打开时：

情况 A：从未成功获取过 Original page

- 立即显示现有 Feed 内容。
- 后台请求 Original page。
- Readability 成功：保存并使用原文。
- 失败：继续使用 Feed fallback。
- 不弹错误。

情况 B：已有 fresh 的 Original page cache

- 直接使用 IndexedDB。
- 不请求网络。

情况 C：已有 Original page cache，但已经 stale

- 立即显示旧缓存。
- 后台静默 revalidate。
- 成功后更新缓存。
- 失败则保留旧缓存。

不能因为后台刷新失败而破坏当前阅读体验。

## 六、增加 Original content freshness metadata

不要复用现有 ArticleRecord.fetchedAt 判断原网页正文 freshness。

建议增加类似：

contentFetchedAt?: number
contentCheckedAt?: number
etag?: string
lastModified?: string

含义：

contentFetchedAt：
最后一次真正下载并成功替换正文的时间。

contentCheckedAt：
最后一次检查 Original page 是否变化的时间。

etag：
原网页最近一次返回的 ETag。

lastModified：
原网页最近一次返回的 Last-Modified。

增加简单常量：

ARTICLE_STALE_MS

第一版使用固定值即可，例如 6～12 小时。

不要做复杂 adaptive refresh scheduling。

## 七、使用 HTTP Conditional GET

Article stale 后，不要先 HEAD 再 GET。

直接做 conditional GET。

如果已有 ETag：

发送：
If-None-Match

如果没有 ETag，但已有 Last-Modified：

发送：
If-Modified-Since

如果返回 304：

- 不运行 Readability。
- 不重新生成 blocks。
- 不替换正文。
- 只更新 contentCheckedAt。

如果返回 200：

- 获取完整 HTML。
- 运行 Readability。
- 重新生成完整 Block[]。
- 整篇替换正文。
- 更新 ETag。
- 更新 Last-Modified。
- 更新 contentFetchedAt。
- 更新 contentCheckedAt。

如果网站不支持 ETag / Last-Modified：

文章 stale 后正常 GET 即可。

不需要内容 hash 来判断变化。

## 八、失败不能永久锁死

目前如果 extractionState = failed 后永久不再尝试，需要修改。

一次失败可能只是：

- timeout
- 临时 500
- 网络问题
- CDN / Cloudflare 临时问题
- JS challenge
- publisher 暂时不可访问

失败后短时间可以不重复请求，但超过 retry window 后必须允许再次尝试。

例如：

EXTRACTION_RETRY_MS = 12h

可以增加或复用合适的：

extractionCheckedAt / contentCheckedAt

不要因为一次失败永久放弃 Original page。

对于明确长期不可读取的情况，仍然依靠 retry window 控制请求频率即可，不需要设计复杂失败分类系统。

## 九、修复当前明确存在的正文截断问题

当前 htmlToBlocks() 的默认 budget 大约为：

- 60 blocks
- 8,000 chars

这个限制用于 Feed cache 可以接受。

但当前 Readability 提取 Original page 后，也使用了同样默认 budget，因此真正的原文可能在约 8,000 characters 被截断。

并且当前 extraction 可能丢弃 truncated 信息，客户端随后又把内容标成 full。

这会导致：

真实文章很长
→ 被截断
→ 被错误标记为 full
→ UI 显示 End of story

必须修复。

Feed 和 Original article 必须使用不同 budget。

例如：

FEED_BODY_BUDGET

- blocks: 60
- chars: 8_000

ARTICLE_BODY_BUDGET

- blocks: 200
- chars: 50_000

具体数值可以根据实际测试调整，但原则不变：

Original article 的 budget 必须明显高于 Feed budget。

truncated 状态必须从：

article-server
→ API
→ client
→ IndexedDB
→ UI

完整传递。

只有真正没有被截断时，才能：

contentState = "full"

如果达到 article budget：

contentState = "truncated"

UI 不得错误显示 End of story。

## 十、简化 Feed 的 full / summary 判断职责

可以保留目前 Feed parser 对：

- full
- summary
- truncated
- Read more cue
- description / content:encoded

等信息的判断。

但这些判断不再决定：

“要不要抓 Original page？”

新的规则是：

只要有 article URL，就允许抓 Original page。

Feed contentState 只负责：

- fallback 内容本身的语义
- 原网页获取失败时 UI 显示 Excerpt 还是 End of story
- 没 URL 的 feed-native article 如何展示

不要继续为了猜 Feed 是否“真的完整”而增加越来越多启发式规则。

## 十一、图片问题不要通过 IndexedDB Blob/WebP 解决

当前系统实际保存的是图片 URL，而不是图片二进制。

因此本次不要：

- 下载所有图片
- 转 WebP
- 把 100～300KB Blob 存入 ArticleRecord
- 新增 image proxy
- 新增 image cache service
- 为图片引入复杂离线存储

目前低清、错图、重复图的问题主要来自：

图片选择逻辑不够好，而不是压缩。

如果未来需要真正的 offline image cache，再单独考虑 Cache Storage 等方案。

## 十二、改进图片候选解析

当前图片提取需要支持更多现代网页形式，包括：

- src
- srcset
- data-src
- data-srcset
- data-original
- picture > source
- media:content
- media:thumbnail
- enclosure

如果存在 srcset：

不要默认拿最小 thumbnail。

优先选择适合阅读器显示的合理高分辨率版本，例如约 1200～1600px。

不需要强行拿超大 4K 原图。

图片候选需要结合：

- URL
- class
- id
- alt
- width
- height
- srcset descriptor
- aspect ratio

过滤明显不是正文图片的资源，例如：

- avatar
- author
- profile
- logo
- icon
- emoji
- sprite
- tracking pixel
- spacer
- social/share button

不要简单认为：

“HTML 里的第一张 img 就是 lead image。”

## 十三、图片顺序必须来自正文 DOM

Article body 中的图片顺序必须尽量保持 Original page 的真实正文顺序。

不要：

- 把图片全部单独搜出来再重新插入
- 根据尺寸重新排序
- 根据 URL 排序
- 根据抓取顺序之外的规则改变正文顺序

最终 Block[] 中图片与段落顺序应该尽可能反映 Readability 输出后的 DOM 顺序。

## 十四、修复 lead image 重复

目前可能存在：

- blocks 中有第一张 figure
- 同时又把这张 figure 的 src 设置为 Article.image
- ArticlePane 顶部渲染 Article.image
- body 又再次渲染同一张 figure

导致：

标题
图片 A

正文
图片 A

重复。

修复原则：

如果某一个 figure 被确定为 Article lead image：

- 设置为 Article.image。
- 从正文 Block[] 中移除第一个 src 相同的 figure。

不要删除正文中后面可能确实再次出现的图片。

最终：

Article.image
= lead image

Article.body
= 不再重复包含同一个 lead image

## 十五、正文图片基础去重

正文解析过程中，对完全相同的 resolved image URL 做基础去重。

要求：

- 必须是 resolved URL 相同才认为重复。
- 不根据文件名去重。
- 不改变正文图片顺序。
- 不误删不同 URL 的图片。
- lead image 的去重逻辑和正文普通图片去重逻辑保持清晰。

## 十六、阅读体验要求

所有后台 Original page refresh 必须尽量无感。

要求：

- 不清空现有正文。
- 不用 loading 覆盖当前文章。
- 不弹 toast。
- 请求失败不打断用户。
- 不修改 read / saved / later。
- 不让当前滚动位置突然跳动。
- 不出现明显文章闪烁。

如果当前文章已经打开，而后台获取到新版正文后立即替换会导致 scroll jump，则优先使用更稳定的策略：

后台更新 IndexedDB；
当前阅读继续使用旧版本；
下一次打开文章时再显示新版。

不要为了“实时”牺牲阅读体验。

## 十七、IndexedDB migration

ArticleRecord 新增 freshness 字段后，旧数据必须仍然可读。

虽然目前没有正式用户，可以删除旧 Article ID bridge，但普通 schema evolution 仍然应该正确。

旧记录缺少：

- contentFetchedAt
- contentCheckedAt
- etag
- lastModified

时，可以自然视为需要重新检查。

不要因为增加这些字段就强制清空 IndexedDB。

## 十八、保持现有安全边界

不要破坏当前已有：

- SSRF safety
- redirect validation
- request timeout
- response size limit
- rate limit
- same-origin / endpoint guard
- no dangerous publisher HTML injection

Original page 仍然必须：

HTML
→ Readability
→ internal Block[]
→ React render

不要把 publisher raw HTML 直接注入页面。

## 十九、测试要求

请补充或更新测试，至少覆盖：

Article identity：

- Atom entry.id 优先。
- RSS guid 优先。
- URL fallback。
- title + published time fallback。
- 无 URL 但有 publisher ID 的 item 可以正常存在。
- article id 不依赖 Feed position/index。
- 正文更新后 article id 不变化。
- 删除旧 byLink compatibility 后逻辑仍稳定。

URL / Feed fallback：

- 有 URL 时会尝试 Original extraction。
- 即使 Feed contentState = full，有 URL 仍允许获取 Original page。
- 没 URL 时不会调用 /api/article。
- 没 URL 时直接使用 Feed body。
- Original extraction 失败时保留 Feed fallback。

Full-text extraction：

- 超过 8,000 chars 的原文章不会再被错误截断。
- Feed budget 仍保持受限。
- Original article budget 达到上限时正确返回 truncated。
- truncated article 不会标记 full。

Article refresh：

- fresh article 不请求原站。
- stale article 发 conditional request。
- ETag 正确发送 If-None-Match。
- Last-Modified 正确发送 If-Modified-Since。
- 304 不重新解析正文。
- 304 只更新时间。
- 200 重新解析并整篇替换正文。
- refresh failure 保留旧正文。
- failed extraction 在 retry window 后允许再次尝试。

Images：

- srcset 可以选择合理的高分辨率图片。
- data-src / data-srcset 可以识别。
- picture/source 可以识别。
- avatar / logo / tracking pixel 被过滤。
- 正文图片顺序保持。
- lead image 不再在 body 中重复。
- 相同 resolved URL 可以去重。

## 二十、不要做的事情

这次不要引入：

- content diff engine
- paragraph-level patch
- DOM diff
- image Blob persistence
- WebP offline cache
- image proxy
- dedicated image backend
- complex adaptive refresh scheduling
- unnecessary content hash
- 新的全局状态架构
- 为不存在的历史用户数据保留兼容层

优先：

- 简单
- 稳定
- 可测试
- 易理解
- 低耦合
- 延续当前 architecture

## 二十一、最终架构应该保持为

Feed：

- discovery
- metadata
- stream summary
- instant fallback body

Original article：

- preferred reading body
- on-demand extraction
- stale-while-revalidate

无 article URL：

- Feed content 即 canonical reading body

有 article URL：

- Original page 为 preferred source
- Feed content 为 fallback

Article identity：

- publisher-provided stable id 优先
- 与 article URL 分离
- 与正文内容分离

Article body：

- disposable
- refreshable
- 整篇替换的 local cache

IndexedDB：

- sources
- article cache
- reading state

Reading state：

- 独立于 article body
- 正文更新不得影响 read / saved / later

完成修改后：

1. 运行项目现有的 good / check、tests、lint、typecheck。
2. 修复本次修改暴露出的相关问题。
3. 检查 README、ARCHITECTURE、STORAGE 等相关文档是否与新实现冲突。
4. 只修改真正需要同步的文档，不要顺带大改 README。
5. 最后简要汇报：
   - 实际修改了什么
   - Article identity 最终规则
   - Original / Feed fallback 最终流程
   - Article refresh 最终流程
   - 图片解析改进
   - 数据结构变化
   - 测试结果
