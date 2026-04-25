<template>
  <div class="space-y-6">
    <header>
      <h1 class="h-page">审计</h1>
      <p class="text-fg-dim text-sm mt-1.5">登录历史与活动日志</p>
    </header>

    <!-- 子 Tab 切换 -->
    <div class="inline-flex items-center gap-1 surface p-1 rounded-xl">
      <button v-for="t in tabs" :key="t.id"
              @click="active = t.id"
              :class="[
                'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                active === t.id
                  ? 'bg-teal-300 text-[#062521]'
                  : 'text-fg-dim hover:text-fg'
              ]">
        {{ t.label }}
      </button>
    </div>

    <!-- 登录历史 -->
    <div v-if="active === 'login'" class="surface overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-line bg-bg-2/50">
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">时间</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">邮箱</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">IP</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">结果</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loginRows.length === 0">
              <td colspan="5" class="px-4 py-12 text-center text-fg-dim text-sm">暂无登录记录</td>
            </tr>
            <tr v-for="r in loginRows" :key="r.id" class="border-b border-line/60 hover:bg-white/3 transition-colors">
              <td class="px-4 py-3 text-xs text-fg-dim font-mono">{{ formatDateTime(r.timestamp) }}</td>
              <td class="px-4 py-3 text-xs font-mono text-fg">{{ r.email }}</td>
              <td class="px-4 py-3 text-xs font-mono text-fg-dim">{{ r.ip }}</td>
              <td class="px-4 py-3">
                <span :class="r.success ? 'badge-emerald' : 'badge-red'">
                  {{ r.success ? '成功' : '失败' }}
                </span>
              </td>
              <td class="px-4 py-3 text-xs text-fg-dim">{{ r.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 活动日志 -->
    <div v-else class="surface overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-line bg-bg-2/50">
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">时间</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">用户</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">操作</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">详情</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">IP</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="activityRows.length === 0">
              <td colspan="5" class="px-4 py-12 text-center text-fg-dim text-sm">暂无活动记录</td>
            </tr>
            <tr v-for="r in activityRows" :key="r.id" class="border-b border-line/60 hover:bg-white/3 transition-colors">
              <td class="px-4 py-3 text-xs text-fg-dim font-mono">{{ formatDateTime(r.timestamp) }}</td>
              <td class="px-4 py-3 text-xs font-mono text-fg">{{ r.username || r.email || '—' }}</td>
              <td class="px-4 py-3"><span class="badge-slate">{{ r.action }}</span></td>
              <td class="px-4 py-3 text-xs text-fg">{{ r.detail }}</td>
              <td class="px-4 py-3 text-xs font-mono text-fg-dim">{{ r.ip }}</td>
            </tr>
          </tbody>
        </table>
      </div>
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
