<template>
  <div class="mx-auto max-w-md">
    <div v-if="loading" class="card p-8 text-center text-ink-500">加载中…</div>

    <div v-else-if="error" class="card p-6">
      <h1 class="mb-2 text-lg font-semibold text-red-700">授权失败</h1>
      <p class="text-sm text-ink-600">{{ error }}</p>
    </div>

    <div v-else class="card p-6">
      <div class="mb-4 flex items-center gap-3">
        <img v-if="info.client.logoUrl" :src="info.client.logoUrl" alt="" class="h-12 w-12 rounded" />
        <div v-else class="flex h-12 w-12 items-center justify-center rounded bg-ink-100 text-lg text-ink-600">
          {{ info.client.name.slice(0, 1) }}
        </div>
        <div>
          <h1 class="text-lg font-semibold text-ink-900">{{ info.client.name }}</h1>
          <a v-if="info.client.homepageUrl" :href="info.client.homepageUrl" target="_blank" rel="noopener noreferrer" class="text-xs text-ink-500 hover:text-ink-700">
            {{ info.client.homepageUrl }}
          </a>
        </div>
      </div>

      <p v-if="info.client.description" class="mb-4 text-sm text-ink-600">
        {{ info.client.description }}
      </p>

      <p class="mb-2 text-sm text-ink-700">该应用请求获取以下权限:</p>
      <ul class="mb-6 space-y-1 rounded-md bg-ink-50 p-3 text-sm text-ink-700">
        <li v-for="s in info.requestedScopes" :key="s" class="flex items-center gap-2">
          <span class="text-ink-500">·</span>
          {{ scopeLabel(s) }}
        </li>
      </ul>

      <div class="flex gap-2">
        <button @click="onDecide(true)" :disabled="busy" class="btn-primary flex-1">
          {{ busy ? "处理中…" : "允许授权" }}
        </button>
        <button @click="onDecide(false)" :disabled="busy" class="btn-secondary flex-1">
          拒绝
        </button>
      </div>

      <p class="mt-4 text-xs text-ink-400">
        授权后您可在「个人中心 → 已授权应用」中随时撤销。
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api.js";
import { route } from "../router.js";
import { errToast } from "../toast.js";

const loading = ref(true);
const error = ref("");
const info = ref(null);
const busy = ref(false);

const scopeLabels = {
  openid: "确认您的身份",
  profile: "读取您的显示名称和头像",
  email: "读取您的邮箱地址",
};
function scopeLabel(s) {
  return scopeLabels[s] || s;
}

// Required query params for /authorize: client_id, redirect_uri,
// response_type, scope, state, code_challenge, code_challenge_method.
async function load() {
  loading.value = true;
  try {
    const q = route.query;
    const params = new URLSearchParams({
      client_id: q.client_id || "",
      redirect_uri: q.redirect_uri || "",
      response_type: q.response_type || "code",
      scope: q.scope || "",
      state: q.state || "",
      code_challenge: q.code_challenge || "",
      code_challenge_method: q.code_challenge_method || "S256",
    });
    info.value = await api.get(`/oauth/authorize/info?${params.toString()}`);
  } catch (e) {
    error.value = e.message || "无法加载授权信息";
  } finally {
    loading.value = false;
  }
}

async function onDecide(allow) {
  busy.value = true;
  try {
    const q = route.query;
    const r = await api.post("/oauth/authorize/decide", {
      clientId: q.client_id,
      redirectUri: q.redirect_uri,
      scope: q.scope || "",
      state: q.state || "",
      codeChallenge: q.code_challenge || "",
      codeChallengeMethod: q.code_challenge_method || "S256",
      allow,
    });
    // The relying party's redirect URI is fully outside our origin —
    // navigate the whole window away.
    window.location.href = r.redirect;
  } catch (e) {
    errToast(e.message);
    busy.value = false;
  }
}

onMounted(load);
</script>
