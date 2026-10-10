# Feature Brief: 今日导读（Today's Briefing）

> 状态：草案，待评审 · 阶段：P0 · 关联：[ai-auto-classify.md](ai-auto-classify.md)、
> [../ARCHITECTURE.md](../ARCHITECTURE.md)、[../STORAGE.md](../STORAGE.md)、[../DESIGN.md](../DESIGN.md)
>
> v0.2：传输层定为**常规 LLM 接口 + BYOK**（OpenAI 兼容 / Anthropic 兼容 / 本地
> Ollama），不再复用决策 transport。第七节整体重写，5.5 / 5.6 / 六 / 八 / 九 / 十二 /
> 十三 / 十四 随改。
>
> v0.3：provider 配置精简。精选的服务**地址写死在表里**，读者只选模型、填 key；只有
> 「自定义」才需要选格式 + 填地址。5.5 与 7.1 重写。

---

## 一、现状（先对齐）

**已经有的**

- **Today 视图**是落地页：`view === "today"`，按发布时间排序的 stream（`lib/store.tsx`
  的 `filtered` / `listed`，`minutesAgo < 60 * 24`），头部是 `SMART_HEAD.today`。
- **文章分类**已经打通了整条 AI 链路：`lib/classify.ts` 的 transport 表 →
  `POST /api/classify` 代理 → store 里的串行 sweep。opt-in、local-first、凭证只存在于
  本机 prefs、服务端零 secret。
- **决策模型能力**：System One 封闭选择（一个 slug + 一个置信度出）。四家 transport：
  OpenAI Decisions、Cloudflare Workers AI、TypeSafe (Jev)、本地 Ollama。
- **阅读语义**：读到底才算读；未读数是一个队列，不是日志。

**缺的**

- 没有任何"今天该读什么"的编辑性入口。Today 只是时间倒序的列表，读者仍然要自己
  在几十行里做筛选。
- **没有常规 LLM 传输层。**现有四家 transport 只会做封闭选择，不会写字；本 brief
  需要的是 chat completions 这一侧的能力，而且要让读者**自带 key**（BYOK）接自己的
  OpenAI 兼容或 Anthropic 兼容服务。这是第七节的主体，也是 P0 最大的一块新基建。
- 从此分类与导读是**两套 provider 配置**：分类继续用决策模型（便宜、封闭集合、精确），
  导读用常规 LLM。二者共用同一个 AI 设置区，但不共用配置。

---

## 二、问题与目标

订阅量上去之后，读者每天面对的是几十条未读，成本不在"读"，而在**决定读哪几条**。
今天的工具把这件事完全留给了人。

**P0 结束时为真**

1. 读者在 3 分钟内知道今天有什么值得读，且每一条都能在一行之内判断要不要点开。
2. 整个过程一次点击可关；关掉之后，产品与现在**完全一致**。
3. AI 产出的每一行都能在 5 秒内被验证没有编造——因为它只来自那篇自己的标题和摘要。

**非目标（明确不做）**

- 不做列表页逐篇文章的一句话摘要 → P1（每篇一次调用，成本与目标 1 不成比例）
- 不做看点/情感/观点标签 → P1（那个用决策模型做，便宜，但需要新的行 UI）
- 不做同源事件聚类、对话式提问 → P2
- 不做云端兴趣画像、账号、同步产品化
- **不改变 stream 的 `layout` 选型**——与文章分类当初的决定一致：AI 不决定一篇
  故事在版面上占多大地方

**写死的原则（后续所有取舍都回到这五条）**

1. **AI 压缩决策成本，不压缩阅读本身。**导读只回答"读什么、为什么"，永远不替代原文，
   永远不给"结论版"。
2. **一日一版。**同一天只有一版导读，像报纸。不随刷新跳动，不做实时信息流。
3. **Grounding。**只用标题和摘要写；写不出来就不写，不留半截。
4. **默认关闭，失败可见，阅读不受阻。**
5. **不新开一套 AI 视觉。**纸感、发丝线、衬线、mono 元数据，accent 色仍然只用在
   它有含义的地方。

---

## 三、P0 范围

**范围内**

1. **今日导读页面**：独立视图（导航 Edition → Briefing），5 条入选，每条一行 gist +
   一行 why。
2. **一日一版 + 候选指纹**：候选变化只标记 stale，不自动重写。
3. **手动 Regenerate**：带每日上限。
4. **设置**：AI 开关组里新增「Today's briefing」开关 + 一套独立的 **LLM provider
   配置（BYOK）**：精选服务只填模型和 key，自定义才选格式 + 填地址。
5. **存储**：新增 `digests` store（DB v3，additive）。
6. **接口**：`POST /api/digest`（服务端写 prompt、转发、只回文本）、
   `GET /api/digest/models`（列本地 Ollama 会聊天的模型）。

