<template>
  <div class="space-y-4">
    <div class="flex items-center justify-end">
      <button @click="showCreate = true" class="btn-primary">新建用户</button>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-ink-50 text-left text-xs uppercase text-ink-500">
          <tr>
            <th class="px-4 py-2 font-medium">邮箱</th>
            <th class="px-4 py-2 font-medium">名称</th>
            <th class="px-4 py-2 font-medium">角色</th>
            <th class="px-4 py-2 font-medium">状态</th>
            <th class="px-4 py-2 font-medium">最近登录</th>
            <th class="px-4 py-2 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-for="u in items" :key="u.id">
            <td class="px-4 py-2 text-ink-900">{{ u.email }}</td>
            <td class="px-4 py-2 text-ink-700">{{ u.name }}</td>
            <td class="px-4 py-2">
              <span class="badge" :class="roleBadge(u.role)">{{ u.role }}</span>
            </td>
            <td class="px-4 py-2">
              <span class="badge" :class="statusBadge(u.status)">{{ u.status }}</span>
            </td>
            <td class="px-4 py-2 text-xs text-ink-500">{{ formatTime(u.lastLoginAt) }}</td>
            <td class="px-4 py-2 text-right">
              <button @click="onEdit(u)" class="btn-secondary mr-1">编辑</button>
              <button @click="onDelete(u)" class="btn-danger">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="items.length === 0 && !loading" class="p-6 text-center text-ink-500">无用户</div>
    </div>

    <Modal v-if="editing" :title="editing.id ? '编辑用户' : '新建用户'" @close="editing = null">
      <form @submit.prevent="onSave" class="space-y-3">
        <div v-if="!editing.id">
          <label class="mb-1 block text-sm">邮箱</label>
          <input v-model="editing.email" type="email" required class="input" />
        </div>
        <div v-if="!editing.id">
          <label class="mb-1 block text-sm">密码</label>
          <input v-model="editing.password" type="password" required minlength="8" class="input" />
        </div>
        <div>
          <label class="mb-1 block text-sm">名称</label>
          <input v-model="editing.name" type="text" required maxlength="32" class="input" />
        </div>
        <div>
          <label class="mb-1 block text-sm">角色</label>
          <select v-model="editing.role" class="input">
            <option value="user">user</option>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div v-if="editing.id">
          <label class="mb-1 block text-sm">状态</label>
          <select v-model="editing.status" class="input">
            <option value="active">active</option>
            <option value="banned">banned</option>
            <option value="disabled">disabled</option>
          </select>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" @click="editing = null" class="btn-secondary">取消</button>
          <button :disabled="busy" class="btn-primary">{{ busy ? "保存中…" : "保存" }}</button>
        </div>
      </form>
    </Modal>

    <Modal v-if="showCreate" title="新建用户" @close="showCreate = false">
      <form @submit.prevent="onCreate" class="space-y-3">
        <div>
          <label class="mb-1 block text-sm">邮箱</label>
          <input v-model="create.email" type="email" required class="input" />
        </div>
        <div>
          <label class="mb-1 block text-sm">密码</label>
          <input v-model="create.password" type="password" required minlength="8" class="input" />
        </div>
        <div>
          <label class="mb-1 block text-sm">名称</label>
          <input v-model="create.name" type="text" required maxlength="32" class="input" />
        </div>
        <div>
          <label class="mb-1 block text-sm">角色</label>
          <select v-model="create.role" class="input">
            <option value="user">user</option>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" @click="showCreate = false" class="btn-secondary">取消</button>
          <button :disabled="busy" class="btn-primary">{{ busy ? "创建中…" : "创建" }}</button>
        </div>
      </form>
    </Modal>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import { formatTime } from "../../format.js";
import Modal from "../Modal.vue";

const items = ref([]);
const loading = ref(true);
const editing = ref(null);
const showCreate = ref(false);
const create = ref({ email: "", password: "", name: "", role: "user" });
const busy = ref(false);

function roleBadge(r) {
  return { admin: "bg-rose-100 text-rose-800", member: "bg-amber-100 text-amber-800" }[r] || "bg-ink-100 text-ink-700";
}
function statusBadge(s) {
  return { active: "bg-emerald-100 text-emerald-800", banned: "bg-red-100 text-red-800", disabled: "bg-ink-100 text-ink-600" }[s] || "bg-ink-100 text-ink-600";
}

async function load() {
  loading.value = true;
  try {
    const r = await api.get("/admin/users?limit=200");
    items.value = r.items || [];
  } finally {
    loading.value = false;
  }
}

function onEdit(u) {
  editing.value = { id: u.id, name: u.name, role: u.role, status: u.status, bio: u.bio || "" };
}

async function onSave() {
  busy.value = true;
  try {
    await api.patch(`/admin/users/${editing.value.id}`, {
      name: editing.value.name,
      role: editing.value.role,
      status: editing.value.status,
      bio: editing.value.bio,
    });
    okToast("已保存");
    editing.value = null;
    await load();
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = false;
  }
}

async function onCreate() {
  busy.value = true;
  try {
    await api.post("/admin/users", create.value);
    okToast("已创建");
    showCreate.value = false;
    create.value = { email: "", password: "", name: "", role: "user" };
    await load();
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = false;
  }
}

async function onDelete(u) {
  if (!confirm(`确定删除用户 ${u.email}?该操作不可恢复。`)) return;
  try {
    await api.delete(`/admin/users/${u.id}`);
    okToast("已删除");
    await load();
  } catch (e) {
    errToast(e.message);
  }
}

onMounted(load);
</script>
