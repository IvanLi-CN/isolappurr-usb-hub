import type { Preview } from "@storybook/react-vite";

import "../src/index.css";

const ISOLAPURR_VIEWPORTS = {
  isolapurrNarrow: {
    name: "Isolapurr Narrow (360×640)",
    styles: {
      width: "360px",
      height: "640px",
    },
    type: "mobile",
  },
  isolapurrMobile: {
    name: "Isolapurr Mobile (390×844)",
    styles: {
      width: "390px",
      height: "844px",
    },
    type: "mobile",
  },
  isolapurrTablet: {
    name: "Isolapurr Tablet (768×800)",
    styles: {
      width: "768px",
      height: "800px",
    },
    type: "tablet",
  },
  isolapurrCompactDesktop: {
    name: "Isolapurr Compact Desktop (1024×700)",
    styles: {
      width: "1024px",
      height: "700px",
    },
    type: "desktop",
  },
  isolapurrLaptop: {
    name: "Isolapurr Laptop (1280×800)",
    styles: {
      width: "1280px",
      height: "800px",
    },
    type: "desktop",
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