**范围外（推迟，附理由）**

| 推迟的                           | 理由                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 列表页逐条一句话摘要             | 每篇一次生成调用，几十篇就是几十次；而 P0 的目标"3 分钟知道今天有什么"一次调用就能达成。先证明价值，再谈铺开。 |
| 看点标签（数据 / 观点 / 教程 …） | 用决策模型做很便宜，但它要改列表行 UI，属于第二个界面。P0 只占一个界面。                                       |
| 同源事件聚类                     | 需要跨文章比较，输入规模和 Prompt 复杂度都上一档。                                                             |
| 「不感兴趣」负反馈               | 先攒点击信号，别在没有任何数据时设计反馈机制。                                                                 |

---

## 四、用户流程

### 4.1 首次开启

Settings → AI → 打开 **Today's briefing** → 导航里多出 **Edition → Briefing** →
点进去，先是一行 `Writing today's edition…` → 出结果。已配好 LLM（默认的本地
Ollama 也算）时，全程无需再填任何东西。

### 4.2 每日自动

条件（全部满足）：开关开着、今天还没有 digest、候选 ≥ 3 条。

时机：**进入 Briefing 页面时**，不是后台定时。读者没打开就不花读者的钱——这与分类
sweep 的"读者打开的那篇优先"是同一种克制。

失败：页面上一行错误 + `Retry`，stream 照常可读。

### 4.3 手动重生成

页面右上 `Regenerate`。**每日上限 6 次**（`DIGEST_MAX_PER_DAY`），超过则按钮禁用并
说明原因——一个付费 key 不该被一次手滑点爆。

### 4.4 候选变化

刷新 feed 后出现新的候选 → 页面底部一行
`3 new stories since this edition was written.`，`Regenerate` 变为 accent 色。
**不自动重写。**刷新一次就跑一次生成，是这类功能最常见的烧钱方式。

---

## 五、功能详述

### 5.1 候选（candidates）

- 范围：`live === true`（排除内置 sample edition，与"不分类虚构故事"同一条理由）、
  未读、`minutesAgo < 60 * 24`。
- **今天的全部都算候选**，不再在查询层截断。「20 篇里选 5」曾让 Today 的 30 篇对不上
  ——那是把预算当成了日子的定义。
- **喂给模型的**最多 50 条（`DIGEST_OFFER_LIMIT`，安全阀：prompt 要装进上下文和账单），
  取最新——被裁掉的是尾巴，不是任意 20 条。页面如实说两个数：「从 30 篇里选出 5 篇」，
  截断时是「从你 72 篇里最新的 50 篇中选出 5 篇」。
- **不重复推荐**：任何旧版入选过的故事直接出候选池——导读值得回看的前提是它不炒
  冷饭。当天「重新生成」时，本次已选的也让位；但若因此剩下不足 3 条，则回退到只
  排除旧版（薄的日子仍然值得一期）。
- **不足 3 条 → 不写版本。**页面给一句「Not enough new today」和为什么（包括"推荐过
  的不再出现"）；今天没什么可导读的时候，安静是最好的编辑判断。

### 5.2 生成：一次调用拿全部

一次生成调用，输入全部候选，输出 ≤ 5 条入选及其 gist / why。相比"先选 5 篇再逐篇
摘要"，这是一次调用而不是六次，而且 gist 和 why 天然一致——它们本来就必须是同一次
判断的产物。

### 5.3 存储

```ts
export type DigestRecord = {
  /** 读者本地日期 `YYYY-MM-DD`。一日一版的键。 */
  day: string;
  /** 入选的 story id，按阅读顺序。 */
  picks: string[];
  /** 每篇的一句话导读。 */
  gists: Record<string, string>;
  /** 每篇的入选理由。 */
  reasons: Record<string, string>;
  /** 写这一版时的候选 id。之后新到的才算「新」；读掉的不算。 */
  candidates: string[];
  /** 写出这一版的 LLM 服务 id。 */
  provider: string;
  model?: string;
  updatedAt: number;
};
```

> 实现注：草图里的「候选指纹」换成了 `candidates: string[]`。指纹只能回答「变没变」，
> 而区块要写「N new stories since this edition was written」就得知道增量；存 id
> 列表后指纹本身就是多余的。`deletedAt` 也去掉了——它是给同步用的墓碑，而 digest
> 不进同步。

- store `digests`，keyPath `day`，index `by-updated`；`DB_VERSION` 2 → 3，**additive**，
  照 v2 加 topics / classifications 的方式加，不清空任何已有 store。
