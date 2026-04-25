<template>
  <transition name="modal">
    <div v-if="modelValue" class="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" @click="$emit('update:modelValue', false)"></div>
      <div class="relative surface w-full max-w-lg overflow-hidden">
        <div class="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 class="font-semibold text-slate-900">{{ title }}</h3>
          <button @click="$emit('update:modelValue', false)" class="text-slate-400 hover:text-slate-700">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="p-5"><slot /></div>
        <div v-if="$slots.footer" class="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
defineProps({ modelValue: Boolean, title: { type: String, default: "" } });
defineEmits(["update:modelValue"]);
</script>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-active > div, .modal-leave-active > div { transition: all 0.2s; }
.modal-enter-from > div:last-child, .modal-leave-to > div:last-child {
  transform: scale(0.96);
}
</style>
