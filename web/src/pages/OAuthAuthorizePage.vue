<template>
  <div class="w-full max-w-md">
    <div class="flex items-center justify-center mb-6">
      <span class="sigil-lg"></span>
    </div>

    <div class="surface-glass p-8 sm:p-10">
      <div v-if="loading" class="py-10 text-center">
        <div class="inline-flex items-center gap-3 text-fg-dim text-sm">
          <span class="inline-block h-2 w-2 rounded-full bg-teal-500 animate-shine"></span>
          <span>加载授权信息</span>
        </div>
      </div>

      <div v-else-if="error" class="py-6 text-center">
        <div class="inline-flex h-12 w-12 items-center justify-center rounded-full mb-3"
             style="background-color: rgba(220, 38, 38, 0.12); color: var(--danger);">
          <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </div>
        <h2 class="h-section text-danger mb-2">{{ error }}</h2>
        <a href="#/" class="text-sm text-teal-300 hover:underline">返回首页</a>
      </div>

      <div v-else-if="info">
        <div class="text-center mb-6">
          <h1 class="h-page text-2xl mb-1.5">授权请求<span class="text-teal-300">.</span></h1>
          <p class="text-fg-dim text-sm">第三方应用希望访问你的账号</p>
        </div>

        <!-- 应用方信息 -->
        <div class="flex items-center gap-4 mb-6 pb-6 border-b border-line">
          <div v-if="info.client.logoUrl" class="h-14 w-14 rounded-2xl border border-line overflow-hidden flex-shrink-0 bg-white">
            <img :src="info.client.logoUrl" class="h-full w-full object-cover" alt="" />
          </div>
          <div v-else class="client-fallback">
            {{ (info.client.name || '?').charAt(0).toUpperCase() }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="h-sub truncate">{{ info.client.name }}</div>
            <a v-if="info.client.homepageUrl" :href="info.client.homepageUrl" target="_blank" rel="noopener"
               class="text-xs text-teal-300 hover:underline font-mono truncate block mt-0.5">
              {{ info.client.homepageUrl }} ↗
            </a>
          </div>
        </div>

        <p v-if="info.client.description" class="text-sm text-fg-dim mb-5 leading-relaxed">
          {{ info.client.description }}
        </p>

        <!-- 之前授权过的提示 — 仅作 UI 提示,不再自动跳转,授权必须由用户显式点击。 -->
        <div v-if="info.preApproved" class="mb-5 p-3 rounded-xl text-xs leading-relaxed flex items-start gap-2"
             style="background-color: rgba(20, 184, 166, 0.08); border: 1px solid rgba(20, 184, 166, 0.25); color: var(--fg-dim);">
          <span class="text-teal-300 font-medium flex-shrink-0">提示</span>
          <span>你曾经授权过此应用使用相同权限。再次确认即可继续 — 出于安全考虑,授权仍需要你明确点击。</span>
        </div>

        <!-- 权限列表:每项都展开说明该权限对应的具体数据。 -->
        <div class="text-xs text-fg-dim mb-2 font-semibold">应用将获得以下权限</div>
        <ul class="space-y-2.5 mb-4 surface-soft p-3.5">
          <li v-for="s in (info.requestedScopes || [])" :key="s"
              class="flex items-baseline gap-3 text-sm">
            <span class="text-teal-300 mt-0.5 flex-shrink-0">✓</span>
            <span class="flex-1 min-w-0">
              <span class="text-fg block leading-tight">{{ scopeTitle(s) }}</span>
              <span class="text-xs text-fg-mute block mt-1 leading-relaxed">{{ scopeDetail(s) }}</span>
            </span>
            <span class="font-mono text-[10px] text-fg-mute flex-shrink-0 self-start mt-0.5">{{ s }}</span>
          </li>
        </ul>

        <!-- OAuth 2.0 安全说明:明确告知用户密码等敏感信息不会被分享。 -->
        <div class="mb-5 p-3.5 rounded-xl text-xs leading-relaxed"
             style="background-color: rgba(20, 184, 166, 0.06); border: 1px solid rgba(20, 184, 166, 0.20);">
          <div class="flex items-start gap-2.5">
            <svg class="h-4 w-4 mt-0.5 flex-shrink-0 text-teal-300"
                 fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
                 aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"/>
            </svg>
            <div class="flex-1 text-fg-dim">
              <div class="font-medium text-fg mb-1.5">通过 OAuth 2.0 协议安全授权</div>
              <ul class="space-y-1 list-none pl-0">
                <li>· 应用<b class="text-fg">不会</b>得到你的密码、登录凭据或任何上方未列出的信息</li>
                <li>· 你的密码始终只与栖枢服务器交互,第三方无法看到</li>
                <li>· 授权范围仅限于上方列出的权限项</li>
                <li>· 你可以随时在 <span class="font-mono text-teal-300">账户中心 → 授权应用</span> 中撤销</li>
              </ul>
            </div>
          </div>
        </div>

        <p class="text-xs text-fg-dim leading-relaxed mb-5">
          点击 <span class="text-fg font-medium">允许</span> 后,你将作为
          <span class="font-mono text-teal-300">{{ user?.name }}</span>
          授权 <span class="font-medium text-fg">{{ info.client.name }}</span> 使用上述权限。
        </p>

        <div class="grid grid-cols-2 gap-3">
          <button @click="decide(false)" :disabled="busy" class="btn btn-secondary">
            拒绝
          </button>
          <button @click="decide(true)" :disabled="busy" class="btn btn-primary">
            {{ busy ? '处理中…' : '允许' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api.js";
import { route } from "../router.js";
import { currentUser } from "../session.js";
import { errToast } from "../toast.js";

const loading = ref(true);
const error = ref("");
const info = ref(null);
const busy = ref(false);
const user = currentUser;

// scope 描述拆为标题 + 详细说明,让用户清楚每项权限对应什么具体数据,
// 避免出现「同意了但不知道授权了什么」的情况。
const scopeMeta = {
  openid:  {
    title: "登录你的账号",
    detail: "应用将获得你在栖枢的账号唯一标识(sub),用于识别身份。",
  },
  profile: {
    title: "读取公开资料",
    detail: "包括你的显示名与头像。不含邮箱、密码、登录历史等敏感信息。",
  },
  email:   {
    title: "读取邮箱地址",
    detail: "应用将获得你的邮箱地址及其验证状态,但无法以你的名义发送邮件。",
  },
};
function scopeTitle(s)  { return scopeMeta[s]?.title  || s; }
function scopeDetail(s) { return scopeMeta[s]?.detail || "应用方自定义权限项,请查看应用说明确认其用途。"; }

onMounted(async () => {
  try {
    const q = route.query;
    const params = new URLSearchParams({
      client_id: q.client_id || "",
      redirect_uri: q.redirect_uri || "",
      scope: q.scope || "",
      state: q.state || "",
      code_challenge: q.code_challenge || "",
      code_challenge_method: q.code_challenge_method || "S256",
      response_type: q.response_type || "code",
    });
    info.value = await api.get("/oauth/authorize/info?" + params.toString());
    // 关键修复: 即便此前授权过(info.preApproved === true),也不再自动跳转。
    // 必须由用户在本页面明确点击「允许」才会触发 decide,这符合 OAuth 显式同意
    // 的本意,也防止恶意第三方借已授权应用静默拿到新的 authorization code。
    // info.preApproved 仅用于在 UI 上显示一条提示。
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

async function decide(allow) {
  busy.value = true;
  try {
    const q = route.query;
    const r = await api.post("/oauth/authorize/decide", {
      clientId: q.client_id, redirectUri: q.redirect_uri,
      scope: q.scope, state: q.state || "",
      codeChallenge: q.code_challenge, codeChallengeMethod: q.code_challenge_method || "S256",
      allow,
    });
    if (r.redirect) location.href = r.redirect;
  } catch (e) {
    errToast(e.message);
    busy.value = false;
  }
}
</script>

<style scoped>
.client-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: linear-gradient(135deg, #06B6D4, #0891B2 60%, #0E7490);
  color: white;
  font-weight: 700;
  font-size: 24px;
  flex-shrink: 0;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.3) inset,
    0 8px 18px -6px rgba(6, 182, 212, 0.5);
}
</style>
