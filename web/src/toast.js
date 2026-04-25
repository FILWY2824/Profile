// toast.js — dead-simple toast queue. Components push, Toaster.vue renders.
import { ref } from "vue";

export const toasts = ref([]);
let nextId = 1;

export function toast(message, kind = "info", timeout = 3500) {
  const id = nextId++;
  toasts.value.push({ id, message, kind });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, timeout);
}

export const okToast = (msg) => toast(msg, "ok");
export const errToast = (msg) => toast(msg, "err", 5000);
