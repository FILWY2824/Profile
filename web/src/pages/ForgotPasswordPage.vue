<template>
  <div class="w-full max-w-md">
    <div class="flex items-center justify-center mb-6">
      <a href="#/" class="flex items-center gap-3">
        <span class="sigil-lg"></span>
      </a>
    </div>

    <div class="surface-glass p-8 sm:p-10">
      <div class="text-center mb-7">
        <h1 class="h-page text-3xl mb-1.5">{{ step === 1 ? "重置密码" : "设置新密码" }}</h1>
        <p class="text-fg-dim text-sm">
          {{ step === 1 ? "我们会发送一个 6 位验证码到你的邮箱" : `验证码已发送至 ${email}` }}
        </p>
      </div>

      <form v-if="step === 1" @submit.prevent="onSend" class="space-y-4">
        <div>
          <label class="label">邮箱地址</label>
          <input v-model="email" type="email" required autofocus class="input" placeholder="you@example.com" />
        </div>
        <div v-if="turnstileSiteKey" :data-sitekey="turnstileSiteKey" class="cf-turnstile pt-1"></div>
        <div class="pt-2">
          <button :disabled="busy" class="btn btn-primary w-full">
            {{ busy ? "正在发送…" : "发送重置码" }}
          </button>
        </div>
      </form>

      <form v-else @submit.prevent="onReset" class="space-y-4">
        <div v-if="devCode" class="dev-banner">
          <span class="text-warn font-mono font-semibold">DEV ·</span>
          <span class="text-fg ml-1">验证码: <span class="text-teal-300 font-mono font-semibold">{{ devCode }}</span></span>
        </div>
        <div>
          <label class="label">六位验证码</label>
          <input v-model="code" required maxlength="6" class="input input-mono text-center text-2xl font-semibold tracking-[0.5em] py-3"
                 placeholder="000000" />
        </div>
        <div>
          <label class="label">新密码 (至少 8 字符)</label>
          <input v-model="newPassword" type="password" required minlength="8" class="input" placeholder="••••••••" />
        </div>
        <div class="pt-2 space-y-2.5">
          <button :disabled="busy" class="btn btn-primary w-full">
            {{ busy ? "正在重置…" : "重置密码" }}
          </button>
          <button type="button" @click="step = 1" class="btn btn-ghost w-full">
            ← 返回上一步
          </button>
        </div>
      </form>
    </div>

    <div class="mt-6 flex items-center justify-between">
      <a href="#/login" class="text-xs text-fg-mute hover:text-fg-dim transition-colors">← 返回登录</a>
      <a href="#/" class="text-xs text-fg-mute hover:text-fg-dim transition-colors">回到主页 →</a>
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
    okToast("已发送 (若该邮箱已注册)");
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
    okToast("密码已重置, 请重新登录");
    navigate("/login");
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.dev-banner {
  border-radius: 12px;
  border: 1px solid rgba(217, 119, 6, 0.40);
  background-color: rgba(254, 243, 199, 0.6);
  padding: 12px;
  font-size: 12px;
}
</style>
