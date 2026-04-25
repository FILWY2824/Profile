<template>
  <div class="w-full max-w-md">
    <div class="surface p-7">
      <div v-if="loading" class="py-10 text-center text-muted">加载中…</div>
      <div v-else-if="error" class="py-6 text-center">
        <div class="text-red-600 font-medium mb-2">{{ error }}</div>
        <a href="#/" class="text-sm text-accent-600 hover:underline">返回首页</a>
      </div>
      <div v-else-if="info">
        <div class="flex items-center gap-3 mb-5 pb-5 border-b border-slate-100">
          <img v-if="info.client.logoUrl" :src="info.client.logoUrl" class="h-12 w-12 rounded-lg object-cover ring-1 ring-slate-200" alt="" />
          <div v-else class="h-12 w-12 rounded-lg bg-accent-100 flex items-center justify-center text-accent-700 font-semibold text-lg">
            {{ (info.client.name || '?').charAt(0).toUpperCase() }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-slate-900 truncate">{{ info.client.name }}</div>
            <a v-if="info.client.homepageUrl" :href="info.client.homepageUrl" target="_blank" rel="noopener" class="text-xs text-accent-600 hover:underline truncate block">{{ info.client.homepageUrl }}</a>
          </div>
        </div>

        <p v-if="info.client.description" class="text-sm text-slate-700 mb-4">{{ info.client.description }}</p>

        <h2 class="text-sm font-semibold text-slate-900 mb-2">将获得以下权限:</h2>
        <ul class="space-y-1.5 mb-6">
          <li v-for="s in (info.requestedScopes || [])" :key="s" class="flex items-baseline gap-2 text-sm">
            <span class="h-1.5 w-1.5 rounded-full bg-accent-500 mt-1.5 flex-shrink-0"></span>
            <span class="text-slate-700">{{ scopeDescr(s) }}</span>
            <span class="ml-auto text-xs text-slate-400 font-mono">{{ s }}</span>
          </li>
        </ul>

        <div class="text-xs text-muted bg-slate-50 ring-1 ring-slate-100 rounded-lg p-3 mb-5">
          点击 "允许" 后将作为 <span class="font-medium text-slate-700">{{ user?.name }}</span> 授权此应用。
          授权后可在账户中心随时撤销。
        </div>

        <div class="flex gap-2">
          <button @click="decide(false)" :disabled="busy" class="btn-secondary flex-1">拒绝</button>
          <button @click="decide(true)" :disabled="busy" class="btn-primary flex-1">{{ busy ? '处理中…' : '允许' }}</button>
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
  openid: "使用您的账号 ID 登录",
  profile: "读取您的显示名、头像",
  email: "读取您的邮箱地址",
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
      // 用户先前已同意相同 scope,直接 allow
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
