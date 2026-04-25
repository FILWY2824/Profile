<template>
  <div class="card max-w-md p-6">
    <form v-if="step === 1" @submit.prevent="onSendCode" class="space-y-4">
      <p class="text-sm text-ink-600">
        修改密码需要邮箱二次验证。点击下方按钮发送验证码到您的注册邮箱。
      </p>
      <button :disabled="busy" class="btn-primary w-full">
        {{ busy ? "发送中…" : "发送验证码" }}
      </button>
    </form>

    <form v-else @submit.prevent="onChange" class="space-y-4">
      <p v-if="devCode" class="rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-500">
        开发模式: {{ devCode }}
      </p>

      <div>
        <label class="mb-1 block text-sm font-medium text-ink-700">邮件验证码</label>
        <input v-model="form.code" type="text" required class="input tracking-widest text-center" maxlength="6" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium text-ink-700">当前密码</label>
        <input v-model="form.oldPassword" type="password" required class="input" autocomplete="current-password" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium text-ink-700">新密码</label>
        <input v-model="form.newPassword" type="password" required class="input" minlength="8" autocomplete="new-password" />
        <p class="mt-1 text-xs text-ink-500">至少 8 位</p>
      </div>

      <div class="flex gap-2">
        <button :disabled="busy" class="btn-primary flex-1">
          {{ busy ? "提交中…" : "确认修改" }}
        </button>
        <button type="button" @click="step = 1" class="btn-secondary">取消</button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { api } from "../../api.js";
import { logout } from "../../session.js";
import { navigate } from "../../router.js";
import { okToast, errToast } from "../../toast.js";

const step = ref(1);
const busy = ref(false);
const devCode = ref("");
const form = ref({ code: "", oldPassword: "", newPassword: "" });

async function onSendCode() {
  busy.value = true;
  try {
    const r = await api.post("/account/password/send-code");
    devCode.value = r.devCode || "";
    step.value = 2;
    okToast("验证码已发送");
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = false;
  }
}

async function onChange() {
  busy.value = true;
  try {
    await api.post("/account/password/change", form.value);
    okToast("密码已修改,请使用新密码登录");
    await logout();
    navigate("/login");
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = false;
  }
}
</script>
