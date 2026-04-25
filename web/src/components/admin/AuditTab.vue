<template>
  <div class="space-y-4">
    <div class="flex gap-1 border-b border-ink-100 text-sm">
      <button
        @click="sub = 'logins'"
        :class="['px-3 py-1.5 -mb-px border-b-2', sub === 'logins' ? 'border-ink-600 font-medium' : 'border-transparent text-ink-500']"
      >登录历史</button>
      <button
        @click="sub = 'activity'"
        :class="['px-3 py-1.5 -mb-px border-b-2', sub === 'activity' ? 'border-ink-600 font-medium' : 'border-transparent text-ink-500']"
      >活动日志</button>
    </div>

    <div class="card overflow-x-auto">
      <table v-if="sub === 'logins'" class="w-full text-sm">
        <thead class="bg-ink-50 text-left text-xs uppercase text-ink-500">
          <tr>
            <th class="px-4 py-2">时间</th>
            <th class="px-4 py-2">邮箱</th>
            <th class="px-4 py-2">IP</th>
            <th class="px-4 py-2">结果</th>
            <th class="px-4 py-2">原因</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-for="r in logins" :key="r.id">
            <td class="px-4 py-2 whitespace-nowrap text-ink-700">{{ formatTime(r.createdAt) }}</td>
            <td class="px-4 py-2 text-ink-900">{{ r.email }}</td>
            <td class="px-4 py-2 font-mono text-xs">{{ r.ip }}</td>
            <td class="px-4 py-2">
              <span class="badge" :class="r.success ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'">
                {{ r.success ? "成功" : "失败" }}
              </span>
            </td>
            <td class="px-4 py-2 text-xs text-ink-500">{{ r.failReason }}</td>
          </tr>
        </tbody>
      </table>

      <table v-else class="w-full text-sm">
        <thead class="bg-ink-50 text-left text-xs uppercase text-ink-500">
          <tr>
            <th class="px-4 py-2">时间</th>
            <th class="px-4 py-2">用户</th>
            <th class="px-4 py-2">动作</th>
            <th class="px-4 py-2">详情</th>
            <th class="px-4 py-2">IP</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-for="r in activity" :key="r.id">
            <td class="px-4 py-2 whitespace-nowrap text-ink-700">{{ formatTime(r.createdAt) }}</td>
            <td class="px-4 py-2 text-ink-700">{{ r.email || r.username || "—" }}</td>
            <td class="px-4 py-2"><code class="rounded bg-ink-50 px-1.5 py-0.5 text-xs">{{ r.action }}</code></td>
            <td class="px-4 py-2 text-ink-700">{{ r.detail }}</td>
            <td class="px-4 py-2 font-mono text-xs">{{ r.ip }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from "vue";
import { api } from "../../api.js";
import { formatTime } from "../../format.js";

const sub = ref("logins");
const logins = ref([]);
const activity = ref([]);

async function loadLogins() {
  const r = await api.get("/admin/login-history?limit=200");
  logins.value = r.items || [];
}
async function loadActivity() {
  const r = await api.get("/admin/activity-log?limit=200");
  activity.value = r.items || [];
}

watch(sub, (v) => {
  if (v === "logins" && !logins.value.length) loadLogins();
  else if (v === "activity" && !activity.value.length) loadActivity();
});

onMounted(loadLogins);
</script>
