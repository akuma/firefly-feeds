# Feature Brief: 文章级自动分类（Jev）

## 现状（先对齐）

### 已有：Feed / 源级分类

- 订阅源可挂在 folder 下：`news` | `science` | `technology` | `culture` | `design` | `independent` | `ai`（见 `lib/types.ts` 的 `FolderId`，`SourceRecord.folder`）。
- 推荐源带有默认 folder；读者手动添加源时可选手动归类。
- **添加 feed 时目前没有自动分类。**

### 本次重点：文章级分类

- 文章（`Article` / `ArticleRecord`）**目前没有**独立于源的主题分类。
- 同一 feed 里的不同文章主题往往不同；只靠源 folder 不够。
- **本 brief 的主交付是：对每篇文章做分类。**

### 次要（已实现）

- 添加 feed 时，用同一套决策模型给源建议 folder（读者可改，且读者已选的 folder 优先于模型建议）。**前提是已配好分类器**；没配、或置信度低于阈值时不给建议——一个没把握的猜测不如空着。

---

## 目标

读者能为每篇文章得到主题标签，并按标签筛选浏览；分类由决策模型完成；可纠正、可关闭；遵守 Firefly 的 local-first 与 editorial 气质。

Jev API: https://www.jevai.org/docs

本地替代：Ollama 的 `clef-flash`（9B 决策模型，与 Jev / System One API 完全兼容）
https://ollama.com/library/clef-flash

---

## 分类器（已定）

- **引擎为决策模型**（TypeSafe 决策模型：封闭标签选择 + 置信度）。
- **分类器由读者在设置里选**，不做文件/环境变量配置：`lib/classify.ts` 的 `CLASSIFY_PROVIDERS` 是一张表，每家声明「读者要填什么」和「请求发去哪」；设置弹窗直接按这张表渲染列表、说明和输入框，所以新增一家只是表里多一行，UI、路由、解析器、阈值门控都不用改。
- 四家可选，按流行程度排序：**OpenAI**（Decisions API，限量预览，需 base URL / model / key，格式与其它家不同）、**Cloudflare Workers AI**（读者自己的 account）、**TypeSafe (Jev) 托管 API**（需 key，按次计费）、**本地 Ollama**（模型不预设：设置里列出的是从 Ollama 接口读到的、本机真正 pull 过的决策模型，读者自己选；免费免 key，标题摘要不出本机）。
- 除 OpenAI 外三家共用 System One 线格式（一个封闭选择问题进，一个 slug + 置信度出）；OpenAI 用的是自己的形状（state 序列化成字符串、question 作为列表项、概率成对返回），所以它在表里多带一个 `read`，路由据此选择解析器。
- 凭证只存在本地 prefs，随请求发到本站自己的 `/api/classify`，再由服务端转发；**不写入仓库、不做服务端配置**，整个应用可以零 secret 部署。未填完的分类器会被路由直接拒绝并提示缺哪几项，而不是带着空 credential 发出去。
- 不引入 Firefly 账号，不把阅读历史默认上传到产品后端。

---

## 必须做

### 产品

1. **对象**：本地已有文章；输入至少 `title` + `dek`/`summary`。若阅读器已拉过全文，可用全文；**不得**为分类后台爬全文或突破 paywall。
2. **标签表**：用户可维护（与源 folder 体系区分开：文章标签 ≠ 源 folder，可并存）。首次启用给出默认文章标签集。
3. **每篇文章**：写入分类结果；带 `confidence`。低于阈值 → `needs_review` / 「待确认」，不得静默当真。
4. **纠正**：读者可改标签；纠正落盘，并可作为后续 Jev 调用的弱信号。
5. **开关**：全局可关；关闭后不再请求 Jev；已有结果仍可读。
6. **失败可见**：无 key、额度、超时 → 明确提示；阅读不受阻。
7. **筛选**：列表/侧栏可按文章标签过滤（独立于按 folder / 按 feed 的现有导航）。

### 架构

1. 遵守 `AGENTS.md`、`docs/STORAGE.md`、`docs/DESIGN.md`。
2. 分类结果是用户状态（可进 sync 侧）；不要把唯一真相只塞进 disposable 的 `articles` 缓存语义。
3. 不改坏 `DB_NAME` / `PREFS_KEY`；schema 变更可迁移，优先 additive。
4. Publisher feed 仍只经服务端；UI 跟现有纸感，不新开一套 AI 仪表盘视觉。
5. TypeScript strict；`bun run good` 与 `bun run check` 必须过。
6. `docs/` 补一小节：数据放哪、何时对文章调用 Jev、与源 folder 的关系、隐私边界。

### DoD

- [ ] 设置：开关、Jev 凭证、文章标签表编辑
- [ ] 新文章出现分类或「待确认」
- [ ] 按文章标签过滤可用
- [ ] 纠正刷新后仍在
- [ ] ≥3 个测试：结果校验、阈值门控、纠正覆盖自动结果
- [ ] `bun run good` + `bun run check` 通过
- [ ] 文档已更新

---

## 不做（v1）

- 不引入非决策模型的引擎（例如让通用 LLM 自由生成标签）做文章分类
- 不做官方跨设备同步产品化（字段可预留）
- 不做云端兴趣画像
- 不做自动长文改写进 edition
- 文章分类不改变 stream 的 `layout` 选型

---

## 建议数据草图

```ts
type ArticleTopic = {
  id: string;
  slug: string;
  label: string;
  updatedAt: number;
  deletedAt?: number;
};

type ArticleClassification = {
  itemId: string;
  topicIds: string[];
  primaryTopicId?: string;
  confidence: number;
  status: "auto" | "confirmed" | "needs_review" | "rejected";
  provider: "jev";
  model?: string;
  contentFingerprint: string;
  updatedAt: number;
};
```

源级 folder 继续用现有 `FolderId` / `SourceRecord.folder`；文章分类用独立 store/记录，二者不要混成一个字段。
