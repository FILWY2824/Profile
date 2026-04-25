<template>
  <div class="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
    <transition-group name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="surface px-4 py-3 flex items-start gap-3 pointer-events-auto"
        :class="ringClass(t.type)"
      >
        <div :class="dotClass(t.type)" class="mt-1 h-2 w-2 rounded-full flex-shrink-0"></div>
        <div class="flex-1 text-sm text-slate-700">{{ t.msg }}</div>
        <button @click="dismissToast(t.id)" class="text-slate-400 hover:text-slate-700 -mr-1 -mt-0.5">
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

function dotClass(t) {
  if (t === "ok") return "bg-emerald-500";
  if (t === "err") return "bg-red-500";
  return "bg-accent-500";
}
function ringClass(t) {
  if (t === "ok") return "ring-emerald-200/70";
  if (t === "err") return "ring-red-200/70";
  return "";
}
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-12px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