- **不进 `Changeset`。**它是从 articles 重新派生的缓存，与 articles 同性质
  （derived、可重算、不是读者亲手写的信息）；分类要进 changeset 是因为读者会纠正它。
  这条理由要写进 `docs/STORAGE.md`。

### 5.4 界面：独立的一页

**briefing 是一个视图（页面），不是 Today 流顶部的横幅。**两者回答的问题不同：流是
「什么到了」，导读是「什么值得读」——把导读塞进流里，只会让其中一个变成另一个的
装饰。

- 入口：导航的 **Edition** 区一行 `Briefing`（移动端是 tab 栏第一项）。**功能未开启时
  这一行不存在**——与 TopicFilter 同一条规矩，不给一个只会说「去设置里打开我」的
  死胡同。
- 列区渲染导读本身（不是故事行）：页头用现有 masthead，`SMART_HEAD` 加
  `briefing: { kicker: "Edition", title: "Today's Briefing" }`；筛选栏在该页隐藏
  （没有行可筛）。
- 点一条导读 = 打开那篇故事，与点流里一行完全相同（`select` + 移动端进阅读 sheet）。
- `j` / `k` 在这一页按**导读的顺序**走，而不是按时间序——列内容就是 `picks` 本身。

```
        11
    SEPTEMBER
  EDITION · TODAY'S BRIEFING

  5 of today's 12 stories, chosen and summarised from your own feeds.   Regenerate

  1  Story headline, serif, opens the story
     One-line gist, in the story's own language.
     Why it is here — one line.
     4 min · The Publication                 ← mono, as everywhere else

  2  …

  Written from each story's title and summary. Nothing fetched, nothing invented.
```

排版规则（`docs/DESIGN.md` 的延伸，不是新语言）：

- 序号 mono；标题衬线可点；gist 衬线；why 用 `ink4` 小一号；元数据 mono small caps，
  与现有故事行一致。
- 发丝线分隔，**不用卡片**；不引入新颜色；accent 只用于 stale 提示。
- 底部固定一行 provenance。这是整个功能信任设计的落点，删掉它这一页就从「路标」
  变成了「代餐」。

状态表（**这一页永远有话说**——一页空白是最差的空状态，与它作为区块时不同）：

| 状态                | 表现                                                           |
| ------------------- | -------------------------------------------------------------- |
| 功能关闭（默认）    | 「The briefing is off」+ `Open settings`（导航里本就没有入口） |
| 候选 < 3            | 「Not enough new today」+ 一句为什么                           |
| 未配 LLM / 没有 key | 「No model is set up yet」+ `Open settings`                    |
| 生成中              | `Writing today's edition…`，mono                               |
| 失败                | 错误行 + `Retry`                                               |
| 有版本              | 条目 + provenance 行                                           |
| stale               | 底部一行「N new stories since this edition was written」       |
| 部分条目校验不过    | 只展示通过校验的；全部不过按失败处理                           |

**回看：导读按日期组织。**`digests` 本来就一天一条存着，所以历史是免费的，缺的只是
入口：页面底部「更早的导读」列表（日期 + 条数），点开即看那一天的版；看旧版时**页头
的日期跟着变**（masthead 印的是"正在看的东西的日期"，否则显示着上周二的版却写今天，
是在说谎）；导航点 `Briefing` 回到今天。旧版是完成品，**没有 Regenerate**。

回看之所以有价值，正是因为候选池剔掉旧版用过的文章（5.1）——否则翻回去只会看到
同样几篇。

**与用户相关**：设置里的「What you care about」是**读者自己写的**兴趣（≤ 600 字符），
以事实形式注入 prompt，选品从"广泛好奇的读者"改为"这位读者"，`why` 必须点名它碰到
的兴趣。刻意不做隐式兴趣画像（读了什么、看了多久）：显式的一句话比推断的一画像更
准、更可改、也不需要解释。

### 5.5 设置：两个开关，两套 provider

AI 设置区在「Article classification」旁边新增 **「Today's briefing」**。两个开关独立，
**两套 provider 配置**：分类继续用决策 transport，导读用读者自己的 LLM。已经配过分类的
读者不需要重填，但也不该被强行共用——一个决策模型写不了导读。

「Today's briefing」展开后是一套 **BYOK** 配置，全部由 `LLM_PROVIDERS` 表驱动渲染，
Settings 不用为它写死任何一家。读者看到的是一串服务，点一个填两样东西：

| 读者选的        | 要填的字段                    |
| --------------- | ----------------------------- |
| 本地 Ollama     | 模型（列表从本机 Ollama 读）  |
| OpenAI          | 模型、API key                 |
| Anthropic       | 模型、API key                 |
| DeepSeek        | 模型、API key                 |
| Moonshot (Kimi) | 模型、API key                 |
| 通义千问 (Qwen) | 模型、API key                 |
| 智谱 GLM        | 模型、API key                 |
| 自定义…         | 格式、Base URL、模型、API key |

