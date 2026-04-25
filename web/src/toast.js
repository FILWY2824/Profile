import { ref } from "vue";

export const toasts = ref([]);
let nextId = 1;

function push(msg, type = "info", timeout = 3500) {
  const id = nextId++;
  toasts.value.push({ id, msg, type });
  if (timeout > 0) {
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, timeout);
  }
  return id;
}

export const okToast = (m) => push(m, "ok");
export const errToast = (m) => push(m || "出错了", "err", 5000);
export const infoToast = (m) => push(m, "info");

export function dismissToast(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
