<template>
  <div class="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
    <transition-group name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        :class="[
          'flex items-start gap-3 px-4 py-3 pointer-events-auto bg-paper-50 border-l-2',
          ringClass(t.type)
        ]"
        style="border-radius: 2px; box-shadow: 0 8px 24px -16px rgba(31, 27, 20, 0.2), 0 0 0 0.5px rgba(31, 27, 20, 0.12);"
      >
        <span :class="['archive-no font-semibold', labelColor(t.type)]">
          {{ labelText(t.type) }}
        </span>
        <div class="flex-1 text-sm text-ink leading-snug">{{ t.msg }}</div>
        <button @click="dismissToast(t.id)" class="text-ash-2 hover:text-ink -mr-1 -mt-0.5 flex-shrink-0">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { toasts, dismissToast } from "../toast.js";

function labelText(t) {
  if (t === "ok") return "OK ·";
  if (t === "err") return "ERR ·";
  return "INFO ·";
}
function labelColor(t) {
  if (t === "ok") return "text-sage";
  if (t === "err") return "text-rust";
  return "text-cinnabar";
}
function ringClass(t) {
  if (t === "ok") return "border-sage";
  if (t === "err") return "border-rust";
  return "border-cinnabar";
}
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
</style>
