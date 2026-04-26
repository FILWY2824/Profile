<template>
  <div class="space-y-5">
    <header class="admin-tab-head">
      <h1 class="h-page">图标缓存<span class="text-teal-300">.</span></h1>
      <p class="text-fg-dim text-sm hidden md:block">
        解析卡片站点 &lt;link rel="icon"&gt; 抓取精确图标
      </p>
    </header>

    <div class="admin-toolbar">
      <input v-model="search" placeholder="搜索 origin / 卡片 / 板块…" class="input admin-search" />
      <span class="admin-count">共 {{ filteredItems.length }} / {{ items.length }} 条</span>
    </div>

    <div class="surface overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="admin-thead">
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider w-12"></th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">Origin</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">关联卡片</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">类型</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">抓取时间</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">错误</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="filteredItems.length === 0">
              <td colspan="7" class="px-4 py-12 text-center text-fg-dim text-sm">
                {{ items.length === 0 ? '暂无' : '没有匹配的图标' }}
              </td>
            </tr>
            <tr v-for="r in pagedItems" :key="r.origin" class="admin-row">
              <td class="px-4 py-3">
                <div class="favicon-wrap">
                  <img v-if="r.hasData" :src="`/api/favicons/image?origin=${encodeURIComponent(r.origin)}`" class="h-5 w-5" alt="" />
                </div>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-fg">{{ r.origin }}</td>
              <td class="px-4 py-3">
                <!-- 关联卡片:每张卡片显示 "标题 · 板块",方便管理员看到 origin 实际是哪些卡片在用 -->
                <div v-if="(r.cards || []).length === 0" class="text-xs text-fg-mute italic">
                  (无关联卡片)
                </div>
                <ul v-else class="card-ref-list">
                  <li v-for="(card, idx) in r.cards" :key="idx" class="card-ref">
                    <span class="card-ref-title">{{ card.title }}</span>
                    <span v-if="card.sectionName" class="card-ref-section">· {{ card.sectionName }}</span>
                    <span v-else class="card-ref-section card-ref-section-none">· 未分组</span>
                  </li>
                </ul>
              </td>
              <td class="px-4 py-3 text-xs text-fg-dim font-mono">{{ r.contentType }}</td>
              <td class="px-4 py-3 text-xs text-fg-dim">{{ formatTime(r.fetchedAt) }}</td>
              <td class="px-4 py-3 text-xs text-danger truncate max-w-xs">{{ r.lastError }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button @click="onRefresh(r.origin)" class="btn btn-ghost btn-sm">刷新</button>
                <button @click="onDelete(r.origin)" class="btn btn-ghost btn-sm text-danger hover:!text-danger">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="filteredItems.length > 0" class="px-4 py-2">
        <Pagination :total="filteredItems.length" v-model:current-page="page" :page-size="10" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import { useConfirm } from "../../confirm.js";
import { formatTime } from "../../format.js";
import Pagination from "../Pagination.vue";

const items = ref([]);
const page = ref(1);
const search = ref("");
const PAGE_SIZE = 10;

const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return items.value;
  return items.value.filter(r => {
    if ((r.origin || "").toLowerCase().includes(q)) return true;
    if ((r.contentType || "").toLowerCase().includes(q)) return true;
    if ((r.lastError || "").toLowerCase().includes(q)) return true;
    // 在关联卡片标题/板块名里也搜索
    for (const card of (r.cards || [])) {
      if ((card.title || "").toLowerCase().includes(q)) return true;
      if ((card.sectionName || "").toLowerCase().includes(q)) return true;
    }
    return false;
  });
});

const pagedItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return filteredItems.value.slice(start, start + PAGE_SIZE);
});

watch(search, () => { page.value = 1; });

async function load() {
  try {
    const r = await api.get("/admin/favicons");
    items.value = r.items || [];
  } catch (e) { errToast(e.message); }
}

async function onRefresh(origin) {
  try {
    await api.post("/admin/favicons/refresh", { origin });
    okToast("图标缓存已刷新");
    await load();
  } catch (e) { errToast(e.message); }
}
async function onDelete(origin) {
  const ok = await useConfirm({
    title: "删除图标缓存",
    message: `确认删除该 origin 的图标缓存?`,
    detail: origin,
    kind: "danger",
    confirmText: "删除",
  });
  if (!ok) return;
  try {
    await api.delete("/admin/favicons/" + encodeURIComponent(origin));
    okToast("图标缓存已删除");
    await load();
  } catch (e) { errToast(e.message); }
}
onMounted(load);
</script>

<style scoped>
.admin-tab-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.admin-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.admin-search {
  flex: 1;
  min-width: 240px;
  max-width: 420px;
}
.admin-count {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
  color: var(--fg-mute);
  white-space: nowrap;
}
.admin-thead {
  border-bottom: 1px solid rgba(15, 36, 25, 0.10);
  background-color: rgba(255, 255, 255, 0.55);
}
.admin-row {
  border-bottom: 1px solid rgba(15, 36, 25, 0.06);
  transition: background-color 0.14s;
}
.admin-row:hover {
  background-color: rgba(255, 255, 255, 0.55);
}
.favicon-wrap {
  height: 28px;
  width: 28px;
  border-radius: 8px;
  background-color: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(15, 36, 25, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.card-ref-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 320px;
}
.card-ref {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12.5px;
  line-height: 1.3;
}
.card-ref-title {
  color: var(--fg);
  font-weight: 500;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-ref-section {
  color: var(--fg-mute);
  font-size: 11px;
  white-space: nowrap;
}
.card-ref-section-none {
  font-style: italic;
  opacity: 0.7;
}
</style>
