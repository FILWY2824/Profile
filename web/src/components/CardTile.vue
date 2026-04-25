<template>
  <a
    :href="card.url"
    target="_blank"
    rel="noopener noreferrer"
    class="group relative block surface-hover p-5 overflow-hidden"
  >
    <!-- 序号 / 角标 -->
    <div class="flex items-start justify-between gap-3 mb-3">
      <div class="flex items-center gap-3 min-w-0">
        <!-- 图标盒 -->
        <div class="h-10 w-10 flex-shrink-0 border border-rule-soft bg-paper-200 overflow-hidden flex items-center justify-center group-hover:border-ink transition-colors">
          <img
            v-if="!iconFailed"
            :src="iconURL"
            @error="iconFailed = true"
            class="h-6 w-6"
            alt=""
          />
          <span v-else class="font-display text-base text-ink/60">{{ initial }}</span>
        </div>
        <!-- 标题 -->
        <h3 class="h-sub truncate group-hover:text-cinnabar transition-colors">
          {{ card.title }}
        </h3>
      </div>
      <!-- 右上角 ↗ 箭头 -->
      <span class="archive-no opacity-30 group-hover:opacity-100 group-hover:text-cinnabar transition-all flex-shrink-0 mt-0.5">
        ↗
      </span>
    </div>

    <!-- 描述 -->
    <p v-if="card.description" class="text-sm text-ash leading-relaxed line-clamp-2 mb-3">
      {{ card.description }}
    </p>

    <!-- 底部 hairline + URL host -->
    <div class="rule-h opacity-50 mb-2"></div>
    <div class="flex items-center gap-2 font-mono text-2xs text-ash-2 truncate">
      <span class="text-cinnabar">·</span>
      <span class="truncate">{{ originHost }}</span>
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
  try { return new URL(props.card.url).host; } catch { return props.card.url; }
});
const iconURL = computed(() =>
  origin.value
    ? `/api/favicons/image?origin=${encodeURIComponent(origin.value)}`
    : ""
);
const initial = computed(() => (props.card.title || "?").charAt(0).toUpperCase());
</script>
