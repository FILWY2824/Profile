<template>
  <div class="space-y-3">
    <div v-if="loading" class="card p-6 text-center text-ink-500">加载中…</div>
    <div v-else-if="items.length === 0" class="card p-6 text-center text-ink-500">
      尚未授权任何应用
    </div>

    <div v-for="g in items" :key="g.id" class="card flex items-center gap-4 p-4">
      <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-ink-100 text-sm text-ink-600">
        {{ g.clientName.slice(0, 1) }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="font-medium text-ink-900">{{ g.clientName }}</div>
        <div class="mt-0.5 text-xs text-ink-500">
          授权于 {{ formatTime(g.grantedAt) }}
          <span v-if="g.lastUsedAt"> · 最近使用 {{ formatTime(g.lastUsedAt) }}</span>
        </div>
        <div class="mt-1 flex flex-wrap gap-1">
          <span v-for="s in g.scopes" :key="s" class="badge bg-ink-100 text-ink-700">{{ s }}</span>
        </div>
      </div>
      <button @click="onRevoke(g)" class="btn-danger" :disabled="busy === g.id">
        {{ busy === g.id ? "…" : "撤销" }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../../api.js";
import { formatTime } from "../../format.js";
import { okToast, errToast } from "../../toast.js";

const items = ref([]);
const loading = ref(true);
const busy = ref(null);

async function load() {
  loading.value = true;
  try {
    const r = await api.get("/account/oauth-grants");
    items.value = r.items || [];
  } finally {
    loading.value = false;
  }
}

async function onRevoke(g) {
  if (!confirm(`确定撤销「${g.clientName}」的授权?其下次访问将需要重新登录。`)) return;
  busy.value = g.id;
  try {
    await api.delete(`/account/oauth-grants/${g.id}`);
    okToast("已撤销");
    await load();
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = null;
  }
}

onMounted(load);
</script>
