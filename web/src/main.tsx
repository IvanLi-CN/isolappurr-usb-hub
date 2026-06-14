import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initThemeFromStorage } from "./app/theme";
import "./index.css";
import { registerPwaUpdatePrompt } from "./pwa/register";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing root element");
}

initThemeFromStorage();
registerPwaUpdatePrompt();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
