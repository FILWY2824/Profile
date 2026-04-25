<template>
  <transition name="modal">
    <div v-if="modelValue" class="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-bg-0/80 backdrop-blur-sm" @click="$emit('update:modelValue', false)"></div>
      <div class="relative surface-glass shadow-pop w-full max-w-lg overflow-hidden">
        <!-- header -->
        <div class="px-6 pt-5 pb-4 flex items-start justify-between gap-4 border-b border-line">
          <h3 class="h-sub flex-1 min-w-0">{{ title }}</h3>
          <button
            @click="$emit('update:modelValue', false)"
            class="text-fg-mute hover:text-fg p-1 -m-1 rounded-md hover:bg-white/5 transition-colors flex-shrink-0"
            aria-label="关闭"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="p-6 max-h-[70vh] overflow-y-auto"><slot /></div>
        <div v-if="$slots.footer" class="px-6 py-4 bg-bg-2/50 border-t border-line flex justify-end gap-2.5">
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
.modal-enter-active > div, .modal-leave-active > div { transition: all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1); }
.modal-enter-from > div:last-child, .modal-leave-to > div:last-child {
  transform: scale(0.96) translateY(8px);
}
</style>
