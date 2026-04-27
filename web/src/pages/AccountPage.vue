<template>
  <!-- 与 NavBar 严格对齐:外层只负责 padding(满视口),内层负责 max-w-7xl 居中。
       padding 必须放在 max-width 之外,否则视口 > 1280px 时账号侧栏会比顶栏内
       缩 32px。 -->
  <div class="account-outer">
   <div class="account-inner">
    <div class="account-shell">
      <aside class="acc-sidebar">
        <!-- 移动端横向 tabs -->
        <nav class="lg:hidden flex gap-1 overflow-x-auto pb-2 px-4 border-b border-line acc-mobile-tabs">
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
        <div class="hidden lg:block acc-side-nav">
          <div class="acc-side-title">账户中心</div>
          <button v-for="t in tabs" :key="t.id"
                  @click="active = t.id"
                  :class="['acc-side-item', active === t.id && 'acc-side-item-active']">
            {{ t.label }}
          </button>
        </div>
      </aside>

      <main class="acc-main">
        <header class="acc-page-head">
          <h1 class="h-page">{{ activeTab.label }}<span class="text-teal-300">.</span></h1>
          <p class="text-fg-dim mt-1.5 text-sm">{{ activeTab.subtitle }}</p>
        </header>

        <!-- Profile -->
        <section v-if="active === 'profile'" class="surface p-6 sm:p-8 max-w-2xl">
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
          <div class="space-y-5">
            <div>
              <label class="label">原密码</label>
              <PasswordInput v-model="oldPw" autocomplete="current-password" placeholder="••••••••" />
            </div>
            <div>
              <label class="label">新密码 (至少 8 字符)</label>
              <PasswordInput v-model="newPw" :minlength="8" autocomplete="new-password" placeholder="••••••••" />
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
            <div class="pt-2">
              <button @click="changePassword" :disabled="busy" class="btn btn-primary">
                {{ busy ? "提交中…" : "确认修改" }}
              </button>
            </div>
          </div>
        </section>

        <!-- Logins — 用 toolbar 行替代独立 h2,避免与页头 h1"登录历史" 重复 -->
        <section v-if="active === 'logins'" class="surface p-6 sm:p-8">
          <div class="acc-toolbar">
            <input v-model="loginsSearch" placeholder="搜索 IP / User-Agent / 结果…" class="input acc-search" />
            <span class="acc-count">共 {{ filteredLogins.length }} / {{ loginsTotal }} 条</span>
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
                <tr v-for="l in filteredLogins" :key="l.id" class="data-row">
                  <td class="py-2.5 px-2 font-mono text-xs text-fg-dim whitespace-nowrap">{{ formatTime(l.timestamp) }}</td>
                  <td class="py-2.5 px-2 font-mono text-xs text-fg whitespace-nowrap">{{ l.ip }}</td>
                  <td class="py-2.5 px-2 text-xs text-fg-dim truncate max-w-xs">{{ l.userAgent }}</td>
                  <td class="py-2.5 px-2 whitespace-nowrap">
                    <span :class="l.success ? 'badge-emerald' : 'badge-red'">
                      {{ l.success ? (l.reason || '成功') : (l.reason || '失败') }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <Pagination
            :total="loginsTotal"
            v-model:current-page="loginsPage"
            :page-size="10"
            @page-change="loadLogins"
          />
        </section>

        <!-- OAuth Grants — 不再单独写 "已授权应用" 标题;页头 h1 已经显示 "授权应用",
             重复写一遍属于冗余。这里只放一个 toolbar(搜索 + 计数)。 -->
        <section v-if="active === 'apps'" class="surface p-6 sm:p-8">
          <div class="acc-toolbar">
            <input v-model="grantsSearch" placeholder="搜索应用名 / scope…" class="input acc-search" />
            <span class="acc-count">共 {{ filteredGrants.length }} / {{ grants.length }} 项</span>
          </div>
          <div v-if="grants.length === 0" class="text-center py-12 text-fg-dim text-sm">暂无</div>
          <ul v-else class="space-y-3">
            <li v-for="g in filteredGrants" :key="g.id" class="grant-item">
              <div class="min-w-0 flex-1">
                <div class="h-sub truncate">{{ g.clientName }}</div>
                <div class="text-xs text-fg-mute mt-1 truncate font-mono">
                  {{ (g.scopes || []).join(' ') || '—' }} · 上次使用 {{ formatTime(g.lastUsedAt) }}
                </div>
              </div>
              <button @click="revokeGrant(g)" class="btn btn-danger btn-sm whitespace-nowrap">
                撤销
              </button>
            </li>
          </ul>
        </section>

        <!-- Activity — 同样去掉重复的 "活动日志" 二级标题 -->
        <section v-if="active === 'activity'" class="surface p-6 sm:p-8">
          <div class="acc-toolbar">
            <input v-model="activitySearch" placeholder="搜索 action / 详情…" class="input acc-search" />
            <span class="acc-count">共 {{ filteredActivity.length }} / {{ activityTotal }} 条</span>
          </div>
          <div v-if="activity.length === 0" class="text-center py-12 text-fg-dim text-sm">暂无</div>
          <ul v-else class="space-y-1">
            <li v-for="a in filteredActivity" :key="a.id"
                class="flex items-baseline gap-4 py-2.5 border-b border-line last:border-0 text-sm">
              <span class="font-mono text-xs text-fg-mute w-32 flex-shrink-0">{{ formatTime(a.timestamp) }}</span>
              <span class="text-teal-300">·</span>
              <span class="text-fg leading-relaxed">{{ a.detail || a.action }}</span>
            </li>
          </ul>
          <Pagination
            :total="activityTotal"
            v-model:current-page="activityPage"
            :page-size="10"
            @page-change="loadActivity"
          />
        </section>
      </main>
    </div>
   </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../api.js";
import { okToast, errToast } from "../toast.js";
import { formatTime } from "../format.js";
import { useConfirm } from "../confirm.js";
import PasswordInput from "../components/PasswordInput.vue";
import Pagination from "../components/Pagination.vue";

const tabs = [
  { id: "profile",  label: "个人资料", subtitle: "管理你的姓名、简介与邮箱信息" },
  { id: "password", label: "修改密码", subtitle: "凭原密码 + 邮件验证码即可更换" },
  { id: "logins",   label: "登录历史", subtitle: "记录每一次会话的来源与结果" },
  { id: "apps",     label: "授权应用", subtitle: "查看并撤销使用 OAuth 接入的应用" },
  { id: "activity", label: "活动日志", subtitle: "你在站点内的关键操作时间线" },
];
const active = ref("profile");
const activeTab = computed(() => tabs.find(t => t.id === active.value) || tabs[0]);

const profile = ref(null);
const oldPw = ref(""); const newPw = ref(""); const pwCode = ref("");
const busy = ref(false);

const logins = ref([]);
const loginsTotal = ref(0);
const loginsPage = ref(1);
const loginsSearch = ref("");

const grants = ref([]);
const grantsSearch = ref("");

const activity = ref([]);
const activityTotal = ref(0);
const activityPage = ref(1);
const activitySearch = ref("");

const initial = computed(() => (profile.value?.name || "?").charAt(0).toUpperCase());
const roleLabel = computed(() => ({user:"普通用户", member:"成员", admin:"管理员"}[profile.value?.role] || profile.value?.role));

// 客户端搜索 — 服务端已经做了分页,这里只在当前页内做模糊匹配。这是
// "拿到了 10 条再筛"的轻量做法,不发起额外请求。
const filteredLogins = computed(() => {
  const q = loginsSearch.value.trim().toLowerCase();
  if (!q) return logins.value;
  return logins.value.filter(l =>
    (l.ip || "").toLowerCase().includes(q) ||
    (l.userAgent || "").toLowerCase().includes(q) ||
    (l.reason || "").toLowerCase().includes(q));
});
const filteredGrants = computed(() => {
  const q = grantsSearch.value.trim().toLowerCase();
  if (!q) return grants.value;
  return grants.value.filter(g =>
    (g.clientName || "").toLowerCase().includes(q) ||
    (g.scopes || []).join(" ").toLowerCase().includes(q));
});
const filteredActivity = computed(() => {
  const q = activitySearch.value.trim().toLowerCase();
  if (!q) return activity.value;
  return activity.value.filter(a =>
    (a.action || "").toLowerCase().includes(q) ||
    (a.detail || "").toLowerCase().includes(q));
});

async function loadProfile() {
  try {
    profile.value = await api.get("/account/profile");
  } catch (e) { errToast(e.message); }
}
async function saveProfile() {
  busy.value = true;
  try {
    await api.patch("/account/profile", { name: profile.value.name, bio: profile.value.bio });
    okToast("个人资料已保存");
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}
async function sendPwCode() {
  busy.value = true;
  try {
    await api.post("/account/password/send-code");
    okToast("验证码已发送至您的邮箱");
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
  try {
    const r = await api.get(`/account/login-history?limit=10&offset=${(loginsPage.value - 1) * 10}`);
    logins.value = r.items || [];
    loginsTotal.value = r.total || 0;
  } catch (e) { errToast(e.message); }
}
async function loadGrants() {
  try {
    const r = await api.get("/account/oauth-grants");
    grants.value = r.items || [];
  } catch (e) { errToast(e.message); }
}
async function revokeGrant(grant) {
  const ok = await useConfirm({
    title: "撤销授权",
    message: `确认撤销 ${grant.clientName} 对你账户的所有访问?`,
    detail: "应用本次会话的所有 access token / refresh token 将立即失效。",
    kind: "danger",
    confirmText: "立即撤销",
  });
  if (!ok) return;
  try {
    await api.delete("/account/oauth-grants/" + grant.id);
    okToast("已撤销该应用的授权");
    loadGrants();
  } catch (e) { errToast(e.message); }
}
async function loadActivity() {
  try {
    const r = await api.get(`/account/activity?limit=10&offset=${(activityPage.value - 1) * 10}`);
    activity.value = r.items || [];
    activityTotal.value = r.total || 0;
  } catch (e) { errToast(e.message); }
}

watch(active, (t) => {
  if (t === "profile") loadProfile();
  if (t === "logins") { loginsPage.value = 1; loadLogins(); }
  if (t === "apps") loadGrants();
  if (t === "activity") { activityPage.value = 1; loadActivity(); }
});

onMounted(loadProfile);
</script>

<style scoped>
/* 外层 — 满视口宽 + 与顶栏同 padding(padding 在 max-width 之外)。
   见 AdminPage.vue 同款注释,理由相同。 */
.account-outer {
  height: 100%;
  width: 100%;
  padding: 0 1rem;
}
@media (min-width: 640px) {
  .account-outer { padding-left: 1.5rem; padding-right: 1.5rem; }
}
@media (min-width: 1024px) {
  .account-outer { padding-left: 2rem; padding-right: 2rem; }
}
@media (max-width: 1023px) {
  .account-outer { height: auto; overflow: visible; }
}

/* 内层 — `mx-auto max-w-7xl` 与顶栏严格一致,无 padding。 */
.account-inner {
  height: 100%;
  width: 100%;
  margin: 0 auto;
  max-width: 80rem;
}
@media (max-width: 1023px) {
  .account-inner { height: auto; }
}

.account-shell {
  display: grid;
  grid-template-columns: 14rem 1fr;
  gap: 0;
  height: 100%;
  width: 100%;
}
@media (max-width: 1023px) {
  .account-shell {
    grid-template-columns: 1fr;
    height: auto;
  }
}

.acc-sidebar {
  position: sticky;
  top: 0;
  align-self: stretch;
  padding: 24px 16px 24px 0;
  height: 100%;
  overflow: hidden;
}
@media (max-width: 1023px) {
  .acc-sidebar { padding: 12px 0; height: auto; }
}

.acc-side-title {
  font-family: "Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-mute);
  padding: 6px 12px 14px;
}

.acc-side-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 12px;
}

.acc-side-item {
  display: flex;
  align-items: center;
  padding: 9px 14px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--fg-dim);
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  transition: all 0.15s ease;
  cursor: pointer;
}
.acc-side-item:hover {
  background-color: rgba(255, 255, 255, 0.55);
  color: var(--fg);
}
.acc-side-item-active {
  background: linear-gradient(135deg, rgba(167, 243, 208, 0.55), rgba(110, 231, 183, 0.40));
  color: var(--brand-deep);
  font-weight: 600;
  border-color: rgba(110, 231, 183, 0.45);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset;
}
.acc-side-item-active:hover {
  background: linear-gradient(135deg, rgba(167, 243, 208, 0.7), rgba(110, 231, 183, 0.55));
}

/* 主区 — 独立滚动,padding 与顶栏宽度配合,右缘对齐 */
.acc-main {
  height: 100%;
  overflow-y: auto;
  padding: 24px 0 24px 24px;
  min-width: 0;
}
@media (max-width: 1023px) {
  .acc-main {
    padding: 16px 0;
    height: auto;
    overflow: visible;
  }
}

.acc-page-head {
  margin-bottom: 24px;
}

.acc-mobile-tabs {
  margin-left: -16px;
  margin-right: -16px;
}

/* 顶部工具条:搜索框 + 计数。计数挪到搜索框附近,不再放在 h2 标题底下,
   也不再有 "已授权应用 / 活动日志" 这种与 h-page 重复的二级标题。 */
.acc-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.acc-search {
  flex: 1;
  min-width: 240px;
  max-width: 420px;
}
.acc-count {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
  color: var(--fg-mute);
  white-space: nowrap;
}

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
