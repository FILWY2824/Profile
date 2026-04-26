<template>
  <a
    :href="card.url"
    target="_blank"
    rel="noopener noreferrer"
    class="hub-card group"
  >
    <!-- 图标盒 -->
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

    <!-- 文字 -->
    <div class="hub-card-meta">
      <div class="hub-card-title">{{ card.title }}</div>
      <div v-if="card.description" class="hub-card-sub">{{ card.description }}</div>
      <div v-else class="hub-card-host">{{ originHost }}</div>
    </div>
  </a>
</template>

<script setup>
import { computed, ref } from "vue";
import { originOf } from "../format.js";

const props = defineProps({ card: { type: Object, required: true } });
const iconFailed = ref(false);

const origin = computed(() => originOf(props.card.url));
const originHost = computed(() => {
  try { return new URL(props.card.url).host.replace(/^www\./, ""); } catch { return props.card.url; }
});
const iconURL = computed(() =>
  origin.value
    ? `/api/favicons/image?origin=${encodeURIComponent(origin.value)}`
    : ""
);
const initial = computed(() => (props.card.title || "?").charAt(0).toUpperCase());
</script>

<style scoped>
.hub-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background-color: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.7);
  padding: 11px 13px;
  border-radius: 14px;
  text-decoration: none;
  color: var(--fg);
  transition: all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  min-height: 60px;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.5) inset;
}
.hub-card:hover {
  background-color: rgba(255, 255, 255, 0.95);
  border-color: rgba(255, 255, 255, 1);
  transform: translateY(-2px);
  color: var(--fg);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 12px 24px -10px rgba(15, 36, 25, 0.18);
}

.hub-card-icon {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: linear-gradient(160deg, #FFFFFF, #ECFDF5);
  border: 1px solid rgba(15, 36, 25, 0.06);
  transition: transform 0.22s ease;
  box-shadow: 0 4px 10px -4px rgba(15, 36, 25, 0.08);
}
.hub-card:hover .hub-card-icon {
  transform: scale(1.06);
}
.hub-card-icon img {
  width: 22px;
  height: 22px;
  object-fit: contain;
}
.hub-card-fallback {
  font-family: "Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif;
  font-weight: 700;
  font-size: 16px;
  color: var(--brand-deep);
  letter-spacing: -0.02em;
}

.hub-card-meta {
  min-width: 0;
  flex: 1;
  line-height: 1.2;
}
.hub-card-title {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--fg);
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hub-card-sub {
  font-size: 11px;
  color: var(--fg-mute);
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.18s;
}
.hub-card:hover .hub-card-sub {
  color: var(--fg-dim);
}
.hub-card-host {
  font-size: 11px;
  color: var(--fg-faint);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
