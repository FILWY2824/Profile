<template>
  <div class="w-full max-w-sm">
    <div class="surface p-7">
      <div class="mb-6">
        <h1 class="text-xl font-semibold tracking-tight text-slate-900">创建账号</h1>
        <p class="text-sm text-muted mt-1">{{ step === 1 ? "填写下面信息以注册" : "请输入邮箱中的验证码" }}</p>
      </div>

      <form v-if="step === 1" @submit.prevent="onSendCode" class="space-y-4">
        <div>
          <label class="label">邮箱</label>
          <input v-model="email" type="email" required class="input" placeholder="you@example.com" />
        </div>
        <div>
          <label class="label">显示名</label>
          <input v-model="name" required maxlength="60" class="input" placeholder="昵称" />
        </div>
        <div>
          <label class="label">密码</label>
          <input v-model="password" type="password" required minlength="8" class="input" placeholder="至少 8 字符" />
        </div>

        <div v-if="turnstileSiteKey" :data-sitekey="turnstileSiteKey" class="cf-turnstile"></div>

        <button :disabled="busy" class="btn-primary w-full">{{ busy ? "发送中…" : "发送验证码" }}</button>
      </form>

      <form v-else @submit.prevent="onConfirm" class="space-y-4">
        <div class="text-sm text-muted bg-slate-50 ring-1 ring-slate-100 rounded-lg p-3">
          验证码已发送至 <span class="font-mono text-slate-900">{{ email }}</span>
        </div>
        <div v-if="devCode" class="text-xs bg-amber-50 ring-1 ring-amber-200/70 rounded-lg p-3 text-amber-800">
          <span class="font-medium">[开发模式]</span> 验证码:<span class="font-mono ml-1">{{ devCode }}</span>
        </div>
        <div>
          <label class="label">6 位验证码</label>
          <input v-model="code" required maxlength="6" pattern="[0-9]{6}" inputmode="numeric"
                 class="input text-center text-lg font-mono tracking-[0.4em]" placeholder="000000" />
        </div>
        <button :disabled="busy" class="btn-primary w-full">{{ busy ? "验证中…" : "完成注册" }}</button>
        <button type="button" @click="step = 1" class="btn-ghost w-full">返回上一步</button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api.js";
import { loadSession } from "../session.js";
import { navigate } from "../router.js";
import { okToast, errToast } from "../toast.js";

const step = ref(1);
const email = ref("");
const password = ref("");
const name = ref("");
const code = ref("");
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
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    }
  } catch {}
});

async function onSendCode() {
  busy.value = true;
  try {
    const tsToken = window.turnstile?.getResponse?.() || "";
    const r = await api.post("/auth/register", {
      email: email.value, password: password.value, name: name.value,
      turnstileToken: tsToken,
    });
    devCode.value = r.devCode || "";
    step.value = 2;
    okToast("验证码已发送");
  } catch (e) {
    errToast(e.message);
    if (window.turnstile) window.turnstile.reset();
  } finally {
    busy.value = false;
  }
}

async function onConfirm() {
  busy.value = true;
  try {
    await api.post("/auth/register/confirm", {
      email: email.value, code: code.value,
    });
    okToast("注册完成");
    await loadSession();
    navigate("/");
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = false;
  }
}
</script>
