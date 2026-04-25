<template>
  <div class="w-full max-w-sm">
    <div class="surface p-7">
      <div class="mb-6">
        <h1 class="text-xl font-semibold tracking-tight text-slate-900">重置密码</h1>
        <p class="text-sm text-muted mt-1">{{ step === 1 ? "输入注册邮箱接收验证码" : "输入新密码与验证码" }}</p>
      </div>

      <form v-if="step === 1" @submit.prevent="onSend" class="space-y-4">
        <div>
          <label class="label">邮箱</label>
          <input v-model="email" type="email" required autofocus class="input" />
        </div>
        <div v-if="turnstileSiteKey" :data-sitekey="turnstileSiteKey" class="cf-turnstile"></div>
        <button :disabled="busy" class="btn-primary w-full">{{ busy ? "发送中…" : "发送重置码" }}</button>
      </form>

      <form v-else @submit.prevent="onReset" class="space-y-4">
        <div v-if="devCode" class="text-xs bg-amber-50 ring-1 ring-amber-200/70 rounded-lg p-3 text-amber-800">
          <span class="font-medium">[开发模式]</span> 验证码:<span class="font-mono ml-1">{{ devCode }}</span>
        </div>
        <div>
          <label class="label">6 位验证码</label>
          <input v-model="code" required maxlength="6" class="input font-mono text-center text-lg tracking-[0.4em]" placeholder="000000" />
        </div>
        <div>
          <label class="label">新密码</label>
          <input v-model="newPassword" type="password" required minlength="8" class="input" placeholder="至少 8 字符" />
        </div>
        <button :disabled="busy" class="btn-primary w-full">{{ busy ? "提交中…" : "重置密码" }}</button>
      </form>

      <p class="mt-6 text-center text-sm text-muted">
        <a href="#/login" class="text-accent-600 hover:underline">返回登录</a>
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { okToast, errToast } from "../toast.js";

const step = ref(1);
const email = ref("");
const code = ref("");
const newPassword = ref("");
const busy = ref(false);
const devCode = ref("");
const turnstileSiteKey = ref("");

onMounted(async () => {
  try {
    const cfg = await api.get("/auth/turnstile-config");
    if (cfg.enabled && cfg.siteKey) {
      turnstileSiteKey.value = cfg.siteKey;
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true; s.defer = true; document.head.appendChild(s);
    }
  } catch {}
});

async function onSend() {
  busy.value = true;
  try {
    const tsToken = window.turnstile?.getResponse?.() || "";
    const r = await api.post("/auth/forgot-password", {
      email: email.value, turnstileToken: tsToken,
    });
    devCode.value = r.devCode || "";
    step.value = 2;
    okToast("已发送(若该邮箱已注册)");
  } catch (e) {
    errToast(e.message);
    if (window.turnstile) window.turnstile.reset();
  } finally {
    busy.value = false;
  }
}

async function onReset() {
  busy.value = true;
  try {
    await api.post("/auth/reset-password", {
      email: email.value, code: code.value, newPassword: newPassword.value,
    });
    okToast("密码已重置,请重新登录");
    navigate("/login");
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = false;
  }
}
</script>
