<template>
  <a
    :href="card.url"
    target="_blank"
    rel="noopener noreferrer"
    class="hub-card group"
    :title="card.title"
  >
    <!-- 顶部强调条:继承父板块 --accent -->
    <span class="hub-card-stripe" aria-hidden="true"></span>

    <!-- 主体:图标 + 文本 -->
    <div class="hub-card-body">
      <div class="hub-card-icon">
        <img
          v-if="!iconFailed"
          :src="iconURL"
          @error="iconFailed = true"
          alt=""
          loading="lazy"
        />
        <span v-else class="hub-card-fallback">{{ initial }}</span>
      </div>

      <div class="hub-card-meta">
        <div class="hub-card-title">{{ card.title }}</div>
        <div v-if="card.description" class="hub-card-sub">{{ card.description }}</div>
        <div class="hub-card-host">{{ originHost }}</div>
      </div>
    </div>

    <!-- 右上指示箭头,悬停浮现 -->
    <svg class="hub-card-arrow" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
         stroke-linejoin="round" aria-hidden="true">
      <path d="M7 17 17 7"/>
      <path d="M8 7h9v9"/>
    </svg>
  </a>
</template>

<script setup>
import { computed, ref } from "vue";
import { originOf } from "../format.js";

const props = defineProps({ card: { type: Object, required: true } });
const iconFailed = ref(false);

const origin = computed(() => originOf(props.card.url));
const originHost = computed(() => {
  try { return new URL(props.card.url).host.replace(/^www\./, ""); }
  catch { return props.card.url; }
});
const iconURL = computed(() =>
  origin.value
    ? `/api/favicons/image?origin=${encodeURIComponent(origin.value)}`
    : "",
);
const initial = computed(() => (props.card.title || "?").charAt(0).toUpperCase());
</script>

<style scoped>
.hub-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background:
    linear-gradient(160deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.55) 100%);
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.80);
  padding: 18px 18px 16px;
  border-radius: 18px;
  text-decoration: none;
  color: var(--fg);
  overflow: hidden;
  isolation: isolate;
  min-height: 96px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.7) inset,
    0 6px 18px -10px rgba(15, 36, 25, 0.10);
  transition:
    transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 0.24s cubic-bezier(0.2, 0.8, 0.2, 1),
    border-color 0.18s,
    background 0.22s;
}

/* 软光晕 — 继承板块 --accent,默认不可见,悬停时柔和透出 */
.hub-card::before {
  content: "";
  position: absolute;
  inset: -40% -40% auto auto;
  width: 70%;
  height: 70%;
  background: var(--accent, #10B981);
  filter: blur(48px);
  opacity: 0;
  transition: opacity 0.32s ease;
  z-index: -1;
  pointer-events: none;
}
.hub-card:hover {
  transform: translateY(-3px);
  background:
    linear-gradient(160deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.78) 100%);
  border-color: rgba(255, 255, 255, 1);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.95) inset,
    0 16px 36px -14px rgba(15, 36, 25, 0.18),
    0 4px 12px -6px color-mix(in srgb, var(--accent, #10B981) 40%, transparent);
}
.hub-card:hover::before { opacity: 0.18; }

/* 顶部强调条 — 由 0 → 100% 横向展开 */
.hub-card-stripe {
  position: absolute;
  top: 0;
  left: 0;
  height: 3px;
  width: 100%;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent, #10B981) 0%, transparent),
    var(--accent, #10B981) 30%,
    color-mix(in srgb, var(--accent, #10B981) 70%, #06B6D4) 70%,
    color-mix(in srgb, var(--accent, #10B981) 0%, transparent)
  );
  transform: scaleX(0.18);
  transform-origin: left center;
  opacity: 0.45;
  transition: transform 0.36s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.22s;
}
.hub-card:hover .hub-card-stripe {
  transform: scaleX(1);
  opacity: 1;
}

.hub-card-body {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  flex: 1;
  min-width: 0;
}

.hub-card-icon {
  width: 46px;
  height: 46px;
  border-radius: 13px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: linear-gradient(155deg, #FFFFFF 0%, #ECFDF5 100%);
  border: 1px solid rgba(15, 36, 25, 0.06);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 6px 14px -6px rgba(15, 36, 25, 0.12);
  transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1),
              box-shadow 0.24s;
}
.hub-card:hover .hub-card-icon {
  transform: scale(1.05) rotate(-1.5deg);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 10px 20px -8px color-mix(in srgb, var(--accent, #10B981) 35%, rgba(15, 36, 25, 0.15));
}
.hub-card-icon img {
  width: 26px;
  height: 26px;
  object-fit: contain;
}
.hub-card-fallback {
  font-family: "Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif;
  font-weight: 700;
  font-size: 19px;
  color: var(--brand-deep);
  letter-spacing: -0.02em;
}

.hub-card-meta {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 1px;
}
.hub-card-title {
  font-weight: 600;
  font-size: 14.5px;
  color: var(--fg);
  letter-spacing: -0.012em;
  line-height: 1.25;
  /* 长标题最多 2 行 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.hub-card-sub {
  font-size: 12px;
  color: var(--fg-mute);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  transition: color 0.18s;
}
.hub-card:hover .hub-card-sub {
  color: var(--fg-dim);
}
.hub-card-host {
  font-size: 10.5px;
  color: var(--fg-faint);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  letter-spacing: 0.01em;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hub-card-arrow {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 14px;
  height: 14px;
  color: var(--fg-mute);
  opacity: 0;
  transform: translate(-3px, 3px);
  transition: opacity 0.22s, transform 0.22s, color 0.18s;
}
.hub-card:hover .hub-card-arrow {
  opacity: 0.85;
  transform: translate(0, 0);
  color: var(--accent, var(--brand));
}
</style>
