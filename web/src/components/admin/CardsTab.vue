<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="h-page">卡片管理</h1>
        <p class="text-muted text-sm mt-1">{{ items.length }} 张卡片</p>
      </div>
      <button @click="openCreate" class="btn-primary">+ 新建卡片</button>
    </header>

    <div class="surface overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
          <tr>
            <th class="px-4 py-2.5 text-left font-medium">标题</th>
            <th class="px-4 py-2.5 text-left font-medium">URL</th>
            <th class="px-4 py-2.5 text-left font-medium">板块</th>
            <th class="px-4 py-2.5 text-left font-medium">权限</th>
            <th class="px-4 py-2.5 text-left font-medium w-20">排序</th>
            <th class="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="c in items" :key="c.id" class="hover:bg-slate-50">
            <td class="px-4 py-2.5 font-medium">{{ c.title }}</td>
            <td class="px-4 py-2.5"><a :href="c.url" target="_blank" class="text-xs text-accent-600 hover:underline truncate inline-block max-w-[200px] align-middle">{{ c.url }}</a></td>
            <td class="px-4 py-2.5 text-xs text-muted">{{ sectionName(c.sectionId) }}</td>
            <td class="px-4 py-2.5"><PermissionBadge :value="c.permission" /></td>
            <td class="px-4 py-2.5 text-xs">{{ c.order }}</td>
            <td class="px-4 py-2.5 text-right whitespace-nowrap">
              <button @click="openEdit(c)" class="btn-ghost btn-sm">编辑</button>
              <button @click="onDelete(c)" class="btn-ghost btn-sm text-red-600">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-model="modalOpen" :title="editing?.id ? '编辑卡片' : '新建卡片'">
      <div v-if="editing" class="space-y-3">
        <div><label class="label">标题</label><input v-model="editing.title" class="input" /></div>
        <div><label class="label">URL</label><input v-model="editing.url" class="input-mono" placeholder="https://..." /></div>
        <div><label class="label">描述</label><textarea v-model="editing.description" rows="2" class="input"></textarea></div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">板块</label>
            <select v-model="editing.sectionId" class="input">
              <option value="">(无)</option>
              <option v-for="s in sections" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div>
            <label class="label">访问权限</label>
            <select v-model="editing.permission" class="input">
              <option value="public">公开</option>
              <option value="user">用户</option>
              <option value="member">成员</option>
              <option value="admin">管理员</option>
            </select>
          </div>
        </div>
        <div><label class="label">排序权重</label><input v-model.number="editing.order" type="number" class="input" /></div>
      </div>
      <template #footer>
        <button @click="modalOpen = false" class="btn-secondary">取消</button>
        <button @click="onSave" :disabled="busy" class="btn-primary">{{ busy ? '保存中…' : '保存' }}</button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import Modal from "../Modal.vue";
import PermissionBadge from "../PermissionBadge.vue";

const items = ref([]);
const sections = ref([]);
const modalOpen = ref(false);
const editing = ref(null);
const busy = ref(false);

const sectionName = (id) => sections.value.find((s) => s.id === id)?.name || (id ? "?" : "—");

async function load() {
  const [c, s] = await Promise.all([api.get("/admin/cards"), api.get("/admin/sections")]);
  items.value = c.items || [];
  sections.value = s.items || [];
}
function openCreate() { editing.value = { title: "", url: "", description: "", sectionId: "", permission: "public", order: items.value.length }; modalOpen.value = true; }
function openEdit(c) { editing.value = { ...c, sectionId: c.sectionId || "" }; modalOpen.value = true; }
async function onSave() {
  busy.value = true;
  try {
    const body = { ...editing.value };
    if (editing.value.id) await api.patch("/admin/cards/" + editing.value.id, body);
    else await api.post("/admin/cards", body);
    okToast("已保存"); modalOpen.value = false; await load();
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}
async function onDelete(c) {
  if (!confirm(`删除卡片 ${c.title}?`)) return;
  try { await api.delete("/admin/cards/" + c.id); okToast("已删除"); await load(); }
  catch (e) { errToast(e.message); }
}
onMounted(load);
</script>
