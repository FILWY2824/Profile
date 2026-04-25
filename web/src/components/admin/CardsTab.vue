<template>
  <div class="space-y-4">
    <div class="flex justify-end">
      <button @click="open()" class="btn-primary">新建卡片</button>
    </div>
    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-ink-50 text-left text-xs uppercase text-ink-500">
          <tr>
            <th class="px-4 py-2">标题</th>
            <th class="px-4 py-2">URL</th>
            <th class="px-4 py-2">板块</th>
            <th class="px-4 py-2">权限</th>
            <th class="px-4 py-2">排序</th>
            <th class="px-4 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-for="c in items" :key="c.id">
            <td class="px-4 py-2 text-ink-900">{{ c.title }}</td>
            <td class="truncate px-4 py-2 text-xs text-ink-500" style="max-width: 16rem">
              <a :href="c.url" target="_blank" class="hover:text-ink-700" rel="noopener">{{ c.url }}</a>
            </td>
            <td class="px-4 py-2 text-ink-700">{{ sectionName(c.sectionId) }}</td>
            <td class="px-4 py-2"><PermissionBadge :perm="c.permission" /></td>
            <td class="px-4 py-2 text-ink-700">{{ c.order }}</td>
            <td class="px-4 py-2 text-right">
              <button @click="open(c)" class="btn-secondary mr-1">编辑</button>
              <button @click="del(c)" class="btn-danger">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!items.length && !loading" class="p-6 text-center text-ink-500">无卡片</div>
    </div>

    <Modal v-if="form" :title="form.id ? '编辑卡片' : '新建卡片'" @close="form = null">
      <form @submit.prevent="save" class="space-y-3">
        <div>
          <label class="mb-1 block text-sm">标题</label>
          <input v-model="form.title" type="text" required class="input" />
        </div>
        <div>
          <label class="mb-1 block text-sm">URL(http(s) only)</label>
          <input v-model="form.url" type="url" required class="input" />
        </div>
        <div>
          <label class="mb-1 block text-sm">描述</label>
          <textarea v-model="form.description" rows="2" class="input resize-y"></textarea>
        </div>
        <div>
          <label class="mb-1 block text-sm">板块</label>
          <select v-model="form.sectionId" class="input">
            <option value="">— 无 —</option>
            <option v-for="s in sections" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-sm">权限</label>
          <select v-model="form.permission" class="input">
            <option value="public">public — 所有人</option>
            <option value="user">user — 任意登录用户</option>
            <option value="member">member — 会员及以上</option>
            <option value="admin">admin — 仅管理员</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-sm">排序权重</label>
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
import PermissionBadge from "../PermissionBadge.vue";

const items = ref([]);
const sections = ref([]);
const loading = ref(true);
const form = ref(null);
const busy = ref(false);

function sectionName(id) {
  return sections.value.find((s) => s.id === id)?.name || "—";
}

async function load() {
  loading.value = true;
  try {
    const [c, s] = await Promise.all([api.get("/admin/cards"), api.get("/admin/sections")]);
    items.value = (c.items || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    sections.value = (s.items || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  } finally {
    loading.value = false;
  }
}
function open(c) {
  form.value = c
    ? { id: c.id, title: c.title, url: c.url, description: c.description || "", sectionId: c.sectionId || "", permission: c.permission, order: c.order || 0 }
    : { id: null, title: "", url: "", description: "", sectionId: "", permission: "public", order: 0 };
}
async function save() {
  busy.value = true;
  try {
    const payload = {
      title: form.value.title, url: form.value.url, description: form.value.description,
      sectionId: form.value.sectionId, permission: form.value.permission, order: form.value.order,
    };
    if (form.value.id) await api.patch(`/admin/cards/${form.value.id}`, payload);
    else await api.post("/admin/cards", payload);
    okToast("已保存");
    form.value = null;
    await load();
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}
async function del(c) {
  if (!confirm(`删除卡片「${c.title}」?`)) return;
  try { await api.delete(`/admin/cards/${c.id}`); okToast("已删除"); await load(); }
  catch (e) { errToast(e.message); }
}
onMounted(load);
</script>
