import React, { useState } from 'react';
import { Download, Smartphone, Share2, ExternalLink, Check, Copy, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // If already running as an installed standalone PWA, hide button
  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuideModal(true);
  };

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '/';
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
  const isDevSandbox =
    typeof window !== 'undefined' &&
    (window.location.hostname.startsWith('ais-dev-') || window.location.hostname.startsWith('ais-pre-'));

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      // ignore clipboard restrictions
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title="Instalar o descargar la aplicación en tu celular o PC"
        className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/25 transition shrink-0"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{isInstallable ? 'Instalar App' : 'Descargar App'}</span>
        <span className="sm:hidden">App</span>
      </button>

      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center text-white shadow-lg">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Instalar Germán Videos Musicales</h3>
                  <p className="text-xs text-slate-400">App independiente (sin depender de AI Studio)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isDevSandbox && (
              <div className="p-3.5 bg-amber-950/50 border border-amber-500/40 rounded-2xl space-y-1.5 text-xs text-amber-200 leading-relaxed">
                <p className="font-bold text-amber-300">
                  Este enlace es la vista previa de AI Studio (por eso muestra su pantalla de carga):
                </p>
                <p>
                  Los enlaces temporales (<code className="text-amber-100">ais-dev</code> / <code className="text-amber-100">ais-pre</code>) dependen del entorno de AI Studio y se apagan al cerrarlo.
                </p>
                <p>
                  Para que abra <strong>100% independiente sin AI Studio</strong>: abre el editor en AI Studio, pulsa <strong>Deploy → Deploy to Cloud Run</strong> (icono de cohete arriba a la derecha; si la barra del navegador móvil lo tapa, gira el celular en horizontal o activa <em>Sitio para computadora</em> en tu navegador), abre esa nueva URL publicada e instala la app desde allí.
                </p>
              </div>
            )}

            {isIOS ? (
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-2 text-xs text-slate-300 leading-relaxed">
                <p className="font-bold text-purple-300 flex items-center gap-1.5">
                  <Share2 className="w-4 h-4" />
                  Pasos para iPhone / iPad (Safari):
                </p>
                <p>1. Abre la URL publicada (Cloud Run) en Safari.</p>
                <p>2. Toca <strong>Compartir → Añadir a pantalla de inicio</strong>.</p>
              </div>
            ) : (
              <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                {isInIframe && !isDevSandbox && (
                  <div className="p-3.5 bg-emerald-950/40 border border-emerald-700/50 rounded-2xl space-y-2">
                    <p className="font-bold text-emerald-300">
                      Abre la app en pestaña completa para instalarla con 1 clic:
                    </p>
                    <a
                      href={currentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Abrir App Independiente</span>
                    </a>
                  </div>
                )}

                <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl space-y-1.5">
                  <p>
                    <strong className="text-white">Android (Chrome):</strong> Abre tu URL publicada (Cloud Run) y toca <strong>Instalar App</strong> o menú <strong>⋮ → Instalar aplicación</strong>.
                  </p>
                  <p>
                    <strong className="text-white">PC (Chrome / Edge):</strong> Haz clic en el icono de <strong>Instalar</strong> en la barra de direcciones cuando estés en la URL publicada.
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleCopyLink}
                className="flex-1 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedUrl ? 'Enlace copiado' : 'Copiar enlace de la App'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
