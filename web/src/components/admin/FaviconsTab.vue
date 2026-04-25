<template>
  <div class="space-y-6">
    <header>
      <h1 class="h-page">图标缓存</h1>
      <p class="text-fg-dim text-sm mt-1.5">解析卡片站点的 &lt;link rel="icon"&gt; 抓取精确图标</p>
    </header>

    <div class="surface overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-line bg-bg-2/50">
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider w-12"></th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">Origin</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">来源</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">类型</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">抓取时间</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">错误</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="items.length === 0">
              <td colspan="7" class="px-4 py-12 text-center text-fg-dim text-sm">暂无</td>
            </tr>
            <tr v-for="r in items" :key="r.origin" class="border-b border-line/60 hover:bg-white/3 transition-colors">
              <td class="px-4 py-3">
                <div class="h-7 w-7 rounded-lg bg-bg-0 border border-line flex items-center justify-center overflow-hidden">
                  <img v-if="r.hasData" :src="`/api/favicons/image?origin=${encodeURIComponent(r.origin)}`" class="h-5 w-5" />
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
