<template>
  <div class="card overflow-hidden">
    <div v-if="loading" class="p-6 text-center text-ink-500">加载中…</div>
    <div v-else-if="items.length === 0" class="p-6 text-center text-ink-500">无记录</div>
    <ul v-else class="divide-y divide-ink-100">
      <li v-for="r in items" :key="r.id" class="px-4 py-3 text-sm">
        <div class="flex items-baseline justify-between gap-4">
          <span class="font-medium text-ink-800">{{ r.detail || r.action }}</span>
          <span class="flex-shrink-0 text-xs text-ink-400">{{ formatTime(r.createdAt) }}</span>
        </div>
        <div class="mt-1 flex items-center gap-2 text-xs text-ink-500">
          <code class="rounded bg-ink-50 px-1.5 py-0.5">{{ r.action }}</code>
          <span v-if="r.ip" class="font-mono">{{ r.ip }}</span>
        </div>
      </li>
    </ul>
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
    const r = await api.get("/account/activity");
    items.value = r.items || [];
  } finally {
    loading.value = false;
  }
});
</script>
