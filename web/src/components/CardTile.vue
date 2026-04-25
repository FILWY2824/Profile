<template>
  <a
    :href="card.url"
    target="_blank"
    rel="noopener noreferrer"
    class="app-tile group"
  >
    <!-- 图标盒 (大圆角, app-icon 风格) -->
    <div class="app-tile-icon">
      <img
        v-if="!iconFailed"
        :src="iconURL"
        @error="iconFailed = true"
        alt=""
        loading="lazy"
      />
      <span v-else class="font-display font-bold text-2xl text-teal-300">
        {{ initial }}
      </span>
    </div>

    <!-- 标题 -->
    <h3 class="font-display font-semibold text-[14px] text-fg tracking-tight w-full truncate">
      {{ card.title }}
    </h3>

    <!-- 描述 (一行) -->
    <p
      v-if="card.description"
      class="text-[11.5px] text-fg-mute mt-1 leading-snug w-full line-clamp-1 group-hover:text-fg-dim transition-colors"
    >
      {{ card.description }}
    </p>
    <p v-else class="text-[11px] text-fg-faint mt-1 font-mono truncate w-full">
      {{ originHost }}
    </p>
  </a>
</template>

<script setup>
import { computed, ref } from "vue";
import { originOf } from "../format.js";

const props = defineProps({ card: { type: Object, required: true } });
const iconFailed = ref(false);

const origin = computed(() => originOf(props.card.url));
const originHost = computed(() => {
  try { return new URL(props.card.url).host; } catch { return props.card.url; }
});
const iconURL = computed(() =>
  origin.value
    ? `/api/favicons/image?origin=${encodeURIComponent(origin.value)}`
    : ""
);
const initial = computed(() => (props.card.title || "?").charAt(0).toUpperCase());
</script>
