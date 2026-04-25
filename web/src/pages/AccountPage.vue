<template>
  <div class="space-y-8">
    <!-- 文头 -->
    <header>
      <div class="flex items-baseline justify-between gap-4 mb-3">
        <span class="archive-no">VOL. I · § II · ACCOUNT</span>
        <span class="archive-no">{{ profile?.email || '—' }}</span>
      </div>
      <div class="rule-double mb-5"></div>
      <h1 class="h-page">账户中心<span class="text-cinnabar">.</span></h1>
      <p class="text-ash text-base mt-2 font-serif" style="font-variation-settings:'opsz' 24, 'SOFT' 50;">
        管理个人信息、密码与已授权应用。
      </p>
    </header>

    <!-- Tab: 编辑感的章节切换,小数字 + 名字 -->
    <nav class="flex gap-1 overflow-x-auto pb-px border-b border-ink">
      <button v-for="(t, i) in tabs" :key="t.id"
              @click="active = t.id"
              :class="[
                'flex items-baseline gap-2 px-4 py-3 -mb-px border-b-2 transition-colors whitespace-nowrap',
                active === t.id ? 'border-cinnabar text-ink' : 'border-transparent text-ash hover:text-ink'
              ]">
        <span :class="['font-mono text-2xs tabular-nums', active === t.id ? 'text-cinnabar' : 'text-ash-2']">
          {{ String(i + 1).padStart(2, '0') }}
        </span>
        <span class="text-sm font-medium">{{ t.label }}</span>
      </button>
    </nav>

    <!-- Profile -->
    <section v-if="active === 'profile'" class="surface p-7 max-w-2xl">
      <div class="flex items-center justify-between mb-5">
        <h2 class="h-section">个人资料</h2>
        <span class="archive-no">§ 01</span>
      </div>
      <div class="rule-h mb-6"></div>
      <div v-if="profile" class="space-y-5">
        <div class="flex items-center gap-4 pb-5 border-b border-rule-soft">
          <div class="seal seal-lg">{{ initial }}</div>
          <div class="flex-1 min-w-0">
            <div class="font-mono text-sm text-ink truncate">{{ profile.email }}</div>
            <div class="archive-no mt-1">ROLE · {{ roleLabel }}</div>
          </div>
        </div>
        <div>
          <label class="label">显示名</label>
          <input v-model="profile.name" maxlength="60" class="input" />
        </div>
        <div>
          <label class="label">个人介绍</label>
          <textarea v-model="profile.bio" rows="3" maxlength="500" class="input-box"></textarea>
        </div>
        <div class="pt-2">
          <button @click="saveProfile" :disabled="busy" class="btn btn-primary">
            <span class="archive-no" style="color:inherit;letter-spacing:0.24em;">
              {{ busy ? "保存中…" : "保存修改 →" }}
            </span>
          </button>
        </div>
      </div>
    </section>

    <!-- Password -->
    <section v-if="active === 'password'" class="surface p-7 max-w-2xl">
      <div class="flex items-center justify-between mb-5">
        <h2 class="h-section">修改密码</h2>
        <span class="archive-no">§ 02</span>
      </div>
      <div class="rule-h mb-6"></div>
      <div class="space-y-5">
        <div>
          <label class="label">原密码</label>
          <input v-model="oldPw" type="password" class="input input-mono" />
        </div>
        <div>
          <label class="label">新密码 (≥ 8 字符)</label>
          <input v-model="newPw" type="password" minlength="8" class="input input-mono" placeholder="••••••••" />
        </div>
        <div class="flex gap-3 items-end">
          <div class="flex-1">
            <label class="label">邮箱验证码</label>
            <input v-model="pwCode" maxlength="6" class="input input-mono text-center tracking-[0.4em]" placeholder="000000" />
          </div>
          <button @click="sendPwCode" :disabled="busy" class="btn btn-secondary">
            <span class="archive-no" style="color:inherit;">发送验证码</span>
          </button>
        </div>
        <div v-if="devCode" class="border border-ochre/40 bg-ochre/5 p-3 text-2xs">
          <span class="archive-no text-ochre">DEV MODE</span>
          <span class="font-mono text-ink ml-2">{{ devCode }}</span>
        </div>
        <div class="pt-2">
          <button @click="changePassword" :disabled="busy" class="btn btn-primary">
            <span class="archive-no" style="color:inherit;letter-spacing:0.24em;">
              {{ busy ? "提交中…" : "确认修改 →" }}
            </span>
          </button>
        </div>
      </div>
    </section>

    <!-- Logins -->
    <section v-if="active === 'logins'" class="surface p-7">
      <div class="flex items-center justify-between mb-5">
        <h2 class="h-section">最近登录</h2>
        <span class="archive-no">§ 03 · {{ logins.length }} 条</span>
      </div>
      <div class="rule-h mb-6"></div>
      <div v-if="logins.length === 0" class="archive-no text-center py-12">— 暂无记录 —</div>
      <div v-else class="overflow-x-auto -mx-1">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-ink">
              <th class="archive-no py-2 px-1 text-left">时间</th>
              <th class="archive-no py-2 px-1 text-left">IP</th>
              <th class="archive-no py-2 px-1 text-left">USER-AGENT</th>
              <th class="archive-no py-2 px-1 text-left">结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in logins" :key="l.id" class="border-b border-rule-softer">
              <td class="py-2.5 px-1 font-mono text-2xs text-ash">{{ formatTime(l.timestamp) }}</td>
              <td class="py-2.5 px-1 font-mono text-2xs text-ink">{{ l.ip }}</td>
              <td class="py-2.5 px-1 text-2xs text-ash truncate max-w-xs">{{ l.userAgent }}</td>
              <td class="py-2.5 px-1">
                <span :class="l.success ? 'badge badge-sage' : 'badge badge-rust'">
                  {{ l.success ? '成功' : (l.reason || '失败') }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- OAuth Grants -->
    <section v-if="active === 'apps'" class="surface p-7">
      <div class="flex items-center justify-between mb-5">
        <h2 class="h-section">已授权应用</h2>
        <span class="archive-no">§ 04 · {{ grants.length }} 项</span>
      </div>
      <div class="rule-h mb-6"></div>
      <div v-if="grants.length === 0" class="archive-no text-center py-12">— 暂无 —</div>
      <ul v-else class="space-y-3">
        <li v-for="g in grants" :key="g.id"
            class="flex items-center justify-between gap-4 p-4 border border-rule-soft hover:border-ink transition-colors">
          <div class="min-w-0 flex-1">
            <div class="h-sub truncate">{{ g.clientName }}</div>
            <div class="archive-no mt-1 truncate">
              SCOPES · {{ (g.scopes || []).join(' ') || '—' }} · 上次使用 {{ formatTime(g.lastUsedAt) }}
            </div>
          </div>
          <button @click="revokeGrant(g.id)" class="btn btn-danger btn-sm">
            <span class="archive-no" style="color:inherit;">撤销</span>
          </button>
        </li>
      </ul>
    </section>

    <!-- Activity -->
    <section v-if="active === 'activity'" class="surface p-7">
      <div class="flex items-center justify-between mb-5">
        <h2 class="h-section">活动日志</h2>
        <span class="archive-no">§ 05 · {{ activity.length }} 条</span>
      </div>
      <div class="rule-h mb-6"></div>
      <div v-if="activity.length === 0" class="archive-no text-center py-12">— 暂无 —</div>
      <ul v-else class="space-y-2">
        <li v-for="a in activity" :key="a.id"
            class="flex items-baseline gap-4 py-2.5 border-b border-rule-softer last:border-0 text-sm">
          <span class="font-mono text-2xs text-ash w-32 flex-shrink-0">{{ formatTime(a.timestamp) }}</span>
          <span class="text-cinnabar font-mono text-2xs">·</span>
          <span class="text-ink-2 leading-relaxed">{{ a.detail || a.action }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../api.js";
import { okToast, errToast } from "../toast.js";
import { formatTime } from "../format.js";

const tabs = [
  { id: "profile",  label: "个人资料" },
  { id: "password", label: "修改密码" },
  { id: "logins",   label: "登录记录" },
  { id: "apps",     label: "已授权应用" },
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
