<template>
  <transition name="modal">
    <div v-if="modelValue" class="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-ink/55 backdrop-blur-[2px]" @click="$emit('update:modelValue', false)"></div>
      <div class="relative surface-elevated w-full max-w-lg overflow-hidden">
        <!-- 文头档案号 + 标题 -->
        <div class="px-6 pt-5 pb-3 border-b border-rule-soft">
          <div class="flex items-baseline justify-between gap-4 mb-2">
            <span class="archive-no">DIALOG</span>
            <button @click="$emit('update:modelValue', false)" class="text-ash hover:text-ink transition-colors">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <h3 class="h-sub">{{ title }}</h3>
        </div>
        <div class="p-6"><slot /></div>
        <div v-if="$slots.footer" class="px-6 py-4 bg-paper-100/40 border-t border-rule-soft flex justify-end gap-2">
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
.modal-enter-active > div, .modal-leave-active > div { transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
.modal-enter-from > div:last-child, .modal-leave-to > div:last-child {
  transform: scale(0.96) translateY(8px);
}
</style>
