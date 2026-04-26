<template>
  <transition name="modal">
    <div v-if="open" class="confirm-overlay" @click.self="onCancel">
      <div class="confirm-card" :class="kind">
        <div class="confirm-icon">
          <svg v-if="kind === 'danger'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0-7.036A11.959 11.959 0 0 1 3.598 9.75c-.054.21-.082.426-.082.65 0 5.373 3.587 9.74 8.484 11.6.054.02.108.02.162 0 4.897-1.86 8.484-6.227 8.484-11.6 0-.224-.028-.44-.082-.65A11.959 11.959 0 0 1 12 5.714Z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5h.008v.008H12V16.5Z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="9"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4M12 15.5v.01"/>
          </svg>
        </div>
        <div class="confirm-body">
          <h3 class="confirm-title">{{ title }}</h3>
          <p class="confirm-msg">{{ message }}</p>
          <div v-if="detail" class="confirm-detail">{{ detail }}</div>
        </div>
        <div class="confirm-actions">
          <button @click="onCancel" class="btn btn-secondary btn-sm">{{ cancelText }}</button>
          <button @click="onConfirm" class="btn btn-sm" :class="kind === 'danger' ? 'btn-danger-strong' : 'btn-primary'">
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { confirmState, closeConfirm } from "../confirm.js";
import { computed } from "vue";

const open    = computed(() => confirmState.value.open);
const title   = computed(() => confirmState.value.title);
const message = computed(() => confirmState.value.message);
const detail  = computed(() => confirmState.value.detail);
const kind    = computed(() => confirmState.value.kind || "danger");
const confirmText = computed(() => confirmState.value.confirmText || "确认");
const cancelText  = computed(() => confirmState.value.cancelText  || "取消");

function onConfirm() { closeConfirm(true); }
function onCancel()  { closeConfirm(false); }
</script>

<style scoped>
.confirm-overlay {
  position: fixed; inset: 0;
  z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  padding: 1rem;
  background-color: rgba(15, 36, 25, 0.32);
  backdrop-filter: blur(8px) saturate(140%);
  -webkit-backdrop-filter: blur(8px) saturate(140%);
}

.confirm-card {
  width: 100%;
  max-width: 26rem;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 22px;
  padding: 22px 22px 18px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 28px 60px -20px rgba(15, 36, 25, 0.30);
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 14px 16px;
}

.confirm-icon {
  width: 42px; height: 42px;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.confirm-icon svg { width: 22px; height: 22px; }

.confirm-card.danger .confirm-icon {
  background: linear-gradient(135deg, #FECACA, #FCA5A5);
  color: #B91C1C;
}
.confirm-card.info .confirm-icon {
  background: linear-gradient(135deg, #A7F3D0, #6EE7B7);
  color: var(--brand-deep);
}

.confirm-body {
  min-width: 0;
  align-self: center;
}

.confirm-title {
  font-family: "Bricolage Grotesque", system-ui, sans-serif;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.012em;
  color: var(--fg);
  margin: 0 0 4px;
}
.confirm-msg {
  font-size: 13.5px;
  color: var(--fg-dim);
  line-height: 1.5;
  margin: 0;
}
.confirm-detail {
  margin-top: 10px;
  padding: 8px 10px;
  background-color: rgba(15, 36, 25, 0.04);
  border-left: 2px solid rgba(15, 36, 25, 0.22);
  border-radius: 8px;
  font-size: 12px;
  color: var(--fg-mute);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  line-height: 1.5;
  word-break: break-all;
}

.confirm-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.btn-danger-strong {
  background-color: #DC2626;
  color: white;
  border-color: transparent;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.25) inset,
    0 6px 16px -6px rgba(220, 38, 38, 0.55);
}
.btn-danger-strong:hover:not(:disabled) {
  background-color: #B91C1C;
}

.modal-enter-active, .modal-leave-active {
  transition: opacity 0.18s ease, backdrop-filter 0.18s ease;
}
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-active .confirm-card,
.modal-leave-active .confirm-card {
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.18s;
}
.modal-enter-from .confirm-card,
.modal-leave-to .confirm-card {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}
</style>
