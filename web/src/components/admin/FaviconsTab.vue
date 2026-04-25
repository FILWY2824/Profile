<template>
  <div class="space-y-4">
    <div class="card p-4">
      <h2 class="mb-2 text-sm font-medium text-ink-900">手动刷新 favicon</h2>
      <p class="mb-3 text-xs text-ink-500">
        仅当某个 origin 已被某张卡片引用时,才能在此手动刷新其图标缓存。
      </p>
      <form @submit.prevent="onRefresh" class="flex gap-2">
        <input v-model="refreshOrigin" type="url" required class="input" placeholder="https://example.com" />
        <button :disabled="busy" class="btn-primary">{{ busy ? "刷新中…" : "刷新" }}</button>
      </form>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-ink-50 text-left text-xs uppercase text-ink-500">
          <tr>
            <th class="px-4 py-2">origin</th>
            <th class="px-4 py-2">来源</th>
            <th class="px-4 py-2">类型</th>
            <th class="px-4 py-2">抓取时间</th>
            <th class="px-4 py-2">状态</th>
            <th class="px-4 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-for="r in items" :key="r.origin">
            <td class="px-4 py-2 text-xs">
              <div class="flex items-center gap-2">
                <img :src="`/api/favicons/image?origin=${encodeURIComponent(r.origin)}`" alt="" class="h-4 w-4" />
                <span class="font-mono">{{ r.origin }}</span>
              </div>
            </td>
            <td class="px-4 py-2 text-ink-700">{{ r.source }}</td>
            <td class="px-4 py-2 font-mono text-xs text-ink-500">{{ r.contentType }}</td>
            <td class="px-4 py-2 text-xs text-ink-500">{{ formatTime(r.fetchedAt) }}</td>
            <td class="px-4 py-2">
              <span v-if="r.hasData" class="badge bg-emerald-100 text-emerald-800">就绪</span>
              <span v-else class="badge bg-red-100 text-red-800" :title="r.lastError">失败</span>
            </td>
            <td class="px-4 py-2 text-right">
              <button @click="del(r)" class="btn-danger">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!items.length && !loading" class="p-6 text-center text-ink-500">无缓存</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import { formatTime } from "../../format.js";

const items = ref([]);
const loading = ref(true);
const refreshOrigin = ref("");
const busy = ref(false);

async function load() {
  loading.value = true;
  try {
    const r = await api.get("/admin/favicons");
    items.value = r.items || [];
  } finally {
    loading.value = false;
  }
}
async function onRefresh() {
  busy.value = true;
  try {
    await api.post("/admin/favicons/refresh", { origin: refreshOrigin.value });
    okToast("已刷新");
    refreshOrigin.value = "";
    await load();
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}
async function del(r) {
  if (!confirm(`删除 ${r.origin} 的缓存?`)) return;
  try { await api.delete(`/admin/favicons/${encodeURIComponent(r.origin)}`); okToast("已删除"); await load(); }
  catch (e) { errToast(e.message); }
}
onMounted(load);
</script>
