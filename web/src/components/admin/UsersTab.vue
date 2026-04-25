<template>
  <div class="space-y-6">
    <header class="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 class="h-page">用户管理</h1>
        <p class="text-fg-dim text-sm mt-1.5">{{ users.length }} / {{ total }} 用户</p>
      </div>
      <button @click="openCreate" class="btn btn-primary">+ 新建用户</button>
    </header>

    <div class="surface overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-line bg-bg-2/50">
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">邮箱</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">姓名</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">角色</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">状态</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">最后登录</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" class="border-b border-line/60 hover:bg-white/3 transition-colors">
              <td class="px-4 py-3 font-mono text-xs text-fg">{{ u.email }}</td>
              <td class="px-4 py-3 text-fg">{{ u.name }}</td>
              <td class="px-4 py-3"><span :class="roleBadge(u.role)">{{ roleLabel(u.role) }}</span></td>
              <td class="px-4 py-3"><span :class="statusBadge(u.status)">{{ statusLabel(u.status) }}</span></td>
              <td class="px-4 py-3 text-xs text-fg-dim">{{ formatTime(u.lastLoginAt) }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button @click="openEdit(u)" class="btn btn-ghost btn-sm">编辑</button>
                <button @click="onDelete(u)" class="btn btn-ghost btn-sm text-danger hover:!text-danger">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal v-model="modalOpen" :title="editing?.id ? '编辑用户' : '新建用户'">
      <div v-if="editing" class="space-y-4">
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
        <button @click="modalOpen = false" class="btn btn-secondary">取消</button>
        <button @click="onSave" :disabled="busy" class="btn btn-primary">{{ busy ? '保存中…' : '保存' }}</button>
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

const roleLabel = (r) => ({admin:"管理员", member:"成员", user:"用户"}[r] || r);
const statusLabel = (s) => ({active:"活跃", banned:"封禁", disabled:"禁用"}[s] || s);

function roleBadge(r) {
  if (r === "admin") return "badge-amber";
  if (r === "member") return "badge-emerald";
  return "badge-slate";
}
function statusBadge(s) {
  if (s === "active") return "badge-emerald";
  if (s === "banned") return "badge-red";
  return "badge-slate";
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
