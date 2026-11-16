import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    __clearBootSplashTimer?: () => void;
  }
}

// In dev preview (ais-dev), clean up any previously registered dev-sw.js so stale precaches never stall Vite reloads.
// In production builds (deployed Cloud Run / dist), register the full offline PWA service worker.
if (import.meta.env.DEV) {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      let unregistered = false;
      for (const reg of regs) {
        const scriptUrl = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
        if (scriptUrl.includes('dev-sw.js')) {
          reg.unregister();
          unregistered = true;
        }
      }
      if (unregistered && typeof caches !== 'undefined') {
        caches.keys().then((keys) => {
          keys.forEach((k) => {
            if (k.includes('workbox')) caches.delete(k);
          });
        });
      }
    }).catch(() => {});
  }
} else {
  registerSW({ immediate: true });
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error?.message || 'Error inesperado al iniciar la aplicación.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-4 shadow-2xl">
            <img src="/pwa-192x192.png" alt="Logo" className="w-16 h-16 mx-auto rounded-2xl shadow-lg" />
            <h1 className="text-lg font-bold text-white">No se pudo iniciar la aplicación</h1>
            <p className="text-xs text-slate-400 break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white text-xs font-bold rounded-xl shadow-md"
            >
              Recargar Aplicación
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);

if (typeof window !== 'undefined') {
  requestAnimationFrame(() => {
    window.__clearBootSplashTimer?.();
  });
}
