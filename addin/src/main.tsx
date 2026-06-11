/// <reference path="../node_modules/@microsoft/office-js/dist/office.d.ts" />
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./shell/App";

function render() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// In Office runtime, wait for Office.js to initialise before rendering
if (typeof Office !== "undefined") {
  Office.onReady(() => render());
} else {
  // Dev browser (no Office.js) — render immediately
  render();
}
