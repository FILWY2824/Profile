import { createApp } from "vue";
import App from "./App.vue";
import { startRouter } from "./router.js";
import "./style.css";

startRouter();
createApp(App).mount("#app");
