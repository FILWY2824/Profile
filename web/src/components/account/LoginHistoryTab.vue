<template>
  <div class="card overflow-hidden">
    <div v-if="loading" class="p-6 text-center text-ink-500">加载中…</div>
    <div v-else-if="items.length === 0" class="p-6 text-center text-ink-500">无记录</div>
    <table v-else class="w-full text-sm">
      <thead class="bg-ink-50 text-left text-xs uppercase text-ink-500">
        <tr>
          <th class="px-4 py-2 font-medium">时间</th>
          <th class="px-4 py-2 font-medium">IP</th>
          <th class="px-4 py-2 font-medium">User-Agent</th>
          <th class="px-4 py-2 font-medium">结果</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-ink-100">
        <tr v-for="r in items" :key="r.id">
          <td class="px-4 py-2 text-ink-700">{{ formatTime(r.createdAt) }}</td>
          <td class="px-4 py-2 font-mono text-xs text-ink-700">{{ r.ip }}</td>
          <td class="truncate px-4 py-2 text-xs text-ink-500" :title="r.userAgent" style="max-width: 24rem">
            {{ r.userAgent }}
          </td>
          <td class="px-4 py-2">
            <span class="badge" :class="r.success ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'">
              {{ r.success ? "成功" : "失败" }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../../api.js";
import { formatTime } from "../../format.js";
const items = ref([]);
const loading = ref(true);
onMounted(async () => {
  try {
    const r = await api.get("/account/login-history");
    items.value = r.items || [];
  } finally {
    loading.value = false;
  }
});
</script>
