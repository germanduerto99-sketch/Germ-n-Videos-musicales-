import React, { useState } from 'react';
import { LibraryVideo, VideoFolder } from '../types';
import { downloadVideoAsMp4 } from '../services/videoConverter';
import { 
  Folder, 
  FolderPlus, 
  FolderMinus, 
  Play, 
  Download, 
  Trash2, 
  Edit3, 
  FolderInput, 
  ArrowDownAZ, 
  ArrowUpAZ, 
  Clock, 
  Calendar, 
  Search, 
  Film, 
  X, 
  Check, 
  MoreVertical,
  Plus,
  Loader2
} from 'lucide-react';

interface VideoLibraryProps {
  videos: LibraryVideo[];
  folders: VideoFolder[];
  activeFolderId: string | 'all';
  onSelectFolder: (folderId: string | 'all') => void;
  onCreateFolder: (name: string, color?: string) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
  onDeleteVideo: (id: string) => Promise<void>;
  onUpdateVideo: (id: string, updates: Partial<LibraryVideo>) => Promise<void>;
  onPlayVideo: (video: LibraryVideo) => void;
  onOpenCreateStudio: () => void;
  onClearAllVideos?: () => Promise<void>;
}

export const VideoLibrary: React.FC<VideoLibraryProps> = ({
  videos,
  folders,
  activeFolderId,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDeleteVideo,
  onUpdateVideo,
  onPlayVideo,
  onOpenCreateStudio,
  onClearAllVideos,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'alpha-asc' | 'alpha-desc' | 'date-desc' | 'date-asc'>('alpha-asc');

  // Modals / Dialog state
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#8B5CF6');
  const [showClearAllModal, setShowClearAllModal] = useState(false);
  const [convertingVideoId, setConvertingVideoId] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  // Edit Video Modal
  const [editingVideo, setEditingVideo] = useState<LibraryVideo | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [editFolderId, setEditFolderId] = useState<string>('root');

  // Delete Video confirmation
  const [videoToDelete, setVideoToDelete] = useState<LibraryVideo | null>(null);

  // Folder to rename/delete
  const [folderToEdit, setFolderToEdit] = useState<VideoFolder | null>(null);
  const [folderRenameInput, setFolderRenameInput] = useState('');
  const [folderToDelete, setFolderToDelete] = useState<VideoFolder | null>(null);

  // Filter videos
  const filteredVideos = videos
    .filter((v) => {
      const matchFolder = activeFolderId === 'all' || (activeFolderId === 'root' ? !v.folderId || v.folderId === 'root' : v.folderId === activeFolderId);
      const matchSearch = v.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          v.artist.toLowerCase().includes(searchQuery.toLowerCase());
      return matchFolder && matchSearch;
    })
    .sort((a, b) => {
      if (sortOrder === 'alpha-asc') {
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      } else if (sortOrder === 'alpha-desc') {
        return b.title.localeCompare(a.title, undefined, { sensitivity: 'base' });
      } else if (sortOrder === 'date-desc') {
        return b.createdAt - a.createdAt;
      } else {
        return a.createdAt - b.createdAt;
      }
    });

  const handleDownload = async (video: LibraryVideo) => {
    const cleanTitle = (video.title || 'video').replace(/[/\\?%*:|"<>]/g, '_');
    const needsConvert = Boolean(video.videoBlob && video.videoBlob.type.toLowerCase().includes('webm'));
    if (needsConvert) {
      setConvertingVideoId(video.id);
      setDownloadNotice(`Convirtiendo "${video.title}" a MP4 compatible con Google Drive...`);
    }
    try {
      const resultBlob = await downloadVideoAsMp4({
        blob: video.videoBlob,
        url: video.videoUrl,
        title: cleanTitle,
        onStatus: (msg) => setDownloadNotice(msg),
      });
      if (needsConvert && resultBlob && resultBlob.type.toLowerCase().includes('mp4')) {
        await onUpdateVideo(video.id, { videoBlob: resultBlob, videoUrl: undefined });
      }
      setDownloadNotice(null);
    } catch (err: any) {
      setDownloadNotice(err?.message || 'El archivo de video no está disponible para descargar.');
    } finally {
      setConvertingVideoId(null);
    }
  };

  const submitCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await onCreateFolder(newFolderName.trim(), newFolderColor);
    setNewFolderName('');
    setShowNewFolderModal(false);
  };

  const submitEditVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVideo) return;
    await onUpdateVideo(editingVideo.id, {
      title: editTitle.trim(),
      artist: editArtist.trim(),
      folderId: editFolderId,
    });
    setEditingVideo(null);
  };

  const submitRenameFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderToEdit || !folderRenameInput.trim()) return;
    await onRenameFolder(folderToEdit.id, folderRenameInput.trim());
    setFolderToEdit(null);
  };

  const confirmDeleteFolder = async () => {
    if (!folderToDelete) return;
    await onDeleteFolder(folderToDelete.id);
    if (activeFolderId === folderToDelete.id) {
      onSelectFolder('all');
    }
    setFolderToDelete(null);
  };

  const confirmDeleteVideo = async () => {
    if (!videoToDelete) return;
    await onDeleteVideo(videoToDelete.id);
    setVideoToDelete(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2.5">
            <Film className="w-6 h-6 text-purple-400" />
            Biblioteca de Videos Musicales
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Organiza tus videos en carpetas, ordénalos alfabéticamente, modifícalos y descárgalos en cualquier momento
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {videos.length > 0 && onClearAllVideos && (
            <button
              onClick={() => setShowClearAllModal(true)}
              className="px-3.5 py-2 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-semibold rounded-xl flex items-center gap-1.5 border border-rose-800/60 transition shadow-sm"
              title="Borrar todas las canciones y videos para liberar espacio"
            >
              <Trash2 className="w-4 h-4 text-rose-400" />
              <span>Borrar Todo ({videos.length})</span>
            </button>
          )}

          <button
            onClick={() => setShowNewFolderModal(true)}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl flex items-center gap-2 border border-slate-700 transition"
          >
            <FolderPlus className="w-4 h-4 text-purple-400" />
            Nueva Carpeta
          </button>
          <button
            onClick={onOpenCreateStudio}
            className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-purple-600/30 flex items-center gap-2 transition"
          >
            <Plus className="w-4 h-4" />
            Crear Video Musical
          </button>
        </div>
      </div>

      {/* Folders navigation bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">
          <span>Carpetas de Videos</span>
          <span>{folders.length} carpetas</span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
          {/* All videos tab */}
          <button
            onClick={() => onSelectFolder('all')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 transition ${
              activeFolderId === 'all'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Film className="w-4 h-4" />
            Todos los Videos ({videos.length})
          </button>

          {/* Root/General videos */}
          <button
            onClick={() => onSelectFolder('root')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 transition ${
              activeFolderId === 'root'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Folder className="w-4 h-4 text-slate-400" />
            Sin Carpeta ({videos.filter((v) => !v.folderId || v.folderId === 'root').length})
          </button>

          {/* Custom folders */}
          {folders.map((folder) => {
            const count = videos.filter((v) => v.folderId === folder.id).length;
            const isSelected = activeFolderId === folder.id;

            return (
              <div
                key={folder.id}
                className={`group px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 border transition ${
                  isSelected
                    ? 'bg-purple-950/80 border-purple-500 text-white'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-800/80 border-slate-800'
                }`}
              >
                <button
                  onClick={() => onSelectFolder(folder.id)}
                  className="flex items-center gap-2"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: folder.color || '#8B5CF6' }}
                  />
                  <span>{folder.name}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-400 font-normal">
                    {count}
                  </span>
                </button>

                {/* Folder actions dropdown or quick buttons */}
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition pl-1">
                  <button
                    onClick={() => {
                      setFolderToEdit(folder);
                      setFolderRenameInput(folder.name);
                    }}
                    className="p-1 hover:text-purple-400 transition"
                    title="Renombrar carpeta"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setFolderToDelete(folder)}
                    className="p-1 hover:text-rose-400 transition"
                    title="Eliminar carpeta"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {downloadNotice && (
        <div className="p-3 bg-purple-950/60 border border-purple-500/40 rounded-2xl text-xs text-purple-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-purple-400 shrink-0" />
            <span>{downloadNotice}</span>
          </div>
          <button
            onClick={() => setDownloadNotice(null)}
            className="text-slate-400 hover:text-white p-1"
            title="Cerrar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search & Sort Controls */}
      <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar videos por título o artista..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Sorting buttons: Orden Alfabético, Fecha */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end flex-wrap">
          <span className="text-xs text-slate-400 font-medium">Ordenar:</span>

          <button
            onClick={() => setSortOrder(sortOrder === 'alpha-asc' ? 'alpha-desc' : 'alpha-asc')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition ${
              sortOrder.startsWith('alpha')
                ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Organizar por orden alfabético"
          >
            {sortOrder === 'alpha-asc' ? <ArrowDownAZ className="w-4 h-4 text-purple-400" /> : <ArrowUpAZ className="w-4 h-4 text-purple-400" />}
            <span>Alfabético {sortOrder === 'alpha-asc' ? '(A-Z)' : '(Z-A)'}</span>
          </button>

          <button
            onClick={() => setSortOrder(sortOrder === 'date-desc' ? 'date-asc' : 'date-desc')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition ${
              sortOrder.startsWith('date')
                ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Ordenar por fecha"
          >
            <Calendar className="w-4 h-4" />
            <span>Fecha {sortOrder === 'date-desc' ? '(Recientes)' : '(Antiguos)'}</span>
          </button>
        </div>
      </div>

      {/* Videos Grid */}
      {filteredVideos.length === 0 ? (
        <div className="py-20 text-center border-2 border-dashed border-slate-800 rounded-3xl space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-purple-950/40 border border-purple-800/40 text-purple-400 flex items-center justify-center mx-auto shadow-inner">
            <Film className="w-8 h-8" />
          </div>
          <div>
            <h4 className="text-lg font-bold text-white">No hay videos en esta carpeta</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
              Convierte una canción en video con letras corriendo o importa videos de tu galería o Google Drive.
            </p>
          </div>
          <button
            onClick={onOpenCreateStudio}
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-purple-600/30 transition inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Crear Mi Primer Video
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredVideos.map((video) => {
            const folder = folders.find((f) => f.id === video.folderId);

            return (
              <div
                key={video.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl hover:border-purple-500/50 transition flex flex-col group"
              >
                {/* Thumbnail / Video Preview Area */}
                <div className="relative aspect-video bg-black overflow-hidden flex items-center justify-center">
                  {video.thumbnailUrl && video.thumbnailUrl.trim() !== '' ? (
                    <img
                      src={video.thumbnailUrl}
                      alt={video.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-purple-950/40 to-slate-950 p-4 text-center">
                      <Film className="w-10 h-10 text-purple-500/50 mb-2" />
                      <p className="text-xs font-bold text-slate-300 line-clamp-1">{video.title}</p>
                      <p className="text-[10px] text-purple-400">{video.artist || 'Canción musical'}</p>
                    </div>
                  )}

                  {/* Play Overlay Button */}
                  <button
                    onClick={() => onPlayVideo(video)}
                    className="absolute inset-0 bg-black/40 hover:bg-black/20 flex items-center justify-center transition group/btn"
                    title="Reproducir video"
                  >
                    <div className="w-12 h-12 rounded-full bg-purple-600/90 hover:bg-purple-500 text-white flex items-center justify-center shadow-lg transform group-hover/btn:scale-110 transition">
                      <Play className="w-5 h-5 ml-1 fill-white" />
                    </div>
                  </button>

                  {/* Duration Badge */}
                  {video.duration > 0 && (
                    <div className="absolute bottom-2 right-2 bg-black/80 text-white text-[10px] px-2 py-0.5 rounded-md font-mono font-bold">
                      {Math.floor(video.duration / 60)}:
                      {Math.floor(video.duration % 60)
                        .toString()
                        .padStart(2, '0')}
                    </div>
                  )}

                  {/* Folder Tag */}
                  {folder && (
                    <div
                      className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-md font-bold text-white shadow-md flex items-center gap-1"
                      style={{ backgroundColor: `${folder.color}cc` }}
                    >
                      <Folder className="w-2.5 h-2.5" />
                      {folder.name}
                    </div>
                  )}
                </div>

                {/* Video Info */}
                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-base text-white line-clamp-1" title={video.title}>
                      {video.title}
                    </h3>
                    <p className="text-xs text-purple-400 font-medium mt-0.5">
                      {video.artist || 'Sin artista especificado'}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                      <span>{new Date(video.createdAt).toLocaleDateString()}</span>
                      <span>•</span>
                      <span>{video.lyrics ? `${video.lyrics.length} líneas de letra` : 'Video'}</span>
                    </p>
                  </div>

                  {/* Actions: Play, Download, Modify, Delete */}
                  <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <button
                      onClick={() => onPlayVideo(video)}
                      className="px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition"
                      title="Abrir en el Reproductor de Videos"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Ver</span>
                    </button>

                    <button
                      onClick={() => handleDownload(video)}
                      disabled={convertingVideoId === video.id}
                      className="flex-1 py-2 bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-60"
                      title="Descargar video en formato MP4 compatible con Google Drive"
                    >
                      {convertingVideoId === video.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>{convertingVideoId === video.id ? 'MP4...' : 'Descargar MP4'}</span>
                    </button>

                    <button
                      onClick={() => {
                        setEditingVideo(video);
                        setEditTitle(video.title);
                        setEditArtist(video.artist || '');
                        setEditFolderId(video.folderId || 'root');
                      }}
                      className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition"
                      title="Modificar título, artista o carpeta"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => setVideoToDelete(video)}
                      className="p-2 bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 rounded-xl transition"
                      title="Borrar video"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-purple-400" />
                Crear Nueva Carpeta
              </h3>
              <button
                onClick={() => setShowNewFolderModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={submitCreateFolder} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nombre de la carpeta
                </label>
                <input
                  type="text"
                  placeholder="Ej: Baladas, Rock, Karaoke..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Color distintivo
                </label>
                <div className="flex items-center gap-2">
                  {['#8B5CF6', '#EC4899', '#3B82F6', '#10B981', '#F59E0B', '#EF4444'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewFolderColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition ${
                        newFolderColor === c ? 'border-white scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewFolderModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!newFolderName.trim()}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl transition disabled:opacity-50"
                >
                  Crear Carpeta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Video Modal */}
      {editingVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-purple-400" />
                Modificar Video
              </h3>
              <button
                onClick={() => setEditingVideo(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={submitEditVideo} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Título del video (igual al de la canción)
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Artista / Intérprete
                </label>
                <input
                  type="text"
                  value={editArtist}
                  onChange={(e) => setEditArtist(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Carpeta de destino
                </label>
                <select
                  value={editFolderId}
                  onChange={(e) => setEditFolderId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-purple-500"
                >
                  <option value="root">Sin Carpeta (General)</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingVideo(null)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!editTitle.trim()}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl transition disabled:opacity-50"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Folder Modal */}
      {folderToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-base text-white">Renombrar Carpeta</h3>
            <form onSubmit={submitRenameFolder} className="space-y-4">
              <input
                type="text"
                value={folderRenameInput}
                onChange={(e) => setFolderRenameInput(e.target.value)}
                autoFocus
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-purple-500"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFolderToEdit(null)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!folderRenameInput.trim()}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl transition"
                >
                  Actualizar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Folder Confirmation Modal */}
      {folderToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-rose-900/60 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <Trash2 className="w-6 h-6" />
              <h3 className="font-bold text-base text-white">¿Eliminar carpeta "{folderToDelete.name}"?</h3>
            </div>
            <p className="text-xs text-slate-300">
              La carpeta será eliminada. Los videos que contiene no se borrarán, sino que se moverán a la sección general "Sin Carpeta".
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setFolderToDelete(null)}
                className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteFolder}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition"
              >
                Sí, Eliminar Carpeta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Video Confirmation Modal */}
      {videoToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-rose-900/60 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <Trash2 className="w-6 h-6" />
              <h3 className="font-bold text-base text-white">¿Borrar video musical?</h3>
            </div>
            <p className="text-xs text-slate-300">
              ¿Estás seguro de que deseas eliminar permanentemente el video "{videoToDelete.title}"? Esta acción no se puede deshacer.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setVideoToDelete(null)}
                className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteVideo}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition"
              >
                Sí, Eliminar Video
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Videos Confirmation Modal */}
      {showClearAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-rose-900/70 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-2xl bg-rose-950/60 border border-rose-800/80 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">¿Borrar todas las canciones?</h3>
                <p className="text-xs text-rose-300">Liberar todo el espacio de almacenamiento</p>
              </div>
            </div>
            <p className="text-xs text-slate-300">
              Esta acción eliminará todas las {videos.length} canciones y videos guardados en tu biblioteca para que no ocupen espacio. ¿Deseas continuar?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowClearAllModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (onClearAllVideos) await onClearAllVideos();
                  setShowClearAllModal(false);
                }}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition"
              >
                Sí, Borrar Todo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
