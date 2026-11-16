/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  LibraryVideo, 
  VideoFolder 
} from './types';
import { 
  getVideos, 
  getFolders, 
  saveVideo, 
  deleteVideo, 
  clearAllVideos,
  updateVideoMetadata, 
  createFolder, 
  updateFolder, 
  deleteFolder 
} from './services/storage';
import { SongToVideoStudio } from './components/SongToVideoStudio';
import { VideoLibrary } from './components/VideoLibrary';
import { VideoPlayerView } from './components/VideoPlayerView';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { GoogleDriveModal } from './components/GoogleDriveModal';
import { SongStoryModal } from './components/SongStoryModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { 
  Film, 
  Music, 
  PlayCircle,
  Maximize2,
  Minimize2
} from 'lucide-react';

export default function App() {
  const [currentView, setCurrentView] = useState<'studio' | 'library' | 'player'>('studio');
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [folders, setFolders] = useState<VideoFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | 'all'>('all');

  // Video chosen to play in the player
  const [playerSelectedVideo, setPlayerSelectedVideo] = useState<LibraryVideo | null>(null);

  // Modals
  const [activePlayingVideoModal, setActivePlayingVideoModal] = useState<LibraryVideo | null>(null);
  const [isDriveModalOpen, setIsDriveModalOpen] = useState<boolean>(false);
  const [isStoryModalOpen, setIsStoryModalOpen] = useState<boolean>(false);
  const [storyInitialSong, setStoryInitialSong] = useState<string>('');
  const [storyInitialOrigin, setStoryInitialOrigin] = useState<string>('');
  const [appliedStoryVideo, setAppliedStoryVideo] = useState<{ url: string; theme: string } | null>(null);
  const [appliedStoryPhoto, setAppliedStoryPhoto] = useState<{ photoId: string; title: string; imageUrl: string; downloadUrl: string } | null>(null);

  // Passing imported media from Drive/Gallery to Studio
  const [importedMedia, setImportedMedia] = useState<{
    blob: Blob;
    fileName: string;
    isAudio: boolean;
  } | null>(null);

  // Fullscreen / Hide browser bar state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [fullscreenNotice, setFullscreenNotice] = useState<string | null>(null);

  useEffect(() => {
    const syncFs = () => {
      const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
      setIsFullscreen(Boolean(fsEl));
    };
    document.addEventListener('fullscreenchange', syncFs);
    document.addEventListener('webkitfullscreenchange', syncFs);
    return () => {
      document.removeEventListener('fullscreenchange', syncFs);
      document.removeEventListener('webkitfullscreenchange', syncFs);
    };
  }, []);

  const handleToggleFullscreen = async () => {
    try {
      const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
      if (fsEl) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        }
      } else {
        const el = document.documentElement as any;
        if (el.requestFullscreen) {
          await el.requestFullscreen({ navigationUI: 'hide' });
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        } else {
          throw new Error('Tu navegador no permite ocultar la barra automáticamente en esta vista.');
        }
      }
    } catch {
      setFullscreenNotice('Para ocultar la barra en este dispositivo, abre la app en Chrome/Edge (nueva pestaña) o pulsa F11 en PC.');
      setTimeout(() => setFullscreenNotice(null), 5000);
    }
  };

  // Initial Data Load (removes sample demo videos so they don't consume space)
  useEffect(() => {
    loadDatabase();
  }, []);

  const loadDatabase = async () => {
    try {
      const [fetchedFolders, fetchedVideos] = await Promise.all([
        getFolders(),
        getVideos(),
      ]);

      setFolders(fetchedFolders);

      // Filter out any mock sample videos to avoid wasting space
      const userVideos = fetchedVideos.filter((v) => v.id !== 'sample-video-1');
      if (fetchedVideos.length !== userVideos.length) {
        await deleteVideo('sample-video-1');
      }

      setVideos(userVideos);
      if (userVideos.length > 0 && !playerSelectedVideo) {
        setPlayerSelectedVideo(userVideos[0]);
      }
    } catch (err) {
      console.error('Error loading data:', err);
    }
  };

  // Handlers for Library Videos
  const handleSaveToLibrary = async (video: LibraryVideo) => {
    await saveVideo(video);
    await loadDatabase();
    setPlayerSelectedVideo(video);
    setCurrentView('player');
  };

  const handleDeleteVideo = async (id: string) => {
    await deleteVideo(id);
    await loadDatabase();
    if (playerSelectedVideo?.id === id) {
      setPlayerSelectedVideo(videos.find((v) => v.id !== id) || null);
    }
  };

  const handleClearAllVideos = async () => {
    await clearAllVideos();
    setVideos([]);
    setPlayerSelectedVideo(null);
  };

  const handleUpdateVideo = async (id: string, updates: Partial<LibraryVideo>) => {
    await updateVideoMetadata(id, updates);
    await loadDatabase();
  };

  // Handlers for Folders
  const handleCreateFolder = async (name: string, color?: string) => {
    await createFolder(name, color);
    const updatedFolders = await getFolders();
    setFolders(updatedFolders);
  };

  const handleRenameFolder = async (id: string, name: string) => {
    await updateFolder(id, name);
    const updatedFolders = await getFolders();
    setFolders(updatedFolders);
  };

  const handleDeleteFolder = async (id: string) => {
    await deleteFolder(id);
    await loadDatabase();
  };

  // Handle media selected from Google Drive
  const handleDriveMediaSelected = (blob: Blob, fileName: string, isAudio: boolean) => {
    setImportedMedia({ blob, fileName, isAudio });
    setCurrentView('studio');
  };

  const handleOpenSongStory = (songTitle: string, songOrigin?: string) => {
    setStoryInitialSong(songTitle || '');
    setStoryInitialOrigin(songOrigin || '');
    setIsStoryModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-purple-600 selection:text-white">
      {/* Top Main Navigation Bar - Streamlined, Clean, Never Overflows */}
      <header className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 px-4 py-2.5 transition">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          
          {/* Logo & App Title */}
          <div 
            onClick={() => setCurrentView('studio')}
            className="flex items-center gap-2.5 cursor-pointer group shrink-0"
          >
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-rose-500 flex items-center justify-center text-white shadow-md shadow-purple-600/30 group-hover:scale-105 transition">
                <Music className="w-4 h-4 absolute -top-0.5 -right-0.5 text-white" />
                <Film className="w-4 h-4 ml-0.5" />
              </div>
            </div>

            <div>
              <h1 className="text-base sm:text-lg font-black tracking-tight text-white group-hover:text-purple-300 transition leading-tight">
                Germán Videos
              </h1>
              <span className="text-[10px] text-purple-400 font-semibold block sm:inline">
                Musicales
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleToggleFullscreen}
              title={isFullscreen ? 'Mostrar barra del navegador' : 'Ocultar barra del navegador (Pantalla completa)'}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition shrink-0 ${
                isFullscreen
                  ? 'bg-amber-600/25 border-amber-500/60 text-amber-200 hover:bg-amber-600/40'
                  : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
              }`}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">{isFullscreen ? 'Mostrar barra' : 'Ocultar barra'}</span>
            </button>

            <PWAInstallButton />

            {/* Navigation: Studio with label, Reproductor (Icon only), Biblioteca (Icon only) */}
            <nav className="flex items-center bg-slate-900/90 p-1 rounded-2xl border border-slate-800 shrink-0 gap-1">
              <button
                onClick={() => setCurrentView('studio')}
                title="Estudio de Creación"
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                  currentView === 'studio'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Music className="w-3.5 h-3.5 text-pink-400" />
                <span>Estudio</span>
              </button>

              {/* Reproductor: Solo logo / icono */}
              <button
                onClick={() => setCurrentView('player')}
                title="Reproductor de Videos"
                aria-label="Reproductor"
                className={`p-2 rounded-xl transition flex items-center justify-center ${
                  currentView === 'player'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <PlayCircle className="w-5 h-5 text-emerald-400" />
              </button>

              {/* Biblioteca: Solo logo / icono */}
              <button
                onClick={() => setCurrentView('library')}
                title={`Biblioteca de Videos (${videos.length})`}
                aria-label="Biblioteca"
                className={`p-2 rounded-xl transition flex items-center justify-center relative ${
                  currentView === 'library'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Film className="w-5 h-5 text-purple-400" />
              </button>
            </nav>
          </div>

        </div>
      </header>

      {fullscreenNotice && (
        <div className="bg-amber-950/90 border-b border-amber-600/40 px-4 py-2 text-center text-xs text-amber-200">
          {fullscreenNotice}
        </div>
      )}

      {/* Main App Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6">
        {currentView === 'studio' ? (
          <SongToVideoStudio
            onSaveToLibrary={handleSaveToLibrary}
            onOpenGoogleDrive={() => setIsDriveModalOpen(true)}
            onOpenSongStory={handleOpenSongStory}
            folders={folders}
            importedMedia={importedMedia}
            onClearImportedMedia={() => setImportedMedia(null)}
            appliedStoryVideo={appliedStoryVideo}
            onClearAppliedStoryVideo={() => setAppliedStoryVideo(null)}
            appliedStoryPhoto={appliedStoryPhoto}
            onClearAppliedStoryPhoto={() => setAppliedStoryPhoto(null)}
          />
        ) : currentView === 'player' ? (
          <VideoPlayerView
            videos={videos}
            folders={folders}
            activeVideo={playerSelectedVideo}
            onSelectVideo={(v) => setPlayerSelectedVideo(v)}
            onOpenStudio={() => setCurrentView('studio')}
          />
        ) : (
          <VideoLibrary
            videos={videos}
            folders={folders}
            activeFolderId={activeFolderId}
            onSelectFolder={setActiveFolderId}
            onCreateFolder={handleCreateFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            onDeleteVideo={handleDeleteVideo}
            onClearAllVideos={handleClearAllVideos}
            onUpdateVideo={handleUpdateVideo}
            onPlayVideo={(v) => {
              setPlayerSelectedVideo(v);
              setCurrentView('player');
            }}
            onOpenCreateStudio={() => setCurrentView('studio')}
          />
        )}
      </main>

      {/* Video Player Modal */}
      {activePlayingVideoModal && (
        <VideoPlayerModal
          video={activePlayingVideoModal}
          onClose={() => setActivePlayingVideoModal(null)}
        />
      )}

      {/* Google Drive Browser Modal */}
      <GoogleDriveModal
        isOpen={isDriveModalOpen}
        onClose={() => setIsDriveModalOpen(false)}
        onSelectMedia={handleDriveMediaSelected}
      />

      {/* Song Story Explorer Modal */}
      <SongStoryModal
        isOpen={isStoryModalOpen}
        onClose={() => setIsStoryModalOpen(false)}
        defaultSongTitle={storyInitialSong}
        defaultOriginOrStory={storyInitialOrigin}
        onConvertToVideo={(title, origin) => {
          setCurrentView('studio');
        }}
        onApplyStoryVideo={(videoUrl, theme) => {
          setAppliedStoryVideo({ url: videoUrl, theme });
          setCurrentView('studio');
        }}
        onApplyStoryPhoto={(photo) => {
          setAppliedStoryPhoto(photo);
          setCurrentView('studio');
        }}
      />

      {/* Footer */}
      <footer className="border-t border-slate-900 py-4 px-4 text-center text-xs text-slate-500">
        <p>Germán Videos Musicales • Convierte canciones en videos con letras sincronizadas, reproductor multimedia y biblioteca organizada</p>
      </footer>

      <OfflineIndicator />
    </div>
  );
}
