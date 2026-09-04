import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Gate } from "./screens/Gate";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Gate>
      <App />
    </Gate>
  </React.StrictMode>
);
