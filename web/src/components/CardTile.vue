<template>
  <a
    v-if="!card.locked"
    :href="card.url"
    target="_blank"
    rel="noopener noreferrer"
    class="card group block p-4 transition-all hover:border-ink-300 hover:shadow-md"
  >
    <div class="flex items-start gap-3">
      <img
        v-if="iconUrl"
        :src="iconUrl"
        alt=""
        class="h-8 w-8 flex-shrink-0 rounded"
        @error="onIconError"
      />
      <div v-else class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-ink-100 text-xs text-ink-500">
        {{ card.title.slice(0, 1) }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h3 class="truncate font-medium text-ink-900 group-hover:text-ink-700">{{ card.title }}</h3>
          <PermissionBadge :perm="card.permission" />
        </div>
        <p v-if="card.description" class="mt-1 line-clamp-2 text-sm text-ink-500">
          {{ card.description }}
        </p>
      </div>
    </div>
  </a>

  <div
    v-else
    class="card relative cursor-not-allowed p-4 opacity-75"
    :title="card.lockReason"
  >
    <div class="flex items-start gap-3">
      <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-ink-100 text-ink-400">
        🔒
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h3 class="truncate font-medium text-ink-500">{{ card.title }}</h3>
          <PermissionBadge :perm="card.permission" />
        </div>
        <p class="mt-1 text-xs text-ink-400">{{ card.lockReason }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import PermissionBadge from "./PermissionBadge.vue";

const props = defineProps({ card: Object });

const iconError = ref(false);

// Derive favicon URL from the card URL's origin. The backend's public
// favicon endpoint requires the origin be referenced by a card — which
// it always will be here, since we're rendering that exact card.
const iconUrl = computed(() => {
  if (!props.card.url || iconError.value) return null;
  try {
    const u = new URL(props.card.url);
    return `/api/favicons/image?origin=${encodeURIComponent(u.origin)}`;
  } catch {
    return null;
  }
});

function onIconError() {
  iconError.value = true;
}
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
