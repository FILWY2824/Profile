<template>
  <div class="space-y-4">
    <div class="flex justify-end">
      <button @click="open()" class="btn-primary">新建 OAuth 应用</button>
    </div>
    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-ink-50 text-left text-xs uppercase text-ink-500">
          <tr>
            <th class="px-4 py-2">client_id</th>
            <th class="px-4 py-2">名称</th>
            <th class="px-4 py-2">最低等级</th>
            <th class="px-4 py-2">状态</th>
            <th class="px-4 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-for="c in items" :key="c.id">
            <td class="px-4 py-2 font-mono text-xs text-ink-900">{{ c.clientId }}</td>
            <td class="px-4 py-2 text-ink-700">{{ c.name }}</td>
            <td class="px-4 py-2 text-ink-700">{{ ["user", "member", "admin"][c.minLevel] }}</td>
            <td class="px-4 py-2">
              <span class="badge" :class="c.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-ink-100 text-ink-600'">{{ c.status }}</span>
            </td>
            <td class="px-4 py-2 text-right">
              <button @click="rotate(c)" class="btn-secondary mr-1">轮换密钥</button>
              <button @click="open(c)" class="btn-secondary mr-1">编辑</button>
              <button @click="del(c)" class="btn-danger">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!items.length && !loading" class="p-6 text-center text-ink-500">无应用</div>
    </div>

    <Modal v-if="form" :title="form.id ? '编辑应用' : '新建应用'" @close="form = null">
      <form @submit.prevent="save" class="space-y-3">
        <div v-if="!form.id">
          <label class="mb-1 block text-sm">client_id</label>
          <input v-model="form.clientId" type="text" required class="input font-mono text-xs" pattern="[a-zA-Z0-9\-_]+" />
        </div>
        <div>
          <label class="mb-1 block text-sm">名称</label>
          <input v-model="form.name" type="text" required class="input" />
        </div>
        <div>
          <label class="mb-1 block text-sm">描述</label>
          <textarea v-model="form.description" rows="2" class="input resize-y"></textarea>
        </div>
        <div>
          <label class="mb-1 block text-sm">主页 URL</label>
          <input v-model="form.homepageUrl" type="url" class="input" />
        </div>
        <div>
          <label class="mb-1 block text-sm">Logo URL</label>
          <input v-model="form.logoUrl" type="url" class="input" />
        </div>
        <div>
          <label class="mb-1 block text-sm">最低账号等级</label>
          <select v-model.number="form.minLevel" class="input">
            <option :value="0">user — 任意登录用户</option>
            <option :value="1">member — 会员及以上</option>
            <option :value="2">admin — 仅管理员</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-sm">允许的 redirect URI(每行一个)</label>
          <textarea v-model="form.redirectUrisText" rows="2" required class="input resize-y font-mono text-xs"></textarea>
        </div>
        <div>
          <label class="mb-1 block text-sm">允许的 scope(空格分隔)</label>
          <input v-model="form.scopesText" type="text" class="input font-mono text-xs" placeholder="openid profile email" />
        </div>
        <div>
          <label class="mb-1 block text-sm">状态</label>
          <select v-model="form.status" class="input">
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" @click="form = null" class="btn-secondary">取消</button>
          <button :disabled="busy" class="btn-primary">{{ busy ? "保存中…" : "保存" }}</button>
        </div>
      </form>
    </Modal>

    <Modal v-if="newSecret" title="客户端密钥(仅展示一次)" @close="newSecret = null">
      <p class="mb-2 text-sm text-ink-700">
        请妥善保存以下密钥,关闭此窗口后将无法再次查看。
      </p>
      <pre class="overflow-x-auto rounded-md bg-ink-50 p-3 text-xs font-mono text-ink-900">{{ newSecret }}</pre>
      <div class="mt-3 flex justify-end">
        <button @click="copy(newSecret); newSecret = null" class="btn-primary">已复制并关闭</button>
      </div>
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
const newSecret = ref(null);

async function load() {
  loading.value = true;
  try {
    const r = await api.get("/admin/oauth-clients");
    items.value = r.items || [];
  } finally {
    loading.value = false;
  }
}

function open(c) {
  form.value = c
    ? {
        id: c.id, clientId: c.clientId, name: c.name, description: c.description || "",
        homepageUrl: c.homepageUrl || "", logoUrl: c.logoUrl || "",
        minLevel: c.minLevel || 0,
        redirectUrisText: (c.redirectUris || []).join("\n"),
        scopesText: (c.scopes || []).join(" "),
        status: c.status,
      }
    : {
        id: null, clientId: "", name: "", description: "",
        homepageUrl: "", logoUrl: "", minLevel: 0,
        redirectUrisText: "", scopesText: "openid", status: "active",
      };
}

async function save() {
  busy.value = true;
  try {
    const payload = {
      clientId: form.value.clientId,
      name: form.value.name,
      description: form.value.description,
      homepageUrl: form.value.homepageUrl,
      logoUrl: form.value.logoUrl,
      minLevel: form.value.minLevel,
      redirectUris: form.value.redirectUrisText.split("\n").map((s) => s.trim()).filter(Boolean),
      scopes: form.value.scopesText.split(/\s+/).filter(Boolean),
      status: form.value.status,
    };
    if (form.value.id) {
      await api.patch(`/admin/oauth-clients/${form.value.id}`, payload);
      okToast("已保存");
    } else {
      const r = await api.post("/admin/oauth-clients", payload);
      newSecret.value = r.clientSecret;
      okToast("已创建");
    }
    form.value = null;
    await load();
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}

async function rotate(c) {
  if (!confirm(`轮换 ${c.name} 的密钥?旧密钥将立即失效。`)) return;
  try {
    const r = await api.post(`/admin/oauth-clients/${c.id}/rotate-secret`);
    newSecret.value = r.clientSecret;
  } catch (e) { errToast(e.message); }
}

async function del(c) {
  if (!confirm(`删除应用「${c.name}」?现有授权将立即失效。`)) return;
  try { await api.delete(`/admin/oauth-clients/${c.id}`); okToast("已删除"); await load(); }
  catch (e) { errToast(e.message); }
}

function copy(s) {
  navigator.clipboard?.writeText(s).catch(() => {});
}

onMounted(load);
</script>
