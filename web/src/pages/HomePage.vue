<template>
  <div>
    <!-- Hero header -->
    <header class="mb-10 sm:mb-12">
      <div class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-sm text-fg-dim mb-2">{{ greeting }}{{ userName ? '，' + userName : '' }}</p>
          <h1 class="h-page">
            {{ siteName }}<span class="text-teal-300">.</span>
          </h1>
          <p v-if="siteDescription" class="text-fg-dim mt-3 max-w-2xl text-[15px] leading-relaxed">
            {{ siteDescription }}
          </p>
          <p v-else class="text-fg-dim mt-3 max-w-2xl text-[15px] leading-relaxed">
            一处汇集你常用工具的入口面板。
          </p>
        </div>
        <div class="hidden sm:flex flex-col items-end gap-1 text-right">
          <div class="font-mono text-2xl text-fg tabular-nums tracking-tight">{{ clock }}</div>
          <div class="text-xs text-fg-mute font-mono">{{ today }}</div>
        </div>
      </div>

      <!-- 搜索条 -->
      <div class="mt-7 relative">
        <svg class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"/>
        </svg>
        <input
          ref="searchInput"
          v-model="search"
          type="text"
          :placeholder="searchPlaceholder"
          class="input pl-10 pr-16 text-[15px] py-3"
        />
        <kbd class="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-line text-[10px] text-fg-mute font-mono">
          <span class="text-[11px]">⌘</span>K
        </kbd>
      </div>
    </header>

    <!-- 加载中 -->
    <div v-if="loading" class="py-20 text-center">
      <div class="inline-flex items-center gap-3 text-fg-dim text-sm">
        <span class="inline-block h-2 w-2 rounded-full bg-teal-300 animate-shine"></span>
        <span>正在加载</span>
      </div>
    </div>

    <!-- 空态 -->
    <div v-else-if="!sections.length && !orphanCards.length" class="surface p-12 text-center">
      <div class="sigil-xl mx-auto mb-5 opacity-50"></div>
      <p class="h-sub mb-2">面板暂无内容</p>
      <p class="text-sm text-fg-dim">
        管理员可在
        <a href="#/admin" class="text-teal-300 hover:underline">后台</a>
        创建分组与卡片
      </p>
    </div>

    <!-- 搜索结果 -->
    <div v-else-if="search.trim()" class="space-y-6 animate-fade-up">
      <div class="flex items-baseline justify-between">
        <h2 class="h-section">搜索结果</h2>
        <span class="text-sm text-fg-mute font-mono">{{ filteredCards.length }} 项</span>
      </div>
      <div v-if="filteredCards.length" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
        <CardTile v-for="c in filteredCards" :key="c.id" :card="c" />
      </div>
      <div v-else class="surface p-10 text-center text-fg-dim text-sm">
        没有匹配 "<span class="text-fg">{{ search }}</span>" 的工具
      </div>
    </div>

    <!-- 板块列表 -->
    <div v-else class="space-y-12">
      <section v-for="(sec, idx) in sections" :key="sec.id" class="animate-fade-up" :style="{ animationDelay: `${idx * 50}ms` }">
        <header class="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <div class="min-w-0 flex-1">
            <h2 class="h-section">{{ sec.name }}</h2>
            <p v-if="sec.description" class="text-sm text-fg-dim mt-1">
              {{ sec.description }}
            </p>
          </div>
          <span class="text-xs text-fg-mute font-mono">{{ cardsBySection(sec.id).length }} 项</span>
        </header>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
          <CardTile v-for="c in cardsBySection(sec.id)" :key="c.id" :card="c" />
        </div>
      </section>

      <section v-if="orphanCards.length" class="animate-fade-up" :style="{ animationDelay: `${sections.length * 50}ms` }">
        <header class="mb-5 flex items-end justify-between gap-4">
          <h2 class="h-section">其他</h2>
          <span class="text-xs text-fg-mute font-mono">{{ orphanCards.length }} 项</span>
        </header>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
          <CardTile v-for="c in orphanCards" :key="c.id" :card="c" />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { api } from "../api.js";
import CardTile from "../components/CardTile.vue";
import { currentUser } from "../session.js";

const sections = ref([]);
const cards = ref([]);
const siteName = ref("Hub");
const siteDescription = ref("");
const loading = ref(true);
const search = ref("");
const searchInput = ref(null);

const userName = computed(() => currentUser.value?.name || "");

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6)  return "凌晨好";
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  if (h < 23) return "晚上好";
  return "夜深了";
});

// 时钟 (每分钟更新一次, 不用每秒, 省 CPU)
const now = ref(new Date());
let clockTimer = null;
const clock = computed(() => {
  const d = now.value;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
});
const today = computed(() => {
  const d = now.value;
  const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} · 周${week}`;
});

function cardsBySection(id) {
  return cards.value.filter((c) => c.sectionId === id).sort((a, b) => a.order - b.order);
}
const orphanCards = computed(() =>
  cards.value.filter((c) => !c.sectionId).sort((a, b) => a.order - b.order),
);

const filteredCards = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return [];
  return cards.value.filter((c) => {
    return (
      c.title?.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q) ||
      c.url?.toLowerCase().includes(q)
    );
  }).sort((a, b) => a.order - b.order);
});

const searchPlaceholder = computed(() =>
  cards.value.length > 0
    ? `搜索 ${cards.value.length} 个工具…`
    : "搜索工具…"
);

// ⌘K / Ctrl+K 快捷键
function onKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    searchInput.value?.focus();
  } else if (e.key === "Escape" && search.value) {
    search.value = "";
    searchInput.value?.blur();
  }
}

onMounted(async () => {
  document.addEventListener("keydown", onKey);
  clockTimer = setInterval(() => { now.value = new Date(); }, 60_000);
  try {
    const data = await api.get("/homepage");
    sections.value = (data.sections || []).sort((a, b) => a.order - b.order);
    cards.value = data.cards || [];
    siteName.value = data.siteName || "Hub";
    siteDescription.value = data.siteDescription || "";
    document.title = siteName.value + " · 工具面板";
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  document.removeEventListener("keydown", onKey);
  if (clockTimer) clearInterval(clockTimer);
});
</script>
