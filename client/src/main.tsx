import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(r => r.unregister());
  });
  caches.keys().then(names => {
    names.forEach(name => caches.delete(name));
  });
}

createRoot(document.getElementById("root")!).render(<App />);
