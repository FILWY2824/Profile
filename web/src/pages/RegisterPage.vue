<template>
  <div class="w-full max-w-md">
    <div class="flex items-baseline justify-between mb-4">
      <span class="archive-no">FORM № R-001</span>
      <a href="#/" class="archive-no hover:text-ink transition-colors">← 返回</a>
    </div>
    <div class="rule-h-strong mb-6"></div>

    <div class="surface-elevated p-8 sm:p-10">
      <div class="flex items-center gap-4 mb-7">
        <span class="seal seal-lg">栖</span>
        <div>
          <div class="archive-no mb-1">REGISTER · 入册</div>
          <h1 class="h-section">{{ step === 1 ? "创建档案" : "确认验证" }}</h1>
        </div>
      </div>

      <!-- 步骤指示 -->
      <div class="flex items-center gap-3 mb-6">
        <div class="flex items-center gap-2">
          <span :class="['archive-no-strong tabular-nums', step === 1 ? 'text-cinnabar' : 'text-ash']">01</span>
          <span :class="step === 1 ? 'text-ink font-medium text-sm' : 'text-ash text-sm'">填写资料</span>
        </div>
        <div class="flex-1 h-px bg-rule-soft"></div>
        <div class="flex items-center gap-2">
          <span :class="['archive-no-strong tabular-nums', step === 2 ? 'text-cinnabar' : 'text-ash']">02</span>
          <span :class="step === 2 ? 'text-ink font-medium text-sm' : 'text-ash text-sm'">邮箱核验</span>
        </div>
      </div>

      <div class="rule-h mb-6"></div>

      <form v-if="step === 1" @submit.prevent="onSendCode" class="space-y-5">
        <div>
          <label class="label">邮箱地址</label>
          <input v-model="email" type="email" required class="input input-mono" placeholder="you@example.com" />
        </div>
        <div>
          <label class="label">显示名 / Display Name</label>
          <input v-model="name" required maxlength="60" class="input" placeholder="昵称" />
        </div>
        <div>
          <label class="label">密码 (≥ 8 字符)</label>
          <input v-model="password" type="password" required minlength="8" class="input input-mono" placeholder="••••••••" />
        </div>

        <div v-if="turnstileSiteKey" :data-sitekey="turnstileSiteKey" class="cf-turnstile pt-1"></div>

        <div class="pt-3">
          <button :disabled="busy" class="btn btn-primary w-full">
            <span class="archive-no" style="color:inherit;letter-spacing:0.3em;">
              {{ busy ? "正在投递…" : "发送验证码 →" }}
            </span>
          </button>
        </div>
      </form>

      <form v-else @submit.prevent="onConfirm" class="space-y-5">
        <div class="surface-soft p-4">
          <div class="archive-no mb-1">已投递至</div>
          <div class="font-mono text-sm text-ink truncate">{{ email }}</div>
        </div>
        <div v-if="devCode" class="border border-ochre/40 bg-ochre/5 p-3 text-2xs">
          <span class="archive-no text-ochre">DEV MODE · 开发模式</span>
          <div class="font-mono text-ink mt-1">验证码: <span class="text-cinnabar font-semibold">{{ devCode }}</span></div>
        </div>
        <div>
          <label class="label">六位验证码</label>
          <input v-model="code" required maxlength="6" pattern="[0-9]{6}" inputmode="numeric"
                 class="input input-mono text-center text-2xl font-semibold tracking-[0.5em]"
                 placeholder="000000" />
        </div>
        <div class="pt-1 space-y-2">
          <button :disabled="busy" class="btn btn-primary w-full">
            <span class="archive-no" style="color:inherit;letter-spacing:0.3em;">
              {{ busy ? "核验中…" : "完成入册 →" }}
            </span>
          </button>
          <button type="button" @click="step = 1" class="btn btn-ghost w-full">
            <span class="archive-no">← 返回上一步</span>
          </button>
        </div>
      </form>
    </div>

    <div class="mt-6 flex items-center justify-between">
      <span class="archive-no">QISHU · VOL. I</span>
      <a href="#/login" class="archive-no hover:text-ink transition-colors">已有账号 · 登入 →</a>
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
