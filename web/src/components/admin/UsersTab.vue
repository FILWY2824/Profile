<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="h-page">用户管理</h1>
        <p class="text-muted text-sm mt-1">{{ users.length }} / {{ total }} 用户</p>
      </div>
      <button @click="openCreate" class="btn-primary">+ 新建用户</button>
    </header>

    <div class="surface overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
            <tr>
              <th class="px-4 py-2.5 text-left font-medium">邮箱</th>
              <th class="px-4 py-2.5 text-left font-medium">姓名</th>
              <th class="px-4 py-2.5 text-left font-medium">角色</th>
              <th class="px-4 py-2.5 text-left font-medium">状态</th>
              <th class="px-4 py-2.5 text-left font-medium">最后登录</th>
              <th class="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="u in users" :key="u.id" class="hover:bg-slate-50">
              <td class="px-4 py-2.5 font-mono text-xs">{{ u.email }}</td>
              <td class="px-4 py-2.5">{{ u.name }}</td>
              <td class="px-4 py-2.5"><span :class="roleBadge(u.role)">{{ u.role }}</span></td>
              <td class="px-4 py-2.5"><span :class="statusBadge(u.status)">{{ u.status }}</span></td>
              <td class="px-4 py-2.5 text-xs text-muted">{{ formatTime(u.lastLoginAt) }}</td>
              <td class="px-4 py-2.5 text-right whitespace-nowrap">
                <button @click="openEdit(u)" class="btn-ghost btn-sm">编辑</button>
                <button @click="onDelete(u)" class="btn-ghost btn-sm text-red-600">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal v-model="modalOpen" :title="editing?.id ? '编辑用户' : '新建用户'">
      <div v-if="editing" class="space-y-3">
        <div>
          <label class="label">邮箱</label>
          <input v-model="editing.email" :disabled="!!editing.id" type="email" class="input" />
        </div>
        <div>
          <label class="label">姓名</label>
          <input v-model="editing.name" class="input" />
        </div>
        <div v-if="!editing.id">
          <label class="label">密码</label>
          <input v-model="editing.password" type="password" class="input" placeholder="至少 8 字符" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">角色</label>
            <select v-model="editing.role" class="input">
              <option value="user">普通用户</option>
              <option value="member">成员</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          <div v-if="editing.id">
            <label class="label">状态</label>
            <select v-model="editing.status" class="input">
              <option value="active">活跃</option>
              <option value="banned">封禁</option>
              <option value="disabled">禁用</option>
            </select>
          </div>
        </div>
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
import { formatTime } from "../../format.js";
import Modal from "../Modal.vue";

const users = ref([]);
const total = ref(0);
const modalOpen = ref(false);
const editing = ref(null);
const busy = ref(false);

function roleBadge(r) {
  if (r === "admin") return "badge badge-amber";
  if (r === "member") return "badge badge-emerald";
  return "badge badge-slate";
}
function statusBadge(s) {
  if (s === "active") return "badge badge-emerald";
  if (s === "banned") return "badge badge-red";
  return "badge badge-slate";
}

async function load() {
  const r = await api.get("/admin/users?limit=200");
  users.value = r.items || [];
  total.value = r.total || 0;
}

function openCreate() {
  editing.value = { email: "", name: "", password: "", role: "user" };
  modalOpen.value = true;
}
function openEdit(u) {
  editing.value = { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, bio: u.bio };
  modalOpen.value = true;
}

async function onSave() {
  busy.value = true;
  try {
    if (editing.value.id) {
      await api.patch("/admin/users/" + editing.value.id, {
        name: editing.value.name, role: editing.value.role,
        status: editing.value.status, bio: editing.value.bio,
      });
    } else {
      await api.post("/admin/users", {
        email: editing.value.email, password: editing.value.password,
        name: editing.value.name, role: editing.value.role,
      });
    }
    okToast("已保存");
    modalOpen.value = false;
    await load();
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}

async function onDelete(u) {
  if (!confirm(`确认删除用户 ${u.email}?\n这将连同其所有 OAuth token / 授权一并清除。`)) return;
  try {
    await api.delete("/admin/users/" + u.id);
    okToast("已删除");
    await load();
  } catch (e) { errToast(e.message); }
}

onMounted(load);
</script>
