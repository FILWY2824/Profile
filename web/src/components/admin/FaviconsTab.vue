<template>
  <div class="space-y-6">
    <header>
      <h1 class="h-page">图标缓存<span class="text-teal-300">.</span></h1>
      <p class="text-fg-dim text-sm mt-1.5">解析卡片站点的 &lt;link rel="icon"&gt; 抓取精确图标</p>
    </header>

    <div class="surface overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="admin-thead">
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider w-12"></th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">Origin</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">来源</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">类型</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">抓取时间</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">错误</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="items.length === 0">
              <td colspan="7" class="px-4 py-12 text-center text-fg-dim text-sm">暂无</td>
            </tr>
            <tr v-for="r in pagedItems" :key="r.origin" class="admin-row">
              <td class="px-4 py-3">
                <div class="favicon-wrap">
                  <img v-if="r.hasData" :src="`/api/favicons/image?origin=${encodeURIComponent(r.origin)}`" class="h-5 w-5" alt="" />
                </div>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-fg">{{ r.origin }}</td>
              <td class="px-4 py-3 text-xs"><span class="badge-slate">{{ r.source || '—' }}</span></td>
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
      <div v-if="items.length > 0" class="px-4 py-2">
        <Pagination :total="items.length" v-model:current-page="page" :page-size="10" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import { useConfirm } from "../../confirm.js";
import { formatTime } from "../../format.js";
import Pagination from "../Pagination.vue";

const items = ref([]);
const page = ref(1);
const PAGE_SIZE = 10;

const pagedItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return items.value.slice(start, start + PAGE_SIZE);
});

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
</style>
