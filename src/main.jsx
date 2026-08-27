import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Offline shell. Dev is skipped: HMR and a cache-first service worker fight
// each other, and Vite's dev server has no hashed assets to cache anyway.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[DR-808] service worker registration failed:', err);
    });
  });
}
