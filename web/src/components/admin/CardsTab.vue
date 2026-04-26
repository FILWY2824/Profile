<template>
  <div class="space-y-6">
    <header class="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 class="h-page">卡片管理<span class="text-teal-300">.</span></h1>
        <p class="text-fg-dim text-sm mt-1.5">{{ items.length }} 张卡片</p>
      </div>
      <button @click="openCreate" class="btn btn-primary">+ 新建卡片</button>
    </header>

    <div class="surface overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="admin-thead">
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">标题</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">URL</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">板块</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">权限</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider w-20">排序</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in pagedItems" :key="c.id" class="admin-row">
              <td class="px-4 py-3 font-semibold text-fg">{{ c.title }}</td>
              <td class="px-4 py-3">
                <!-- 只在管理员视图显示 URL,但不再做"点击跳转"
                     这能避免在表格里用 anchor 让浏览器历史记录里出现 URL。
                     管理员要测试卡片可以用主页或编辑表单。 -->
                <span class="font-mono text-xs text-fg-dim truncate inline-block max-w-[260px] align-middle" :title="c.url">{{ c.url }}</span>
              </td>
              <td class="px-4 py-3 text-xs text-fg-dim">{{ sectionName(c.sectionId) }}</td>
              <td class="px-4 py-3"><PermissionBadge :value="c.permission" /></td>
              <td class="px-4 py-3 text-xs text-fg-dim font-mono">{{ c.order }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button @click="openEdit(c)" class="btn btn-ghost btn-sm">编辑</button>
                <button @click="onDelete(c)" class="btn btn-ghost btn-sm text-danger hover:!text-danger">删除</button>
              </td>
            </tr>
            <tr v-if="items.length === 0">
              <td colspan="6" class="px-4 py-12 text-center text-fg-dim text-sm">暂无卡片</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="items.length > 0" class="px-4 py-2">
        <Pagination :total="items.length" v-model:current-page="page" :page-size="10" />
      </div>
    </div>

    <Modal v-model="modalOpen" :title="editing?.id ? '编辑卡片' : '新建卡片'">
      <div v-if="editing" class="space-y-4">
        <div><label class="label">标题</label><input v-model="editing.title" class="input" /></div>
        <div><label class="label">URL</label><input v-model="editing.url" class="input input-mono" placeholder="https://..." /></div>
        <div><label class="label">描述 <span class="label-opt">(可选)</span></label><textarea v-model="editing.description" rows="2" class="input"></textarea></div>
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
        <button @click="modalOpen = false" class="btn btn-secondary">取消</button>
        <button @click="onSave" :disabled="busy" class="btn btn-primary">{{ busy ? '保存中…' : '保存' }}</button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import { useConfirm } from "../../confirm.js";
import Modal from "../Modal.vue";
import Pagination from "../Pagination.vue";
import PermissionBadge from "../PermissionBadge.vue";

const items = ref([]);
const sections = ref([]);
const modalOpen = ref(false);
const editing = ref(null);
const busy = ref(false);
const page = ref(1);
const PAGE_SIZE = 10;

const pagedItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return items.value.slice(start, start + PAGE_SIZE);
});

const sectionName = (id) => sections.value.find((s) => s.id === id)?.name || (id ? "?" : "—");

async function load() {
  try {
    const [c, s] = await Promise.all([api.get("/admin/cards"), api.get("/admin/sections")]);
    items.value = c.items || [];
    sections.value = s.items || [];
  } catch (e) { errToast(e.message); }
}
function openCreate() { editing.value = { title: "", url: "", description: "", sectionId: "", permission: "public", order: items.value.length }; modalOpen.value = true; }
function openEdit(c) { editing.value = { ...c, sectionId: c.sectionId || "" }; modalOpen.value = true; }
async function onSave() {
  busy.value = true;
  try {
    const body = { ...editing.value };
    if (editing.value.id) {
      await api.patch("/admin/cards/" + editing.value.id, body);
      okToast("卡片已更新");
    } else {
      await api.post("/admin/cards", body);
      okToast("卡片已创建");
    }
    modalOpen.value = false; await load();
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}
async function onDelete(c) {
  const ok = await useConfirm({
    title: "删除卡片",
    message: `确认删除卡片 "${c.title}"?`,
    detail: c.url,
    kind: "danger",
    confirmText: "删除",
  });
  if (!ok) return;
  try {
    await api.delete("/admin/cards/" + c.id);
    okToast("卡片已删除");
    await load();
  } catch (e) { errToast(e.message); }
}
onMounted(load);
</script>

<style scoped>
.admin-thead {
  border-bottom: 1px solid rgba(15, 36, 25, 0.10);
  background-color: rgba(255, 255, 255, 0.55);
}
.admin-row {
  border-bottom: 1px solid rgba(15, 36, 25, 0.06);
  transition: background-color 0.14s;
}
.admin-row:hover {
  background-color: rgba(255, 255, 255, 0.55);
}
.label-opt {
  color: var(--fg-mute);
  font-weight: normal;
  font-size: 11px;
  letter-spacing: normal;
  margin-left: 4px;
  text-transform: none;
}
</style>
