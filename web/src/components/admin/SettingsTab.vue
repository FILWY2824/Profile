<template>
  <div class="space-y-3">
    <div v-if="loading" class="card p-6 text-center text-ink-500">加载中…</div>
    <form v-else @submit.prevent="save" class="card divide-y divide-ink-100">
      <div v-for="row in items" :key="row.key" class="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-3 sm:items-start">
        <div>
          <div class="font-mono text-xs text-ink-700">{{ row.key }}</div>
          <div class="text-xs text-ink-500">{{ row.description || "—" }}</div>
          <span v-if="row.sensitive" class="badge mt-1 bg-amber-100 text-amber-800">敏感</span>
        </div>
        <div class="sm:col-span-2">
          <textarea
            v-if="row.type === 'longtext'"
            v-model="dirty[row.key]"
            rows="3"
            class="input font-mono text-xs"
          ></textarea>
          <select v-else-if="row.type === 'bool'" v-model="dirty[row.key]" class="input">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
          <input
            v-else
            v-model="dirty[row.key]"
            :type="row.sensitive ? 'password' : 'text'"
            class="input font-mono text-xs"
          />
        </div>
      </div>

      <div class="flex justify-end gap-2 px-4 py-3">
        <button type="button" @click="reset" class="btn-secondary">重置</button>
        <button :disabled="busy" class="btn-primary">{{ busy ? "保存中…" : "保存修改" }}</button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";

const items = ref([]);
const dirty = ref({});
const loading = ref(true);
const busy = ref(false);

async function load() {
  loading.value = true;
  try {
    const r = await api.get("/admin/settings");
    items.value = r.items || [];
    reset();
  } finally {
    loading.value = false;
  }
}
function reset() {
  dirty.value = Object.fromEntries(items.value.map((i) => [i.key, i.value]));
}
async function save() {
  // Only diff fields. Sensitive fields starting with •••• are sentinels;
  // backend strips them. We send everything that differs.
  const updates = items.value
    .filter((i) => dirty.value[i.key] !== i.value)
    .map((i) => ({ key: i.key, value: dirty.value[i.key] }));
  if (updates.length === 0) {
    okToast("无变更");
    return;
  }
  busy.value = true;
  try {
    await api.patch("/admin/settings", { updates });
    okToast(`已保存 ${updates.length} 项`);
    await load();
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}
onMounted(load);
</script>
