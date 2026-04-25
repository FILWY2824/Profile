<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="h-page">板块管理</h1>
        <p class="text-muted text-sm mt-1">{{ items.length }} 个板块</p>
      </div>
      <button @click="openCreate" class="btn-primary">+ 新建板块</button>
    </header>

    <div class="surface overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
          <tr>
            <th class="px-4 py-2.5 text-left font-medium">名称</th>
            <th class="px-4 py-2.5 text-left font-medium">Slug</th>
            <th class="px-4 py-2.5 text-left font-medium">描述</th>
            <th class="px-4 py-2.5 text-left font-medium w-20">排序</th>
            <th class="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="s in items" :key="s.id" class="hover:bg-slate-50">
            <td class="px-4 py-2.5 font-medium">{{ s.name }}</td>
            <td class="px-4 py-2.5 text-xs font-mono text-slate-500">{{ s.slug }}</td>
            <td class="px-4 py-2.5 text-xs text-muted truncate max-w-xs">{{ s.description }}</td>
            <td class="px-4 py-2.5 text-xs">{{ s.order }}</td>
            <td class="px-4 py-2.5 text-right whitespace-nowrap">
              <button @click="openEdit(s)" class="btn-ghost btn-sm">编辑</button>
              <button @click="onDelete(s)" class="btn-ghost btn-sm text-red-600">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-model="modalOpen" :title="editing?.id ? '编辑板块' : '新建板块'">
      <div v-if="editing" class="space-y-3">
        <div><label class="label">名称</label><input v-model="editing.name" class="input" /></div>
        <div><label class="label">Slug (字母数字短横线)</label><input v-model="editing.slug" class="input-mono" /></div>
        <div><label class="label">描述</label><textarea v-model="editing.description" rows="2" class="input"></textarea></div>
        <div><label class="label">排序权重(小的靠前)</label><input v-model.number="editing.order" type="number" class="input" /></div>
      </div>
      <template #footer>
        <button @click="modalOpen = false" class="btn-secondary">取消</button>
        <button @click="onSave" :disabled="busy" class="btn-primary">{{ busy ? '保存中…' : '保存' }}</button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import Modal from "../Modal.vue";

const items = ref([]);
const modalOpen = ref(false);
const editing = ref(null);
const busy = ref(false);

async function load() {
  const r = await api.get("/admin/sections");
  items.value = r.items || [];
}
function openCreate() { editing.value = { name: "", slug: "", description: "", order: items.value.length }; modalOpen.value = true; }
function openEdit(s) { editing.value = { ...s }; modalOpen.value = true; }
async function onSave() {
  busy.value = true;
  try {
    if (editing.value.id) {
      await api.patch("/admin/sections/" + editing.value.id, editing.value);
    } else {
      await api.post("/admin/sections", editing.value);
    }
    okToast("已保存"); modalOpen.value = false; await load();
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}
async function onDelete(s) {
  if (!confirm(`删除板块 ${s.name}?板块内的卡片不会被删除,但会变为无所属。`)) return;
  try {
    await api.delete("/admin/sections/" + s.id);
    okToast("已删除"); await load();
  } catch (e) { errToast(e.message); }
}
onMounted(load);
</script>
