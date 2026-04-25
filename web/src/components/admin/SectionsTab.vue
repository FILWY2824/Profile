<template>
  <div class="space-y-4">
    <div class="flex justify-end">
      <button @click="open()" class="btn-primary">新建板块</button>
    </div>
    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-ink-50 text-left text-xs uppercase text-ink-500">
          <tr>
            <th class="px-4 py-2">名称</th>
            <th class="px-4 py-2">slug</th>
            <th class="px-4 py-2">排序</th>
            <th class="px-4 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-for="s in items" :key="s.id">
            <td class="px-4 py-2 text-ink-900">{{ s.name }}</td>
            <td class="px-4 py-2 font-mono text-xs text-ink-500">{{ s.slug }}</td>
            <td class="px-4 py-2 text-ink-700">{{ s.order }}</td>
            <td class="px-4 py-2 text-right">
              <button @click="open(s)" class="btn-secondary mr-1">编辑</button>
              <button @click="del(s)" class="btn-danger">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!items.length && !loading" class="p-6 text-center text-ink-500">无板块</div>
    </div>

    <Modal v-if="form" :title="form.id ? '编辑板块' : '新建板块'" @close="form = null">
      <form @submit.prevent="save" class="space-y-3">
        <div>
          <label class="mb-1 block text-sm">名称</label>
          <input v-model="form.name" type="text" required class="input" />
        </div>
        <div>
          <label class="mb-1 block text-sm">slug</label>
          <input v-model="form.slug" type="text" required class="input" pattern="[a-z0-9\-]+" />
        </div>
        <div>
          <label class="mb-1 block text-sm">描述</label>
          <textarea v-model="form.description" rows="2" class="input resize-y"></textarea>
        </div>
        <div>
          <label class="mb-1 block text-sm">排序权重(小的靠前)</label>
          <input v-model.number="form.order" type="number" class="input" />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" @click="form = null" class="btn-secondary">取消</button>
          <button :disabled="busy" class="btn-primary">{{ busy ? "保存中…" : "保存" }}</button>
        </div>
      </form>
    </Modal>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import Modal from "../Modal.vue";

const items = ref([]);
const loading = ref(true);
const form = ref(null);
const busy = ref(false);

async function load() {
  loading.value = true;
  try {
    const r = await api.get("/admin/sections");
    items.value = (r.items || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  } finally {
    loading.value = false;
  }
}
function open(s) {
  form.value = s
    ? { id: s.id, name: s.name, slug: s.slug, description: s.description || "", order: s.order || 0 }
    : { id: null, name: "", slug: "", description: "", order: 0 };
}
async function save() {
  busy.value = true;
  try {
    const payload = { name: form.value.name, slug: form.value.slug, description: form.value.description, order: form.value.order };
    if (form.value.id) await api.patch(`/admin/sections/${form.value.id}`, payload);
    else await api.post("/admin/sections", payload);
    okToast("已保存");
    form.value = null;
    await load();
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}
async function del(s) {
  if (!confirm(`删除板块「${s.name}」?`)) return;
  try { await api.delete(`/admin/sections/${s.id}`); okToast("已删除"); await load(); }
  catch (e) { errToast(e.message); }
}
onMounted(load);
</script>
