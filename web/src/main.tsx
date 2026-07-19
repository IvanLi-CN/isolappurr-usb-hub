import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initThemeFromStorage } from "./app/theme";
import "./index.css";
import {
  PwaBootMountSignal,
  reportPwaStartupFailure,
} from "./pwa/boot-shell-client";
import { registerPwaUpdatePrompt } from "./pwa/register";

function bootstrap() {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Missing root element");
  }

  initThemeFromStorage();
  registerPwaUpdatePrompt();

  createRoot(rootElement).render(
    <StrictMode>
      <PwaBootMountSignal />
      <App />
    </StrictMode>,
  );
}

try {
  bootstrap();
} catch (error) {
  reportPwaStartupFailure(error);
  throw error;
}
