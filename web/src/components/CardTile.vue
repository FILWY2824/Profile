<template>
  <a
    :href="card.url"
    target="_blank"
    rel="noopener noreferrer"
    class="surface-hover group block p-4"
  >
    <div class="flex items-start gap-3">
      <div class="h-10 w-10 rounded-lg bg-slate-100 ring-1 ring-slate-200/70 overflow-hidden flex-shrink-0 flex items-center justify-center">
        <img
          v-if="!iconFailed"
          :src="iconURL"
          @error="iconFailed = true"
          class="h-6 w-6"
          alt=""
        />
        <span v-else class="text-slate-400 font-medium text-sm">{{ initial }}</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-2">
          <h3 class="font-semibold text-slate-900 truncate group-hover:text-accent-700 transition-colors">
            {{ card.title }}
          </h3>
        </div>
        <p v-if="card.description" class="text-xs text-slate-500 mt-0.5 line-clamp-2">{{ card.description }}</p>
        <div class="text-[11px] text-slate-400 mt-1.5 truncate font-mono">{{ originHost }}</div>
      </div>
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
