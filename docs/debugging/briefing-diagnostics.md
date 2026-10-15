# 导出一版 Briefing 的选稿诊断

在 Firefly Feeds 页面打开浏览器开发者工具 Console，执行下面的代码。
默认导出截图中的 2026-10-14 / r17，可修改前两行。浏览器会下载一个 JSON 文件，
可将该文件提供给开发者定位问题。

只读本地数据；不调用模型、不请求网络、不改写数据。文件仅包含本版候选标题/摘要、
分类与主题名称、选稿评分、所用材料及成稿，不包含 API key、provider 配置或其他版本正文。

```js
(async () => {
  const editionDate = "2026-10-14";
  const revision = 17;
  const request = indexedDB.open("firefly-feeds");
  const database = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => request.transaction.abort();
  });
  const stores = ["briefingRuns", "briefings", "topics", "classifications"];
  let rows;
  try {
    const tx = database.transaction(stores, "readonly");
    rows = await Promise.all(
      stores.map(
        (name) =>
          new Promise((resolve, reject) => {
            const read = tx.objectStore(name).getAll();
            read.onsuccess = () => resolve(read.result);
            read.onerror = () => reject(read.error);
          }),
      ),
    );
  } finally {
    database.close();
  }
  const [runs, editions, topics, classifications] = rows;
  const run = runs
    .filter((item) => item.editionKey.startsWith(editionDate + "@") && item.revision === revision)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!run) throw new Error("找不到该版本任务，请检查日期与 revision。");
  const ids = new Set(run.prepared?.candidates.map((item) => item.articleId) ?? []);
  const report = {
    run: {
      runId: run.runId,
      editionKey: run.editionKey,
      revision: run.revision,
      status: run.status,
      cutoffAt: run.cutoffAt,
      promptVersion: run.promptVersion,
      callsUsed: run.callsUsed,
      repairTrace: run.repairTrace,
      trigger: run.trigger,
      truncatedPhases: run.truncatedPhases,
    },
    topics: topics.map(({ id, label, deletedAt }) => ({ id, label, deletedAt })),
    prepared: run.prepared && {
      editionDate: run.prepared.editionDate,
      timezone: run.prepared.timezone,
      focusTopicIds: run.prepared.focusTopicIds,
      focusTopics: run.prepared.focusTopics,
      focusOnly: run.prepared.focusOnly,
      candidates: run.prepared.candidates,
    },
    classifications: classifications
      .filter((item) => ids.has(item.itemId))
      .map(({ itemId, topicIds, status, confidence, updatedAt, deletedAt }) => ({
        itemId,
        topicIds,
        status,
        confidence,
        updatedAt,
        deletedAt,
      })),
    shortlist: run.shortlist,
    materials: run.materials,
    edition: editions.find(
      (item) => item.editionKey === run.editionKey && item.revision === revision,
    ),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `briefing-r${revision}-diagnostics.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
})();
```

`prepared.focusTopicIds` 是生成时冻结的兴趣，不一定等于当前设置。
`prepared.candidates[].topicIds` 是生成时分类；`classifications` 是当前分类，可用于发现事后变化。
旧任务没有 `focusTopics` / `focusOnly` 是兼容情况，不代表兴趣没有保存。
