import { ref, computed } from "vue";
import { api } from "./api.js";

export const currentUser = ref(null);
export const sessionLoaded = ref(false);

export const isAdmin = computed(
  () => currentUser.value && currentUser.value.role === "admin",
);
export const isMember = computed(
  () =>
    currentUser.value &&
    (currentUser.value.role === "member" || currentUser.value.role === "admin"),
);

export async function loadSession() {
  try {
    const r = await api.get("/auth/me");
    currentUser.value = r.user || null;
  } catch (e) {
    if (e.status === 401) currentUser.value = null;
  } finally {
    sessionLoaded.value = true;
  }
}

export async function logout() {
  try {
    await api.post("/auth/logout");
  } catch {}
  currentUser.value = null;
}
