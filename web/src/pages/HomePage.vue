<template>
  <div>
    <!-- Hero 区域 -->
    <header class="hero-block">
      <div class="greet-pill">
        <span class="greet-pulse"></span>
        <span>{{ greeting }}<template v-if="userName">,<b> {{ userName }}</b></template> · {{ today }}</span>
      </div>

      <h1 class="hero-title">
        <template v-if="isDefaultName">
          <span class="hero-slogan">挑一个工具,<em>开始今天的事</em>。</span>
        </template>
        <template v-else>
          {{ siteName }}<em class="dot">.</em>
        </template>
      </h1>

      <p v-if="siteDescription" class="hero-lede">{{ siteDescription }}</p>
      <p v-else-if="cards.length === 0" class="hero-lede">一处汇集你常用工具的入口面板。</p>
    </header>

    <!-- 加载中 -->
    <div v-if="loading" class="py-20 text-center">
      <div class="inline-flex items-center gap-3 text-fg-dim text-sm">
        <span class="inline-block h-2 w-2 rounded-full bg-teal-500 animate-shine"></span>
        <span>正在加载</span>
      </div>
    </div>

    <!-- 空态 -->
    <div v-else-if="!sections.length && !orphanCards.length" class="surface p-12 text-center">
      <div class="sigil-xl mx-auto mb-5"></div>
      <p class="h-sub mb-2">面板暂无内容</p>
      <p class="text-sm text-fg-dim">
        管理员可在
        <a href="#/admin" class="text-teal-300 hover:underline">后台</a>
        创建分组与卡片
      </p>
    </div>

    <!-- 搜索结果 -->
    <div v-else-if="search.trim()" class="space-y-6 animate-fade-up">
      <div class="flex items-baseline justify-between mb-3">
        <h2 class="h-section">搜索结果<span class="ic">✦</span></h2>
        <span class="text-sm text-fg-mute font-mono">{{ filteredCards.length }} 项</span>
      </div>
      <div v-if="filteredCards.length" class="cards-grid">
        <CardTile v-for="c in filteredCards" :key="c.id" :card="c" />
      </div>
      <div v-else class="surface p-10 text-center text-fg-dim text-sm">
        没有匹配 "<span class="text-fg">{{ search }}</span>" 的工具
      </div>
    </div>

    <!-- 板块 — 每个板块整行 -->
    <div v-else class="section-stack">
      <section
        v-for="(sec, idx) in sections"
        :key="sec.id"
        class="bento-group animate-fade-up"
        :style="{ '--accent': accentFor(idx), animationDelay: `${idx * 50}ms` }"
      >
        <header class="sec-head">
          <div class="min-w-0 flex-1">
            <h2 class="h-section">
              {{ sec.name }}<span class="ic">{{ iconFor(idx) }}</span>
            </h2>
            <p v-if="sec.description" class="sec-sub">{{ sec.description }}</p>
          </div>
          <span class="sec-meta">
            {{ secEyebrow(idx) }} <b>{{ cardsBySection(sec.id).length }}</b>
          </span>
        </header>
        <div class="cards-grid">
          <CardTile v-for="c in cardsBySection(sec.id)" :key="c.id" :card="c" />
        </div>
      </section>

      <section
        v-if="orphanCards.length"
        class="bento-group animate-fade-up"
        :style="{ '--accent': accentFor(sections.length), animationDelay: `${sections.length * 50}ms` }"
      >
        <header class="sec-head">
          <h2 class="h-section">
            其他<span class="ic">❀</span>
          </h2>
          <span class="sec-meta">未分组 <b>{{ orphanCards.length }}</b></span>
        </header>
        <div class="cards-grid">
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
import { globalSearch } from "../searchStore.js";

const sections = ref([]);
const cards = ref([]);
const siteName = ref("Qi Shu");
const siteDescription = ref("");
const loading = ref(true);
const search = globalSearch; // 顶部 NavBar 提供输入框

const userName = computed(() => currentUser.value?.name || "");

const isDefaultName = computed(
  () => siteName.value === "Qi Shu" || siteName.value === "栖枢" || siteName.value === "Hub",
);

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6)  return "凌晨好";
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  if (h < 23) return "晚上好";
  return "夜深了";
});

const now = ref(new Date());
let clockTimer = null;
const today = computed(() => {
  const d = now.value;
  const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `今天是周${week},做点有趣的事吧`;
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
      c.description?.toLowerCase().includes(q)
    );
  }).sort((a, b) => a.order - b.order);
});

// 板块强调色 — 4 色循环
const ACCENTS = ["#10B981", "#06B6D4", "#F59E0B", "#0891B2"];
function accentFor(idx) { return ACCENTS[idx % ACCENTS.length]; }
const ICONS = ["✦", "⌬", "✿", "❀", "✺", "❖"];
function iconFor(idx) { return ICONS[idx % ICONS.length]; }
const EYEBROWS = ["每天打开", "代码 ·", "研究 ·", "娱乐 · 灵感", "·", "·"];
function secEyebrow(idx) { return EYEBROWS[idx % EYEBROWS.length]; }

