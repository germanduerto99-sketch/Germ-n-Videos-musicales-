import React, { useState, useEffect, useRef } from 'react';
import { 
  downloadDriveFileBlob, 
  fetchDriveFileMetadata,
  extractDriveFileId,
  fetchDriveMediaFiles,
  DriveFileItem
} from '../services/googleDrive';
import { 
  initAuth, 
  googleSignIn, 
  logoutGoogle, 
  getAccessToken,
  isDriveConnected,
  auth
} from '../services/firebase';
import { User } from 'firebase/auth';
import { 
  Search, 
  Music, 
  Download, 
  Loader2, 
  X, 
  CheckCircle, 
  AlertCircle,
  Infinity as InfinityIcon,
  Link as LinkIcon,
  Sparkles,
  ExternalLink,
  ClipboardPaste,
  ShieldCheck,
  Cloud,
  FolderOpen,
  Info
} from 'lucide-react';

interface GoogleDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectMedia: (blob: Blob, fileName: string, isAudio: boolean) => void;
}

export const GoogleDriveModal: React.FC<GoogleDriveModalProps> = ({
  isOpen,
  onClose,
  onSelectMedia,
}) => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [token, setToken] = useState<string | null>(null);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [driveFilterType, setDriveFilterType] = useState<'all' | 'audio' | 'image' | 'video'>('all');
  const [searchResults, setSearchResults] = useState<DriveFileItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Direct Link / ID search
  const [directLinkInput, setDirectLinkInput] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Initialize Auth and verify fixed persistent connection
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, accessToken) => {
        setUser(currentUser);
        setToken(accessToken);
      },
      () => {
        if (isDriveConnected()) {
          setUser(auth.currentUser);
        }
      }
    );
    return () => unsubscribe();
  }, []);

  // When modal opens, load cached token
  useEffect(() => {
    if (isOpen) {
      getAccessToken().then((activeToken) => {
        if (activeToken) {
          setToken(activeToken);
        }
      });
      setErrorMessage(null);
      setStatusMessage(null);
      setHasSearched(false);
      setSearchResults([]);
    }
  }, [isOpen]);

  // Search songs in Google Drive
  const handleSearchDriveSongs = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setErrorMessage(null);
    setHasSearched(true);

    try {
      let activeToken = token || (await getAccessToken());
      if (!activeToken) {
        // Try sign in once if not connected
        const result = await googleSignIn();
        if (result) {
          activeToken = result.accessToken;
          setToken(result.accessToken);
          setUser(result.user);
        }
      }

      if (activeToken) {
        const results = await fetchDriveMediaFiles(activeToken, driveFilterType, searchQuery.trim());
        setSearchResults(results);
      } else {
        setErrorMessage('Para buscar en tu Google Drive por nombre, conecta tu cuenta o usa la opción de pegar enlace directo.');
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Error al buscar en Google Drive. Puedes usar la descarga directa por enlace.');
    } finally {
      setIsSearching(false);
    }
  };

  // Download a file directly and send to Studio to convert into video
  const handleDownloadAndConvertToVideo = async (fileId: string, customName?: string) => {
    const cleanId = extractDriveFileId(fileId);
    if (!cleanId) {
      setErrorMessage('ID o enlace no válido.');
      return;
    }

    setIsDownloading(true);
    setDownloadingFileId(cleanId);
    setErrorMessage(null);
    setStatusMessage('Descargando canción de Google Drive al estudio...');
    setDownloadProgress(20);

    try {
      const activeToken = token || (await getAccessToken());

      let fileName = customName || '';
      if (!fileName && activeToken) {
        try {
          const meta = await fetchDriveFileMetadata(cleanId, activeToken);
          if (meta && meta.name) {
            fileName = meta.name;
          }
        } catch {
          // Fallback
        }
      }

      const blob = await downloadDriveFileBlob(cleanId, activeToken, (percent) => {
        setDownloadProgress(percent);
      });

      if (!fileName) {
        if (blob.type.startsWith('image/')) {
          const imgExt = blob.type.includes('png') ? '.png' : blob.type.includes('webp') ? '.webp' : '.jpg';
          fileName = `foto_google_drive${imgExt}`;
        } else if (blob.type.startsWith('video/')) {
          fileName = 'video_google_drive.mp4';
        } else {
          fileName = 'cancion_google_drive.mp3';
        }
      }

      const lower = fileName.toLowerCase();
      const isImage = blob.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp|heic)$/i.test(lower);
      const isVideo = blob.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(lower);
      const isAudio = !isImage && !isVideo && (
        blob.type.startsWith('audio/') ||
        /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(lower)
      );

      const mediaKindLabel = isImage ? 'Foto' : isVideo ? 'Video' : 'Canción';
      setStatusMessage(`¡${mediaKindLabel} "${fileName}" descargada con éxito! Incorporando al estudio...`);
      setDownloadProgress(100);

      setTimeout(() => {
        onSelectMedia(blob, fileName, isAudio);
        onClose();
      }, 500);

    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'No se pudo descargar el archivo. Verifica que exista o tenga enlace de acceso.');
    } finally {
      setIsDownloading(false);
      setDownloadingFileId(null);
    }
  };

  // Handle local file selection from device / Google Drive mount
  const handleLocalDeviceFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusMessage(`Cargando "${file.name}" al estudio...`);
    const lower = file.name.toLowerCase();
    const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp|heic)$/i.test(lower);
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(lower);
    const isAudio = !isImage && !isVideo && (
      file.type.startsWith('audio/') ||
      /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(lower)
    );

    setTimeout(() => {
      onSelectMedia(file, file.name, isAudio);
      onClose();
    }, 400);
  };

  // Paste from clipboard helper
  const handlePasteClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setDirectLinkInput(text.trim());
          setStatusMessage('Enlace pegado desde el portapapeles');
        }
      }
    } catch {
      // Ignore
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-500 via-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-black text-lg sm:text-xl text-white">
                  Descargar Música, Fotos o Videos
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1 shadow-sm">
                  <InfinityIcon className="w-3.5 h-3.5" />
                  Fotos, Videos y Audio
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Descarga canciones, fotos o videos de fondo desde Google Drive directo al estudio
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-indigo-950/40 px-5 py-2.5 border-b border-indigo-900/50 flex items-center gap-2.5 text-xs text-indigo-200">
          <Info className="w-4 h-4 text-sky-400 shrink-0" />
          <span>
            <strong>¿Cómo funciona?</strong> Descarga canciones, fotos o videos directamente al estudio para combinarlos con letras sincronizadas a la voz:
          </span>
        </div>

        {/* Notifications */}
        {statusMessage && (
          <div className="mx-5 mt-4 p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-2xl text-xs text-emerald-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>{statusMessage}</span>
            </div>
            <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-white">✕</button>
          </div>
        )}

        {errorMessage && (
          <div className="mx-5 mt-4 p-3 bg-rose-950/40 border border-rose-800/60 rounded-2xl text-xs text-rose-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="text-slate-400 hover:text-white">✕</button>
          </div>
        )}

        {/* Main Content Area */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          
          {/* OPTION 1: Direct Search in Google Drive without leaving the app */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3 shadow-inner">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Search className="w-4 h-4 text-purple-400" />
                <span>Opción 1: Buscar Canciones, Fotos o Videos en Google Drive</span>
              </label>
              <div className="flex items-center gap-1">
                {([
                  { id: 'all', label: 'Todo' },
                  { id: 'audio', label: 'Canciones' },
                  { id: 'image', label: 'Fotos' },
                  { id: 'video', label: 'Videos' },
                ] as const).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setDriveFilterType(f.id)}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition ${
                      driveFilterType === f.id
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleSearchDriveSongs} className="flex gap-2">
              <input
                type="text"
                placeholder="Nombre de tu canción, foto o video en Google Drive..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shrink-0 disabled:opacity-50"
              >
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>Buscar</span>
              </button>
            </form>

            {/* Results of Search if any */}
            {hasSearched && (
              <div className="pt-2 space-y-2">
                {isSearching ? (
                  <div className="py-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                    <span>Buscando canciones en tu Google Drive...</span>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 text-center text-xs text-slate-400">
                    No encontramos archivos con ese nombre. Prueba con la Opción 2 o 3 de abajo.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {searchResults.map((file) => (
                      <div
                        key={file.id}
                        className="p-3 bg-slate-900 border border-slate-800 hover:border-purple-500/60 rounded-xl flex items-center justify-between gap-3 transition"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Music className="w-4 h-4 text-purple-400 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-200 truncate">{file.name}</p>
                            <p className="text-[10px] text-slate-500">Google Drive • Listo para convertir</p>
                          </div>
                        </div>

                        <button
                          onClick={() => handleDownloadAndConvertToVideo(file.id, file.name)}
                          disabled={isDownloading}
                          className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shrink-0 shadow transition disabled:opacity-50"
                        >
                          {downloadingFileId === file.id ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>{downloadProgress}%</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-3.5 h-3.5" />
                              <span>Descargar y Convertir en Video</span>
                            </>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* OPTION 2: Paste Direct Link or File ID */}
          <div className="p-4 rounded-2xl bg-indigo-950/30 border border-indigo-800/40 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-indigo-400" />
                <span>Opción 2: Pegar Enlace de Google Drive y Convertir</span>
              </label>
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="text-purple-400 hover:text-purple-300 text-[11px] font-semibold flex items-center gap-1 transition"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                <span>Pegar enlace copiado</span>
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (directLinkInput.trim()) {
                  handleDownloadAndConvertToVideo(directLinkInput.trim());
                }
              }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                placeholder="https://drive.google.com/file/d/..."
                value={directLinkInput}
                onChange={(e) => setDirectLinkInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />

              <button
                type="submit"
                disabled={isDownloading || !directLinkInput.trim()}
                className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow flex items-center justify-center gap-1.5 transition disabled:opacity-50 shrink-0"
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Descargando {downloadProgress}%</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Descargar y Convertir en Video</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* OPTION 3: Select from Device / Google Drive app */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-inner">
            <div className="space-y-1 text-center sm:text-left">
              <h4 className="text-xs font-bold text-slate-200 flex items-center justify-center sm:justify-start gap-2">
                <FolderOpen className="w-4 h-4 text-emerald-400" />
                <span>Opción 3: Seleccionar Archivo desde tu Google Drive / Dispositivo</span>
              </h4>
              <p className="text-[11px] text-slate-400">
                Abre el selector de archivos de tu teléfono o PC y elige tu canción de Google Drive
              </p>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl border border-slate-700 flex items-center gap-2 transition shrink-0"
            >
              <FolderOpen className="w-4 h-4 text-emerald-400" />
              <span>Elegir Archivo</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*,image/*"
              onChange={handleLocalDeviceFileSelect}
              className="hidden"
            />
          </div>

          {/* Download Progress Bar */}
          {isDownloading && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-emerald-400 font-semibold">
                <span>Descargando canción al estudio...</span>
                <span>{downloadProgress}%</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Al descargar, la canción se convierte en video con letras en el estudio</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition"
          >
            Cerrar
          </button>
        </div>

      </div>
    </div>
  );
};