三条规则：

- **精选的服务不出现地址字段。**地址是表里的常量，读者只选模型、填 key——两步搞定，
  也是绝大多数人的路径。代价是端点变更要我们发版，接受（见 7.1）。
- **「自定义」才选格式**（OpenAI 兼容 / Anthropic 兼容）并填地址。任何兼容这两套格式的
  服务都走这一条，包括 OpenRouter、Groq、Gemini 的兼容端点——不为它们
  单列条目，每多一家就多一个要跟着它端点变更的承诺。
- **key 与 model 都按服务各存一把**，key 是密码字段，换服务不用重输。
- **Written in**：导读（gist / why）与这一页自身文案的语言。默认跟随原文；其余是封闭
  枚举（含中文简繁、日、韩、英、西、法、德、葡、俄），不是自由文本。
- **What you care about**：自由文本（≤ 600 字符），写你真正想读的东西。越具体越好
  ——「创新方案如何落地密歇根州」胜过「创新」。空着则退回"广泛好奇的读者"，不猜。

模型是**必填的自由文本**，不是下拉：模型名变得比我们发版快，写死的列表过期之后是一条
死路，而占位符（如 `deepseek-flash`）已经够暗示格式。填错的代价由 7.4 的 400 文案承担。

本地 Ollama 是默认项：无 key、不出本机，模型列表从 Ollama 自己读，只列会聊天的。

代价必须说清，原文大致如下：

> A briefing sends today's unread headlines and summaries — up to 20 at once — to
> the model you chose, using your own key. A local Ollama sends nothing off this
> machine.

### 5.6 隐私

- **离机的**：最多 50 条的 title + summary（summary 截断），一日一次 + 手动重生成。
  与分类的差别有两点，设置文案要把两点都写清：一次一批而不是一次一条；去的是
  **读者自己的** LLM 账号，而不是某个分类服务。
- **不离机的**：全文、阅读状态、订阅列表、key。key 只存在于本机 prefs，随请求发到
  本站自己的 `/api/digest`，服务端不落盘。
- **本地 Ollama**：什么都不出本机，且是默认项——没配 key 的读者不该被推着去注册一个
  账号才能用这个功能。

---

## 六、Prompt 与输出契约

**System prompt 的硬约束**（实现时逐条落实，不是建议）

1. 你是编辑，不是作者。只用给定的标题和摘要。
2. 不得引入给定材料之外的事实、数字、引语、人名、链接。
3. **为「这位读者」选，不是为想象中的读者选。**设置里「What you care about」的原文
   以**事实**形式注入（`What this reader says they care about: …`），优先级高于普世
   重要性：碰到其兴趣的小事，胜过与他无关的大事。没填才退回「广泛好奇的读者」，
   **不猜**——对兴趣的猜测比一份不声称认识你的导读更糟。
4. **`gist` 必须具体**：给出发生了什么 / 主张什么——那个数字、那个名字、那个发现、
   那个机制。禁止换词复述标题，禁止以「这篇文章 / This article」开头。
   **`why` 必须落到这位读者**：点名它碰到的兴趣，或那个足以勾住他的具体细节。
   禁止 `interesting` / `important` / `worth reading` 这类空词——写了等于没写。
5. **两个字段同用一种语言**，由「Written in」设定：默认**跟随原文**，或指定中文 /
   日文 / 韩文 / 英文等。指定语言时**专有名词、公司/产品名、代码标识符保留原文**
   ——「OpenAI」不需要被译成另一种文字。字数上限按语言分档（CJK 60 字符、拉丁系
   120 字符）：同一个上限会让中文的一句话先变一段话才被丢掉。
6. 选 5 条，按价值降序；**同一来源最多 2 条**；多样性优先于同主题堆叠。
7. 只输出 JSON 数组，字段 `id` / `gist` / `why`，`id` 原样来自输入。

> **语言是一个枚举，不是一段文本。**请求只带 `language: "ja"` 这样的名字，prompt
> 仍由服务端写——否则读者就能借语言字段注入自己的指令，那条「不接受自带指令」的
> 规矩就破了。

**后处理校验（不过就丢，不显示半截）**

- 可解析为 JSON 数组，长度 ≤ 5。
- 每条 `id` 在候选白名单内；`gist` / `why` 为非空字符串且在上限内。
- 同 `id` 只留第一条。
- **通过数 < 1 → 整批按失败处理**，显示错误而不是显示三条里的两条。

