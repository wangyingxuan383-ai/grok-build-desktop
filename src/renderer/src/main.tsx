import React from "react";
import ReactDOM from "react-dom/client";
import "katex/dist/katex.min.css";
import App from "./App";
import "./styles.css";
import { applyThemeToDocument, readCachedThemeForEarlyStartup } from "./theme";

const cachedTheme = readCachedThemeForEarlyStartup();
if (cachedTheme) applyThemeToDocument(cachedTheme, window.matchMedia("(prefers-color-scheme: dark)").matches);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
