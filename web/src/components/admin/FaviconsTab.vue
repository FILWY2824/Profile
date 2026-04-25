<template>
  <div class="space-y-4">
    <header>
      <h1 class="h-page">图标缓存</h1>
      <p class="text-muted text-sm mt-1">解析卡片站点的 &lt;link rel=&quot;icon&quot;&gt; 抓取精确图标</p>
    </header>

    <div class="surface overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
          <tr>
            <th class="px-4 py-2.5 text-left font-medium w-12"></th>
            <th class="px-4 py-2.5 text-left font-medium">Origin</th>
            <th class="px-4 py-2.5 text-left font-medium">来源</th>
            <th class="px-4 py-2.5 text-left font-medium">类型</th>
            <th class="px-4 py-2.5 text-left font-medium">抓取时间</th>
            <th class="px-4 py-2.5 text-left font-medium">错误</th>
            <th class="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="items.length === 0">
            <td colspan="7" class="px-4 py-8 text-center text-muted text-sm">暂无</td>
          </tr>
          <tr v-for="r in items" :key="r.origin" class="hover:bg-slate-50">
            <td class="px-4 py-2.5">
              <img v-if="r.hasData" :src="`/api/favicons/image?origin=${encodeURIComponent(r.origin)}`" class="h-5 w-5" />
              <span v-else class="h-5 w-5 inline-block bg-slate-200 rounded"></span>
            </td>
            <td class="px-4 py-2.5 font-mono text-xs">{{ r.origin }}</td>
            <td class="px-4 py-2.5 text-xs"><span class="badge-slate">{{ r.source || '—' }}</span></td>
            <td class="px-4 py-2.5 text-xs text-muted">{{ r.contentType }}</td>
            <td class="px-4 py-2.5 text-xs text-muted">{{ formatTime(r.fetchedAt) }}</td>
            <td class="px-4 py-2.5 text-xs text-red-600 truncate max-w-xs">{{ r.lastError }}</td>
            <td class="px-4 py-2.5 text-right whitespace-nowrap">
              <button @click="onRefresh(r.origin)" class="btn-ghost btn-sm">刷新</button>
              <button @click="onDelete(r.origin)" class="btn-ghost btn-sm text-red-600">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import { formatTime } from "../../format.js";

const items = ref([]);
async function load() { const r = await api.get("/admin/favicons"); items.value = r.items || []; }

async function onRefresh(origin) {
  try { await api.post("/admin/favicons/refresh", { origin }); okToast("已刷新"); await load(); }
  catch (e) { errToast(e.message); }
}
async function onDelete(origin) {
  if (!confirm(`删除 ${origin} 的缓存?`)) return;
  try { await api.delete("/admin/favicons/" + encodeURIComponent(origin)); okToast("已删除"); await load(); }
  catch (e) { errToast(e.message); }
}
onMounted(load);
</script>
