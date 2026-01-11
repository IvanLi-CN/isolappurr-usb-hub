import type { Preview } from "@storybook/react-vite";

import "../src/index.css";

const ISOLAPURR_VIEWPORTS = {
  isolapurrMobile: {
    name: "Isolapurr Mobile (390×844)",
    styles: {
      width: "390px",
      height: "844px",
    },
    type: "mobile",
  },
  isolapurrDesktop: {
    name: "Isolapurr Desktop (1440×900)",
    styles: {
      width: "1440px",
      height: "900px",
    },
    type: "desktop",
  },
} as const;

const preview: Preview = {
  parameters: {
    viewport: {
      viewports: ISOLAPURR_VIEWPORTS,
      defaultViewport: "isolapurrDesktop",
    },
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