onMounted(async () => {
  clockTimer = setInterval(() => { now.value = new Date(); }, 60_000);
  try {
    const data = await api.get("/homepage");
    sections.value = (data.sections || []).sort((a, b) => a.order - b.order);
    cards.value = data.cards || [];
    siteName.value = data.siteName || "Qi Shu";
    siteDescription.value = data.siteDescription || "";
    document.title = siteName.value;
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
});
</script>

<style scoped>
/* ── Hero ───────────────────────────────────────────────── */
.hero-block {
  padding: 40px 0 28px;
  text-align: center;
  max-width: 760px;
  margin: 0 auto;
}

.greet-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.85);
  padding: 6px 14px 6px 8px;
  border-radius: 999px;
  font-size: 12.5px;
  color: var(--fg-dim);
  margin-bottom: 20px;
  box-shadow: 0 4px 14px -4px rgba(15, 36, 25, 0.08);
}
.greet-pill b {
  color: var(--fg);
  font-weight: 600;
  margin: 0 2px;
}
.greet-pulse {
  width: 16px;
  height: 16px;
  background: linear-gradient(135deg, #34D399, #10B981 60%, #047857);
  border-radius: 50%;
  position: relative;
  flex-shrink: 0;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
  animation: pulse 2s infinite;
}
.greet-pulse::before {
  content: "";
  position: absolute;
  inset: 4px;
  background: white;
  border-radius: 50%;
}
@keyframes pulse {
  0%   { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45); }
  70%  { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

.hero-title {
  font-family: "Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif;
  font-variation-settings: "opsz" 96;
  font-weight: 700;
  /* 缩小、收紧字距,确保 "挑一个工具,开始今天的事。" 一行内显示 */
  font-size: clamp(28px, 4.4vw, 48px);
  line-height: 1.1;
  letter-spacing: -0.03em;
  margin-bottom: 14px;
  color: var(--fg);
}
.hero-title em {
  font-style: italic;
  font-variation-settings: "opsz" 96;
  font-weight: 500;
  background: linear-gradient(120deg, #047857, #10B981 50%, #06B6D4);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-title .dot {
  background: none;
  -webkit-text-fill-color: var(--brand);
  color: var(--brand);
}
.hero-slogan {
  display: inline-block;
  white-space: nowrap;
  max-width: 100%;
}
@media (max-width: 520px) {
  /* 极窄屏允许换行,避免横向溢出 */
  .hero-slogan { white-space: normal; }
}

.hero-lede {
  font-size: 15px;
  color: var(--fg-dim);
  max-width: 540px;
  margin: 0 auto;
  line-height: 1.55;
}
.hero-lede b {
  color: var(--fg);
  font-weight: 600;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.9em;
  background: rgba(255, 255, 255, 0.7);
  padding: 1px 6px;
  border-radius: 6px;
  border: 1px solid rgba(15, 36, 25, 0.06);
}

/* ── 板块纵向堆叠 — 每个板块占整整一行 ──────────────────── */
.section-stack {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 36px;
}

.bento-group {
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.80);
  border-radius: 24px;
  padding: 24px 24px 22px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.85) inset,
    0 12px 36px -16px rgba(15, 36, 25, 0.12);
  position: relative;
  overflow: hidden;
}
.bento-group::before {
  content: "";
  position: absolute;
  top: -60px;
  right: -60px;
  width: 220px;
  height: 220px;
  background: var(--accent, var(--brand));
  border-radius: 50%;
  opacity: 0.16;
  filter: blur(60px);
  z-index: 0;
  pointer-events: none;
}
.bento-group > * {
  position: relative;
  z-index: 1;
}

.sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 18px;
  gap: 10px;
}
.sec-head h2 {
  font-family: "Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif;
  font-variation-settings: "opsz" 48;
  font-weight: 700;
  font-size: 24px;
  letter-spacing: -0.025em;
  line-height: 1;
  color: var(--fg);
}
.sec-head .ic {
  font-style: italic;
  font-weight: 500;
  margin-left: 6px;
  color: var(--accent, var(--brand));
}
.sec-sub {
  font-size: 12.5px;
  color: var(--fg-mute);
  margin-top: 4px;
  line-height: 1.45;
}
.sec-meta {
  font-size: 11.5px;
  color: var(--fg-mute);
  font-weight: 500;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.sec-meta b {
  color: var(--fg);
  background: rgba(255, 255, 255, 0.65);
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  margin-left: 4px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 600;
  border: 1px solid rgba(15, 36, 25, 0.05);
}

/* 一行 3 张卡片 */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 880px) {
  .cards-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 540px) {
  .cards-grid { grid-template-columns: 1fr; }
}
</style>
