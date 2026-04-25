<template>
  <div class="w-full max-w-md">
    <div class="flex items-baseline justify-between mb-4">
      <span class="archive-no">FORM № P-001</span>
      <a href="#/login" class="archive-no hover:text-ink transition-colors">← 返回登入</a>
    </div>
    <div class="rule-h-strong mb-6"></div>

    <div class="surface-elevated p-8 sm:p-10">
      <div class="flex items-center gap-4 mb-7">
        <span class="seal seal-lg">栖</span>
        <div>
          <div class="archive-no mb-1">RECOVER · 重置</div>
          <h1 class="h-section">{{ step === 1 ? "重置密码" : "确认新密码" }}</h1>
        </div>
      </div>

      <div class="rule-h mb-6"></div>

      <form v-if="step === 1" @submit.prevent="onSend" class="space-y-5">
        <p class="text-sm text-ash leading-relaxed">
          请输入注册时使用的邮箱,我们将发送一份六位重置码到这个地址。
        </p>
        <div>
          <label class="label">邮箱地址</label>
          <input v-model="email" type="email" required autofocus class="input input-mono" placeholder="you@example.com" />
        </div>
        <div v-if="turnstileSiteKey" :data-sitekey="turnstileSiteKey" class="cf-turnstile pt-1"></div>
        <div class="pt-3">
          <button :disabled="busy" class="btn btn-primary w-full">
            <span class="archive-no" style="color:inherit;letter-spacing:0.3em;">
              {{ busy ? "正在投递…" : "发送重置码 →" }}
            </span>
          </button>
        </div>
      </form>

      <form v-else @submit.prevent="onReset" class="space-y-5">
        <div v-if="devCode" class="border border-ochre/40 bg-ochre/5 p-3 text-2xs">
          <span class="archive-no text-ochre">DEV MODE</span>
          <div class="font-mono text-ink mt-1">验证码: <span class="text-cinnabar font-semibold">{{ devCode }}</span></div>
        </div>
        <div>
          <label class="label">六位验证码</label>
          <input v-model="code" required maxlength="6" class="input input-mono text-center text-2xl font-semibold tracking-[0.5em]"
                 placeholder="000000" />
        </div>
        <div>
          <label class="label">新密码 (≥ 8 字符)</label>
          <input v-model="newPassword" type="password" required minlength="8" class="input input-mono" placeholder="••••••••" />
        </div>
        <div class="pt-3">
          <button :disabled="busy" class="btn btn-primary w-full">
            <span class="archive-no" style="color:inherit;letter-spacing:0.3em;">
              {{ busy ? "正在重置…" : "重置密码 →" }}
            </span>
          </button>
        </div>
      </form>
    </div>

    <div class="mt-6 flex items-center justify-between">
      <span class="archive-no">QISHU · VOL. I</span>
      <a href="#/login" class="archive-no hover:text-ink transition-colors">回到登入 →</a>
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
