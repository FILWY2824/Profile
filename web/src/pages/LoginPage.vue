<template>
  <div class="w-full max-w-md">
    <!-- 顶部 logo -->
    <div class="flex items-center justify-center mb-6">
      <a href="#/" class="flex items-center gap-3">
        <span class="sigil-lg"></span>
      </a>
    </div>

    <div class="surface-glass p-8 sm:p-10">
      <div class="text-center mb-7">
        <h1 class="h-page text-3xl mb-1.5">欢迎回来<span class="text-teal-300">.</span></h1>
        <p class="text-fg-dim text-sm">登录到你的账户</p>
      </div>

      <form @submit.prevent="onSubmit" class="space-y-4">
        <div>
          <label class="label">邮箱地址</label>
          <input v-model="email" type="email" required autofocus class="input"
                 placeholder="you@example.com" autocomplete="username" />
        </div>
        <div>
          <div class="flex items-baseline justify-between mb-1.5">
            <label class="label !mb-0">密码</label>
            <a href="#/forgot-password" class="text-xs text-teal-300 hover:text-teal-200 transition-colors">忘记密码?</a>
          </div>
          <PasswordInput v-model="password" required autocomplete="current-password" placeholder="••••••••" />
        </div>

        <div v-if="turnstileSiteKey" :data-sitekey="turnstileSiteKey" class="cf-turnstile pt-1"></div>

        <div class="pt-2">
          <button :disabled="busy" class="btn btn-primary w-full">
            {{ busy ? "正在登录…" : "登录" }}
          </button>
        </div>
      </form>

      <div class="rule-h mt-7 mb-5"></div>

      <p class="text-center text-sm text-fg-dim">
        还没有账号?
        <a href="#/register" class="text-teal-300 hover:text-teal-200 font-medium transition-colors">
          立即注册
        </a>
      </p>
    </div>

    <div class="mt-6 flex items-center justify-center">
      <a href="#/" class="text-xs text-fg-mute hover:text-fg-dim transition-colors">← 返回主页</a>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api.js";
import { loadSession } from "../session.js";
import { navigate } from "../router.js";
import { errToast, okToast } from "../toast.js";
import PasswordInput from "../components/PasswordInput.vue";

const email = ref("");
const password = ref("");
const busy = ref(false);
const turnstileSiteKey = ref("");

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js";

onMounted(async () => {
  try {
    const cfg = await api.get("/auth/turnstile-config");
    if (cfg.enabled && cfg.siteKey) {
      turnstileSiteKey.value = cfg.siteKey;
      // 防止 SPA 内反复挂载时重复加载脚本
      if (!document.querySelector(`script[src="${TURNSTILE_SCRIPT}"]`)) {
        const s = document.createElement("script");
        s.src = TURNSTILE_SCRIPT;
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
      } else if (window.turnstile) {
        setTimeout(() => window.turnstile.render?.(".cf-turnstile"), 0);
      }
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
