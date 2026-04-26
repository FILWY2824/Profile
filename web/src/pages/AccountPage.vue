<template>
  <div>
    <!-- 文头 -->
    <header class="mb-8">
      <h1 class="h-page">账户中心<span class="text-teal-300">.</span></h1>
      <p class="text-fg-dim mt-2 text-[15px]">管理个人信息、密码与已授权应用</p>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-6">
      <!-- 左侧 sidebar -->
      <aside class="lg:sticky lg:top-24 lg:self-start">
        <!-- 移动端横向 tabs -->
        <nav class="lg:hidden flex gap-1 overflow-x-auto pb-2 -mx-4 px-4 mb-4 border-b border-line">
          <button v-for="t in tabs" :key="t.id"
                  @click="active = t.id"
                  :class="[
                    'flex-shrink-0 px-3.5 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors',
                    active === t.id ? 'tab-mobile-active' : 'text-fg-dim'
                  ]">
            {{ t.label }}
          </button>
        </nav>
        <!-- 桌面端竖向 -->
        <div class="hidden lg:block surface p-2 space-y-0.5">
          <button v-for="t in tabs" :key="t.id"
                  @click="active = t.id"
                  :class="['tab-pill', active === t.id && 'tab-pill-active']">
            <span class="text-base">{{ t.icon }}</span>
            <span>{{ t.label }}</span>
          </button>
        </div>
      </aside>

      <!-- 右侧内容 -->
      <div>
        <!-- Profile -->
        <section v-if="active === 'profile'" class="surface p-6 sm:p-8 max-w-2xl">
          <h2 class="h-section mb-6">个人资料</h2>
          <div v-if="profile" class="space-y-5">
            <div class="flex items-center gap-4 pb-5 border-b border-line">
              <span class="profile-avatar">{{ initial }}</span>
              <div class="flex-1 min-w-0">
                <div class="font-mono text-sm text-fg truncate">{{ profile.email }}</div>
                <div class="text-xs text-fg-mute mt-1">{{ roleLabel }}</div>
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
            <div class="pt-2">
              <button @click="saveProfile" :disabled="busy" class="btn btn-primary">
                {{ busy ? "保存中…" : "保存修改" }}
              </button>
            </div>
          </div>
        </section>

        <!-- Password -->
        <section v-if="active === 'password'" class="surface p-6 sm:p-8 max-w-2xl">
          <h2 class="h-section mb-6">修改密码</h2>
          <div class="space-y-5">
            <div>
              <label class="label">原密码</label>
              <input v-model="oldPw" type="password" class="input input-mono" />
            </div>
            <div>
              <label class="label">新密码 (至少 8 字符)</label>
              <input v-model="newPw" type="password" minlength="8" class="input input-mono" placeholder="••••••••" />
            </div>
            <div class="flex gap-3 items-end">
              <div class="flex-1">
                <label class="label">邮箱验证码</label>
                <input v-model="pwCode" maxlength="6" class="input input-mono text-center tracking-[0.4em]" placeholder="000000" />
              </div>
              <button @click="sendPwCode" :disabled="busy" class="btn btn-secondary whitespace-nowrap">
                发送验证码
              </button>
            </div>
            <div v-if="devCode" class="dev-banner">
              <span class="text-warn font-mono font-semibold">DEV ·</span>
              <span class="text-fg ml-1 font-mono">{{ devCode }}</span>
            </div>
            <div class="pt-2">
              <button @click="changePassword" :disabled="busy" class="btn btn-primary">
                {{ busy ? "提交中…" : "确认修改" }}
              </button>
            </div>
          </div>
        </section>

        <!-- Logins -->
        <section v-if="active === 'logins'" class="surface p-6 sm:p-8">
          <div class="flex items-center justify-between mb-6">
            <h2 class="h-section">最近登录</h2>
            <span class="text-xs text-fg-mute font-mono">{{ logins.length }} 条</span>
          </div>
          <div v-if="logins.length === 0" class="text-center py-12 text-fg-dim text-sm">暂无记录</div>
          <div v-else class="overflow-x-auto -mx-2">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-line">
                  <th class="text-xs text-fg-mute font-medium py-2.5 px-2 text-left">时间</th>
                  <th class="text-xs text-fg-mute font-medium py-2.5 px-2 text-left">IP</th>
                  <th class="text-xs text-fg-mute font-medium py-2.5 px-2 text-left">User-Agent</th>
                  <th class="text-xs text-fg-mute font-medium py-2.5 px-2 text-left">结果</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="l in logins" :key="l.id" class="data-row">
                  <td class="py-2.5 px-2 font-mono text-xs text-fg-dim">{{ formatTime(l.timestamp) }}</td>
                  <td class="py-2.5 px-2 font-mono text-xs text-fg">{{ l.ip }}</td>
                  <td class="py-2.5 px-2 text-xs text-fg-dim truncate max-w-xs">{{ l.userAgent }}</td>
                  <td class="py-2.5 px-2">
                    <span :class="l.success ? 'badge-emerald' : 'badge-red'">
                      {{ l.success ? '成功' : (l.reason || '失败') }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- OAuth Grants -->
        <section v-if="active === 'apps'" class="surface p-6 sm:p-8">
          <div class="flex items-center justify-between mb-6">
            <h2 class="h-section">已授权应用</h2>
            <span class="text-xs text-fg-mute font-mono">{{ grants.length }} 项</span>
          </div>
          <div v-if="grants.length === 0" class="text-center py-12 text-fg-dim text-sm">暂无</div>
          <ul v-else class="space-y-3">
            <li v-for="g in grants" :key="g.id" class="grant-item">
              <div class="min-w-0 flex-1">
                <div class="h-sub truncate">{{ g.clientName }}</div>
                <div class="text-xs text-fg-mute mt-1 truncate font-mono">
                  {{ (g.scopes || []).join(' ') || '—' }} · 上次使用 {{ formatTime(g.lastUsedAt) }}
                </div>
              </div>
              <button @click="revokeGrant(g.id)" class="btn btn-danger btn-sm whitespace-nowrap">
                撤销
              </button>
            </li>
          </ul>
        </section>

        <!-- Activity -->
        <section v-if="active === 'activity'" class="surface p-6 sm:p-8">
          <div class="flex items-center justify-between mb-6">
            <h2 class="h-section">活动日志</h2>
            <span class="text-xs text-fg-mute font-mono">{{ activity.length }} 条</span>
          </div>
          <div v-if="activity.length === 0" class="text-center py-12 text-fg-dim text-sm">暂无</div>
          <ul v-else class="space-y-1">
            <li v-for="a in activity" :key="a.id"
                class="flex items-baseline gap-4 py-2.5 border-b border-line last:border-0 text-sm">
              <span class="font-mono text-xs text-fg-mute w-32 flex-shrink-0">{{ formatTime(a.timestamp) }}</span>
              <span class="text-teal-300">·</span>
              <span class="text-fg leading-relaxed">{{ a.detail || a.action }}</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../api.js";
import { okToast, errToast } from "../toast.js";
import { formatTime } from "../format.js";

const tabs = [
  { id: "profile",  icon: "👤", label: "个人资料" },
  { id: "password", icon: "🔑", label: "修改密码" },
  { id: "logins",   icon: "📋", label: "登录记录" },
  { id: "apps",     icon: "🔗", label: "授权应用" },
  { id: "activity", icon: "⚡", label: "活动日志" },
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
    okToast("密码已修改, 请重新登录");
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

<style scoped>
.profile-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: linear-gradient(135deg, #34D399, #10B981 55%, #047857);
  color: white;
  font-weight: 700;
  font-size: 24px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.3) inset,
    0 8px 18px -6px rgba(16, 185, 129, 0.5);
}
.tab-mobile-active {
  background: linear-gradient(135deg, #34D399, #10B981 60%, #047857);
  color: #fff !important;
  font-weight: 600;
  box-shadow: 0 4px 10px -3px rgba(16, 185, 129, 0.45);
}
.dev-banner {
  border-radius: 12px;
  border: 1px solid rgba(217, 119, 6, 0.40);
  background-color: rgba(254, 243, 199, 0.6);
  padding: 12px;
  font-size: 12px;
}
.data-row {
  border-bottom: 1px solid rgba(15, 36, 25, 0.06);
  transition: background-color 0.14s;
}
.data-row:hover {
  background-color: rgba(255, 255, 255, 0.5);
}
.grant-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 14px;
  background-color: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.7);
  transition: background-color 0.14s, border-color 0.14s;
}
.grant-item:hover {
  background-color: rgba(255, 255, 255, 0.8);
  border-color: rgba(255, 255, 255, 0.95);
}
</style>
