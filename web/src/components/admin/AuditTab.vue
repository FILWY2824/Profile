<template>
  <div class="space-y-4">
    <header>
      <h1 class="h-page">审计</h1>
      <p class="text-muted text-sm mt-1">登录历史与活动日志</p>
    </header>

    <div class="flex gap-1 border-b border-slate-200">
      <button v-for="t in tabs" :key="t.id"
              @click="active = t.id"
              :class="['px-4 py-2 text-sm font-medium border-b-2 -mb-px',
                       active === t.id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-900']">
        {{ t.label }}
      </button>
    </div>

    <div class="surface overflow-hidden">
      <table v-if="active === 'login'" class="w-full text-sm">
        <thead class="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
          <tr>
            <th class="px-4 py-2.5 text-left font-medium">时间</th>
            <th class="px-4 py-2.5 text-left font-medium">邮箱</th>
            <th class="px-4 py-2.5 text-left font-medium">IP</th>
            <th class="px-4 py-2.5 text-left font-medium">结果</th>
            <th class="px-4 py-2.5 text-left font-medium">原因</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="r in loginRows" :key="r.id" class="hover:bg-slate-50">
            <td class="px-4 py-2.5 text-xs text-muted">{{ formatDateTime(r.timestamp) }}</td>
            <td class="px-4 py-2.5 text-xs font-mono">{{ r.email }}</td>
            <td class="px-4 py-2.5 text-xs font-mono">{{ r.ip }}</td>
            <td class="px-4 py-2.5"><span :class="r.success ? 'badge-emerald' : 'badge-red'">{{ r.success ? '成功' : '失败' }}</span></td>
            <td class="px-4 py-2.5 text-xs text-muted">{{ r.reason }}</td>
          </tr>
        </tbody>
      </table>

      <table v-else class="w-full text-sm">
        <thead class="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
          <tr>
            <th class="px-4 py-2.5 text-left font-medium">时间</th>
            <th class="px-4 py-2.5 text-left font-medium">用户</th>
            <th class="px-4 py-2.5 text-left font-medium">操作</th>
            <th class="px-4 py-2.5 text-left font-medium">详情</th>
            <th class="px-4 py-2.5 text-left font-medium">IP</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="r in activityRows" :key="r.id" class="hover:bg-slate-50">
            <td class="px-4 py-2.5 text-xs text-muted">{{ formatDateTime(r.timestamp) }}</td>
            <td class="px-4 py-2.5 text-xs font-mono">{{ r.username || r.email || '—' }}</td>
            <td class="px-4 py-2.5"><span class="badge-slate font-mono">{{ r.action }}</span></td>
            <td class="px-4 py-2.5 text-xs">{{ r.detail }}</td>
            <td class="px-4 py-2.5 text-xs font-mono">{{ r.ip }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from "vue";
import { api } from "../../api.js";
import { formatDateTime } from "../../format.js";

const tabs = [{ id: "login", label: "登录历史" }, { id: "activity", label: "活动日志" }];
const active = ref("login");
const loginRows = ref([]);
const activityRows = ref([]);

async function load() {
  if (active.value === "login") {
    const r = await api.get("/admin/login-history");
    loginRows.value = r.items || [];
  } else {
    const r = await api.get("/admin/activity-log");
    activityRows.value = r.items || [];
  }
}

watch(active, load);
onMounted(load);
</script>