JSON + 白名单是唯一能便宜地防住两件事的手段：**编造**（材料里没有的事实）和**串台**
（把 A 篇的摘要安到 B 篇头上）。自由文本回答做不到这一点，所以 P0 不接受自由回答。

**不发送 `response_format: { type: "json_object" }`。**一部分 OpenAI 兼容网关会直接
400，另一部分悄悄忽略；prompt 已经要求只输出 JSON，加上围栏剥离与 7.4 的错误映射就够。
等预设稳定后再作为按预设开启的增强（见待决问题 2）。

---

## 七、技术方案：LLM 传输层（接口草图）

**前提**：这是一套**新的**传输层，不是给分类加一个能力。分类继续走
`lib/classify.ts` 的决策 transport（便宜、封闭集合、精确），一字不动；两套 provider
配置互不影响，共用一个 AI 设置区。

**新增**

- `lib/llm.ts`：服务表（精选 + 自定义）、请求构造、响应读取、错误映射。
- `lib/digest.ts`：day 键、候选指纹、白名单校验、客户端 pacing、`requestDigest()`。
- `app/api/digest/route.ts`：服务端写 prompt、转发、只回文本。
- `app/api/digest/models/route.ts`：列本地 Ollama 会聊天的模型。
- `components/briefing.tsx`：导读页面 UI。
- `lib/store.tsx`：`digestEnabled` / `digest` / `digestError` / `digestWorking` /
  `pendingDigest` / `regenerateDigest()`，以及一个复刻分类 sweep 的 effect。
- `lib/storage/db.ts` + `types.ts`：`digests` store，DB v3。
- `lib/storage/prefs.ts`：`digest?: boolean` + `llmConfig`。

### 7.1 provider 表：一家一行，填几个字段也由表决定

形状完全复刻 `CLASSIFY_PROVIDERS`——Settings 从表渲染，路由与解析器不看表——所以
以后加一家仍然是表里加一行，UI、守卫都不用改。**读者填几个字段同样是表里声明的**：
精选的服务只声明 `model` + `key`，「自定义」才声明 `wire` + `baseUrl` + `model` + `key`。
UI 因此不需要为"这家要不要填地址"写任何分支。

```ts
/** 两种 wire 格式。自定义时由读者选，表里的服务定死。 */
export type LlmWire = "openai" | "anthropic";

export type LlmConfig = {
  /** 表里的服务 id，或 "custom"。 */
  service: string;
  /** 仅自定义时使用：读者选的那种格式。 */
  wire: LlmWire;
  /** 仅自定义时与本地 Ollama 使用：读者填的地址。 */
  baseUrl: string;
  /** 模型与 key 都按服务记住，换服务不用重输。 */
  models: Partial<Record<string, string>>;
  keys: Partial<Record<string, string>>;
};

export type LlmMessage = { role: "system" | "user"; content: string };

export type LlmField = {
  key: "wire" | "baseUrl" | "model" | "key";
  label: string;
  placeholder: string;
  hint?: string;
  /** 格式选择：两个 closed choice。 */
  choices?: readonly { value: string; label: string }[];
  /** 凭证：密码字段，永不进日志。 */
  secret?: boolean;
  optional?: boolean;
};

export type LlmProvider = {
  id: string;
  label: string;
  blurb: string;
  /** 这种服务走哪种格式。 */
  wire: LlmWire;
  /** 地址已知的服务不列 baseUrl 字段——读者只选模型。 */
  baseUrl?: string;
  /** 地址下补的路径；不填就用格式自己的。 */
  path?: string;
  fields: readonly LlmField[];
  call(config: LlmConfig, messages: LlmMessage[]): ProviderCall;
  /** 无凭证且在本机网络时可被浏览器直连——只有本地 Ollama。 */
  direct?: (config: LlmConfig) => boolean;
};

/** 表里的服务用表里的地址，自定义用读者填的。 */
export function endpointFor(provider: LlmProvider, config: LlmConfig): string;
```

`ProviderCall`（`{ url, body, headers }`）直接从 `lib/classify.ts` 复用，不重造；
`onReadersNetwork` 也直接拿来判断 Ollama 能否直连。

> 实现注：模型名改成按服务存（`models` map，与 `keys` 同形）。草图里的单一 `model`
> 在切换服务时会把 `deepseek-flash` 带到 OpenAI 上——分类那边是 `ollamaModel` /
> `openaiModel` 各存各的，这里用 map 达到同一件事，换服务回来不用重输。另外给
> `path` 留了一个字段：Ollama 说的是 OpenAI 格式，但它在 `/v1/chat/completions`，
> 而读者填的是它的根地址。

