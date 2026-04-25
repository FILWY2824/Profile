<template>
  <div class="card p-6">
    <form @submit.prevent="onSave" class="max-w-md space-y-4">
      <div>
        <label class="mb-1 block text-sm font-medium text-ink-700">邮箱</label>
        <input :value="user?.email" disabled class="input bg-ink-50" />
        <p class="mt-1 text-xs text-ink-400">邮箱暂不支持自助修改</p>
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium text-ink-700">显示名称</label>
        <input v-model="form.name" type="text" maxlength="32" class="input" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium text-ink-700">简介</label>
        <textarea v-model="form.bio" rows="3" maxlength="500" class="input resize-y"></textarea>
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium text-ink-700">头像 URL</label>
        <input v-model="form.avatar" type="text" class="input" placeholder="https://..." />
      </div>

      <div>
        <button :disabled="busy" class="btn-primary">{{ busy ? "保存中…" : "保存" }}</button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../../api.js";
import { currentUser, loadSession } from "../../session.js";
import { okToast, errToast } from "../../toast.js";

const user = currentUser;
const form = ref({ name: "", bio: "", avatar: "" });
const busy = ref(false);

async function load() {
  const r = await api.get("/account/profile");
  form.value = { name: r.name || "", bio: r.bio || "", avatar: r.avatar || "" };
}

async function onSave() {
  busy.value = true;
  try {
    await api.patch("/account/profile", form.value);
    await loadSession();
    okToast("已保存");
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>
