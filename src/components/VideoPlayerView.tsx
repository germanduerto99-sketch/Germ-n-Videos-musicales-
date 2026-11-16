import React, { useState, useRef, useEffect } from 'react';
import { LibraryVideo, VideoFolder } from '../types';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  RotateCw, 
  Volume2, 
  VolumeX, 
  Maximize, 
  Minimize, 
  PictureInPicture, 
  Repeat, 
  Download, 
  FileText, 
  Upload, 
  Cloud, 
  Film, 
  Music, 
  SkipForward, 
  SkipBack, 
  Folder, 
  Search, 
  Sliders, 
  Check, 
  Info,
  Layers,
  Sparkles
} from 'lucide-react';
import { VideoCanvasRenderer } from './VideoCanvasRenderer';
import { defaultStyle } from '../services/storage';
import { downloadVideoAsMp4 } from '../services/videoConverter';

interface VideoPlayerViewProps {
  videos: LibraryVideo[];
  folders: VideoFolder[];
  activeVideo: LibraryVideo | null;
  onSelectVideo: (video: LibraryVideo) => void;
  onOpenStudio: () => void;
}

export const VideoPlayerView: React.FC<VideoPlayerViewProps> = ({
  videos,
  folders,
  activeVideo: propActiveVideo,
  onSelectVideo,
  onOpenStudio,
}) => {
  // Current selected video
  const [currentVideo, setCurrentVideo] = useState<LibraryVideo | null>(
    propActiveVideo || (videos.length > 0 ? videos[0] : null)
  );

  // Custom local video file if user loads one directly
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);
  const [localVideoName, setLocalVideoName] = useState<string | null>(null);

  // Playback state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showLyricsOverlay, setShowLyricsOverlay] = useState<boolean>(true);
  const [autoPlayNext, setAutoPlayNext] = useState<boolean>(true);

  // Playlist filtering
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterFolderId, setFilterFolderId] = useState<string | 'all'>('all');

  // Sync prop changes
  useEffect(() => {
    if (propActiveVideo) {
      setCurrentVideo(propActiveVideo);
      setLocalVideoUrl(null);
      setLocalVideoName(null);
    }
  }, [propActiveVideo]);

  // Compute video source URL
  const videoSource = localVideoUrl || (currentVideo ? currentVideo.videoUrl || (currentVideo.videoBlob ? URL.createObjectURL(currentVideo.videoBlob) : null) : null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Play / Pause handler
  const togglePlay = () => {
    if (videoSource && videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(console.warn);
      }
    } else if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().then(() => setIsPlaying(true)).catch(console.warn);
      }
    }
  };

  const handleTimeUpdate = () => {
    if (videoSource && videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      const d = videoRef.current.duration;
      if ((!duration || !isFinite(duration) || duration === 0) && d && !isNaN(d) && isFinite(d) && d > 0) {
        setDuration(d);
      }
    } else if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      const d = audioRef.current.duration;
      if ((!duration || !isFinite(duration) || duration === 0) && d && !isNaN(d) && isFinite(d) && d > 0) {
        setDuration(d);
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (videoSource && videoRef.current) {
      const d = videoRef.current.duration;
      if (d && !isNaN(d) && isFinite(d) && d > 0) {
        setDuration(d);
      } else if (currentVideo?.duration && currentVideo.duration > 0) {
        setDuration(currentVideo.duration);
      }
    } else if (audioRef.current) {
      const d = audioRef.current.duration;
      if (d && !isNaN(d) && isFinite(d) && d > 0) {
        setDuration(d);
      } else if (currentVideo?.duration && currentVideo.duration > 0) {
        setDuration(currentVideo.duration);
      }
    }
  };

  const handleSeek = (time: number) => {
    if (videoSource && videoRef.current) {
      videoRef.current.currentTime = time;
    } else if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    setCurrentTime(time);
  };

  const skipSeconds = (seconds: number) => {
    const target = Math.max(0, Math.min(duration, currentTime + seconds));
    handleSeek(target);
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
    }
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
    }
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (newVolume: number) => {
    if (videoRef.current) videoRef.current.volume = newVolume;
    if (audioRef.current) audioRef.current.volume = newVolume;
    setVolume(newVolume);
    if (newVolume === 0) {
      if (videoRef.current) videoRef.current.muted = true;
      if (audioRef.current) audioRef.current.muted = true;
      setIsMuted(true);
    } else if (isMuted) {
      if (videoRef.current) videoRef.current.muted = false;
      if (audioRef.current) audioRef.current.muted = false;
      setIsMuted(false);
    }
  };

  const handleSpeedChange = (rate: number) => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
    if (audioRef.current) audioRef.current.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(console.warn);
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(console.warn);
      setIsFullscreen(false);
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (e) {
      console.warn('PiP error:', e);
    }
  };

  // Handle local video upload directly into the player
  const handleLocalVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    setLocalVideoUrl(url);
    setLocalVideoName(file.name.replace(/\.[^/.]+$/, ''));
    setCurrentVideo(null);
    setIsPlaying(false);
  };

  // Playlist navigation
  const filteredPlaylist = videos.filter((v) => {
    const matchFolder = filterFolderId === 'all' || (filterFolderId === 'root' ? !v.folderId || v.folderId === 'root' : v.folderId === filterFolderId);
    const matchSearch = v.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        v.artist.toLowerCase().includes(searchQuery.toLowerCase());
    return matchFolder && matchSearch;
  });

  const currentIndex = currentVideo ? filteredPlaylist.findIndex((v) => v.id === currentVideo.id) : -1;

  const handlePlayNext = () => {
    if (filteredPlaylist.length === 0) return;
    const nextIdx = (currentIndex + 1) % filteredPlaylist.length;
    const nextVideo = filteredPlaylist[nextIdx];
    setCurrentVideo(nextVideo);
    setLocalVideoUrl(null);
    onSelectVideo(nextVideo);
  };

  const handlePlayPrev = () => {
    if (filteredPlaylist.length === 0) return;
    const prevIdx = (currentIndex - 1 + filteredPlaylist.length) % filteredPlaylist.length;
    const prevVideo = filteredPlaylist[prevIdx];
    setCurrentVideo(prevVideo);
    setLocalVideoUrl(null);
    onSelectVideo(prevVideo);
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
    if (autoPlayNext && filteredPlaylist.length > 1) {
      handlePlayNext();
    }
  };

  // Active lyric finder
  const activeLyric = currentVideo?.lyrics?.find((line, idx, arr) => {
    const nextTime = idx < arr.length - 1 ? arr[idx + 1].time : 999999;
    return currentTime >= line.time && currentTime < nextTime;
  });

  // Download video as universal MP4 (converts WebM on the fly if needed)
  const handleDownloadCurrentVideo = async () => {
    if (!videoSource && !currentVideo?.videoBlob) return;
    const title = localVideoName || currentVideo?.title || 'video_musical';
    await downloadVideoAsMp4({
      blob: localVideoUrl ? null : currentVideo?.videoBlob,
      url: videoSource,
      title,
    });
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Top Bar Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-3xl bg-gradient-to-r from-purple-950/60 via-slate-900 to-indigo-950/60 border border-purple-800/40 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-purple-600/30">
            <Film className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white flex items-center gap-2">
              Reproductor de Videos Musicales
            </h2>
            <p className="text-xs text-purple-300">
              Reproduce tus videos generados o carga cualquier video desde tu galería y Google Drive
            </p>
          </div>
        </div>

        {/* Action Buttons: Cargar Video Local, Google Drive, Ir a Crear */}
        <div className="flex items-center gap-2 flex-wrap">
          <label className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 flex items-center gap-2 cursor-pointer transition shadow-md">
            <Upload className="w-4 h-4 text-purple-400" />
            <span>Cargar Video de Galería</span>
            <input
              type="file"
              accept="video/*"
              onChange={handleLocalVideoUpload}
              className="hidden"
            />
          </label>

          <button
            onClick={onOpenStudio}
            className="px-4 py-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-pink-600/30 flex items-center gap-2 transition"
          >
            <Sparkles className="w-4 h-4" />
            <span>Crear Nuevo Video</span>
          </button>
        </div>
      </div>

      {/* Main Player Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Cinema Video Player (8 Cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div
            ref={containerRef}
            className="relative bg-black rounded-3xl overflow-hidden border border-slate-800 shadow-2xl group flex flex-col justify-between"
            style={{ minHeight: '440px' }}
          >
            {/* Main Video Element */}
            {videoSource ? (
              <div className="relative w-full aspect-video flex items-center justify-center bg-black overflow-hidden">
                <video
                  ref={videoRef}
                  src={videoSource}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onEnded={handleVideoEnded}
                  loop={isLooping}
                  playsInline
                  onClick={togglePlay}
                  className="w-full h-full object-contain cursor-pointer"
                />

                {/* Big Center Play Icon overlay when paused */}
                {!isPlaying && (
                  <button
                    onClick={togglePlay}
                    className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/25 transition group/play"
                  >
                    <div className="w-16 h-16 rounded-full bg-purple-600/90 group-hover/play:bg-purple-500 text-white flex items-center justify-center shadow-2xl transform group-hover/play:scale-110 transition">
                      <Play className="w-8 h-8 ml-1 fill-white" />
                    </div>
                  </button>
                )}

                {/* Rolling Lyrics Karaoke Overlay */}
                {showLyricsOverlay && activeLyric && (
                  <div className="absolute bottom-16 inset-x-6 text-center pointer-events-none animate-fadeIn">
                    <div className="inline-block bg-black/75 backdrop-blur-md px-6 py-2.5 rounded-2xl border border-white/10 shadow-2xl">
                      <p className="text-base sm:text-xl font-black text-rose-400 drop-shadow-md">
                        {activeLyric.text}
                      </p>
                    </div>
                  </div>
                )}

                {/* Floating Title Tag */}
                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-white/10 text-xs font-bold text-white flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-purple-400" />
                  <span className="truncate max-w-[200px] sm:max-w-[320px]">
                    {localVideoName || currentVideo?.title || 'Video Musical'}
                  </span>
                </div>
              </div>
            ) : currentVideo ? (
              <div className="relative w-full aspect-video flex items-center justify-center bg-black overflow-hidden">
                <canvas
                  ref={canvasRef}
                  width={1280}
                  height={720}
                  className="w-full h-full object-contain cursor-pointer"
                  onClick={togglePlay}
                />
                <VideoCanvasRenderer
                  canvasRef={canvasRef}
                  songTitle={currentVideo.title}
                  artist={currentVideo.artist || ''}
                  lyrics={currentVideo.lyrics || []}
                  currentTime={currentTime}
                  duration={duration || currentVideo.duration || 30}
                  style={currentVideo.style || defaultStyle}
                  audioElementRef={audioRef}
                />
                <audio
                  ref={audioRef}
                  src={currentVideo.audioUrl || undefined}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onEnded={handleVideoEnded}
                  loop={isLooping}
                />
                {!isPlaying && (
                  <button
                    onClick={togglePlay}
                    className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/25 transition group/play"
                  >
                    <div className="w-16 h-16 rounded-full bg-purple-600/90 group-hover/play:bg-purple-500 text-white flex items-center justify-center shadow-2xl transform group-hover/play:scale-110 transition">
                      <Play className="w-8 h-8 ml-1 fill-white" />
                    </div>
                  </button>
                )}
                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-white/10 text-xs font-bold text-white flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-purple-400" />
                  <span className="truncate max-w-[200px] sm:max-w-[320px]">
                    {currentVideo.title}
                  </span>
                </div>
              </div>
            ) : (
              <div className="w-full aspect-video flex flex-col items-center justify-center p-8 text-center bg-gradient-to-b from-slate-900 to-black">
                <div className="w-16 h-16 rounded-2xl bg-purple-950/40 border border-purple-800/40 text-purple-400 flex items-center justify-center mb-3">
                  <Film className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-white">Ningún video seleccionado</h3>
                <p className="text-xs text-slate-400 max-w-sm mt-1">
                  Selecciona un video de tu biblioteca en la lista derecha o carga un archivo de video desde tu dispositivo.
                </p>
                <div className="flex items-center gap-2 mt-4">
                  <label className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl cursor-pointer shadow-lg transition">
                    Cargar Video
                    <input
                      type="file"
                      accept="video/*"
                      onChange={handleLocalVideoUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Comprehensive Video Controls Bar */}
            {videoSource && (
              <div className="bg-slate-950/95 border-t border-slate-800/80 p-4 space-y-3">
                {/* Timeline Scrubber */}
                <div className="space-y-1">
                  <input
                    type="range"
                    min="0"
                    max={duration || 100}
                    step="0.1"
                    value={currentTime}
                    onChange={(e) => handleSeek(parseFloat(e.target.value))}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                  />
                  <div className="flex justify-between text-[11px] font-mono text-slate-400 px-1">
                    <span>
                      {Math.floor(currentTime / 60)}:
                      {Math.floor(currentTime % 60)
                        .toString()
                        .padStart(2, '0')}
                    </span>
                    <span>
                      {Math.floor(duration / 60)}:
                      {Math.floor(duration % 60)
                        .toString()
                        .padStart(2, '0')}
                    </span>
                  </div>
                </div>

                {/* Control Buttons Row */}
                <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                  {/* Left Controls: Prev, Play/Pause, Next, Skip */}
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <button
                      onClick={handlePlayPrev}
                      className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition"
                      title="Video anterior"
                    >
                      <SkipBack className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => skipSeconds(-10)}
                      className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition"
                      title="Retroceder 10 segundos"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>

                    <button
                      onClick={togglePlay}
                      className="w-10 h-10 rounded-xl bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center shadow-lg transition"
                      title={isPlaying ? 'Pausar' : 'Reproducir'}
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                    </button>

                    <button
                      onClick={() => skipSeconds(10)}
                      className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition"
                      title="Adelantar 10 segundos"
                    >
                      <RotateCw className="w-4 h-4" />
                    </button>

                    <button
                      onClick={handlePlayNext}
                      className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition"
                      title="Video siguiente"
                    >
                      <SkipForward className="w-4 h-4" />
                    </button>

                    {/* Volume Slider */}
                    <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                      <button
                        onClick={toggleMute}
                        className="text-slate-400 hover:text-white transition"
                        title={isMuted ? 'Desmutear' : 'Mutear'}
                      >
                        {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={isMuted ? 0 : volume}
                        onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                        className="w-16 sm:w-20 h-1.5 bg-slate-800 rounded-lg accent-purple-500 cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Right Controls: Speed, Lyrics Toggle, Loop, PiP, Download, Fullscreen */}
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    {/* Playback Speed selector */}
                    <select
                      value={playbackRate}
                      onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[11px] font-mono text-purple-300 focus:outline-none"
                      title="Velocidad de reproducción"
                    >
                      <option value="0.5">0.5x</option>
                      <option value="0.75">0.75x</option>
                      <option value="1">1.0x</option>
                      <option value="1.25">1.25x</option>
                      <option value="1.5">1.5x</option>
                      <option value="2">2.0x</option>
                    </select>

                    {/* Lyrics Overlay Toggle */}
                    <button
                      onClick={() => setShowLyricsOverlay(!showLyricsOverlay)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 border transition ${
                        showLyricsOverlay
                          ? 'bg-purple-600/30 border-purple-500 text-purple-300'
                          : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                      }`}
                      title="Subtítulos / Letras en video"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Letras</span>
                    </button>

                    {/* Loop Toggle */}
                    <button
                      onClick={() => setIsLooping(!isLooping)}
                      className={`p-1.5 rounded-lg transition ${
                        isLooping
                          ? 'bg-purple-600/30 text-purple-300'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Repetir video"
                    >
                      <Repeat className="w-4 h-4" />
                    </button>

                    {/* Picture in Picture */}
                    <button
                      onClick={togglePiP}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
                      title="Ventana flotante (PiP)"
                    >
                      <PictureInPicture className="w-4 h-4" />
                    </button>

                    {/* Download Video */}
                    <button
                      onClick={handleDownloadCurrentVideo}
                      className="p-1.5 text-slate-400 hover:text-purple-400 rounded-lg transition"
                      title="Descargar este video"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    {/* Fullscreen */}
                    <button
                      onClick={toggleFullscreen}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
                      title="Pantalla completa"
                    >
                      {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Current Video Info Panel */}
          {currentVideo && (
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400">
                  Reproduciendo Ahora
                </span>
                <h3 className="text-xl font-bold text-white mt-0.5">{currentVideo.title}</h3>
                <p className="text-xs text-slate-400">
                  {currentVideo.artist || 'Canción musical'} • {Math.floor(currentVideo.duration / 60)}:
                  {Math.floor(currentVideo.duration % 60)
                    .toString()
                    .padStart(2, '0')}{' '}
                  minutos
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadCurrentVideo}
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-1.5 transition"
                >
                  <Download className="w-4 h-4" />
                  <span>Descargar Video</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Playlist & Video Selector (4 Cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl flex flex-col h-full max-h-[700px]">
            {/* Playlist Header */}
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-base text-white flex items-center gap-2">
                  <Film className="w-4 h-4 text-purple-400" />
                  Lista de Videos ({filteredPlaylist.length})
                </h3>
                <p className="text-[11px] text-slate-400">
                  Selecciona cualquier video para reproducirlo
                </p>
              </div>

              {/* Auto play toggle */}
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPlayNext}
                  onChange={(e) => setAutoPlayNext(e.target.checked)}
                  className="rounded text-purple-600 focus:ring-0"
                />
                <span>Auto-siguiente</span>
              </label>
            </div>

            {/* Folder Filter Pill */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-thin mb-3">
              <button
                onClick={() => setFilterFolderId('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 transition ${
                  filterFolderId === 'all'
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-950 text-slate-400 border border-slate-800'
                }`}
              >
                Todos
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilterFolderId(f.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 border transition ${
                    filterFolderId === f.id
                      ? 'bg-purple-950 border-purple-500 text-purple-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>

            {/* Search within playlist */}
            <div className="relative mb-3">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar video..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>

            {/* Playlist Video Items */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {filteredPlaylist.length === 0 ? (
                <div className="py-12 text-center text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                  <Film className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                  <p className="text-xs">No hay videos en esta lista</p>
                </div>
              ) : (
                filteredPlaylist.map((v) => {
                  const isCurrent = currentVideo?.id === v.id && !localVideoUrl;
                  const folder = folders.find((f) => f.id === v.folderId);

                  return (
                    <div
                      key={v.id}
                      onClick={() => {
                        setCurrentVideo(v);
                        setLocalVideoUrl(null);
                        setLocalVideoName(null);
                        onSelectVideo(v);
                      }}
                      className={`p-2.5 rounded-xl border cursor-pointer transition flex items-center gap-3 ${
                        isCurrent
                          ? 'bg-purple-950/70 border-purple-500 shadow-md'
                          : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      {/* Mini Thumbnail */}
                      <div className="w-14 h-10 rounded-lg bg-black overflow-hidden relative shrink-0 flex items-center justify-center">
                        {v.thumbnailUrl ? (
                          <img
                            src={v.thumbnailUrl}
                            alt={v.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Film className="w-5 h-5 text-purple-400/60" />
                        )}
                        {isCurrent && isPlaying && (
                          <div className="absolute inset-0 bg-purple-600/40 flex items-center justify-center">
                            <span className="w-2.5 h-2.5 bg-white rounded-full animate-ping" />
                          </div>
                        )}
                      </div>

                      {/* Video Title and info */}
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-xs font-bold truncate ${
                            isCurrent ? 'text-purple-300' : 'text-slate-200'
                          }`}
                        >
                          {v.title}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {v.artist || 'Canción musical'}
                        </p>
                        {folder && (
                          <span
                            className="inline-block mt-0.5 text-[9px] px-1.5 py-0.2 rounded font-semibold text-white"
                            style={{ backgroundColor: `${folder.color}bb` }}
                          >
                            {folder.name}
                          </span>
                        )}
                      </div>

                      {/* Duration */}
                      <span className="text-[10px] font-mono text-slate-500 shrink-0">
                        {Math.floor(v.duration / 60)}:
                        {Math.floor(v.duration % 60)
                          .toString()
                          .padStart(2, '0')}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Clickable Lyrics List in Sidebar */}
            {currentVideo?.lyrics && currentVideo.lyrics.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-purple-400" />
                    Letras Sincronizadas
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Clic en un verso para saltar
                  </span>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                  {currentVideo.lyrics.map((line) => {
                    const isActive = activeLyric?.id === line.id;
                    return (
                      <button
                        key={line.id}
                        onClick={() => handleSeek(line.time)}
                        className={`w-full p-1.5 rounded-lg text-left text-xs transition flex items-start gap-2 ${
                          isActive
                            ? 'bg-rose-950/60 border border-rose-800 text-rose-300 font-bold'
                            : 'hover:bg-slate-950 text-slate-400'
                        }`}
                      >
                        <span className="font-mono text-[10px] text-purple-400 shrink-0 mt-0.5">
                          {Math.floor(line.time / 60)}:
                          {Math.floor(line.time % 60)
                            .toString()
                            .padStart(2, '0')}
                        </span>
                        <span className="truncate">{line.text}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
