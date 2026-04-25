<template>
  <div class="w-full max-w-sm">
    <div class="surface p-7">
      <div class="mb-6">
        <h1 class="text-xl font-semibold tracking-tight text-slate-900">欢迎回来</h1>
        <p class="text-sm text-muted mt-1">使用邮箱登录到栖枢</p>
      </div>

      <form @submit.prevent="onSubmit" class="space-y-4">
        <div>
          <label class="label">邮箱</label>
          <input v-model="email" type="email" required autofocus class="input" placeholder="you@example.com" />
        </div>
        <div>
          <div class="flex items-baseline justify-between mb-1.5">
            <label class="label !mb-0">密码</label>
            <a href="#/forgot-password" class="text-xs text-accent-600 hover:underline">忘记密码?</a>
          </div>
          <input v-model="password" type="password" required class="input" placeholder="••••••••" />
        </div>

        <div v-if="turnstileSiteKey" :data-sitekey="turnstileSiteKey" class="cf-turnstile"></div>

        <button :disabled="busy" class="btn-primary w-full">
          {{ busy ? "登录中…" : "登录" }}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-muted">
        没有账号? <a href="#/register" class="text-accent-600 hover:underline font-medium">立即注册</a>
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api.js";
import { loadSession } from "../session.js";
import { navigate } from "../router.js";
import { errToast, okToast } from "../toast.js";

const email = ref("");
const password = ref("");
const busy = ref(false);
const turnstileSiteKey = ref("");
let turnstileWidget = null;

onMounted(async () => {
  try {
    const cfg = await api.get("/auth/turnstile-config");
    if (cfg.enabled && cfg.siteKey) {
      turnstileSiteKey.value = cfg.siteKey;
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
  } catch {}
});

async function onSubmit() {
  busy.value = true;
  try {
    const tsToken = window.turnstile?.getResponse?.() || "";
    await api.post("/auth/login", {
      email: email.value, password: password.value, turnstileToken: tsToken,
    });
    okToast("登录成功");
    await loadSession();
    navigate("/");
  } catch (e) {
    errToast(e.message);
    if (window.turnstile) window.turnstile.reset();
  } finally {
    busy.value = false;
  }
}
</script>
