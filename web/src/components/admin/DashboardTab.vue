<template>
  <div class="space-y-6">
    <header>
      <h1 class="h-page">总览</h1>
      <p class="text-muted text-sm mt-1">站点统计与运行状况</p>
    </header>

    <div v-if="loading" class="surface p-8 text-center text-muted">加载中…</div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="surface p-5">
        <div class="text-xs uppercase tracking-wider text-slate-400 font-medium">用户总数</div>
        <div class="mt-1.5 text-2xl font-semibold text-slate-900">{{ data.users?.total || 0 }}</div>
        <div class="mt-1 text-xs text-muted">
          管理员 {{ data.users?.byRole?.admin || 0 }} · 成员 {{ data.users?.byRole?.member || 0 }} · 用户 {{ data.users?.byRole?.user || 0 }}
        </div>
      </div>
      <div class="surface p-5">
        <div class="text-xs uppercase tracking-wider text-slate-400 font-medium">板块</div>
        <div class="mt-1.5 text-2xl font-semibold text-slate-900">{{ data.sections || 0 }}</div>
      </div>
      <div class="surface p-5">
        <div class="text-xs uppercase tracking-wider text-slate-400 font-medium">卡片</div>
        <div class="mt-1.5 text-2xl font-semibold text-slate-900">{{ data.cards || 0 }}</div>
      </div>
      <div class="surface p-5">
        <div class="text-xs uppercase tracking-wider text-slate-400 font-medium">健康状态</div>
        <div class="mt-1.5 text-2xl font-semibold text-emerald-600">运行中</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../../api.js";

const data = ref({});
const loading = ref(true);
onMounted(async () => {
  try { data.value = await api.get("/admin/dashboard"); }
  finally { loading.value = false; }
});
</script>