| 服务            | 格式      | 地址                                                | 读者填                   |
| --------------- | --------- | --------------------------------------------------- | ------------------------ |
| 本地 Ollama     | openai    | `http://localhost:11434/v1`（可改）                 | 模型（从本机读）、无 key |
| OpenAI          | openai    | `https://api.openai.com/v1`                         | 模型、key                |
| Anthropic       | anthropic | `https://api.anthropic.com`                         | 模型、key                |
| DeepSeek        | openai    | `https://api.deepseek.com/v1`                       | 模型、key                |
| Moonshot (Kimi) | openai    | `https://api.moonshot.cn/v1`                        | 模型、key                |
| 通义千问 (Qwen) | openai    | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 模型、key                |
| 智谱 GLM        | openai    | `https://open.bigmodel.cn/api/paas/v4`              | 模型、key                |
| 自定义          | 读者选    | 读者填                                              | 格式、地址、模型、key    |

两种格式的差只有三处，实现时点名：Anthropic 的 `system` 是顶层字段而不是一条 message；
`max_tokens` 在 Anthropic 必填；读取时 Anthropic 要拼 `content[]` 里 `type === "text"`
的片段，OpenAI 取 `choices[0].message.content`。`call()` 按 `provider.wire` 分派，
自定义条目的 wire 来自读者选的那一个。

**为什么精选服务敢把地址写死在代码里**：换来读者少填一个字段，而这几家的端点几年不变，
真变了我们发版、读者侧无感。读者的「自定义」条目永远读 `config.baseUrl`，不受影响。
OpenRouter / Groq / Gemini 这类同样出名但不进表：它们全是 OpenAI 兼容，
走「自定义」一个条目就够——每单列一家，就多一个要我们盯着变更的承诺。

**模型占位符**：每家在表里带一个当前型号作为 placeholder（OpenAI `gpt-4o-mini`、
Anthropic `claude-sonnet-4-5`、DeepSeek `deepseek-flash`、Kimi `moonshot-v1-8k`、
Qwen `qwen-plus`、GLM `glm-4-air`）。它只是格式暗示，不是推荐——模型名变得比我们发版快，
所以读者永远可以改，我们也永远不用为了更新型号发版。

### 7.2 路由：prompt 由服务端写

`POST /api/digest` 与 `/api/classify` 同构：`fromAnotherSite` 守卫、凭证随请求体来、
服务端不落任何东西、`cache-control: no-store`。唯一差别是它**不调** `withinRateLimit`。

**这里不加限流——理由记下来，免得以后有人照着 `/api/classify` 又抄一份。**分类要
限流，是因为它的 sweep 一分钟最多打 12 次（`CLASSIFY_MAX_PER_MINUTE`），是持续的后台
流量，需要一个滥用闸门；导读是一天一次、手动重生成日上限 6 次，不存在合法的突发。

成本控制靠确定性上限，不靠限流：输入封顶、`max_tokens: 3000`、60s 超时——单次请求的
最坏开销是算得出来的（见 7.3）。滥用面上，`fromAnotherSite` 挡掉别的页面借我们的 Worker
发请求；读者的 key 只存在本机 prefs、只随我们自己的页面发出，别人既拿不到也发不出跨站
请求，所以"借我们的端点花读者的钱"这条路是封死的。剩下只有"花我们自己的 Worker 额度"，
而那要求攻击者自带 key，动机很低。

真出现了，补一个 binding 是两行的事（`wrangler.jsonc` 加一条、调用处换个名字），或者先
复用现成的 `FEED_FETCH` 顶着。P0 不加。

关键差别是 **prompt 由服务端写**，与分类"服务端写下 question 的每一个字"同一条规矩：
页面只送候选 `[{ id, title, summary }]`（≤ 50 条，title ≤ 300 字符，summary ≤ 300
字符），服务端组装 system + user messages、调用 transport、返回
`{ ok, text, provider, model }`。白名单校验留在客户端——候选集本来就只在客户端。所以
这个路由不是一个通用 LLM 代理。

`GET /api/digest/models?base=`：照 `/api/classify/models` 问 Ollama 的 `/api/tags`，
但按 `capabilities` 里的 `completion` 过滤而不是 `decision`——同一个 `ollamaTagsUrl`，
另一个读取器。pull 过聊天模型的读者看得到，没 pull 的看到空列表，而不是一个只会失败的建议。

### 7.3 参数与成本

- `temperature: 0.3`——编辑性任务，不要创意。
- `max_tokens: 3000`——**思考型模型的「思考」也计在预算里**（实测一个 3 条候选的请求，
  约 2/3 的输出是 reasoning），800 会被思考吃光：调用成功、`content` 为空、然后报一句
  误导人的「模型没说话」。3000 覆盖思考与正文，同时仍是失控输出的硬上限。
