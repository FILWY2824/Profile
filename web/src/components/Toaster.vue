<template>
  <div class="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
    <transition-group name="toast" tag="div" class="flex w-full max-w-md flex-col gap-2">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto rounded-md border px-4 py-2 text-sm shadow-md backdrop-blur"
        :class="{
          'border-emerald-200 bg-emerald-50/95 text-emerald-900': t.kind === 'ok',
          'border-red-200 bg-red-50/95 text-red-900': t.kind === 'err',
          'border-ink-200 bg-white/95 text-ink-900': t.kind !== 'ok' && t.kind !== 'err',
        }"
      >
        {{ t.message }}
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { toasts } from "../toast.js";
</script>

<style>
.toast-enter-from { opacity: 0; transform: translateY(-6px); }
.toast-enter-active, .toast-leave-active { transition: all 200ms ease; }
.toast-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
