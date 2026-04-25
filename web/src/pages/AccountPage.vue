<template>
  <div class="space-y-6">
    <header>
      <h1 class="h-page">账户中心</h1>
      <p class="text-muted text-sm mt-1">管理个人信息、密码与已授权应用</p>
    </header>

    <!-- Tab 导航 -->
    <div class="flex gap-1 border-b border-slate-200">
      <button v-for="t in tabs" :key="t.id"
              @click="active = t.id"
              :class="[
                'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                active === t.id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-900'
              ]">
        {{ t.label }}
      </button>
    </div>

    <!-- Profile -->
    <div v-if="active === 'profile'" class="surface p-6 max-w-xl">
      <h2 class="h-section mb-4">个人资料</h2>
      <div v-if="profile" class="space-y-4">
        <div class="flex items-center gap-4">
          <div class="h-14 w-14 rounded-full bg-gradient-to-br from-accent-400 to-accent-700 text-white flex items-center justify-center text-xl font-semibold">
            {{ initial }}
          </div>
          <div>
            <div class="font-medium text-slate-900">{{ profile.email }}</div>
            <div class="text-xs text-muted">角色:{{ roleLabel }}</div>
          </div>
        </div>
        <div>
          <label class="label">显示名</label>
          <input v-model="profile.name" maxlength="60" class="input" />
        </div>
        <div>
          <label class="label">个人介绍</label>
          <textarea v-model="profile.bio" rows="3" maxlength="500" class="input"></textarea>
        </div>
        <button @click="saveProfile" :disabled="busy" class="btn-primary">{{ busy ? "保存中…" : "保存修改" }}</button>
      </div>
    </div>

    <!-- Password -->
    <div v-if="active === 'password'" class="surface p-6 max-w-xl">
      <h2 class="h-section mb-4">修改密码</h2>
      <div class="space-y-4">
        <div>
          <label class="label">旧密码</label>
          <input v-model="oldPw" type="password" class="input" />
        </div>
        <div>
          <label class="label">新密码</label>
          <input v-model="newPw" type="password" minlength="8" class="input" placeholder="至少 8 字符" />
        </div>
        <div class="flex gap-2 items-end">
          <div class="flex-1">
            <label class="label">邮箱验证码</label>
            <input v-model="pwCode" maxlength="6" class="input font-mono" placeholder="000000" />
          </div>
          <button @click="sendPwCode" :disabled="busy" class="btn-secondary">发送验证码</button>
        </div>
        <div v-if="devCode" class="text-xs bg-amber-50 ring-1 ring-amber-200/70 rounded-lg p-3 text-amber-800">
          [开发模式] 验证码:<span class="font-mono ml-1">{{ devCode }}</span>
        </div>
        <button @click="changePassword" :disabled="busy" class="btn-primary">{{ busy ? "提交中…" : "确认修改" }}</button>
      </div>
    </div>

    <!-- Logins -->
    <div v-if="active === 'logins'" class="surface p-6">
      <h2 class="h-section mb-4">最近登录</h2>
      <div v-if="logins.length === 0" class="text-muted text-sm py-6 text-center">暂无记录</div>
      <table v-else class="w-full text-sm">
        <thead>
          <tr class="text-xs uppercase tracking-wider text-slate-400">
            <th class="py-2 text-left font-medium">时间</th>
            <th class="py-2 text-left font-medium">IP</th>
            <th class="py-2 text-left font-medium">User-Agent</th>
            <th class="py-2 text-left font-medium">结果</th>
          </tr>
        </thead>
        <tbody class="divide-soft">
          <tr v-for="l in logins" :key="l.id">
            <td class="py-2 text-slate-600">{{ formatTime(l.timestamp) }}</td>
            <td class="py-2 text-slate-600 font-mono text-xs">{{ l.ip }}</td>
            <td class="py-2 text-slate-500 text-xs truncate max-w-xs">{{ l.userAgent }}</td>
            <td class="py-2">
              <span :class="l.success ? 'badge-emerald' : 'badge-red'">{{ l.success ? '成功' : (l.reason || '失败') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- OAuth Grants -->
    <div v-if="active === 'apps'" class="surface p-6">
      <h2 class="h-section mb-4">已授权应用</h2>
      <div v-if="grants.length === 0" class="text-muted text-sm py-6 text-center">暂无</div>
      <ul v-else class="space-y-2">
        <li v-for="g in grants" :key="g.id" class="flex items-center justify-between p-3 rounded-lg ring-1 ring-slate-100 hover:ring-slate-200">
          <div>
            <div class="font-medium text-slate-900">{{ g.clientName }}</div>
            <div class="text-xs text-muted">权限:{{ (g.scopes || []).join(' ') || '—' }} · 上次使用 {{ formatTime(g.lastUsedAt) }}</div>
          </div>
          <button @click="revokeGrant(g.id)" class="btn-ghost btn-sm text-red-600">撤销</button>
        </li>
      </ul>
    </div>

    <!-- Activity -->
    <div v-if="active === 'activity'" class="surface p-6">
      <h2 class="h-section mb-4">活动日志</h2>
      <div v-if="activity.length === 0" class="text-muted text-sm py-6 text-center">暂无记录</div>
      <ul v-else class="space-y-1">
        <li v-for="a in activity" :key="a.id" class="flex items-baseline gap-3 py-2 border-b border-slate-100 last:border-0 text-sm">
          <span class="text-xs text-slate-400 font-mono w-32 flex-shrink-0">{{ formatTime(a.timestamp) }}</span>
          <span class="text-slate-700">{{ a.detail || a.action }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../api.js";
import { okToast, errToast } from "../toast.js";
import { formatTime } from "../format.js";

const tabs = [
  { id: "profile", label: "个人资料" },
  { id: "password", label: "修改密码" },
  { id: "logins", label: "登录记录" },
  { id: "apps", label: "已授权应用" },
  { id: "activity", label: "活动日志" },
];
const active = ref("profile");

const profile = ref(null);
const oldPw = ref(""); const newPw = ref(""); const pwCode = ref(""); const devCode = ref("");
const busy = ref(false);
const logins = ref([]);
const grants = ref([]);
const activity = ref([]);

const initial = computed(() => (profile.value?.name || "?").charAt(0).toUpperCase());
const roleLabel = computed(() => ({user:"普通用户", member:"成员", admin:"管理员"}[profile.value?.role] || profile.value?.role));

async function loadProfile() {
  profile.value = await api.get("/account/profile");
}
async function saveProfile() {
  busy.value = true;
  try {
    await api.patch("/account/profile", { name: profile.value.name, bio: profile.value.bio });
    okToast("已保存");
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}
async function sendPwCode() {
  busy.value = true;
  try {
    const r = await api.post("/account/password/send-code");
    devCode.value = r.devCode || "";
    okToast("验证码已发送");
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}
async function changePassword() {
  busy.value = true;
  try {
    await api.post("/account/password/change", {
      oldPassword: oldPw.value, newPassword: newPw.value, code: pwCode.value,
    });
    okToast("密码已修改,请重新登录");
    setTimeout(() => location.hash = "/login", 800);
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}

async function loadLogins() {
  const r = await api.get("/account/login-history");
  logins.value = r.items || [];
}
async function loadGrants() {
  const r = await api.get("/account/oauth-grants");
  grants.value = r.items || [];
}
async function revokeGrant(id) {
  if (!confirm("确认撤销此应用的所有授权?")) return;
  try {
    await api.delete("/account/oauth-grants/" + id);
    okToast("已撤销");
    loadGrants();
  } catch (e) { errToast(e.message); }
}
async function loadActivity() {
  const r = await api.get("/account/activity");
  activity.value = r.items || [];
}

watch(active, (t) => {
  if (t === "profile") loadProfile();
  if (t === "logins") loadLogins();
  if (t === "apps") loadGrants();
  if (t === "activity") loadActivity();
});

onMounted(loadProfile);
</script>