- **能关思考的就关**：表里的 `thinkOff` 声明「这家怎么关思考」，DeepSeek 发
  `thinking: {type: "disabled"}`（官方文档：它默认 `enabled`，且 reasoning 与 answer
  共享同一个 token 配额）。每家叫法不同、不声明就不发——给不认识的服务发未知字段是
  纯冒险。Ollama 这边实测 `think:false` 与 `chat_template_kwargs` 都无效，故不发，靠预算
  与真实错误兜底。
- 输入侧封顶：50 条 ×（300 + 300）字符；候选本身不截断，只有 `offered` 被封顶。
- 超时 **60s**：生成比决策慢一个量级，分类那 20s 不够。
- 上面两条加上 `max_tokens` 就是全部成本控制——单次请求的最坏开销由此确定，所以服务端
  不需要限流（理由见 7.2）。
- 客户端 pacing 与分类共用 `classifyDelay`；另加 `DIGEST_MAX_PER_DAY = 6` 的手动重生成
  上限。

### 7.4 错误映射

| 上游         | 给读者看                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 401 / 403    | "The key was refused."                                                                                                                    |
| 404          | 自定义："That address does not answer chat completions. Check the base URL."；表里的服务："{服务名} did not answer at its usual address." |
| 429          | "The service is rate limiting requests." + 暂停，等 `Retry`                                                                               |
| 400          | 上游原文——通常是模型名不被这个账号接受                                                                                                    |
| 空 `content` | "The model returned nothing."                                                                                                             |
| 超时 / 网络  | "Could not reach the service."                                                                                                            |

### 7.5 sweep 模式

复刻分类 sweep：一个 in-flight ref、失败即暂停、`Retry` 清错、串行、开关关闭后
in-flight 的返回值丢弃（用 ref 读最新开关，避免竞态）。P0 简化为"今天缺一篇就写
一篇"，没有队列。

---

## 八、边界与降级

- 浏览器不直连带凭证的 provider（沿用分类的规矩：key 不能出现在页面上）；本地 Ollama
  无凭证且在本机网络时可直连。
- 付费 key 被点爆：每日上限 + 限速 + 失败即暂停。
- 模型不听话（输出散文、输出 Markdown 代码块围栏）：JSON 校验失败 → 按失败处理，
  不显示。
- 读者在生成途中关开关：返回值丢弃。
- 跨午夜：day 键取读者本地日期；当天已写的不因跨午夜重写，次日才写新版。

---

## 九、测试计划

1. 候选构造：排除已读、排除 sample edition、截断到 20、按新排序。
2. 指纹：候选不变 → 不重发请求；候选变 → 标记 stale 而**不**自动重写。
3. 解析校验：白名单外 `id` 丢弃、超长丢弃、非 JSON 丢弃、全丢弃按失败处理。
4. 开关：关闭时不发请求；已有今日 digest 时不发请求。
5. 上限：第 7 次手动重生成被拒。
6. **传输层**：`endpointFor` 对表里的服务取表内地址、对自定义取读者填的；两种 wire 的
   URL / body / headers 构造；Anthropic 的 `system` 在顶层且 `max_tokens` 必填；两种响应
   读取（含 Anthropic 多段 text 拼接）；Markdown 围栏剥离；key 按服务 id 存取、换服务不
   串 key；本地 Ollama 走直连、其余一律走本站代理。
7. **字段表**：精选服务的 `fields` 里没有 `baseUrl`（`missingFields` 不会索要它）；自定义
   条目有 `wire`，且它的两个取值改变请求形状。
8. **模型列表**：只列 `capabilities` 含 `completion` 的模型。
9. 失败可见：路由返回错误 → store 记 error，区块显示 `Retry`；上游 401 / 404 的文案
   按 7.4 的映射。

## 十、DoD

- [ ] Settings：`Today's briefing` 开关 + BYOK 服务配置（精选服务的模型与 key / 自定义的
      格式、地址、模型、key）+ 代价说明
- [ ] Briefing 页面：5 条、gist、why、provenance 行、全部状态
- [ ] 一日一版；候选变化只标 stale；手动重生成有日上限
- [ ] `digests` store（v3 additive），迁移不清空既有数据
- [ ] `POST /api/digest` 有 origin guard，凭证不落服务端；输入 / 输出上限与超时见 7.3
- [ ] ≥ 9 个测试覆盖第九节
- [ ] `bun run good` + `bun run check` 通过
- [ ] 文档同步：`ARCHITECTURE.md` 增加「Today's briefing」一节（挨着 Article
      classification）、`STORAGE.md` 增加 `digests` store 及其"为何不进 changeset"、
      `DESIGN.md` 无需改动（没有新视觉语言）

---

## 十一、指标（上线后 4 周）

