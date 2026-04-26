<template>
  <div v-if="totalPages > 1" class="pagination">
    <span class="pg-info">共 {{ total }} 条 · 第 {{ currentPage }}/{{ totalPages }} 页</span>
    <div class="pg-controls">
      <button class="pg-btn" :disabled="currentPage === 1" @click="go(1)" title="第一页">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M18.75 19.5 11.25 12l7.5-7.5M11.25 19.5 3.75 12l7.5-7.5"/>
        </svg>
      </button>
      <button class="pg-btn" :disabled="currentPage === 1" @click="go(currentPage - 1)" title="上一页">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/>
        </svg>
      </button>
      <button
        v-for="p in pageList"
        :key="p.key"
        class="pg-num"
        :class="{ active: p.value === currentPage, ellipsis: p.ellipsis }"
        :disabled="p.ellipsis"
        @click="!p.ellipsis && go(p.value)"
      >
        {{ p.label }}
      </button>
      <button class="pg-btn" :disabled="currentPage === totalPages" @click="go(currentPage + 1)" title="下一页">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/>
        </svg>
      </button>
      <button class="pg-btn" :disabled="currentPage === totalPages" @click="go(totalPages)" title="最后一页">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="m5.25 4.5 7.5 7.5-7.5 7.5m6-15 7.5 7.5-7.5 7.5"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  total: { type: Number, required: true },
  currentPage: { type: Number, required: true },
  pageSize: { type: Number, default: 10 },
});

const emit = defineEmits(["update:currentPage", "page-change"]);

const totalPages = computed(() =>
  Math.max(1, Math.ceil(props.total / props.pageSize))
);

// 智能页码列表 - 当前页周围 ±2 + 首尾,中间用省略号
const pageList = computed(() => {
  const result = [];
  const cur = props.currentPage;
  const last = totalPages.value;
  const pages = new Set([1, last]);
  for (let i = cur - 2; i <= cur + 2; i++) {
    if (i >= 1 && i <= last) pages.add(i);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) {
      result.push({ key: `e${p}`, value: 0, label: "…", ellipsis: true });
    }
    result.push({ key: `p${p}`, value: p, label: String(p), ellipsis: false });
    prev = p;
  }
  return result;
});

function go(page) {
  if (page < 1 || page > totalPages.value || page === props.currentPage) return;
  emit("update:currentPage", page);
  emit("page-change", page);
}
</script>

<style scoped>
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 4px 6px;
  flex-wrap: wrap;
}
.pg-info {
  font-size: 12.5px;
  color: var(--fg-mute);
}
.pg-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.pg-btn, .pg-num {
  min-width: 32px;
  height: 30px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(15, 36, 25, 0.14);
  background: rgba(255, 255, 255, 0.78);
  color: var(--fg-dim);
  font-size: 12.5px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: "JetBrains Mono", ui-monospace, monospace;
}
.pg-btn:hover:not(:disabled),
.pg-num:hover:not(.active):not(:disabled):not(.ellipsis) {
  background-color: white;
  border-color: rgba(15, 36, 25, 0.22);
  color: var(--fg);
}
.pg-num.active {
  background-color: var(--brand-deep);
  color: white;
  border-color: var(--brand-deep);
}
.pg-btn:disabled, .pg-num:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.pg-num.ellipsis {
  border-color: transparent;
  background: transparent;
  cursor: default;
}
</style>
