<template>
  <div class="w-full max-w-md">
    <div class="flex items-baseline justify-between mb-4">
      <span class="archive-no">FORM № O-AUTH</span>
      <span class="archive-no">VOL. I · § OAUTH</span>
    </div>
    <div class="rule-h-strong mb-6"></div>

    <div class="surface-elevated p-8 sm:p-10">
      <div v-if="loading" class="py-10 text-center">
        <div class="archive-no">LOADING · 加载授权信息</div>
      </div>

      <div v-else-if="error" class="py-6 text-center">
        <div class="font-display text-2xl text-rust mb-3">{{ error }}</div>
        <a href="#/" class="text-sm text-cinnabar hover:text-cinnabar-deep underline decoration-cinnabar/40">返回首页</a>
      </div>

      <div v-else-if="info">
        <!-- 应用方头信息 -->
        <div class="flex items-center gap-4 mb-6 pb-6 border-b border-rule-soft">
          <div v-if="info.client.logoUrl" class="h-14 w-14 border border-rule-soft overflow-hidden">
            <img :src="info.client.logoUrl" class="h-full w-full object-cover" alt="" />
          </div>
          <div v-else class="h-14 w-14 bg-cinnabar text-paper flex items-center justify-center font-display text-2xl rounded-sm">
            {{ (info.client.name || '?').charAt(0).toUpperCase() }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="archive-no mb-1">第三方应用 · CLIENT</div>
            <div class="h-sub truncate">{{ info.client.name }}</div>
            <a v-if="info.client.homepageUrl" :href="info.client.homepageUrl" target="_blank" rel="noopener"
               class="text-2xs text-cinnabar hover:text-cinnabar-deep font-mono truncate block mt-1">
              {{ info.client.homepageUrl }} ↗
            </a>
          </div>
        </div>

        <p v-if="info.client.description" class="text-sm text-ash mb-5 leading-relaxed">
          {{ info.client.description }}
        </p>

        <!-- 权限列表 -->
        <div class="archive-no mb-3">REQUESTED SCOPES · 请求的权限</div>
        <ul class="space-y-3 mb-6 border border-rule-soft p-4">
          <li v-for="(s, i) in (info.requestedScopes || [])" :key="s"
              class="flex items-baseline gap-3 text-sm">
            <span class="font-mono text-2xs text-cinnabar tabular-nums">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="text-ink-2 flex-1">{{ scopeDescr(s) }}</span>
            <span class="font-mono text-2xs text-ash-2 uppercase">{{ s }}</span>
          </li>
        </ul>

        <div class="archive-no mb-2 text-ash">授权说明</div>
        <p class="text-sm text-ash leading-relaxed mb-6 surface-soft p-3">
          点击 <span class="text-ink font-medium">允许</span> 后将作为
          <span class="font-mono text-cinnabar">{{ user?.name }}</span>
          授权此应用。授权后可在账户中心 → 已授权应用 中随时撤销。
        </p>

        <!-- 操作 -->
        <div class="grid grid-cols-2 gap-3">
          <button @click="decide(false)" :disabled="busy" class="btn btn-secondary">
            <span class="archive-no" style="color:inherit;">拒绝</span>
          </button>
          <button @click="decide(true)" :disabled="busy" class="btn btn-accent">
            <span class="archive-no" style="color:inherit;letter-spacing:0.3em;">
              {{ busy ? '处理中…' : '允许 →' }}
            </span>
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
  openid:  "使用您的账号 ID 登录",
  profile: "读取您的显示名、头像",
  email:   "读取您的邮箱地址",
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
