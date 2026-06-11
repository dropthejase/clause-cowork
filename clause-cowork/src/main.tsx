import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { api as addinApi } from "@word-graph/shared";

// The addin uses https://localhost:8766 (Office requires HTTPS), webapp uses plain http on 8765
addinApi.defaults.baseURL = "http://localhost:8765";

// StrictMode disabled: SuperDoc embeds a Vue app internally and StrictMode's
// double-invoke of effects causes "Cannot unmount an app that is not mounted" errors.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
