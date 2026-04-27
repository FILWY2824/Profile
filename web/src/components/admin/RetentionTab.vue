<template>
  <!-- 数据清理 — 整页只做一件事:勾选要清的目标 → 单清 / 一键清。
       视觉上跟 UsersTab/CardsTab 同款的 surface 列表(单列、行间分隔线、
       hover 与选中态),不再用 grid 双列布局。 -->
  <div class="space-y-5">
    <div class="admin-sticky-head">
      <div class="admin-toolbar">
        <button @click="selectAllPrune(true)" class="btn btn-ghost btn-sm">全选</button>
        <button @click="selectAllPrune(false)" class="btn btn-ghost btn-sm">清空</button>
        <span class="admin-count">已选中 {{ pruneSelectedCount }} / {{ pruneTargets.length }} 类</span>
        <button @click="pruneBatch"
                :disabled="pruneBusy || pruneSelectedCount === 0"
                class="btn btn-secondary btn-sm bulk-danger admin-action">
          {{ pruneBusy ? '清理中…' : `清理选中 (${pruneSelectedCount})` }}
        </button>
      </div>
    </div>

    <!-- 警示信息条 — 数据清理是破坏性操作,明确告诉管理员"不可逆"。 -->
    <div class="warn-banner">
      <span class="badge-amber">注意</span>
      <span>勾选后点 "清理选中" 一次性清掉勾选项;也可单独点每行的 "清理"。
        <strong class="text-warn-700">操作不可逆。</strong>
      </span>
    </div>

    <!-- 列表 — 与其它 admin tab 的 surface 列表风格保持一致:
           单列、每行 padding 充足、底部分隔线、hover/选中态。
           每条目附一行 hint 说明它具体清什么、参考哪个保留天数。 -->
    <div class="surface overflow-hidden">
      <ul>
        <li v-for="t in pruneTargets" :key="t.key"
            :class="['retention-row', pruneSelected[t.key] && 'retention-row-on']">
          <label class="retention-label">
            <input type="checkbox" v-model="pruneSelected[t.key]"
                   :disabled="pruneBusy" class="bulk-cb" />
            <div class="retention-text">
              <div class="retention-name">{{ t.label }}</div>
              <div class="retention-hint">{{ t.hint }}</div>
            </div>
          </label>
          <button @click="pruneOne(t.key)" :disabled="pruneBusy"
                  class="btn btn-ghost btn-sm">清理</button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import { useConfirm } from "../../confirm.js";

// 后端 /admin/retention/:table/prune 接受这 7 个 key,顺序按"高频清理"在前。
// hint 只是给管理员看的辅助说明,不参与请求。
const pruneTargets = [
  { key: "vcodes",               label: "过期验证码",
    hint: "已过期的邮箱 / 重置 / 登录验证码,清理后不影响在用的会话。" },
  { key: "pending",              label: "过期待注册",
    hint: "注册流程未完成、验证码已过期的临时记录(pending 表)。" },
  { key: "login-history",        label: "登录历史",
    hint: "按 LOGIN_HISTORY_RETENTION_DAYS(默认 30 天)清理过旧记录。" },
  { key: "activity-log",         label: "活动日志",
    hint: "按 ACTIVITY_LOG_RETENTION_DAYS(默认 30 天)清理过旧记录。" },
  { key: "oauth-codes",          label: "过期 OAuth 授权码",
    hint: "OAuth 流程中的一次性 code,过期未兑换 token 的部分。" },
  { key: "oauth-tokens-expired", label: "过期 OAuth token",
    hint: "已过期的 access token / refresh token。在用的不会被清。" },
  { key: "favicons",             label: "全部图标缓存",
    hint: "图标缓存表整张清空。再次访问主页时会按需重新抓取。" },
];
const pruneSelected = ref({});
const pruneBusy = ref(false);
const pruneSelectedCount = computed(() =>
  pruneTargets.filter(t => pruneSelected.value[t.key]).length
);
function selectAllPrune(v) {
  for (const t of pruneTargets) pruneSelected.value[t.key] = v;
}

async function pruneOne(table) {
  const target = pruneTargets.find(t => t.key === table);
  const ok = await useConfirm({
    title: "清理数据",
    message: `确认清理 "${target?.label || table}"?`,
    detail: "已被清理的数据无法恢复。",
    kind: "danger",
    confirmText: "立即清理",
  });
  if (!ok) return;
  try {
    const r = await api.post(`/admin/retention/${table}/prune`);
    okToast(`已清理 ${r.removed ?? 0} 条 (${target?.label || table})`);
  } catch (e) { errToast(e.message); }
}

async function pruneBatch() {
  if (pruneBusy.value) return;
  const sel = pruneTargets.filter(t => pruneSelected.value[t.key]);
  if (sel.length === 0) return;
  const ok = await useConfirm({
    title: "批量清理",
    message: `确认一键清理勾选的 ${sel.length} 类数据?`,
    detail: sel.map(t => "· " + t.label).join("\n"),
    kind: "danger",
    confirmText: `清理 ${sel.length} 类`,
  });
  if (!ok) return;
  pruneBusy.value = true;
  let totalRemoved = 0;
  let okCount = 0;
  let failCount = 0;
  for (const t of sel) {
    try {
      const r = await api.post(`/admin/retention/${t.key}/prune`);
      totalRemoved += (r.removed || 0);
      okCount++;
    } catch (e) {
      failCount++;
      // 不打断整批,仅在 toast 上汇报失败次数
      // eslint-disable-next-line no-console
      console.warn(`prune ${t.key} failed:`, e.message);
    }
  }
  pruneBusy.value = false;
  if (failCount === 0) {
    okToast(`已清理 ${okCount} 类、共 ${totalRemoved} 条`);
  } else {
    errToast(`完成 ${okCount} / 失败 ${failCount} · 共清理 ${totalRemoved} 条`);
  }
}
</script>

<style scoped>
.admin-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.admin-count {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
  color: var(--fg-mute);
  white-space: nowrap;
}

.warn-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  background-color: rgba(254, 243, 199, 0.55);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(217, 119, 6, 0.35);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--fg);
}
.text-warn-700 { color: #B45309; font-weight: 500; }

/* 行 — 与 UsersTab/CardsTab 的 .admin-row 同款分隔线 + hover/selected,
   保证视觉与"用户/卡片/审计日志"等列表 tab 同款。 */
.retention-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(15, 36, 25, 0.06);
  transition: background-color 0.14s;
}
.retention-row:last-child {
  border-bottom: none;
}
.retention-row:hover {
  background-color: rgba(255, 255, 255, 0.55);
}
.retention-row-on {
  background-color: rgba(167, 243, 208, 0.30);
}
.retention-row-on:hover {
  background-color: rgba(167, 243, 208, 0.42);
}

.retention-label {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 1;
  cursor: pointer;
  min-width: 0;
}
.retention-text {
  flex: 1;
  min-width: 0;
}
.retention-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--fg);
  line-height: 1.4;
}
.retention-hint {
  font-size: 12px;
  color: var(--fg-mute);
  line-height: 1.5;
  margin-top: 2px;
}

.bulk-cb {
  accent-color: var(--brand);
  width: 16px;
  height: 16px;
  cursor: pointer;
  vertical-align: middle;
  flex-shrink: 0;
  /* 让 checkbox 与 retention-name 第一行的字基线大致对齐 */
  margin-top: 2px;
}
.bulk-danger {
  color: var(--danger) !important;
  border-color: rgba(220, 38, 38, 0.30) !important;
}
.bulk-danger:hover:not(:disabled) {
  background-color: rgba(220, 38, 38, 0.08) !important;
}
</style>

