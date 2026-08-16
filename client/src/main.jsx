import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles/app.css";

if (localStorage.getItem("hearth.compact") === "1") {
  document.body.classList.add("compact");
}

if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
