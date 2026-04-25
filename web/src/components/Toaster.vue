<template>
  <div class="fixed top-4 right-4 z-50 flex flex-col gap-2.5 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
    <transition-group name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        :class="[
          'flex items-start gap-3 px-4 py-3 pointer-events-auto rounded-xl border',
          'surface-glass shadow-pop',
          ringClass(t.type)
        ]"
      >
        <span :class="['flex-shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full mt-0.5', dotBg(t.type)]">
          <svg class="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
            <path v-if="t.type === 'ok'" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            <path v-else-if="t.type === 'err'" stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            <path v-else stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </span>
        <div class="flex-1 text-sm text-fg leading-snug">{{ t.msg }}</div>
        <button @click="dismissToast(t.id)" class="text-fg-mute hover:text-fg flex-shrink-0">
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

function ringClass(t) {
  if (t === "ok")  return "border-ok/40";
  if (t === "err") return "border-danger/40";
  return "border-teal-300/40";
}
function dotBg(t) {
  if (t === "ok")  return "bg-ok";
  if (t === "err") return "bg-danger";
  return "bg-teal-300";
}
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
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