| 指标                         | 目标       | 说明                                                                                                      |
| ---------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| 导读页点开率                 | ≥ 40% 会话 | 开着导读的会话里，至少点开一条入选的占比                                                                  |
| 入选条目到达率               | ≥ 25%      | 点开 / 展示。低于它说明入选选错了，不是说明 AI 没用                                                       |
| **只看导读不点开的会话占比** | **< 40%**  | **危险信号。**超过 60% 意味着 AI 在替代阅读，此时该改产品（比如把 gist 改短、加"读原文"权重），不是改指标 |
| 开关 7 日留存                | ≥ 70%      | 开了还开着                                                                                                |
| 失败率 / 平均生成时长        | 监控       | 失败率 > 5% 要查 prompt 或 transport                                                                      |
| 关闭率 + 关闭原因            | 监控       | 设置里一个可选的一句话输入框                                                                              |

---

## 十二、风险与取舍

| 风险                   | 影响                | 处置                                                                       |
| ---------------------- | ------------------- | -------------------------------------------------------------------------- |
| 模型编造               | 信任一次性破产      | 只用 title + summary；JSON + 白名单校验；provenance 行常驻                 |
| 一次发 50 条离机       | 隐私观感变差        | 设置文案如实写；本地 Ollama 是默认且不出本机                               |
| 读者只看导读不读原文   | 产品变成"AI 摘要器" | 指标里设为危险信号；gist 故意短、制造信息缺口                              |
| 刷新即重生成烧钱       | 付费 key 被点爆     | 指纹 + stale + 手动 + 日上限，四道闸                                       |
| 与分类抢限速配额       | 两个功能互相拖慢    | 共用同一套 pacing；digest 一日一次，影响可预期                             |
| BYOK 门槛劝退读者      | 功能没人用          | 精选服务只填模型和 key；本地 Ollama 零配置兜底；设置里写清"不配也能正常读" |
| 预设过期 / 端点变更    | 填对了也连不上      | 精选服务的端点写在表里，变更随发版修；404 文案按 7.4 分自定义与表内两种    |
| 两套 provider 配置混乱 | 读者填错地方        | 两个开关各自展开各自的配置，标题写清"分类用决策模型，导读用你自己的模型"   |

---

## 十三、后续阶段（简表）

**P1 —— 把筛选铺到列表**

- 列表页逐条一句话摘要（按需生成 + 缓存，未打开不生成）
- 看点标签：用**决策模型**做封闭选择（`数据` / `观点` / `教程` / `发布` / `软文`），
  复用现有分类基建，不新增 transport
- 「不感兴趣」负反馈，落盘，作为后续选品的弱信号
- 流式输出（SSE 穿过自己的代理），让 `Writing today's edition…` 变成逐字出现

**P2 —— 跨文章**

- 同源事件聚类：同一事件多篇折叠，可对比不同信源表述
- 跨文章观点关联：「读这篇时，你订阅的另外两篇持相反观点」
- 文章详情页：结构化摘要、重点段落标注、就文章提问（回答严格基于原文并标注出处）

**P3 —— 个性化与探索**

- 对话式检索（基于订阅内容回答，附原文链接）
- 兴趣画像可见可调
- 日报推送（可选，默认关）

---

## 十四、待决问题

1. **5 条是否可调**（3 / 5 / 10）？P0 固定 5，先看数据。
2. **是否发送 `response_format: json_object`**？P0 不发（兼容性差），稳定后按预设开启。
3. **digest 是否进 Changeset**？P0 不进（可从 articles 重算）。
4. **导读页能否被永久关闭**？P0 只做开关级关闭，不做页面级永久 dismiss。
5. **gist 的语言**：✅ 已定。加一个「Written in」选择：跟随原文（默认）/ English /
   简体中文 / 繁體中文 / 日本語 / 한국어 / Español / Français / Deutsch / Português /
   Русский。选定语言时 `gist` 与 `why` 同用它，导读页自身文案也跟着走（仅 en /
   zh-Hans / zh-Hant / ja / ko 有文案表，其余回退英文）。**阿拉伯语 / 希伯来语不列入**
   ——版式无 RTL 适配。app 其余界面仍是英文，整体 i18n 另立项。
6. **模型要下拉还是自由文本**？P0 自由文本 + 占位符（理由见 5.5）；想要下拉就得接受
   过期，或做一个"常用几个 + 手动输入"的组合框，那是另一个组件。
7. **精选服务还要不要加**：现在 6 家 + Ollama + 自定义。OpenRouter 是最后一个有力的
   候选（一把 key 通百家模型），加了就是表里一行，但也要我们盯着它的端点。
8. **要不要"测试连接"按钮**？P0 不做预检，靠首次生成的真实失败暴露问题。
