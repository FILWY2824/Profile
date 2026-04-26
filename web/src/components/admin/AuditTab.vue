<template>
  <div class="space-y-6">
    <header>
      <h1 class="h-page">审计<span class="text-teal-300">.</span></h1>
      <p class="text-fg-dim text-sm mt-1.5">登录历史与活动日志</p>
    </header>

    <!-- 子 Tab 切换 -->
    <div class="audit-subtabs">
      <button v-for="t in tabs" :key="t.id"
              @click="setActive(t.id)"
              :class="['audit-subtab', active === t.id && 'audit-subtab-active']">
        {{ t.label }}
      </button>
    </div>

    <!-- 登录历史 -->
    <div v-if="active === 'login'" class="surface overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="admin-thead">
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">时间</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">邮箱</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">IP</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">结果</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loginRows.length === 0">
              <td colspan="5" class="px-4 py-12 text-center text-fg-dim text-sm">暂无登录记录</td>
            </tr>
            <tr v-for="r in loginRows" :key="r.id" class="admin-row">
              <td class="px-4 py-3 text-xs text-fg-dim font-mono whitespace-nowrap">{{ formatDateTime(r.timestamp) }}</td>
              <td class="px-4 py-3 text-xs font-mono text-fg">{{ r.email }}</td>
              <td class="px-4 py-3 text-xs font-mono text-fg-dim whitespace-nowrap">{{ r.ip }}</td>
              <td class="px-4 py-3 whitespace-nowrap">
                <span :class="r.success ? 'badge-emerald' : 'badge-red'">
                  {{ r.success ? '成功' : '失败' }}
                </span>
              </td>
              <td class="px-4 py-3 text-xs text-fg-dim">{{ r.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="loginTotal > 0" class="px-4 py-2">
        <Pagination :total="loginTotal" v-model:current-page="loginPage" :page-size="10" @page-change="loadLogin" />
      </div>
    </div>

    <!-- 活动日志 -->
    <div v-else class="surface overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="admin-thead">
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">时间</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">用户</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">操作</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">详情</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">IP</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="activityRows.length === 0">
              <td colspan="5" class="px-4 py-12 text-center text-fg-dim text-sm">暂无活动记录</td>
            </tr>
            <tr v-for="r in activityRows" :key="r.id" class="admin-row">
              <td class="px-4 py-3 text-xs text-fg-dim font-mono whitespace-nowrap">{{ formatDateTime(r.timestamp) }}</td>
              <td class="px-4 py-3 text-xs font-mono text-fg">{{ r.username || r.email || '—' }}</td>
              <td class="px-4 py-3 whitespace-nowrap"><span class="badge-slate">{{ r.action }}</span></td>
              <td class="px-4 py-3 text-xs text-fg">{{ r.detail }}</td>
              <td class="px-4 py-3 text-xs font-mono text-fg-dim whitespace-nowrap">{{ r.ip }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="activityTotal > 0" class="px-4 py-2">
        <Pagination :total="activityTotal" v-model:current-page="activityPage" :page-size="10" @page-change="loadActivity" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../../api.js";
import { errToast } from "../../toast.js";
import { formatDateTime } from "../../format.js";
import Pagination from "../Pagination.vue";

const tabs = [{ id: "login", label: "登录历史" }, { id: "activity", label: "活动日志" }];
const active = ref("login");

const loginRows = ref([]);
const loginTotal = ref(0);
const loginPage = ref(1);

const activityRows = ref([]);
const activityTotal = ref(0);
const activityPage = ref(1);

async function loadLogin() {
  try {
    const r = await api.get(`/admin/login-history?limit=10&offset=${(loginPage.value - 1) * 10}`);
    loginRows.value = r.items || [];
    loginTotal.value = r.total || 0;
  } catch (e) { errToast(e.message); }
}

async function loadActivity() {
  try {
    const r = await api.get(`/admin/activity-log?limit=10&offset=${(activityPage.value - 1) * 10}`);
    activityRows.value = r.items || [];
    activityTotal.value = r.total || 0;
  } catch (e) { errToast(e.message); }
}

function setActive(t) {
  active.value = t;
  if (t === "login") {
    loginPage.value = 1;
    loadLogin();
  } else {
    activityPage.value = 1;
    loadActivity();
  }
}

onMounted(loadLogin);
</script>

<style scoped>
.audit-subtabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 14px;
  background-color: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.75);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset;
}
.audit-subtab {
  padding: 6px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--fg-dim);
  transition: background-color 0.15s, color 0.15s;
  background: transparent;
  border: none;
  cursor: pointer;
}
.audit-subtab:hover {
  color: var(--fg);
  background-color: rgba(255, 255, 255, 0.5);
}
.audit-subtab-active {
  background: linear-gradient(135deg, #34D399, #10B981 60%, #047857);
  color: #fff !important;
  font-weight: 600;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.3) inset,
    0 4px 10px -3px rgba(16, 185, 129, 0.45);
}
.audit-subtab-active:hover {
  color: #fff;
}

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
</style>
