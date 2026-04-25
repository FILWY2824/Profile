<template>
  <div class="w-full max-w-md">
    <div class="flex items-center justify-center mb-6">
      <span class="sigil-lg"></span>
    </div>

    <div class="surface-glass shadow-pop p-8 sm:p-10">
      <div v-if="loading" class="py-10 text-center">
        <div class="inline-flex items-center gap-3 text-fg-dim text-sm">
          <span class="inline-block h-2 w-2 rounded-full bg-teal-300 animate-shine"></span>
          <span>加载授权信息</span>
        </div>
      </div>

      <div v-else-if="error" class="py-6 text-center">
        <div class="inline-flex h-12 w-12 items-center justify-center rounded-full bg-danger/15 text-danger mb-3">
          <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </div>
        <h2 class="h-section text-danger mb-2">{{ error }}</h2>
        <a href="#/" class="text-sm text-teal-300 hover:underline">返回首页</a>
      </div>

      <div v-else-if="info">
        <div class="text-center mb-6">
          <h1 class="h-page text-2xl mb-1.5">授权请求</h1>
          <p class="text-fg-dim text-sm">第三方应用希望访问你的账号</p>
        </div>

        <!-- 应用方信息 -->
        <div class="flex items-center gap-4 mb-6 pb-6 border-b border-line">
          <div v-if="info.client.logoUrl" class="h-14 w-14 rounded-2xl border border-line overflow-hidden flex-shrink-0">
            <img :src="info.client.logoUrl" class="h-full w-full object-cover" alt="" />
          </div>
          <div v-else class="h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-400 to-sky-500 text-white flex items-center justify-center font-bold text-2xl flex-shrink-0">
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

        <!-- 权限列表 -->
        <div class="text-xs text-fg-dim mb-3 font-medium">将获得以下权限</div>
        <ul class="space-y-2 mb-6 surface-soft p-3.5">
          <li v-for="s in (info.requestedScopes || [])" :key="s"
              class="flex items-baseline gap-3 text-sm">
            <span class="text-teal-300 mt-0.5 flex-shrink-0">✓</span>
            <span class="text-fg flex-1">{{ scopeDescr(s) }}</span>
            <span class="font-mono text-[10px] text-fg-mute flex-shrink-0">{{ s }}</span>
          </li>
        </ul>

        <p class="text-xs text-fg-dim leading-relaxed mb-6">
          点击 <span class="text-fg font-medium">允许</span> 后将作为
          <span class="font-mono text-teal-300">{{ user?.name }}</span>
          授权此应用。可在账户中心 → 授权应用 中随时撤销。
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

const scopeDescriptions = {
  openid:  "使用你的账号 ID 登录",
  profile: "读取你的显示名、头像",
  email:   "读取你的邮箱地址",
};
function scopeDescr(s) { return scopeDescriptions[s] || s; }

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
    if (info.value.preApproved) {
      await decide(true);
      return;
    }
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
