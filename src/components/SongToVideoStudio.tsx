import React, { useState, useRef, useEffect } from 'react';
import { 
  LyricLine, 
  VideoStyleConfig, 
  LibraryVideo, 
  VisualizerTheme, 
  AspectRatio, 
  FontFamily,
  LyricEffect
} from '../types';
import { defaultStyle } from '../services/storage';
import { fixWebmDuration } from '../services/webmDuration';
import { convertVideoBlobToMp4, downloadVideoAsMp4, fetchMp4BlobInChunks } from '../services/videoConverter';
import { VideoCanvasRenderer } from './VideoCanvasRenderer';
import { generateSampleSongTrack } from '../services/audioSynth';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Video as VideoIcon, 
  Music, 
  Mic, 
  Upload, 
  Cloud, 
  Sparkles, 
  Palette, 
  Type, 
  Sliders, 
  Download, 
  Save, 
  Folder, 
  Check, 
  Loader2, 
  AlertCircle,
  HelpCircle,
  Plus,
  Trash2,
  Maximize2,
  Zap,
  Clock,
  StopCircle,
  XCircle,
  Info,
  Film,
  Repeat,
  FileText,
  Image as ImageIcon
} from 'lucide-react';

interface SongToVideoStudioProps {
  onSaveToLibrary: (video: LibraryVideo) => Promise<void>;
  onOpenGoogleDrive: () => void;
  onOpenSongStory: (songTitle: string, songOrigin?: string) => void;
  initialSongTitle?: string;
  initialArtist?: string;
  folders: { id: string; name: string }[];
  importedMedia?: { blob: Blob; fileName: string; isAudio: boolean } | null;
  onClearImportedMedia?: () => void;
  appliedStoryVideo?: { url: string; theme: string } | null;
  onClearAppliedStoryVideo?: () => void;
  appliedStoryPhoto?: { photoId: string; title: string; imageUrl: string; downloadUrl: string } | null;
  onClearAppliedStoryPhoto?: () => void;
}

const LOCAL_THEMATIC_VIDEOS = [
  {
    id: 'sunset_romance',
    title: 'Atardecer y Recuerdos Románticos',
    tags: ['amor', 'romance', 'atardecer', 'playa', 'recuerdos', 'nostalgia', 'corazon', 'tristeza', 'balada', 'sentimiento', 'olvido', 'pasion', 'especial'],
  },
  {
    id: 'night_city',
    title: 'Ciudad Nocturna y Luces de Neón',
    tags: ['ciudad', 'noche', 'urbano', 'luces', 'calle', 'desvelo', 'ritmo', 'auto', 'carretera', 'pop', 'rap', 'trap', 'moderno'],
  },
  {
    id: 'travel_nature',
    title: 'Viaje en Carretera, Naturaleza y Libertad',
    tags: ['viaje', 'carretera', 'libertad', 'naturaleza', 'montana', 'paisaje', 'escapada', 'vida', 'destino', 'camino', 'horizonte'],
  },
  {
    id: 'stage_concert',
    title: 'Concierto y Luces de Escenario',
    tags: ['fiesta', 'energia', 'fuego', 'rock', 'baile', 'alegria', 'fuerza', 'pasion', 'concierto', 'bateria', 'guitarra', 'electrica'],
  },
  {
    id: 'party_celebration',
    title: 'Fiesta, Ritmo y Baile',
    tags: ['baile', 'fiesta', 'colores', 'alegria', 'ritmo', 'sabor', 'latino', 'amigos', 'celebracion', 'verano', 'cumbia', 'salsa', 'bailable'],
  },
  {
    id: 'calm_acoustic',
    title: 'Momento Acústico y Melódico',
    tags: ['guitarra', 'suave', 'paz', 'cafe', 'acustico', 'intimo', 'hogar', 'alma', 'tranquilidad', 'tiempo'],
  },
];

function matchLocalStoryTheme(title: string, artist: string, origin: string) {
  const combined = `${title} ${artist} ${origin}`.toLowerCase();
  let best = LOCAL_THEMATIC_VIDEOS[0];
  let bestScore = -1;
  for (const item of LOCAL_THEMATIC_VIDEOS) {
    let score = 0;
    for (const tag of item.tags) {
      if (combined.includes(tag)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  const cleanName = (title || 'video_cancion').replace(/[/\\?%*:|"<>]/g, '_');
  return {
    theme: best.title,
    videoUrl: `/api/video-stream?theme=${best.id}`,
    downloadUrl: `/api/video-download?theme=${best.id}&filename=${encodeURIComponent(cleanName + '_video_relacionado.mp4')}`,
  };
}

async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, retries = 2): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Error de red al conectar con el servidor');
}

export const SongToVideoStudio: React.FC<SongToVideoStudioProps> = ({
  onSaveToLibrary,
  onOpenGoogleDrive,
  onOpenSongStory,
  initialSongTitle = '',
  initialArtist = '',
  folders,
  importedMedia,
  onClearImportedMedia,
  appliedStoryVideo,
  onClearAppliedStoryVideo,
  appliedStoryPhoto,
  onClearAppliedStoryPhoto,
}) => {
  // Video and Song Metadata
  const [songTitle, setSongTitle] = useState(initialSongTitle || '');
  const [artist, setArtist] = useState(initialArtist || '');
  const [songOrigin, setSongOrigin] = useState<string>('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('root');

  // Story / Gallery Video or Chosen Story Photo State
  const [storyVideoUrl, setStoryVideoUrl] = useState<string | null>('/api/video-stream?theme=sunset_romance');
  const [storyVideoTheme, setStoryVideoTheme] = useState<string>('Atardecer y Recuerdos Románticos');
  const [storyVideoDownloadUrl, setStoryVideoDownloadUrl] = useState<string>('/api/video-download?theme=sunset_romance&filename=video_relacionado.mp4');
  const [galleryVideoBlob, setGalleryVideoBlob] = useState<Blob | null>(null);
  const [galleryVideoDuration, setGalleryVideoDuration] = useState<number>(0);
  const [galleryPhotos, setGalleryPhotos] = useState<{ blob?: Blob; url: string; name: string; photoId?: string; downloadUrl?: string }[]>([]);
  const [showStoryPhotoPicker, setShowStoryPhotoPicker] = useState<boolean>(false);
  const [storyPhotoCatalog, setStoryPhotoCatalog] = useState<{ id: string; title: string; category: string; previewUrl: string; downloadUrl: string }[]>([]);
  const [storyPhotoFilterCat, setStoryPhotoFilterCat] = useState<string>('Todas');
  const [storyPhotoSearch, setStoryPhotoSearch] = useState<string>('');
  const [videoSourceType, setVideoSourceType] = useState<'gallery' | 'story' | 'photo'>('story');
  const [isSearchingStoryVideo, setIsSearchingStoryVideo] = useState<boolean>(false);
  const [isFastRendering, setIsFastRendering] = useState<boolean>(false);
  const [fastRenderProgressText, setFastRenderProgressText] = useState<string>('');
  const backgroundStoryVideoRef = useRef<HTMLVideoElement | null>(null);
  const uploadedPhotosRef = useRef<{ blobs: (Blob | undefined)[]; fileIds: string[] }>({ blobs: [], fileIds: [] });

  // Audio and Media State
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioFileName, setAudioFileName] = useState<string>('');
  const [duration, setDuration] = useState<number>(30);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Styling Configuration
  const [style, setStyle] = useState<VideoStyleConfig>(defaultStyle);
  const [activeTab, setActiveTab] = useState<'style' | 'lyrics' | 'media'>('style');

  // Camera & Mic State
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // Synchronized Lyrics - automatically extracted and acoustically aligned to song pauses
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [rawLyricsInput, setRawLyricsInput] = useState<string>('');
  const [isSyncingLyrics, setIsSyncingLyrics] = useState<boolean>(false);
  const [lyricsSourceLabel, setLyricsSourceLabel] = useState<string>('');
  const [pausesDetectedCount, setPausesDetectedCount] = useState<number | null>(null);
  const [showQuickLyricsBox, setShowQuickLyricsBox] = useState<boolean>(false);
  const [isDictatingLyrics, setIsDictatingLyrics] = useState<boolean>(false);
  const [lyricOffsetSec, setLyricOffsetSec] = useState<number>(0);
  const [isTapSyncMode, setIsTapSyncMode] = useState<boolean>(false);
  const [tapSyncIndex, setTapSyncIndex] = useState<number>(0);
  const speechRecRef = useRef<any>(null);
  const lastSyncedRawRef = useRef<string>('');
  const syncSeqRef = useRef<number>(0);
  const lastSyncedAudioBlobRef = useRef<Blob | null>(null);
  const activeSyncPromiseRef = useRef<Promise<void> | null>(null);

  // Audio Processing Elements
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioDestStreamRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const uploadedAudioRef = useRef<{ blob: Blob | null; fileId: string | null }>({ blob: null, fileId: null });
  const uploadedGalleryRef = useRef<{ blob: Blob | null; fileId: string | null }>({ blob: null, fileId: null });

  // Canvas and Recording Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportSecondsElapsed, setExportSecondsElapsed] = useState<number>(0);
  const [accurateAudioDuration, setAccurateAudioDuration] = useState<number>(0);
  const [exportTargetSeconds, setExportTargetSeconds] = useState<number>(30);
  const exportIntervalRef = useRef<any>(null);
  const exportCancelledRef = useRef<boolean>(false);
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);
  const [exportedBlob, setExportedBlob] = useState<Blob | null>(null);
  const [exportedExtension, setExportedExtension] = useState<'mp4' | 'webm'>('mp4');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Nudge all lyric timestamps cleanly together (+2s / -2s / +0.5s / -0.5s / +0.2s / -0.2s)
  const handleNudgeAllLyrics = (delta: number) => {
    if (lyrics.length === 0) return;
    setLyrics((prev) =>
      prev.map((l) => ({
        ...l,
        time: Math.max(0, Math.round((l.time + delta) * 10) / 10),
        endTime: l.endTime !== undefined ? Math.max(0.5, Math.round((l.endTime + delta) * 10) / 10) : undefined,
      }))
    );
    setLyricOffsetSec((prev) => Math.round((prev + delta) * 10) / 10);
    setStatusMessage(`Sincronización ajustada ${delta > 0 ? `+${delta}s` : `${delta}s`} para todos los versos.`);
  };

  // Anchor first vocal entrance directly at the current playback second
  const handleAnchorVoiceStartHere = () => {
    const tNow = Math.max(0, Math.round(((audioRef.current?.currentTime ?? currentTime) || 0) * 10) / 10);
    const plain = rawLyricsInput.trim() || lyrics.map((l) => l.text).join('\n');
    if (!plain) {
      setStatusMessage('Pega o carga la letra primero para anclarla a la voz del cantante.');
      return;
    }
    handleAiSyncLyrics(plain, false, uploadedAudioRef.current.fileId, undefined, undefined, tNow);
  };

  // Re-anchor ONLY the remaining verses from the current moment forward (fixes drift after instrumental breaks/pauses without touching synced intro)
  const handleReanchorRemainingHere = () => {
    if (lyrics.length === 0) return;
    const tNow = Math.max(0, Math.round(((audioRef.current?.currentTime ?? currentTime) || 0) * 10) / 10);
    const songDur = accurateAudioDuration > 0 ? accurateAudioDuration : (duration || 180);

    let lastStartedIdx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time <= tNow + 0.4) {
        lastStartedIdx = i;
      } else {
        break;
      }
    }

    let targetIdx = Math.max(0, lastStartedIdx);
    if (lastStartedIdx >= 0) {
      const prevEnd = lyrics[lastStartedIdx].endTime ?? (lyrics[lastStartedIdx + 1]?.time ?? lyrics[lastStartedIdx].time + 3.2);
      // If that verse already finished before the instrumental break/pause, align the NEXT upcoming verse to tNow
      if (prevEnd < tNow - 0.8 && lastStartedIdx + 1 < lyrics.length) {
        targetIdx = lastStartedIdx + 1;
      }
    }

    const anchorOldTime = lyrics[targetIdx].time;
    const delta = Math.round((tNow - anchorOldTime) * 10) / 10;

    setLyrics((prev) => {
      const next = prev.map((l) => ({ ...l }));
      if (targetIdx > 0 && next[targetIdx - 1]) {
        next[targetIdx - 1].endTime = Math.max(
          next[targetIdx - 1].time + 0.4,
          Math.min(next[targetIdx - 1].endTime ?? tNow - 0.1, Math.round((tNow - 0.1) * 10) / 10)
        );
      }

      const lastOldTime = next[next.length - 1].time;
      const neededEnd = lastOldTime + delta;
      const availableSpan = Math.max(1.2, songDur - tNow - 0.4);
      const oldSpan = Math.max(0.5, lastOldTime - anchorOldTime);
      const needsCompression = neededEnd > songDur - 0.4 && next.length - 1 > targetIdx;
      const scale = needsCompression ? Math.min(1, availableSpan / oldSpan) : 1;

      for (let i = targetIdx; i < next.length; i++) {
        const minAllowed = i > 0 ? next[i - 1].time + 0.5 : 0;
        const shifted = i === targetIdx
          ? tNow
          : tNow + (next[i].time - anchorOldTime) * scale;
        next[i].time = Math.min(songDur - 0.3, Math.max(minAllowed, Math.round(shifted * 10) / 10));
      }

      for (let i = targetIdx; i < next.length; i++) {
        const nextLineTime = i < next.length - 1 ? next[i + 1].time : songDur;
        const origDur = next[i].endTime ? Math.max(0.7, (next[i].endTime! - prev[i].time) * scale) : 3.0;
        next[i].endTime = Math.min(
          i < next.length - 1 ? Math.max(next[i].time + 0.5, Math.round((nextLineTime - 0.1) * 10) / 10) : songDur,
          Math.round((next[i].time + origDur) * 10) / 10
        );
      }
      return next;
    });

    const snippet = lyrics[targetIdx].text.slice(0, 32);
    setLyricsSourceLabel('Re-anclado tras pausa');
    setStatusMessage(`Verso ${targetIdx + 1} ("${snippet}...") y el resto re-anclados en ${formatTime(tNow)} sin mover el inicio.`);
  };

  // Live Tap-to-Sync: stamp exact entrance of each verse while listening to the singer
  const handleStampTapSyncVerse = () => {
    if (lyrics.length === 0) return;
    const idx = Math.min(lyrics.length - 1, Math.max(0, tapSyncIndex));
    const tStamp = Math.max(0, Math.round(((audioRef.current?.currentTime ?? currentTime) || 0) * 10) / 10);
    const songDur = accurateAudioDuration > 0 ? accurateAudioDuration : (duration || 180);

    setLyrics((prev) => {
      const next = prev.map((l) => ({ ...l }));
      if (idx > 0 && next[idx - 1]) {
        next[idx - 1].endTime = Math.max(next[idx - 1].time + 0.5, Math.round((tStamp - 0.1) * 10) / 10);
      }
      if (next[idx]) {
        next[idx].time = idx > 0 ? Math.max(next[idx - 1].time + 0.5, tStamp) : tStamp;
        // Shift subsequent un-stamped lines proportionally forward so preview remains coherent
        const oldNextStart = idx < next.length - 1 ? next[idx + 1].time : songDur;
        if (oldNextStart <= next[idx].time + 0.6 && idx < next.length - 1) {
          const remainCount = next.length - idx;
          const remainSpan = Math.max(remainCount * 1.2, songDur - next[idx].time - 0.5);
          const step = remainSpan / remainCount;
          for (let j = idx + 1; j < next.length; j++) {
            next[j].time = Math.min(songDur - 0.4, Math.round((next[idx].time + (j - idx) * step) * 10) / 10);
          }
        }
        next[idx].endTime = idx < next.length - 1
          ? Math.max(next[idx].time + 0.6, Math.round((next[idx + 1].time - 0.1) * 10) / 10)
          : Math.min(songDur, next[idx].time + 4);
      }
      return next;
    });
    setLyricsSourceLabel('Marcada con la voz en vivo');

    if (idx + 1 >= lyrics.length) {
      setIsTapSyncMode(false);
      setTapSyncIndex(0);
      setStatusMessage('¡Todos los versos quedaron sincronizados con la voz del cantante!');
    } else {
      setTapSyncIndex(idx + 1);
    }
  };

  const handleToggleTapSyncMode = async () => {
    if (isTapSyncMode) {
      setIsTapSyncMode(false);
      return;
    }
    // Prepare parsed lines if lyrics array is empty but rawLyricsInput has text
    if (lyrics.length === 0 && rawLyricsInput.trim()) {
      await handleAiSyncLyrics(rawLyricsInput.trim(), true);
    }
    const tNow = audioRef.current?.currentTime ?? currentTime;
    let startIdx = 0;
    if (tNow > 4 && lyrics.length > 0) {
      let lastIdx = 0;
      for (let i = 0; i < lyrics.length; i++) {
        if (lyrics[i].time <= tNow + 0.5) lastIdx = i;
        else break;
      }
      const endOfLast = lyrics[lastIdx].endTime ?? lyrics[lastIdx].time + 3.0;
      startIdx = endOfLast < tNow - 0.8 && lastIdx + 1 < lyrics.length ? lastIdx + 1 : lastIdx;
    }

    setTapSyncIndex(startIdx);
    setIsTapSyncMode(true);
    if (audioRef.current && audioUrl) {
      ensureAudioContext();
      if (tNow <= 4) {
        audioRef.current.currentTime = 0;
        setCurrentTime(0);
      }
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
    setStatusMessage(
      tNow > 4
        ? `Modo Marcar activo desde el verso ${startIdx + 1} (${formatTime(tNow)}): pulsa "Marcar Verso" o Espacio justo cuando entre cada frase.`
        : 'Modo Marcar con la Voz activo: pulsa "Marcar Verso" o la Barra Espaciadora justo cuando entre cada frase.'
    );
  };

  useEffect(() => {
    if (!isTapSyncMode) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (ev.code === 'Space') {
        ev.preventDefault();
        handleStampTapSyncVerse();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTapSyncMode, tapSyncIndex, lyrics]);

  // Time formatter helper
  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Decode exact duration from audio buffer to guarantee the video matches the song duration precisely
  const calculateExactAudioDuration = async (blob: Blob): Promise<number> => {
    try {
      const arrayBuffer = await blob.slice(0).arrayBuffer();
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      const exactDur = decoded.duration;
      ctx.close();
      if (exactDur && isFinite(exactDur) && exactDur > 0) {
        setAccurateAudioDuration(exactDur);
        setDuration(exactDur);
        setExportTargetSeconds(exactDur);
        return exactDur;
      }
    } catch (e) {
      console.warn('AudioContext decodeAudioData fallback:', e);
    }
    return 0;
  };

  // Handle external media imports (e.g., from Google Drive: songs, photos, or videos)
  useEffect(() => {
    if (importedMedia) {
      const url = URL.createObjectURL(importedMedia.blob);
      const cleanName = importedMedia.fileName.replace(/\.[^/.]+$/, '');
      const isImageFile = !importedMedia.isAudio && (
        importedMedia.blob.type.startsWith('image/') ||
        /\.(jpg|jpeg|png|webp|gif|bmp|heic)$/i.test(importedMedia.fileName)
      );
      const isVideoFile = !importedMedia.isAudio && !isImageFile && (
        importedMedia.blob.type.startsWith('video/') ||
        /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(importedMedia.fileName)
      );

      if (isImageFile) {
        setStoryVideoUrl(null);
        setGalleryVideoBlob(null);
        setGalleryVideoDuration(0);
        setGalleryPhotos([{ blob: importedMedia.blob, url, name: importedMedia.fileName }]);
        uploadedPhotosRef.current = { blobs: [], fileIds: [] };
        setVideoSourceType('photo');
        setStoryVideoTheme(cleanName);
        setCameraActive(false);
        setStyle((prev) => ({ ...prev, visualizerTheme: 'camera-live' }));
        setStatusMessage(`Foto "${importedMedia.fileName}" escogida para la historia de tu canción.`);
      } else if (isVideoFile) {
        // Load as background looping video without wiping any loaded song
        setGalleryPhotos([]);
        setStoryVideoUrl(url);
        setGalleryVideoBlob(importedMedia.blob);
        setVideoSourceType('gallery');
        setStoryVideoTheme(cleanName);
        setCameraActive(false);
        setStyle((prev) => ({ ...prev, visualizerTheme: 'camera-live' }));
        setStatusMessage(`Video "${importedMedia.fileName}" cargado como fondo. Se repetirá automáticamente hasta durar lo mismo que tu canción.`);
      } else {
        // Load as the song/audio track
        setSongTitle((prev) => prev.trim() ? prev : cleanName);
        if (!songTitle.trim()) setSongTitle(cleanName);
        setAudioFileName(importedMedia.fileName);
        setAudioBlob(importedMedia.blob);
        setAudioUrl(url);
        uploadedAudioRef.current = { blob: importedMedia.blob, fileId: null };

        calculateExactAudioDuration(importedMedia.blob).then((exactDur) => {
          const finalDur = exactDur > 0 ? exactDur : 180;
          if (exactDur > 0) {
            setStatusMessage(
              videoSourceType === 'gallery' || videoSourceType === 'photo'
                ? `Canción "${importedMedia.fileName}" (${formatTime(exactDur)}) incorporada. Sincronizando letra con la voz del cantante...`
                : `Canción "${importedMedia.fileName}" cargada (${formatTime(exactDur)}). Sincronizando letra con la voz del cantante...`
            );
          } else {
            setStatusMessage(`Canción "${importedMedia.fileName}" cargada. Buscando letra...`);
          }
          extractLyricsForLoadedSong(importedMedia.blob, importedMedia.fileName, finalDur, cleanName, artist);
        });

        // Only auto-match a story video if the user hasn't picked a gallery photo or video
        if (videoSourceType !== 'gallery' && videoSourceType !== 'photo') {
          handleAutoMatchStoryVideo(cleanName);
        }
      }

      if (onClearImportedMedia) onClearImportedMedia();
    }
  }, [importedMedia]);

  // Sync applied story video from modal or external props
  useEffect(() => {
    if (appliedStoryVideo && appliedStoryVideo.url) {
      setGalleryPhotos([]);
      setStoryVideoUrl(appliedStoryVideo.url);
      setGalleryVideoBlob(null);
      setVideoSourceType('story');
      setStoryVideoTheme(appliedStoryVideo.theme);
      setStoryVideoDownloadUrl(appliedStoryVideo.url.replace('/api/video-stream', '/api/video-download'));
      setCameraActive(false);
      setStyle((prev) => ({ ...prev, visualizerTheme: 'camera-live' }));
      setStatusMessage(`Video temático "${appliedStoryVideo.theme}" asignado como fondo.`);
      if (backgroundStoryVideoRef.current) {
        backgroundStoryVideoRef.current.load();
        backgroundStoryVideoRef.current.play().catch(() => {});
      }
      if (onClearAppliedStoryVideo) onClearAppliedStoryVideo();
    }
  }, [appliedStoryVideo]);

  // Sync applied story photo (person, landscape, scene chosen from explorer)
  useEffect(() => {
    if (appliedStoryPhoto && appliedStoryPhoto.imageUrl) {
      setStoryVideoUrl(null);
      setGalleryVideoBlob(null);
      setGalleryVideoDuration(0);
      setGalleryPhotos([
        {
          url: appliedStoryPhoto.imageUrl,
          name: `${appliedStoryPhoto.title}.jpg`,
          photoId: appliedStoryPhoto.photoId,
          downloadUrl: appliedStoryPhoto.downloadUrl,
        },
      ]);
      uploadedPhotosRef.current = { blobs: [], fileIds: [] };
      setVideoSourceType('photo');
      setStoryVideoTheme(appliedStoryPhoto.title);
      setCameraActive(false);
      setStyle((prev) => ({ ...prev, visualizerTheme: 'camera-live' }));
      setStatusMessage(`Foto "${appliedStoryPhoto.title}" escogida para la historia de tu canción.`);
      if (onClearAppliedStoryPhoto) onClearAppliedStoryPhoto();
    }
  }, [appliedStoryPhoto]);

  // Load curated story photos when Studio photo picker is opened
  useEffect(() => {
    if (!showStoryPhotoPicker) return;
    const params = new URLSearchParams();
    const q = storyPhotoSearch.trim() || songTitle.trim();
    if (q) params.set('q', q);
    if (storyPhotoFilterCat && storyPhotoFilterCat !== 'Todas') params.set('category', storyPhotoFilterCat);
    fetchWithRetry(`/api/story-photos?${params.toString()}`, undefined, 1)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.photos)) {
          setStoryPhotoCatalog(d.photos);
        }
      })
      .catch(() => {});
  }, [showStoryPhotoPicker, storyPhotoFilterCat, storyPhotoSearch]);

  // Auto match video resembling song story or theme from API (with retry + deterministic fallback)
  const handleAutoMatchStoryVideo = async (overrideTitle?: string) => {
    setIsSearchingStoryVideo(true);
    const searchTitle = overrideTitle || songTitle || 'Música';
    setStatusMessage(`Buscando video que se asemeje a "${searchTitle}"...`);
    try {
      const res = await fetchWithRetry('/api/search-story-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: searchTitle,
          artist,
          origin: songOrigin,
        }),
      }, 2);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.videoUrl) {
        setGalleryPhotos([]);
        setStoryVideoUrl(data.videoUrl);
        setGalleryVideoBlob(null);
        setVideoSourceType('story');
        setStoryVideoTheme(data.theme || 'Video Temático');
        setStoryVideoDownloadUrl(data.downloadUrl || data.videoUrl.replace('/api/video-stream', '/api/video-download'));
        setCameraActive(false);
        setStyle((prev) => ({ ...prev, visualizerTheme: 'camera-live' }));
        setStatusMessage(`¡Video seleccionado que se aproxima a la canción: ${data.theme}!`);
        if (backgroundStoryVideoRef.current) {
          backgroundStoryVideoRef.current.load();
          backgroundStoryVideoRef.current.play().catch(() => {});
        }
      }
    } catch (e: any) {
      console.warn('Auto match story video network fallback:', e?.message || e);
      const localMatch = matchLocalStoryTheme(searchTitle, artist, songOrigin);
      setGalleryPhotos([]);
      setStoryVideoUrl(localMatch.videoUrl);
      setGalleryVideoBlob(null);
      setVideoSourceType('story');
      setStoryVideoTheme(localMatch.theme);
      setStoryVideoDownloadUrl(localMatch.downloadUrl);
      setCameraActive(false);
      setStyle((prev) => ({ ...prev, visualizerTheme: 'camera-live' }));
      setStatusMessage(`¡Video seleccionado que se aproxima a la canción: ${localMatch.theme}!`);
      if (backgroundStoryVideoRef.current) {
        backgroundStoryVideoRef.current.load();
        backgroundStoryVideoRef.current.play().catch(() => {});
      }
    } finally {
      setIsSearchingStoryVideo(false);
    }
  };

  // Download background video OR background photo OR thematic photo
  const handleDownloadStoryVideo = (asPhoto = false) => {
    const cleanTitle = (storyVideoTheme || songTitle || 'fondo_musical').replace(/[/\\?%*:|"<>]/g, '_');

    if (videoSourceType === 'photo' && galleryPhotos.length > 0) {
      galleryPhotos.forEach((p, idx) => {
        const a = document.createElement('a');
        const dlTarget = p.photoId
          ? `/api/photo-download?photoId=${encodeURIComponent(p.photoId)}&download=1&filename=${encodeURIComponent(cleanTitle + (galleryPhotos.length > 1 ? `_foto_${idx + 1}` : '') + '.jpg')}`
          : (p.downloadUrl || p.url);
        a.href = dlTarget;
        a.download = galleryPhotos.length > 1 ? `${cleanTitle}_foto_${idx + 1}.jpg` : (p.name || `${cleanTitle}.jpg`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
      setStatusMessage(`Descargando ${galleryPhotos.length > 1 ? `${galleryPhotos.length} fotos escogidas` : 'tu foto escogida'}...`);
      return;
    }

    if (asPhoto && storyVideoUrl) {
      let themeParam = 'sunset_romance';
      try {
        const u = new URL(storyVideoUrl, window.location.origin);
        themeParam = u.searchParams.get('theme') || 'sunset_romance';
      } catch { /* ignore */ }
      const a = document.createElement('a');
      a.href = `/api/photo-download?theme=${encodeURIComponent(themeParam)}&download=1&filename=${encodeURIComponent(cleanTitle + '_foto.jpg')}`;
      a.download = `${cleanTitle}_foto.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setStatusMessage(`Descargando foto relacionada "${cleanTitle}_foto.jpg"...`);
      return;
    }

    if (videoSourceType === 'gallery' && storyVideoUrl) {
      const a = document.createElement('a');
      a.href = storyVideoUrl;
      a.download = `${cleanTitle}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setStatusMessage(`Descargando "${cleanTitle}.mp4"...`);
      return;
    }
    const downloadEndpoint = storyVideoDownloadUrl || (storyVideoUrl ? storyVideoUrl.replace('/api/video-stream', '/api/video-download') : '/api/video-download?theme=sunset_romance');
    const fullDownloadUrl = `${downloadEndpoint}&filename=${encodeURIComponent(cleanTitle + '_video.mp4')}`;
    const a = document.createElement('a');
    a.href = fullDownloadUrl;
    a.download = `${cleanTitle}_video.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatusMessage(`Descargando video relacionado "${cleanTitle}_video.mp4"...`);
  };

  // Download current Studio visual frame (photo + title + lyric) as HD PNG photo
  const handleDownloadCoverPhoto = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      const cleanTitle = (songTitle.trim() || storyVideoTheme || 'portada_musical').replace(/[/\\?%*:|"<>]/g, '_');
      a.href = dataUrl;
      a.download = `${cleanTitle}_foto.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setStatusMessage(`¡Foto "${cleanTitle}_foto.png" descargada con tu portada y letra!`);
    } catch (err) {
      console.error(err);
      setStatusMessage('No se pudo exportar la foto.');
    }
  };

  // Set up Audio Context and Analyser when audio starts
  const ensureAudioContext = () => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;

      if (audioRef.current) {
        try {
          const source = ctx.createMediaElementSource(audioRef.current);
          source.connect(analyser);
          analyser.connect(ctx.destination);
          audioSourceNodeRef.current = source;
        } catch (e) {
          console.warn('Audio node already connected or cors issue:', e);
        }
      }

      audioContextRef.current = ctx;
      analyserRef.current = analyser;
    }

    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const handlePlayPause = async () => {
    if (!audioRef.current) return;
    ensureAudioContext();

    if (isPlaying) {
      audioRef.current.pause();
      if (backgroundStoryVideoRef.current) {
        backgroundStoryVideoRef.current.pause();
      }
      setIsPlaying(false);
    } else {
      try {
        await audioRef.current.play();
        if (backgroundStoryVideoRef.current) {
          backgroundStoryVideoRef.current.play().catch(() => {});
        }
        setIsPlaying(true);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const d = audioRef.current.duration;
      if (d && !isNaN(d) && isFinite(d) && d > 0) {
        if (!accurateAudioDuration || accurateAudioDuration === 0) {
          setDuration(d);
          setExportTargetSeconds(d);
        }
      }
    }
  };

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
      if (backgroundStoryVideoRef.current && backgroundStoryVideoRef.current.duration) {
        backgroundStoryVideoRef.current.currentTime = time % backgroundStoryVideoRef.current.duration;
      }
    }
  };

  // Lightweight UI progress & background video keeper while audio plays (VideoCanvasRenderer reads audio.currentTime at 60fps directly)
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      const audio = audioRef.current;
      if (audio && !audio.seeking) {
        setCurrentTime(audio.currentTime);
        const bgVid = backgroundStoryVideoRef.current;
        if (bgVid && !cameraActive && !audio.paused && bgVid.paused) {
          bgVid.play().catch(() => {});
        }
      }
    }, 120);
    return () => clearInterval(timer);
  }, [isPlaying, cameraActive]);

  // Toggle Camera
  const toggleCamera = async () => {
    setCameraError(null);
    if (cameraActive) {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
      }
      setCameraActive(false);
      setStyle((prev) => ({ ...prev, visualizerTheme: 'spectrum-bars' }));
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: false, // audio comes from the music track
        });
        cameraStreamRef.current = stream;
        if (videoElementRef.current) {
          videoElementRef.current.srcObject = stream;
          videoElementRef.current.play();
        }
        setCameraActive(true);
        setStyle((prev) => ({ ...prev, visualizerTheme: 'camera-live' }));
        setStatusMessage('Cámara activada como fondo del video musical');
      } catch (err: any) {
        console.error(err);
        setCameraError('No se pudo acceder a la cámara. Verifica los permisos.');
      }
    }
  };

  // Dedicated upload for videos OR photos (1 or multiple) from device gallery
  const handleGalleryVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    if (fileList.length === 0) return;

    const imageFiles = fileList.filter(
      (f) => f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp|heic)$/i.test(f.name)
    );
    const videoFile = fileList.find(
      (f) => f.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(f.name)
    );

    if (imageFiles.length > 0 && !videoFile) {
      const photoItems = imageFiles.map((file) => ({
        blob: file,
        url: URL.createObjectURL(file),
        name: file.name,
      }));
      setStoryVideoUrl(null);
      setGalleryVideoBlob(null);
      setGalleryVideoDuration(0);
      setGalleryPhotos(photoItems);
      uploadedPhotosRef.current = { blobs: [], fileIds: [] };
      setVideoSourceType('photo');
      const cleanName = photoItems[0].name.replace(/\.[^/.]+$/, '');
      setStoryVideoTheme(
        photoItems.length > 1 ? `${photoItems.length} fotos de tu galería` : cleanName
      );
      setCameraActive(false);
      setStyle((prev) => ({ ...prev, visualizerTheme: 'camera-live' }));
      setStatusMessage(
        photoItems.length > 1
          ? `${photoItems.length} fotos escogidas para acompañar toda la historia de tu canción.`
          : `Foto "${photoItems[0].name}" escogida para la historia de tu canción.`
      );
    } else {
      const file = videoFile || fileList[0];
      const url = URL.createObjectURL(file);
      const cleanName = file.name.replace(/\.[^/.]+$/, '');
      setGalleryPhotos([]);
      setStoryVideoUrl(url);
      setGalleryVideoBlob(file);
      setVideoSourceType('gallery');
      setStoryVideoTheme(cleanName);
      setCameraActive(false);
      setStyle((prev) => ({ ...prev, visualizerTheme: 'camera-live' }));
      setStatusMessage(`Video de tu galería "${file.name}" cargado. Se repetirá automáticamente hasta durar igual a tu canción.`);

      if (backgroundStoryVideoRef.current) {
        backgroundStoryVideoRef.current.load();
        backgroundStoryVideoRef.current.play().catch(() => {});
      }
    }
    e.target.value = '';
  };

  // Resilient chunked ArrayBuffer uploader (1.5 MB chunks with retries to avoid proxy body size limits)
  const uploadBlobInChunks = async (
    blob: Blob,
    ext: string,
    onProgress?: (pct: number) => void
  ): Promise<string> => {
    const CHUNK_SIZE = 1536 * 1024; // 1.5 MB
    const totalSize = Math.max(1, blob.size);
    const totalChunks = Math.max(1, Math.ceil(totalSize / CHUNK_SIZE));
    let fileId = '';

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(blob.size, start + CHUNK_SIZE);
      const chunkBuffer = await blob.slice(start, end).arrayBuffer();

      const endpoint = i === 0
        ? `/api/upload-temp-media?ext=${encodeURIComponent(ext)}`
        : `/api/upload-temp-media?fileId=${encodeURIComponent(fileId)}&append=1`;

      let lastErr: any = null;
      let uploadedOk = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: chunkBuffer,
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const data = await res.json();
          if (i === 0 && data.fileId) {
            fileId = data.fileId;
          }
          uploadedOk = true;
          break;
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        }
      }

      if (!uploadedOk) {
        throw lastErr || new Error('No se pudo subir el archivo al servidor.');
      }

      if (onProgress) {
        onProgress(Math.round(((i + 1) / totalChunks) * 100));
      }
    }

    return fileId;
  };

  // Upload audio once & cache fileId for both lyric extraction and MP4 rendering
  const ensureUploadedAudioId = async (blob: Blob, fileName: string): Promise<string | null> => {
    if (uploadedAudioRef.current.blob === blob && uploadedAudioRef.current.fileId) {
      return uploadedAudioRef.current.fileId;
    }
    try {
      const ext = (fileName || '').match(/\.[a-zA-Z0-9]+$/)?.[0] || '.mp3';
      const fileId = await uploadBlobInChunks(blob, ext);
      if (fileId) {
        uploadedAudioRef.current = { blob, fileId };
        return fileId;
      }
    } catch {
      // ignore upload failures during background auto-extraction
    }
    return null;
  };

  // Automatically extract or fetch real synced lyrics for the active song
  const extractLyricsForLoadedSong = async (
    blobOverride?: Blob | null,
    fileNameOverride?: string,
    durOverride?: number,
    titleOverride?: string,
    artistOverride?: string
  ) => {
    const seq = ++syncSeqRef.current;
    const activeBlob = blobOverride ?? audioBlob;
    const activeFileName = fileNameOverride ?? audioFileName;
    const activeTitle = (titleOverride ?? songTitle).trim();
    const activeArtist = (artistOverride ?? artist).trim();
    const activeDur = durOverride && durOverride > 0
      ? durOverride
      : (accurateAudioDuration > 0 ? accurateAudioDuration : (duration || 180));

    const runTask = (async () => {
      setIsSyncingLyrics(true);
      try {
        let audioFileId: string | null = null;
        if (activeBlob) {
          audioFileId = await ensureUploadedAudioId(activeBlob, activeFileName);
        }

        if (seq !== syncSeqRef.current) return;

        // If the user already pasted their own lyrics, align those lyrics directly instead of searching unrelated web lyrics
        const userPasted = rawLyricsInput.trim();
        if (userPasted) {
          await handleAiSyncLyrics(userPasted, true, audioFileId, activeDur, activeBlob);
          return;
        }

        const res = await fetchWithRetry('/api/extract-song-lyrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioFileId,
            songTitle: activeTitle,
            artist: activeArtist,
            fileName: activeFileName,
            durationSeconds: activeDur,
          }),
        }, 2);
        if (!res.ok) throw new Error('Error al buscar letra');
        const data = await res.json();

        if (seq !== syncSeqRef.current) return;

        if (data.detectedArtist && !activeArtist) {
          setArtist(data.detectedArtist);
        }
        if (data.detectedTitle && (!songTitle.trim() || songTitle === activeFileName.replace(/\.[^/.]+$/, ''))) {
          setSongTitle(data.detectedTitle);
        }

        if (data.lyrics && Array.isArray(data.lyrics) && data.lyrics.length > 0) {
          const plainOut = (data.rawPlain || data.lyrics.map((l: LyricLine) => l.text).join('\n')).trim();
          lastSyncedRawRef.current = plainOut;
          lastSyncedAudioBlobRef.current = activeBlob || null;
          setLyricOffsetSec(0);
          setLyrics(data.lyrics);
          setRawLyricsInput(plainOut);
          const pauses = typeof data.pausesDetected === 'number' ? data.pausesDetected : null;
          setPausesDetectedCount(pauses);

          const sourceMap: Record<string, string> = {
            'id3-embedded': 'Etiqueta del audio + pausas',
            'gemini-audio-transcribe': 'Escuchada del audio con IA',
            'lrclib-synced': 'LRC exacta + pausas reales',
            'lrclib-plain': 'Sincronizada automáticamente al audio',
          };
          setLyricsSourceLabel(sourceMap[data.source] || 'Auto-sincronizada con la voz');
          setShowQuickLyricsBox(false);
          const pauseSummary = pauses && pauses > 0 ? ` · ${pauses} pausas detectadas` : '';
          setStatusMessage(`¡Letra sincronizada automáticamente (${data.lyrics.length} versos${pauseSummary})! Corre estable desde el inicio.`);
        } else {
          setPausesDetectedCount(null);
          setLyricsSourceLabel('');
          setShowQuickLyricsBox(true);
          setStatusMessage('No se halló letra automática para esta canción. Pégala en el panel todo-en-uno para sincronizarla con la voz.');
        }
      } catch (e) {
        console.warn('Lyric extraction warning:', e);
      } finally {
        if (seq === syncSeqRef.current) {
          setIsSyncingLyrics(false);
        }
      }
    })();

    activeSyncPromiseRef.current = runTask;
    await runTask;
  };

  // Import .lrc or .txt lyrics file directly from device (automatically aligned with song pauses)
  const handleLyricsFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsSyncingLyrics(true);
    try {
      const text = await file.text();
      if (!text.trim()) return;
      lastSyncedRawRef.current = text.trim();
      lastSyncedAudioBlobRef.current = audioBlob;
      setRawLyricsInput(text);
      const songDur = accurateAudioDuration > 0 ? accurateAudioDuration : (duration || 180);
      let audioFileId: string | null = null;
      if (audioBlob) {
        audioFileId = await ensureUploadedAudioId(audioBlob, audioFileName);
      }
      const res = await fetchWithRetry('/api/extract-song-lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioFileId,
          songTitle: songTitle.trim(),
          artist: artist.trim(),
          fileName: audioFileName,
          rawLyrics: text,
          durationSeconds: songDur,
        }),
      }, 2);
      const data = await res.json();
      if (data.lyrics && data.lyrics.length > 0) {
        const pauses = typeof data.pausesDetected === 'number' ? data.pausesDetected : null;
        setPausesDetectedCount(pauses);
        setLyricOffsetSec(0);
        setLyrics(data.lyrics);
        setLyricsSourceLabel(
          file.name.toLowerCase().endsWith('.lrc')
            ? 'Archivo .LRC + pausas'
            : (pauses && pauses > 0 ? `Auto-adaptada (${pauses} pausas)` : 'Auto-sincronizada al audio')
        );
        setShowQuickLyricsBox(false);
        const pauseInfo = pauses && pauses > 0 ? ` adaptada a ${pauses} pausas reales` : '';
        setStatusMessage(`¡Letra de "${file.name}" (${data.lyrics.length} versos)${pauseInfo}! Corre en sincronía automática.`);
      }
    } catch (err) {
      console.warn('Lyrics file upload warning:', err);
      setStatusMessage('No se pudo leer el archivo de letra.');
    } finally {
      setIsSyncingLyrics(false);
      e.target.value = '';
    }
  };

  // Live voice dictation / sing-along capture using Web Speech Recognition
  const toggleLiveLyricDictation = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      setStatusMessage('Tu navegador no soporta dictado directo; pega la letra o sube un archivo .lrc/.txt.');
      return;
    }

    if (isDictatingLyrics && speechRecRef.current) {
      try { speechRecRef.current.stop(); } catch { /* ignore */ }
      setIsDictatingLyrics(false);
      return;
    }

    const recognition = new SpeechRec();
    recognition.lang = 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const phrase = String(event.results[i][0]?.transcript || '').trim();
          if (phrase) {
            const stamp = Math.round(((audioRef.current?.currentTime ?? currentTime) || 0) * 10) / 10;
            const formatted = phrase.charAt(0).toUpperCase() + phrase.slice(1);
            setLyrics((prev) => [
              ...prev,
              { id: `voice-${Date.now()}-${i}`, time: stamp, text: formatted }
            ].sort((a, b) => a.time - b.time));
            setRawLyricsInput((prev) => (prev ? `${prev}\n${formatted}` : formatted));
            setLyricsSourceLabel('Capturada en vivo');
          }
        }
      }
    };

    recognition.onerror = () => {
      setIsDictatingLyrics(false);
    };
    recognition.onend = () => {
      setIsDictatingLyrics(false);
    };

    speechRecRef.current = recognition;
    recognition.start();
    setIsDictatingLyrics(true);
    setStatusMessage('Micrófono activo: canta o dicta los versos mientras suena la canción para marcarlos al instante.');
  };

  // File upload for song / audio from device
  const handleLocalAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
    if (!songTitle.trim()) {
      setSongTitle(cleanTitle);
    }
    setAudioFileName(file.name);
    setAudioBlob(file);
    setAudioUrl(url);
    setIsPlaying(false);
    uploadedAudioRef.current = { blob: file, fileId: null };

    calculateExactAudioDuration(file).then((exactDur) => {
      const finalDur = exactDur > 0 ? exactDur : 180;
      if (exactDur > 0) {
        setStatusMessage(
          videoSourceType === 'gallery' || videoSourceType === 'photo'
            ? `Canción "${file.name}" (${formatTime(exactDur)}) incorporada. Sincronizando letra con la voz...`
            : `Canción "${file.name}" cargada (${formatTime(exactDur)}). Sincronizando letra con la voz...`
        );
      } else {
        setStatusMessage(`Canción "${file.name}" cargada. Buscando su letra...`);
      }
      extractLyricsForLoadedSong(file, file.name, finalDur, songTitle.trim() || cleanTitle, artist);
    });

    if (videoSourceType !== 'gallery' && videoSourceType !== 'photo') {
      handleAutoMatchStoryVideo(cleanTitle);
    }
    e.target.value = '';
  };

  // Automatic Acoustic-Adaptive Lyrics Sync (detects singing vs pauses directly from the audio track)
  const handleAiSyncLyrics = async (
    overrideRawText?: string,
    silent = false,
    preUploadedAudioId?: string | null,
    durOverride?: number,
    blobOverride?: Blob | null,
    vocalStartOffsetSec = 0
  ) => {
    const textToSync = (typeof overrideRawText === 'string' ? overrideRawText : rawLyricsInput).trim();
    if (!textToSync) {
      await extractLyricsForLoadedSong();
      return;
    }

    const activeAudio = blobOverride ?? audioBlob;
    const seq = ++syncSeqRef.current;
    lastSyncedRawRef.current = textToSync;
    lastSyncedAudioBlobRef.current = activeAudio;
    setIsSyncingLyrics(true);
    if (!silent) {
      setStatusMessage(
        vocalStartOffsetSec > 0
          ? `Anclando entrada de voz en ${formatTime(vocalStartOffsetSec)} y alineando todos los versos...`
          : 'Analizando voz del cantante y pausas para sincronizar sin saltos...'
      );
    }
    const runTask = (async () => {
      try {
        const songDur = durOverride && durOverride > 0
          ? durOverride
          : (accurateAudioDuration > 0 ? accurateAudioDuration : (duration || 180));
        let audioFileId = preUploadedAudioId ?? null;
        if (!audioFileId && activeAudio) {
          audioFileId = await ensureUploadedAudioId(activeAudio, audioFileName);
        }

        if (seq !== syncSeqRef.current) return;

        const res = await fetchWithRetry('/api/ai-sync-lyrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioFileId,
            songTitle: songTitle || 'Canción',
            artist,
            rawLyrics: textToSync,
            durationSeconds: songDur,
            vocalStartOffsetSec,
          }),
        }, 2);

        if (!res.ok) throw new Error('Error al sincronizar');
        const data = await res.json();
        if (seq !== syncSeqRef.current) return;

        if (data.lyrics && Array.isArray(data.lyrics) && data.lyrics.length > 0) {
          const pauses = typeof data.pausesDetected === 'number' ? data.pausesDetected : null;
          setPausesDetectedCount(pauses);
          setLyricOffsetSec(0);
          setLyrics(data.lyrics);
          const lrcNote = data.source === 'lrc-voice-matched' ? 'LRC exacta con la voz' : null;
          setLyricsSourceLabel(
            lrcNote || (pauses && pauses > 0 ? `Sincronizada a la voz (${pauses} pausas)` : 'Sincronizada a la voz')
          );
          if (!silent) {
            setShowQuickLyricsBox(false);
          }
          const pauseInfo = pauses && pauses > 0 ? ` · ${pauses} pausas adaptadas` : '';
          setStatusMessage(
            vocalStartOffsetSec > 0
              ? `¡Voz anclada en ${formatTime(vocalStartOffsetSec)} (${data.lyrics.length} versos alineados)!`
              : `¡${data.lyrics.length} versos sincronizados${lrcNote ? ' con marca LRC exacta' : ''}${pauseInfo}!`
          );
        } else if (!silent) {
          setStatusMessage('No se encontraron versos. Escribe o pega la letra línea por línea.');
        }
      } catch (err: any) {
        console.warn('AI sync warning:', err?.message || err);
        if (!silent) {
          setStatusMessage('No se pudo completar la sincronización automática.');
        }
      } finally {
        if (seq === syncSeqRef.current) {
          setIsSyncingLyrics(false);
        }
      }
    })();

    activeSyncPromiseRef.current = runTask;
    await runTask;
  };

  // Automatic debounced sync whenever user pastes/edits lyrics OR loads a new song with pasted lyrics already present
  useEffect(() => {
    const trimmed = rawLyricsInput.trim();
    if (!trimmed) return;
    const sameText = trimmed === lastSyncedRawRef.current;
    const sameAudio = audioBlob === lastSyncedAudioBlobRef.current;
    if (sameText && sameAudio) return;
    const lineCount = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
    if (lineCount < 2 && !/\[(\d{1,2}):(\d{2})/.test(trimmed)) return;

    const timer = setTimeout(() => {
      handleAiSyncLyrics(trimmed, true);
    }, 1000);

    return () => clearTimeout(timer);
  }, [rawLyricsInput, audioBlob, accurateAudioDuration]);

  // Canvas Dimension calculation according to aspect ratio
  const getCanvasDimensions = () => {
    switch (style.aspectRatio) {
      case '9:16':
        return { width: 720, height: 1280 };
      case '1:1':
        return { width: 1080, height: 1080 };
      case '16:9':
      default:
        return { width: 1280, height: 720 };
    }
  };

  const canvasDims = getCanvasDimensions();

  // Stop or finish export early on demand
  const handleFinishExportEarly = () => {
    if (exportIntervalRef.current) {
      clearInterval(exportIntervalRef.current);
      exportIntervalRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      setIsPlaying(false);
    }
    if (backgroundStoryVideoRef.current) {
      backgroundStoryVideoRef.current.pause();
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      setExportProgress(100);
      setStatusMessage('Finalizando y empaquetando video...');
    } else {
      setIsExporting(false);
    }
  };

  // Cancel export
  const handleCancelExport = () => {
    exportCancelledRef.current = true;
    if (exportIntervalRef.current) {
      clearInterval(exportIntervalRef.current);
      exportIntervalRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      setIsPlaying(false);
    }
    if (backgroundStoryVideoRef.current) {
      backgroundStoryVideoRef.current.pause();
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      recorder.stop();
    }
    setIsExporting(false);
    setExportProgress(0);
    setExportSecondsElapsed(0);
    setStatusMessage('Exportación cancelada.');
  };

  // Fast Server-Side Merge (FFmpeg): Repeats short gallery video seamlessly to match exact song duration and downloads MP4 in seconds
  const handleFastMergeMp4AndDownload = async () => {
    if (!audioBlob && !audioUrl) {
      setStatusMessage('Por favor incorpora o descarga una canción primero (desde Google Drive o tu dispositivo).');
      return;
    }

    setIsFastRendering(true);
    setFastRenderProgressText('Subiendo archivos para unir video y canción...');
    setStatusMessage('Creando tu video MP4 con la duración exacta de la canción...');

    try {
      // 1. Obtain audio blob
      let finalAudioBlob = audioBlob;
      if (!finalAudioBlob && audioUrl) {
        const audioFetch = await fetch(audioUrl);
        finalAudioBlob = await audioFetch.blob();
      }
      if (!finalAudioBlob) {
        throw new Error('No se pudo leer el archivo de audio.');
      }

      const audioExt = audioFileName.match(/\.[a-zA-Z0-9]+$/)?.[0] || '.mp3';
      let audioFileId = (uploadedAudioRef.current.blob === finalAudioBlob && uploadedAudioRef.current.fileId)
        ? uploadedAudioRef.current.fileId
        : await uploadBlobInChunks(finalAudioBlob, audioExt, (pct) => {
            setFastRenderProgressText(`Subiendo canción: ${pct}%...`);
          });
      uploadedAudioRef.current = { blob: finalAudioBlob, fileId: audioFileId };

      let videoFileId: string | undefined;
      let photoFileIds: string[] | undefined;
      let storyPhotoIds: string[] | undefined;
      let videoTheme = 'sunset_romance';

      if (videoSourceType === 'photo' && galleryPhotos.length > 0) {
        const serverPhotoIds = galleryPhotos.map((p) => p.photoId).filter((id): id is string => Boolean(id));
        const localPhotos = galleryPhotos.filter((p) => Boolean(p.blob));

        if (serverPhotoIds.length === galleryPhotos.length) {
          storyPhotoIds = serverPhotoIds;
        } else if (localPhotos.length > 0) {
          const sameBlobs =
            uploadedPhotosRef.current.blobs.length === localPhotos.length &&
            localPhotos.every((p, idx) => uploadedPhotosRef.current.blobs[idx] === p.blob);
          if (sameBlobs && uploadedPhotosRef.current.fileIds.length === localPhotos.length) {
            photoFileIds = uploadedPhotosRef.current.fileIds;
          } else {
            const uploadedIds: string[] = [];
            for (let i = 0; i < localPhotos.length; i++) {
              const p = localPhotos[i];
              if (!p.blob) continue;
              setFastRenderProgressText(`Subiendo foto ${i + 1}/${localPhotos.length}...`);
              const pExt = p.name.match(/\.[a-zA-Z0-9]+$/)?.[0] || (p.blob.type.includes('png') ? '.png' : '.jpg');
              const fid = await uploadBlobInChunks(p.blob, pExt);
              uploadedIds.push(fid);
            }
            photoFileIds = uploadedIds;
            uploadedPhotosRef.current = { blobs: localPhotos.map((p) => p.blob), fileIds: uploadedIds };
          }
        }
      } else if (videoSourceType === 'gallery' && galleryVideoBlob) {
        if (uploadedGalleryRef.current.blob === galleryVideoBlob && uploadedGalleryRef.current.fileId) {
          videoFileId = uploadedGalleryRef.current.fileId;
        } else {
          setFastRenderProgressText('Subiendo video de tu galería: 0%...');
          const vidExt = galleryVideoBlob.type.includes('webm')
            ? '.webm'
            : galleryVideoBlob.type.includes('quicktime')
            ? '.mov'
            : '.mp4';
          videoFileId = await uploadBlobInChunks(galleryVideoBlob, vidExt, (pct) => {
            setFastRenderProgressText(`Subiendo video de tu galería: ${pct}%...`);
          });
          uploadedGalleryRef.current = { blob: galleryVideoBlob, fileId: videoFileId };
        }
      } else if (storyVideoUrl && storyVideoUrl.includes('theme=')) {
        const u = new URL(storyVideoUrl, window.location.origin);
        videoTheme = u.searchParams.get('theme') || 'sunset_romance';
      }

      setFastRenderProgressText(
        (photoFileIds && photoFileIds.length > 0) || (storyPhotoIds && storyPhotoIds.length > 0)
          ? 'Creando video MP4 con tu foto escogida y letra sincronizada a la voz...'
          : 'Uniendo y repitiendo el video hasta durar igual a la canción...'
      );

      const songDur = accurateAudioDuration > 0
        ? accurateAudioDuration
        : (audioRef.current?.duration && isFinite(audioRef.current.duration) && audioRef.current.duration > 0)
        ? audioRef.current.duration
        : (duration || 30);

      const renderRes = await fetchWithRetry('/api/render-loop-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoFileId,
          photoFileIds,
          storyPhotoIds,
          videoTheme,
          audioFileId,
          durationSeconds: songDur,
          aspectRatio: style.aspectRatio,
          songTitle: songTitle.trim(),
          artist: artist.trim(),
          lyrics,
          showTitleHeader: style.showTitleHeader,
          lyricEffect: style.lyricEffect || 'karaoke-sweep',
        }),
      }, 1);

      const renderData = await renderRes.json();
      if (!renderRes.ok || !renderData.success) {
        throw new Error(renderData.error || 'Error al generar el video MP4.');
      }

      setFastRenderProgressText('Descargando video MP4 (0%)...');

      // Fetch rendered MP4 in 4 MB Range chunks so large (>32 MB) videos succeed behind Cloud Run proxy
      const mp4Blob = await fetchMp4BlobInChunks(
        renderData.streamUrl,
        typeof renderData.sizeBytes === 'number' ? renderData.sizeBytes : undefined,
        (msg) => setFastRenderProgressText(msg)
      );
      const mp4ObjectUrl = URL.createObjectURL(mp4Blob);

      setExportedBlob(mp4Blob);
      setExportedVideoUrl(mp4ObjectUrl);
      setExportedExtension('mp4');

      // Trigger automatic download from local ObjectURL (zero duplicate network request & no 32 MB limit)
      const a = document.createElement('a');
      a.href = mp4ObjectUrl;
      const cleanTitle = (songTitle.trim() || storyVideoTheme || 'video_musical').replace(/[/\\?%*:|"<>]/g, '_');
      a.download = `${cleanTitle}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setStatusMessage(`¡Video MP4 generado y descargado (${formatTime(renderData.duration || songDur)})! Duración exacta igual a tu canción.`);
    } catch (err: any) {
      console.warn('Fast merge warning:', err?.message || err);
      setStatusMessage('Error al generar MP4: ' + (err.message || 'Intenta grabar en vivo o verifica los archivos.'));
    } finally {
      setIsFastRendering(false);
      setFastRenderProgressText('');
    }
  };

  // Export video (Real-time Canvas stream + Audio stream, with continuous looping for short gallery videos)
  const handleExportVideo = async () => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;

    if (!audioUrl) {
      setStatusMessage('Por favor selecciona o importa una canción antes de grabar el video.');
      return;
    }

    exportCancelledRef.current = false;
    setIsExporting(true);
    setExportProgress(0);
    setExportSecondsElapsed(0);
    setStatusMessage('Preparando sincronización limpia desde 0:00 antes de grabar...');

    ensureAudioContext();

    try {
      // 1. Wait for any pending lyric sync OR run final sync BEFORE recording so lyrics never jump mid-recording
      const pendingRaw = rawLyricsInput.trim();
      if (pendingRaw && (pendingRaw !== lastSyncedRawRef.current || audioBlob !== lastSyncedAudioBlobRef.current)) {
        await handleAiSyncLyrics(pendingRaw, true);
      } else if (activeSyncPromiseRef.current) {
        await activeSyncPromiseRef.current.catch(() => {});
      }

      // The video MUST last the exact same time as the song!
      const songDuration = (accurateAudioDuration > 0)
        ? accurateAudioDuration
        : (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0)
        ? audio.duration
        : (duration || 30);

      const targetDuration = songDuration;
      setExportTargetSeconds(targetDuration);
      setDuration(targetDuration);

      // 2. Pause audio and AWAIT actual 'seeked' completion to 0.00s so frame 0 never captures an old playback position
      audio.pause();
      setIsPlaying(false);
      if (Math.abs(audio.currentTime) > 0.015 || audio.seeking) {
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            audio.removeEventListener('seeked', finish);
            resolve();
          };
          audio.addEventListener('seeked', finish, { once: true });
          audio.currentTime = 0;
          setTimeout(finish, 900);
        });
      } else {
        audio.currentTime = 0;
      }

      // Reset background looping video cleanly to 0 before starting recorder
      if (backgroundStoryVideoRef.current && !cameraActive) {
        const bgVid = backgroundStoryVideoRef.current;
        bgVid.pause();
        bgVid.loop = true;
        bgVid.muted = true;
        bgVid.currentTime = 0;
      }

      // 3. Flush t = 0 state and let Canvas render 2 clean frames at 0.00s BEFORE starting playback & recording
      setCurrentTime(0);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

      // Capture Canvas Stream at 30fps
      const canvasStream = canvas.captureStream(30);

      // Capture audio stream reliably via Web Audio destination first (since createMediaElementSource is attached)
      let audioStream: MediaStream | null = null;
      if (audioContextRef.current && analyserRef.current) {
        if (!audioDestStreamRef.current) {
          audioDestStreamRef.current = audioContextRef.current.createMediaStreamDestination();
          analyserRef.current.connect(audioDestStreamRef.current);
        }
        audioStream = audioDestStreamRef.current.stream;
      } else if ((audio as any).captureStream) {
        audioStream = (audio as any).captureStream();
      } else if ((audio as any).mozCaptureStream) {
        audioStream = (audio as any).mozCaptureStream();
      }

      // Combine video and audio tracks
      const tracks = [...canvasStream.getVideoTracks()];
      if (audioStream) {
        tracks.push(...audioStream.getAudioTracks());
      }

      const combinedStream = new MediaStream(tracks);

      // Prefer low-latency hardware-friendly codecs (H264 / VP8) before software VP9 for smooth 30fps capture
      const mimeCandidates = [
        'video/webm;codecs=h264,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm',
      ];
      const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
      const targetBitrate = canvas.width * canvas.height >= 1000000 ? 3600000 : 2800000;

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: targetBitrate,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        if (exportIntervalRef.current) {
          clearInterval(exportIntervalRef.current);
          exportIntervalRef.current = null;
        }
        setIsExporting(false);

        if (exportCancelledRef.current || chunks.length === 0) {
          return;
        }

        const cleanTitle = (songTitle.trim() || storyVideoTheme || 'video_musical').replace(/[/\\?%*:|"<>]/g, '_');
        const rawVideoBlob = new Blob(chunks, { type: mimeType });
        // Patch EBML header with exact duration so FFmpeg & players read the full length cleanly
        const fixedVideoBlob = await fixWebmDuration(rawVideoBlob, targetDuration * 1000);

        setIsFastRendering(true);
        setFastRenderProgressText('Convirtiendo grabación a MP4 compatible con Google Drive...');
        setStatusMessage('Convirtiendo video grabado a MP4 (H.264/AAC) para Google Drive...');

        try {
          const converted = await convertVideoBlobToMp4(fixedVideoBlob, cleanTitle, (msg) => {
            setFastRenderProgressText(msg);
          });
          const mp4ObjectUrl = URL.createObjectURL(converted.mp4Blob);
          setExportedBlob(converted.mp4Blob);
          setExportedVideoUrl(mp4ObjectUrl);
          setExportedExtension('mp4');

          // Auto-download converted MP4 directly from local ObjectURL (avoids Cloud Run 32 MB HTTP download limit)
          const a = document.createElement('a');
          a.href = mp4ObjectUrl;
          a.download = `${cleanTitle}.mp4`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          setStatusMessage(`¡Video MP4 grabado y convertido con éxito (${formatTime(targetDuration)})! Compatible con Google Drive y celulares.`);
        } catch (convErr: any) {
          console.error('Error converting recorded video to MP4:', convErr);
          const fallbackUrl = URL.createObjectURL(fixedVideoBlob);
          setExportedBlob(fixedVideoBlob);
          setExportedVideoUrl(fallbackUrl);
          setExportedExtension('webm');
          setStatusMessage(`Grabación lista, pero falló la conversión a MP4 (${convErr?.message || 'error de servidor'}). Usa "Descargar" para reintentar convertir a MP4.`);
        } finally {
          setIsFastRendering(false);
          setFastRenderProgressText('');
        }
      };

      // 4. Start playback first so WebAudio/canvas advance smoothly, wait 1 frame, then start MediaRecorder
      if (backgroundStoryVideoRef.current && !cameraActive) {
        backgroundStoryVideoRef.current.play().catch(() => {});
      }
      try {
        await audio.play();
        setIsPlaying(true);
      } catch (playErr) {
        console.warn('Audio play during export warning:', playErr);
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setStatusMessage('Grabando video a 30 FPS en sincronía perfecta desde el primer segundo...');

      if (exportIntervalRef.current) {
        clearInterval(exportIntervalRef.current);
      }

      exportIntervalRef.current = setInterval(() => {
        const cur = audio.currentTime;
        setExportSecondsElapsed(cur);
        setCurrentTime(cur); // Keep UI progress counter updated while Canvas reads audio.currentTime at 60fps

        // Keep short background video looping without ever stalling
        if (backgroundStoryVideoRef.current && !cameraActive && backgroundStoryVideoRef.current.paused) {
          backgroundStoryVideoRef.current.play().catch(() => {});
        }

        if (cur >= targetDuration || audio.ended) {
          handleFinishExportEarly();
        } else {
          const pct = Math.min(99, Math.round((cur / targetDuration) * 100));
          setExportProgress(pct);
        }
      }, 100);
    } catch (err: any) {
      console.error('Export error:', err);
      setIsExporting(false);
      setStatusMessage('Error al grabar video: ' + err.message);
    }
  };

  const handleSaveToLibraryDirectly = async () => {
    // Generate snapshot thumbnail from canvas
    const canvas = canvasRef.current;
    const thumbnail = canvas ? canvas.toDataURL('image/jpeg', 0.8) : '';
    const songDuration = accurateAudioDuration > 0
      ? accurateAudioDuration
      : (audioRef.current?.duration && isFinite(audioRef.current.duration) && audioRef.current.duration > 0)
      ? audioRef.current.duration
      : (duration || 30);

    const newVideo: LibraryVideo = {
      id: 'video-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      title: songTitle.trim() || storyVideoTheme || 'Video Musical',
      artist: artist.trim(),
      duration: songDuration,
      folderId: selectedFolderId,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      thumbnailUrl: thumbnail,
      videoBlob: exportedBlob || undefined,
      videoUrl: exportedVideoUrl || undefined,
      audioBlob: audioBlob || undefined,
      audioUrl: audioUrl || undefined,
      lyrics,
      style,
      sourceType: cameraActive ? 'camera' : 'generated',
    };

    await onSaveToLibrary(newVideo);
    setStatusMessage(`Video "${newVideo.title}" guardado en tu biblioteca (${formatTime(songDuration)}).`);
  };

  const handleDownloadExported = async () => {
    if (!exportedVideoUrl && !exportedBlob) return;
    const cleanTitle = (songTitle.trim() || storyVideoTheme || 'video_musical').replace(/[/\\?%*:|"<>]/g, '_');
    const isWebm = Boolean(exportedBlob && exportedBlob.type.toLowerCase().includes('webm'));
    if (isWebm) {
      setIsFastRendering(true);
      setFastRenderProgressText('Convirtiendo grabación a MP4 compatible con Google Drive...');
    }
    try {
      const resultBlob = await downloadVideoAsMp4({
        blob: exportedBlob,
        url: exportedVideoUrl,
        title: cleanTitle,
        onStatus: (msg) => setFastRenderProgressText(msg),
      });
      if (resultBlob && resultBlob !== exportedBlob && resultBlob.type.includes('mp4')) {
        setExportedBlob(resultBlob);
        setExportedVideoUrl(URL.createObjectURL(resultBlob));
        setExportedExtension('mp4');
      }
      setStatusMessage(`Descargando "${cleanTitle}.mp4" compatible con Google Drive.`);
    } catch (err: any) {
      setStatusMessage('Error al descargar en MP4: ' + (err?.message || 'Intenta nuevamente.'));
    } finally {
      if (isWebm) {
        setIsFastRendering(false);
        setFastRenderProgressText('');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Media elements */}
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => {
          setIsPlaying(true);
          if (backgroundStoryVideoRef.current && !cameraActive) {
            backgroundStoryVideoRef.current.play().catch(() => {});
          }
        }}
        onPause={() => {
          setIsPlaying(false);
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
          if (backgroundStoryVideoRef.current && !cameraActive) {
            backgroundStoryVideoRef.current.pause();
          }
        }}
        onSeeked={() => {
          if (audioRef.current) {
            const t = audioRef.current.currentTime;
            setCurrentTime(t);
            if (backgroundStoryVideoRef.current && !cameraActive && backgroundStoryVideoRef.current.duration) {
              backgroundStoryVideoRef.current.currentTime = t % backgroundStoryVideoRef.current.duration;
            }
          }
        }}
        onEnded={() => {
          setIsPlaying(false);
          if (backgroundStoryVideoRef.current && !cameraActive) {
            backgroundStoryVideoRef.current.pause();
          }
        }}
        crossOrigin="anonymous"
      />

      {/* Top Banner / Actions */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 p-5 rounded-3xl bg-gradient-to-r from-purple-950/60 via-slate-900 to-indigo-950/60 border border-purple-800/40 shadow-2xl">
        <div className="w-full lg:w-auto">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-pink-500/20 text-pink-400 border border-pink-500/30">
              Creador de Videos Musicales
            </span>
            <span className="text-xs text-slate-400">
              Personaliza el título de tu canción o cárgala directamente
            </span>
          </div>
          <div className="flex items-center gap-2.5 mt-2">
            <Music className="w-6 h-6 text-pink-500 shrink-0" />
            <input
              type="text"
              value={songTitle}
              onChange={(e) => setSongTitle(e.target.value)}
              placeholder="Escribe el nombre de tu canción aquí..."
              className="bg-transparent border-b border-purple-500/40 hover:border-pink-500 focus:border-pink-500 text-xl sm:text-2xl font-black text-white focus:outline-none placeholder-slate-500 w-full max-w-md transition"
            />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-slate-400">Artista / Intérprete:</span>
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Nombre del artista..."
              className="bg-transparent border-b border-slate-700 hover:border-slate-500 focus:border-purple-400 text-xs text-purple-300 font-medium focus:outline-none placeholder-slate-500 w-48 transition"
            />
          </div>
        </div>

        {/* Solo Descarga / Búsqueda de Videos (los demás controles están unificados en Todo-en-Uno) */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => handleAutoMatchStoryVideo()}
            disabled={isSearchingStoryVideo}
            className="px-3.5 py-2 bg-emerald-700/90 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl border border-emerald-600/60 flex items-center gap-2 transition shadow-md disabled:opacity-50"
            title="Conseguir automáticamente un video relacionado al tema de la canción"
          >
            {isSearchingStoryVideo ? (
              <Loader2 className="w-4 h-4 animate-spin text-emerald-300" />
            ) : (
              <Sparkles className="w-4 h-4 text-emerald-300" />
            )}
            <span>Video Relacionado</span>
          </button>

          <button
            type="button"
            onClick={() => handleDownloadStoryVideo(false)}
            disabled={!storyVideoUrl && !galleryVideoBlob}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-semibold rounded-xl border border-emerald-500/40 flex items-center gap-2 transition shadow-md disabled:opacity-40"
            title="Descargar video de fondo (.mp4)"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            <span>Descargar Video</span>
          </button>
        </div>
      </div>

      {/* Collapsible Story Photo Picker (People, Couples, Landscapes, Scenes) */}
      {showStoryPhotoPicker && (
        <div className="p-4 bg-slate-900/95 border border-sky-500/40 rounded-2xl shadow-2xl space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-sky-400" />
                <span>Escoge una Foto para la Historia de tu Canción</span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Selecciona una imagen de persona, pareja, paisaje, playa, montañas o artista — puedes descargarla directa o usarla en tu video.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={storyPhotoSearch}
                onChange={(e) => setStoryPhotoSearch(e.target.value)}
                placeholder="Buscar persona, playa, paisaje..."
                className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 w-48 sm:w-56"
              />
              <button
                type="button"
                onClick={() => setShowStoryPhotoPicker(false)}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl"
              >
                Cerrar
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {['Todas', 'Personas', 'Paisajes', 'Música', 'Ciudad'].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setStoryPhotoFilterCat(cat)}
                className={`px-3 py-1 rounded-xl text-[11px] font-bold transition ${
                  storyPhotoFilterCat === cat
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-sky-500/40'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
            {storyPhotoCatalog.map((photo) => {
              const cleanBase = (songTitle.trim() || photo.title || 'foto_historia').replace(/[/\\?%*:|"<>]/g, '_');
              const dlHref = `/api/photo-download?photoId=${encodeURIComponent(photo.id)}&download=1&filename=${encodeURIComponent(cleanBase + '.jpg')}`;
              const isSelected = galleryPhotos.some((g) => g.photoId === photo.id);
              return (
                <div
                  key={photo.id}
                  className={`bg-slate-950 rounded-xl overflow-hidden border transition flex flex-col justify-between ${
                    isSelected ? 'border-emerald-400 ring-1 ring-emerald-400/40' : 'border-slate-800 hover:border-sky-500/60'
                  }`}
                >
                  <div className="aspect-video w-full overflow-hidden bg-slate-900 relative">
                    <img
                      src={photo.previewUrl}
                      alt={photo.title}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-bold text-sky-300">
                      {photo.category}
                    </span>
                  </div>
                  <div className="p-2 space-y-1.5">
                    <p className="text-[11px] font-semibold text-slate-200 line-clamp-1" title={photo.title}>
                      {photo.title}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setStoryVideoUrl(null);
                          setGalleryVideoBlob(null);
                          setGalleryVideoDuration(0);
                          setGalleryPhotos([
                            {
                              url: photo.previewUrl,
                              name: `${photo.title}.jpg`,
                              photoId: photo.id,
                              downloadUrl: dlHref,
                            },
                          ]);
                          uploadedPhotosRef.current = { blobs: [], fileIds: [] };
                          setVideoSourceType('photo');
                          setStoryVideoTheme(photo.title);
                          setCameraActive(false);
                          setStyle((prev) => ({ ...prev, visualizerTheme: 'camera-live' }));
                          setStatusMessage(`Foto "${photo.title}" escogida para la historia de tu canción.`);
                          setShowStoryPhotoPicker(false);
                        }}
                        className="flex-1 py-1 px-1.5 bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold rounded-lg transition"
                      >
                        {isSelected ? 'Activa' : 'Escoger'}
                      </button>
                      <a
                        href={dlHref}
                        download={`${cleanBase}.jpg`}
                        className="py-1 px-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-[10px] font-bold rounded-lg flex items-center gap-0.5 transition"
                        title="Descargar foto directamente (.jpg)"
                      >
                        <Download className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* UNIFIED ALL-IN-ONE CREATOR WORKSPACE: Song + Photo + Lyrics + Effects + Record in ONE place */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/50 border border-purple-500/35 rounded-3xl p-4 shadow-2xl space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-xl bg-gradient-to-tr from-purple-600 to-pink-600 flex items-center justify-center text-white shadow">
              <Zap className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-xs sm:text-sm font-black text-white">
                Centro Todo-en-Uno: Canción + Foto + Letra + Sincronización y Grabación
              </h3>
              <p className="text-[11px] text-slate-400">
                Pega la letra, carga o baja la canción y escoge/descarga tu foto en un solo lugar; se sincroniza automáticamente para grabar.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[11px]">
            <span className={`px-2 py-0.5 rounded-lg border font-bold ${audioBlob ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
              {audioBlob ? '✓ Canción' : '1. Canción'}
            </span>
            <span className={`px-2 py-0.5 rounded-lg border font-bold ${galleryPhotos.length > 0 || videoSourceType === 'gallery' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
              {galleryPhotos.length > 0 || videoSourceType === 'gallery' ? '✓ Foto/Video' : '2. Foto'}
            </span>
            <span className={`px-2 py-0.5 rounded-lg border font-bold ${lyrics.length > 0 ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
              {lyrics.length > 0 ? `✓ ${lyrics.length} Versos` : '3. Letra'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Step 1 + Step 2 Compact Combined Controls */}
          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5">
            {/* 1. Canción */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-pink-400 block">1. Canción (Audio)</span>
                <p className="text-xs font-semibold text-white truncate">
                  {audioFileName ? `${audioFileName} (${formatTime(duration)})` : 'Sin canción cargada'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <label className="px-2.5 py-1.5 bg-pink-600 hover:bg-pink-500 text-white text-[11px] font-bold rounded-xl cursor-pointer transition">
                  <span>Subir</span>
                  <input type="file" accept="audio/*" onChange={handleLocalAudioUpload} className="hidden" />
                </label>
                <button
                  type="button"
                  onClick={onOpenGoogleDrive}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 text-[11px] font-bold rounded-xl transition"
                  title="Bajar canción o foto desde Google Drive"
                >
                  Drive
                </button>
              </div>
            </div>

            {/* 2. Foto de la Historia (Persona, Paisaje...) */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {videoSourceType === 'photo' && galleryPhotos[0] && (
                  <img src={galleryPhotos[0].url} alt="" className="w-9 h-9 rounded-lg object-cover border border-sky-500/50 shrink-0" />
                )}
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400 block">2. Foto (Persona / Paisaje)</span>
                  <p className="text-xs font-semibold text-white truncate">
                    {storyVideoTheme || 'Escoge o sube imagen'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowStoryPhotoPicker((v) => !v)}
                  className="px-2.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold rounded-xl transition"
                >
                  Escoger
                </button>
                <label className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-bold rounded-xl cursor-pointer transition">
                  <span>Galería</span>
                  <input type="file" accept="video/*,image/*" multiple onChange={handleGalleryVideoUpload} className="hidden" />
                </label>
                {(videoSourceType === 'photo' || videoSourceType === 'story') && (
                  <button
                    type="button"
                    onClick={() => handleDownloadStoryVideo(true)}
                    className="p-1.5 bg-emerald-600/90 hover:bg-emerald-500 text-white rounded-xl transition"
                    title="Descargar esta foto (.jpg)"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Step 3: Paste Lyrics -> Auto-Sync -> Lyric Effects -> Record/Export */}
          <div className="lg:col-span-7 p-3 bg-slate-950/80 border border-slate-800 rounded-2xl flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5" />
                <span>3. Pega la Letra aquí + Alinea con la Voz + Efectos</span>
              </span>
              {lyrics.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-slate-400 mr-0.5">Ajuste:</span>
                  {[-2, -0.5, -0.2, 0.2, 0.5, 2].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => handleNudgeAllLyrics(delta)}
                      className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-[10px] font-mono transition"
                      title={`Desplazar toda la letra ${delta > 0 ? `+${delta}s` : `${delta}s`}`}
                    >
                      {delta > 0 ? `+${delta}s` : `${delta}s`}
                    </button>
                  ))}
                  {lyricOffsetSec !== 0 && (
                    <span className="text-[10px] font-mono text-amber-300 ml-0.5">
                      ({lyricOffsetSec > 0 ? `+${lyricOffsetSec}s` : `${lyricOffsetSec}s`})
                    </span>
                  )}
                </div>
              )}
            </div>

            <textarea
              rows={2}
              value={rawLyricsInput}
              onChange={(e) => setRawLyricsInput(e.target.value)}
              placeholder="Pega aquí la letra de tu canción... al soltarla o cargar tu audio se sincronizará automáticamente con la voz."
              className="w-full bg-slate-900 border border-slate-700/80 rounded-xl p-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none"
            />

            {/* Voice-Lock Quick Calibration Bar */}
            {(audioUrl || lyrics.length > 0) && (
              <div className="p-2 bg-slate-900/90 border border-amber-500/30 rounded-xl flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={handleAnchorVoiceStartHere}
                    disabled={!audioUrl || isSyncingLyrics}
                    className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold rounded-lg flex items-center gap-1 transition disabled:opacity-40"
                    title="Reproduce la canción y pulsa este botón en el segundo exacto en que empieza a cantar"
                  >
                    <Mic className="w-3 h-3" />
                    <span>La voz entra AQUÍ ({formatTime(currentTime)})</span>
                  </button>
                  {lyrics.length > 0 && currentTime > 3 && (
                    <button
                      type="button"
                      onClick={handleReanchorRemainingHere}
                      disabled={!audioUrl || isSyncingLyrics}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded-lg flex items-center gap-1 transition disabled:opacity-40"
                      title="Si tras una pausa o solo de instrumentos la letra se adelantó o atrasó, re-ancla desde aquí el resto de versos sin mover el inicio"
                    >
                      <Clock className="w-3 h-3" />
                      <span>Re-anclar resto tras pausa AQUÍ ({formatTime(currentTime)})</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleToggleTapSyncMode}
                    disabled={!audioUrl}
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg flex items-center gap-1 border transition disabled:opacity-40 ${
                      isTapSyncMode
                        ? 'bg-pink-600 text-white border-pink-400 animate-pulse'
                        : 'bg-slate-800 hover:bg-slate-700 text-pink-300 border-pink-500/40'
                    }`}
                    title="Ve tocando en vivo (o con la Barra Espaciadora) cada vez que el cantante empiece un verso"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>{isTapSyncMode ? 'Salir de Marcar' : 'Marcar cada verso al ritmo de la voz'}</span>
                  </button>
                </div>

                {isTapSyncMode && lyrics.length > 0 && (
                  <div className="w-full pt-1.5 mt-1 border-t border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-[11px] text-slate-200 truncate max-w-md">
                      <span className="text-amber-300 font-bold mr-1">
                        Verso {Math.min(lyrics.length, tapSyncIndex + 1)}/{lyrics.length}:
                      </span>
                      <span className="italic">"{lyrics[Math.min(lyrics.length - 1, tapSyncIndex)]?.text}"</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setTapSyncIndex((i) => Math.max(0, i - 1))}
                        disabled={tapSyncIndex === 0}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold rounded-lg disabled:opacity-40"
                      >
                        Atrás
                      </button>
                      <button
                        type="button"
                        onClick={handleStampTapSyncVerse}
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold rounded-lg shadow transition"
                      >
                        Marcar Verso Ahora (Espacio)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Lyric Effects Bar + Instant Sync & Record */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { id: 'karaoke-sweep', label: 'Karaoke' },
                  { id: 'neon-pulse', label: 'Neón Pulso' },
                  { id: 'fade-slide', label: 'Cine Suave' },
                  { id: 'typewriter', label: 'Escritura' },
                  { id: 'bounce-pop', label: 'Pop Rebote' },
                  { id: 'subtitle-clean', label: 'Subtítulo' },
                ].map((ef) => (
                  <button
                    key={ef.id}
                    type="button"
                    onClick={() => setStyle({ ...style, lyricEffect: ef.id as LyricEffect })}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition ${
                      (style.lyricEffect || 'karaoke-sweep') === ef.id
                        ? 'bg-pink-600 text-white border-pink-400 shadow'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-pink-500/40'
                    }`}
                  >
                    {ef.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleAiSyncLyrics()}
                  disabled={isSyncingLyrics}
                  className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold rounded-xl flex items-center gap-1 transition disabled:opacity-50"
                >
                  {isSyncingLyrics ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  <span>Sincronizar</span>
                </button>
                <button
                  type="button"
                  onClick={handleFastMergeMp4AndDownload}
                  disabled={isExporting || isFastRendering || !audioBlob}
                  className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold rounded-xl flex items-center gap-1 transition disabled:opacity-40"
                >
                  <Zap className="w-3 h-3 text-amber-300" />
                  <span>Crear MP4</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportVideo}
                  disabled={isExporting || isFastRendering || !audioUrl}
                  className="px-2.5 py-1.5 bg-pink-600 hover:bg-pink-500 text-white text-[11px] font-bold rounded-xl flex items-center gap-1 transition disabled:opacity-40"
                >
                  <VideoIcon className="w-3 h-3" />
                  <span>Grabar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Gallery / Story Video or Chosen Photo & Song Pairing Bar */}
      {(storyVideoUrl || galleryPhotos.length > 0) && (
        <div className="p-3.5 bg-gradient-to-r from-emerald-950/70 via-slate-900 to-violet-950/70 border border-emerald-500/40 rounded-2xl flex items-center justify-between gap-3 flex-wrap animate-fadeIn shadow-xl">
          <div className="flex items-center gap-2.5 flex-wrap">
            {videoSourceType === 'photo' && galleryPhotos[0] ? (
              <img
                src={galleryPhotos[0].url}
                alt={storyVideoTheme || 'Foto escogida'}
                className="w-10 h-10 rounded-xl object-cover border border-sky-400/60 shrink-0 shadow"
              />
            ) : (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                <Film className="w-4 h-4 text-fuchsia-400 shrink-0" />
              </>
            )}
            <div className="text-xs flex items-center gap-2 flex-wrap">
              <span className="font-bold text-white">
                {videoSourceType === 'photo'
                  ? (galleryPhotos.length > 1 ? 'Fotos de la historia escogidas:' : 'Imagen de la historia escogida:')
                  : videoSourceType === 'gallery'
                  ? 'Video de tu galería activo:'
                  : 'Video de historia activo:'}
              </span>
              <span className="text-emerald-300 font-semibold">{storyVideoTheme || 'Imagen seleccionada'}</span>
              {videoSourceType !== 'photo' && galleryVideoDuration > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-violet-500/20 border border-violet-400/30 text-violet-200 font-mono text-[11px]">
                  <Repeat className="w-3 h-3" />
                  <span>
                    Clip {formatTime(galleryVideoDuration)}
                    {duration > galleryVideoDuration
                      ? ` × ${Math.ceil(duration / galleryVideoDuration)} = ${formatTime(duration)}`
                      : ` → ${formatTime(duration)}`}
                  </span>
                </span>
              )}
              {audioFileName && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-pink-500/20 border border-pink-400/30 text-pink-200 text-[11px]">
                  <Music className="w-3 h-3" />
                  <span>{audioFileName}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {videoSourceType === 'photo' ? (
              <button
                onClick={() => handleDownloadStoryVideo(true)}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-md transition"
                title="Descargar esta foto escogida (persona, paisaje, etc.)"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar Foto</span>
              </button>
            ) : (
              <>
                <button
                  onClick={() => handleDownloadStoryVideo(false)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-md transition"
                  title="Descargar video (.mp4)"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar Video</span>
                </button>
                {videoSourceType === 'story' && (
                  <button
                    onClick={() => handleDownloadStoryVideo(true)}
                    className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-md transition"
                    title="Descargar foto real relacionada con la historia (.jpg)"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>Descargar Foto</span>
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => {
                setStoryVideoUrl(null);
                setGalleryVideoBlob(null);
                setGalleryPhotos([]);
                setGalleryVideoDuration(0);
                setVideoSourceType('story');
                setStoryVideoTheme('');
                setStyle((prev) => ({ ...prev, visualizerTheme: 'spectrum-bars' }));
                setStatusMessage('Imagen/video retirado.');
              }}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl transition"
              title="Quitar imagen o video seleccionado"
            >
              Quitar
            </button>
          </div>
        </div>
      )}

      {statusMessage && (
        <div className="p-3 bg-purple-950/50 border border-purple-800/60 rounded-xl text-xs text-purple-200 flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
            <span>{statusMessage}</span>
          </div>
          <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-white text-xs">
            ✕
          </button>
        </div>
      )}

      {cameraError && (
        <div className="p-3 bg-rose-950/50 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{cameraError}</span>
        </div>
      )}

      {/* Main Studio Work Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left / Center: Interactive Canvas Video Player (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-2xl overflow-hidden flex flex-col items-center">
            {/* Aspect ratio frame container */}
            <div
              className="relative w-full max-w-full rounded-2xl overflow-hidden bg-black shadow-inner flex items-center justify-center"
              style={{
                aspectRatio:
                  style.aspectRatio === '9:16'
                    ? '9/16'
                    : style.aspectRatio === '1:1'
                    ? '1/1'
                    : '16/9',
                maxHeight: style.aspectRatio === '9:16' ? '600px' : '440px',
              }}
            >
              {/* Visible Video Background Element (Guarantees visible moving video immediately & auto-loops short clips) */}
              {storyVideoUrl && !cameraActive && (
                <video
                  ref={backgroundStoryVideoRef}
                  src={storyVideoUrl}
                  playsInline
                  muted
                  loop
                  autoPlay
                  crossOrigin="anonymous"
                  onLoadedMetadata={(e) => {
                    const vd = e.currentTarget.duration;
                    if (vd && isFinite(vd) && vd > 0) {
                      setGalleryVideoDuration(vd);
                    }
                  }}
                  onEnded={(e) => {
                    e.currentTarget.currentTime = 0;
                    e.currentTarget.play().catch(() => {});
                  }}
                  className="absolute inset-0 w-full h-full object-cover z-0 pointer-events-none"
                />
              )}
              {cameraActive && (
                <video
                  ref={videoElementRef}
                  playsInline
                  muted
                  autoPlay
                  className="absolute inset-0 w-full h-full object-cover z-0 pointer-events-none"
                />
              )}

              <canvas
                ref={canvasRef}
                width={canvasDims.width}
                height={canvasDims.height}
                className="w-full h-full object-contain relative z-10"
              />

              <VideoCanvasRenderer
                canvasRef={canvasRef}
                songTitle={songTitle}
                artist={artist}
                lyrics={lyrics}
                currentTime={currentTime}
                duration={duration}
                style={style}
                audioAnalyser={analyserRef.current}
                audioElementRef={audioRef}
                videoBackgroundElement={cameraActive ? videoElementRef.current : (storyVideoUrl ? backgroundStoryVideoRef.current : null)}
                videoBackgroundRef={backgroundStoryVideoRef}
                cameraVideoRef={videoElementRef}
                photoUrls={videoSourceType === 'photo' ? galleryPhotos.map((p) => p.url) : []}
                isCameraActive={cameraActive}
                isRecording={isExporting}
              />

              {/* Watermark badge */}
              <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-300 flex items-center gap-1.5 border border-white/10">
                <Music className="w-3 h-3 text-pink-500" />
                <span>Germán Videos Musicales</span>
              </div>

              {/* Aspect Ratio Badge */}
              <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-mono text-slate-300 border border-white/10">
                {style.aspectRatio}
              </div>
            </div>

            {/* Playback Controls & Progress Bar */}
            <div className="w-full mt-4 space-y-3 px-2">
              {/* Progress Slider */}
              <div className="space-y-1">
                <input
                  type="range"
                  min="0"
                  max={duration || 30}
                  step="0.1"
                  value={currentTime}
                  onChange={(e) => handleSeek(parseFloat(e.target.value))}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
                <div className="flex justify-between text-[11px] font-mono text-slate-400">
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

              {/* Action buttons under player */}
              <div className="space-y-3 pt-1">
                {/* Duration sync banner: El vídeo tiene que durar el mismo tiempo de la canción */}
                <div className="flex items-center justify-between flex-wrap gap-2 px-3.5 py-2.5 bg-slate-950/90 border border-slate-800 rounded-2xl shadow-inner">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-semibold text-slate-200">
                      {storyVideoUrl && galleryVideoDuration > 0 && duration > galleryVideoDuration
                        ? `Video corto (${formatTime(galleryVideoDuration)}) repetido ${Math.ceil(duration / galleryVideoDuration)}× para durar igual a la canción:`
                        : 'Duración del video sincronizada con la canción:'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono font-bold text-white bg-slate-900 px-3 py-1 rounded-xl border border-slate-700/80">
                    <Clock className="w-3.5 h-3.5 text-pink-400" />
                    <span>{formatTime(duration)}</span>
                    <span className="text-[10px] text-emerald-400 font-sans font-medium">(Duración exacta)</span>
                  </div>
                </div>

                {/* Live Lyrics Status & Quick Controls Bar (always accessible under player) */}
                <div className="p-3 bg-slate-950/90 border border-slate-800 rounded-2xl space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <Type className={`w-4 h-4 shrink-0 ${lyrics.length > 0 ? 'text-pink-400' : 'text-amber-400'}`} />
                      {lyrics.length > 0 ? (
                        <div className="text-xs truncate">
                          <span className="font-bold text-white">Letra lista ({lyrics.length} versos)</span>
                          {lyricsSourceLabel && (
                            <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30">
                              {lyricsSourceLabel}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-amber-300">
                          {isSyncingLyrics ? 'Buscando y sincronizando letra de la canción...' : 'Aún no hay letra cargada para esta canción'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => extractLyricsForLoadedSong()}
                        disabled={isSyncingLyrics || (!audioBlob && !songTitle.trim())}
                        className="px-2.5 py-1 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-[11px] font-bold rounded-xl flex items-center gap-1 transition disabled:opacity-50"
                        title="Detectar o buscar automáticamente la letra sincronizada de esta canción"
                      >
                        {isSyncingLyrics ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        <span>{lyrics.length > 0 ? 'Re-detectar Letra' : 'Detectar Letra'}</span>
                      </button>

                      <label
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold rounded-xl flex items-center gap-1 cursor-pointer transition border border-slate-700"
                        title="Subir archivo de letra .LRC o .TXT"
                      >
                        <FileText className="w-3 h-3 text-sky-400" />
                        <span>.LRC / .TXT</span>
                        <input type="file" accept=".lrc,.txt,text/plain" onChange={handleLyricsFileUpload} className="hidden" />
                      </label>

                      <button
                        type="button"
                        onClick={toggleLiveLyricDictation}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-xl flex items-center gap-1 transition border ${
                          isDictatingLyrics
                            ? 'bg-rose-600 text-white border-rose-500 animate-pulse'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                        }`}
                        title="Cantar o dictar la letra al micrófono mientras suena la canción"
                      >
                        <Mic className="w-3 h-3 text-rose-400" />
                        <span>{isDictatingLyrics ? 'Grabando Voz...' : 'Dictar'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowQuickLyricsBox((v) => !v)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-purple-300 text-[11px] font-semibold rounded-xl border border-slate-700 transition"
                      >
                        {showQuickLyricsBox ? 'Ocultar' : (lyrics.length > 0 ? 'Editar Letra' : 'Pegar Letra')}
                      </button>
                    </div>
                  </div>

                  {/* Active running lyric ticker preview (adapts to musical pauses) */}
                  {lyrics.length > 0 && (() => {
                    const sorted = [...lyrics].sort((a, b) => a.time - b.time);
                    let activeIdx = -1;
                    for (let i = 0; i < sorted.length; i++) {
                      if (currentTime >= sorted[i].time) activeIdx = i;
                    }
                    const isIntroWait = activeIdx === -1;
                    const active = activeIdx >= 0 ? sorted[activeIdx] : sorted[0];
                    const nextLine = activeIdx + 1 < sorted.length ? sorted[activeIdx + 1] : null;
                    const phraseEnd = activeIdx >= 0
                      ? Math.min(nextLine ? nextLine.time : duration, active.endTime ?? (nextLine ? nextLine.time : duration))
                      : sorted[0].time;
                    const isInPause = !isIntroWait && currentTime > phraseEnd + 0.15;

                    return (
                      <div className="px-3 py-1.5 rounded-xl bg-black/50 border border-pink-500/20 text-xs text-pink-200 font-medium flex items-center justify-between gap-2 truncate">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] font-mono text-pink-400 shrink-0">
                            {isInPause || isIntroWait ? formatTime(currentTime) : formatTime(active.time)}
                          </span>
                          <span className="truncate">
                            {isIntroWait
                              ? `♪ Intro musical... (${sorted[0].text})`
                              : isInPause
                              ? `♪ Pausa musical...`
                              : `♪ ${active.text}`}
                          </span>
                        </div>
                        {pausesDetectedCount !== null && pausesDetectedCount > 0 && (
                          <span className="text-[10px] text-emerald-300 shrink-0 font-mono">
                            {pausesDetectedCount} pausas adaptadas
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {/* Quick inline paste & automatic sync box */}
                  {showQuickLyricsBox && (
                    <div className="space-y-2 pt-1 border-t border-slate-800">
                      <textarea
                        rows={3}
                        value={rawLyricsInput}
                        onChange={(e) => setRawLyricsInput(e.target.value)}
                        placeholder="Pega aquí la letra de tu canción: se sincronizará automáticamente detectando las pausas e intros reales del audio..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-pink-500"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-emerald-400/90 flex items-center gap-1">
                          {isSyncingLyrics ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>Adaptando automáticamente a las pausas del audio...</span>
                            </>
                          ) : (
                            <span>Sincronización automática con el audio (sin ajustes manuales)</span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAiSyncLyrics()}
                          disabled={!rawLyricsInput.trim() || isSyncingLyrics}
                          className="px-3.5 py-1.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-xs font-bold rounded-xl transition disabled:opacity-50"
                        >
                          Sincronizar Ahora
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Primary Action Buttons */}
                <div className="flex items-center justify-between flex-wrap gap-2.5">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePlayPause}
                      disabled={isExporting || isFastRendering}
                      className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white flex items-center justify-center shadow-lg shadow-purple-600/30 transition disabled:opacity-50"
                      title={isPlaying ? 'Pausar' : 'Reproducir vista previa'}
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                    </button>

                    <button
                      onClick={() => handleSeek(0)}
                      disabled={isExporting || isFastRendering}
                      className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition disabled:opacity-50"
                      title="Reiniciar reproducción"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Fast Server-Side FFmpeg Loop & Merge MP4 */}
                    <button
                      onClick={handleFastMergeMp4AndDownload}
                      disabled={isExporting || isFastRendering}
                      className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-2xl shadow-lg shadow-emerald-600/30 flex items-center gap-2 transition disabled:opacity-50"
                      title={`Une y repite el video automáticamente hasta durar ${formatTime(duration)} y lo descarga en MP4 rápido`}
                    >
                      {isFastRendering ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Creando MP4...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4 text-amber-300" />
                          <span>Crear y Descargar MP4 Rápido</span>
                        </>
                      )}
                    </button>

                    {/* Real-Time Canvas + Audio Recording */}
                    <button
                      onClick={handleExportVideo}
                      disabled={isExporting || isFastRendering}
                      className="px-4 py-2.5 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white text-xs font-bold rounded-2xl shadow-lg shadow-pink-600/30 flex items-center gap-2 transition disabled:opacity-50"
                      title={`Graba y descarga el video con efectos y visualizador durante toda la canción (${formatTime(duration)})`}
                    >
                      {isExporting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Grabando {exportProgress}%</span>
                        </>
                      ) : (
                        <>
                          <VideoIcon className="w-4 h-4" />
                          <span>Grabar y Descargar</span>
                        </>
                      )}
                    </button>

                    {/* Download Studio Frame as HD Photo (.png) */}
                    <button
                      onClick={handleDownloadCoverPhoto}
                      disabled={isExporting || isFastRendering}
                      className="px-3.5 py-2.5 bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 text-white text-xs font-bold rounded-2xl shadow-lg shadow-sky-600/30 flex items-center gap-1.5 transition disabled:opacity-50"
                      title="Descarga una foto HD (.png) de la escena actual con el título y la letra"
                    >
                      <ImageIcon className="w-4 h-4" />
                      <span>Foto (.png)</span>
                    </button>

                    {/* Guardar en Biblioteca al Instante (0 seg) */}
                    <button
                      onClick={handleSaveToLibraryDirectly}
                      disabled={isExporting || isFastRendering}
                      className="px-3.5 py-2.5 bg-gradient-to-r from-purple-700 to-indigo-600 hover:from-purple-600 hover:to-indigo-500 text-white text-xs font-bold rounded-2xl shadow-lg shadow-purple-700/30 flex items-center gap-1.5 transition disabled:opacity-50"
                      title="Guarda el proyecto en tu biblioteca en 0 segundos con letras y efectos para reproducir en cualquier momento"
                    >
                      <Save className="w-4 h-4 text-amber-300" />
                      <span>Guardar</span>
                    </button>
                  </div>
                </div>

                {/* Fast FFmpeg Merge / MP4 Conversion Progress Banner */}
                {isFastRendering && (
                  <div className="p-4 bg-slate-950 border border-emerald-500/40 rounded-2xl space-y-2 animate-fadeIn shadow-2xl">
                    <div className="flex items-center gap-2.5 text-xs font-bold text-emerald-300">
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      <span>{fastRenderProgressText || 'Procesando video MP4 compatible con Google Drive...'}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Codificando en <strong>MP4 (H.264 + AAC)</strong> para reproducirse sin problemas en Google Drive y móviles. Se descargará automáticamente al terminar.
                    </p>
                  </div>
                )}

                {/* Active Exporting Live HUD */}
                {isExporting && (
                  <div className="p-4 bg-slate-950 border border-pink-500/40 rounded-2xl space-y-3 animate-fadeIn shadow-2xl">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                        <span className="text-xs font-bold text-rose-300">
                          Grabando video con duración exacta de la canción
                        </span>
                      </div>
                      <div className="text-xs font-mono text-pink-400 font-bold">
                        {formatTime(exportSecondsElapsed)} / {formatTime(exportTargetSeconds)} ({exportProgress}%)
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden p-0.5">
                      <div
                        className="bg-gradient-to-r from-purple-500 via-pink-500 to-rose-500 h-full rounded-full transition-all duration-200"
                        style={{ width: `${exportProgress}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                      <p className="text-[11px] text-slate-400">
                        Restante aprox:{' '}
                        <span className="text-white font-mono font-bold">
                          {formatTime(Math.max(0, exportTargetSeconds - exportSecondsElapsed))}
                        </span>
                      </p>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleFinishExportEarly}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition shadow-md"
                          title="Finaliza la grabación ahora con los segundos grabados hasta este momento"
                        >
                          <StopCircle className="w-3.5 h-3.5" />
                          <span>Terminar y Descargar Ahora</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelExport}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Cancelar</span>
                        </button>
                      </div>
                    </div>

                    {/* Explanatory note */}
                    <div className="p-2.5 bg-pink-950/20 border border-pink-900/40 rounded-xl text-[11px] text-pink-300/90 flex items-start gap-2 leading-relaxed">
                      <Info className="w-4 h-4 text-pink-400 shrink-0 mt-0.5" />
                      <span>
                        El video durará <strong>{formatTime(exportTargetSeconds)}</strong>, exactamente igual a la canción. Si el video de tu galería es más corto, se repite automáticamente sin cortes mientras se graba la canción completa.
                      </span>
                    </div>
                  </div>
                )}

                {/* Post-export options */}
                {exportedVideoUrl && !isExporting && !isFastRendering && (
                  <div className="p-4 bg-emerald-950/40 border border-emerald-800/60 rounded-2xl flex items-center justify-between gap-3 animate-fadeIn flex-wrap">
                    <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                      <Check className="w-5 h-5 shrink-0" />
                      <span>¡Tu video (.{exportedExtension}) está listo, sincronizado y compatible con Google Drive!</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleDownloadExported}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-md"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Descargar (.{exportedExtension})</span>
                      </button>
                      <button
                        onClick={handleSaveToLibraryDirectly}
                        className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-md"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Guardar en Biblioteca</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Customization Panels (Style, Lyrics, Media) (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl flex flex-col h-full">
            {/* Tabs */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-2xl border border-slate-800 mb-5">
              <button
                onClick={() => setActiveTab('style')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                  activeTab === 'style'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Palette className="w-3.5 h-3.5" />
                Estilo y Letras
              </button>
              <button
                onClick={() => setActiveTab('lyrics')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                  activeTab === 'lyrics'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Type className="w-3.5 h-3.5" />
                Letras ({lyrics.length})
              </button>
              <button
                onClick={() => setActiveTab('media')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                  activeTab === 'media'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                Canción & Fuentes
              </button>
            </div>

            {/* TAB 1: STYLE CUSTOMIZATION */}
            {activeTab === 'style' && (
              <div className="space-y-4 flex-1 overflow-y-auto max-h-[520px] pr-1">
                {/* Title & Artist Input (Ensures video title equals song title) */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300">
                    Título de la Canción (será el título del video)
                  </label>
                  <input
                    type="text"
                    value={songTitle}
                    onChange={(e) => setSongTitle(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-100 font-semibold focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300">
                    Artista / Banda
                  </label>
                  <input
                    type="text"
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300 flex items-center justify-between">
                    <span>Historia u Origen de mi Canción (Opcional)</span>
                    <span className="text-[10px] text-purple-400 font-normal">Para buscar videos relacionados</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Agrega el origen, inspiración o de qué trata tu canción..."
                    value={songOrigin}
                    onChange={(e) => setSongOrigin(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
                  />
                </div>

                {/* Aspect Ratio */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300">
                    Formato de Video
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: '16:9', label: '16:9 Horizontal (YouTube / TV)' },
                      { id: '9:16', label: '9:16 Vertical (Reels / TikTok)' },
                      { id: '1:1', label: '1:1 Cuadrado (Instagram)' },
                    ].map((ar) => (
                      <button
                        key={ar.id}
                        onClick={() => setStyle({ ...style, aspectRatio: ar.id as AspectRatio })}
                        className={`p-2 rounded-xl text-xs font-bold border transition text-center ${
                          style.aspectRatio === ar.id
                            ? 'bg-purple-600/30 border-purple-500 text-purple-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {ar.id}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font Family Selection */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300">
                    Fuente de Letras
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { name: 'Montserrat', label: 'Montserrat (Moderna)' },
                      { name: 'Playfair Display', label: 'Playfair (Elegante)' },
                      { name: 'Orbitron', label: 'Orbitron (Futurista / Neón)' },
                      { name: 'Dancing Script', label: 'Dancing (Manuscrita)' },
                      { name: 'Poppins', label: 'Poppins (Limpia)' },
                      { name: 'Space Mono', label: 'Space Mono (Retro)' },
                    ].map((font) => (
                      <button
                        key={font.name}
                        onClick={() => setStyle({ ...style, fontFamily: font.name as FontFamily })}
                        className={`p-2.5 rounded-xl text-xs font-medium border text-left transition ${
                          style.fontFamily === font.name
                            ? 'bg-purple-600/30 border-purple-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                        style={{ fontFamily: font.name }}
                      >
                        {font.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Lyric Effects Selection */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300">
                    Efectos de Letras en el Video
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'karaoke-sweep', label: 'Barrido Karaoke' },
                      { id: 'neon-pulse', label: 'Neón Pulsante' },
                      { id: 'fade-slide', label: 'Entrada Cine Suave' },
                      { id: 'typewriter', label: 'Máquina de Escribir' },
                      { id: 'bounce-pop', label: 'Pop Rebote Urbano' },
                      { id: 'subtitle-clean', label: 'Subtítulo Limpio' },
                    ].map((ef) => (
                      <button
                        key={ef.id}
                        type="button"
                        onClick={() => setStyle({ ...style, lyricEffect: ef.id as LyricEffect })}
                        className={`p-2.5 rounded-xl text-xs font-semibold border text-left transition ${
                          (style.lyricEffect || 'karaoke-sweep') === ef.id
                            ? 'bg-pink-600/30 border-pink-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {ef.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Visualizer Theme Selection */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300">
                    Efecto Visualizador Musical
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'spectrum-bars', label: 'Barras Neón' },
                      { id: 'neon-waves', label: 'Ondas de Frecuencia' },
                      { id: 'vinyl-record', label: 'Disco de Vinilo Giratorio' },
                      { id: 'cosmic-particles', label: 'Galaxia de Partículas' },
                      { id: 'camera-live', label: 'Cámara en Vivo' },
                    ].map((v) => (
                      <button
                        key={v.id}
                        onClick={() => {
                          if (v.id === 'camera-live' && !cameraActive) {
                            toggleCamera();
                          } else {
                            setStyle({ ...style, visualizerTheme: v.id as VisualizerTheme });
                          }
                        }}
                        className={`p-2.5 rounded-xl text-xs font-semibold border text-left transition ${
                          style.visualizerTheme === v.id
                            ? 'bg-purple-600/30 border-purple-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Colors: Active lyric, glow, background */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300">
                    Colores de la Letra y Fondo
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400">Letra Activa</span>
                      <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800">
                        <input
                          type="color"
                          value={style.activeLyricColor}
                          onChange={(e) => setStyle({ ...style, activeLyricColor: e.target.value })}
                          className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                        />
                        <span className="text-[10px] font-mono text-slate-300">{style.activeLyricColor}</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400">Resplandor Neón</span>
                      <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800">
                        <input
                          type="color"
                          value={style.glowColor}
                          onChange={(e) => setStyle({ ...style, glowColor: e.target.value })}
                          className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                        />
                        <span className="text-[10px] font-mono text-slate-300">{style.glowColor}</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400">Fondo</span>
                      <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800">
                        <input
                          type="color"
                          value={style.backgroundColor}
                          onChange={(e) => setStyle({ ...style, backgroundColor: e.target.value })}
                          className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                        />
                        <span className="text-[10px] font-mono text-slate-300">{style.backgroundColor}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Text Alignment */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300">Alineación del Texto</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['left', 'center', 'right'] as const).map((align) => (
                      <button
                        key={align}
                        onClick={() => setStyle({ ...style, textAlignment: align })}
                        className={`p-2 rounded-xl text-xs font-bold border capitalize transition ${
                          style.textAlignment === align
                            ? 'bg-purple-600/30 border-purple-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {align === 'left' ? 'Izquierda' : align === 'center' ? 'Centrado' : 'Derecha'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Adaptive Lyrics Sizing & Font Size Control */}
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-bold text-slate-200 block">Letra Adaptable Automática</span>
                      <span className="text-[10px] text-slate-400">
                        Ajusta versos largos y evita recortes en 16:9, 9:16 y 1:1
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStyle({ ...style, adaptiveLyrics: style.adaptiveLyrics === false })}
                      className={`px-3 py-1 rounded-xl text-[11px] font-bold border transition ${
                        style.adaptiveLyrics !== false
                          ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                          : 'bg-slate-900 border-slate-700 text-slate-400'
                      }`}
                    >
                      {style.adaptiveLyrics !== false ? 'Activa' : 'Manual'}
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-slate-400 shrink-0">Tamaño base:</span>
                    <input
                      type="range"
                      min={18}
                      max={42}
                      value={style.lyricsFontSize}
                      onChange={(e) => setStyle({ ...style, lyricsFontSize: Number(e.target.value) })}
                      className="w-full accent-purple-500 cursor-pointer"
                    />
                    <span className="text-[11px] font-mono text-purple-300 w-9 text-right">{style.lyricsFontSize}px</span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: AUTOMATICALLY SYNCHRONIZED LYRICS */}
            {activeTab === 'lyrics' && (
              <div className="space-y-4 flex-1 overflow-y-auto max-h-[520px] pr-1">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-slate-300 block">
                      Sincronización Automática ({lyrics.length} versos)
                    </span>
                    <span className="text-[10px] text-emerald-400">
                      Se adapta automáticamente a las pausas e intros reales del audio
                    </span>
                  </div>
                  <button
                    onClick={() => handleAiSyncLyrics()}
                    disabled={isSyncingLyrics}
                    className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow transition disabled:opacity-50 shrink-0"
                  >
                    {isSyncingLyrics ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>Re-sincronizar Audio</span>
                  </button>
                </div>

                {/* Paste raw lyrics tool - auto-syncs on paste/edit */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-slate-400">
                    Pega la letra completa aquí (se alinea automáticamente sin tiempos manuales):
                  </span>
                  <textarea
                    rows={3}
                    placeholder="Pega aquí la letra línea por línea: la app analiza el audio y adapta cada verso a sus pausas..."
                    value={rawLyricsInput}
                    onChange={(e) => setRawLyricsInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">
                      {isSyncingLyrics ? 'Detectando pausas en el audio...' : 'Auto-sincronización activa al pegar o editar'}
                    </span>
                    <button
                      onClick={() => handleAiSyncLyrics()}
                      disabled={!rawLyricsInput.trim() || isSyncingLyrics}
                      className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition disabled:opacity-50"
                    >
                      Alinear con Pausas
                    </button>
                  </div>
                </div>

                {/* Lyrics Lines List with manual time adjustment */}
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  {lyrics.map((line, idx) => (
                    <div
                      key={line.id}
                      className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2"
                    >
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={line.time}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const updated = [...lyrics];
                          updated[idx].time = val;
                          setLyrics(updated);
                        }}
                        className="w-14 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-xs text-purple-300 font-mono text-center focus:outline-none"
                        title="Tiempo en segundos"
                      />
                      <input
                        type="text"
                        value={line.text}
                        onChange={(e) => {
                          const updated = [...lyrics];
                          updated[idx].text = e.target.value;
                          setLyrics(updated);
                        }}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-100 focus:outline-none"
                      />
                      <button
                        onClick={() => {
                          setLyrics(lyrics.filter((_, i) => i !== idx));
                        }}
                        className="p-1 text-slate-500 hover:text-rose-400 transition"
                        title="Eliminar verso"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  <button
                    onClick={() => {
                      const lastTime = lyrics[lyrics.length - 1]?.time || 0;
                      setLyrics([
                        ...lyrics,
                        {
                          id: 'line-' + Date.now(),
                          time: Math.round((lastTime + 4) * 10) / 10,
                          text: 'Nuevo verso musical',
                        },
                      ]);
                    }}
                    className="w-full py-2 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-dashed border-slate-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Añadir Verso
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: MEDIA & SOURCES */}
            {activeTab === 'media' && (
              <div className="space-y-4 flex-1 overflow-y-auto max-h-[520px] pr-1">
                {/* 1. Gallery Photo or Video Upload */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <ImageIcon className="w-4 h-4 text-fuchsia-400" />
                    <span>1. Foto(s) o Video de tu Galería (duran igual a la canción)</span>
                  </label>
                  <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-fuchsia-800/60 hover:border-fuchsia-500 rounded-2xl cursor-pointer bg-slate-950/60 transition group">
                    <ImageIcon className="w-7 h-7 text-fuchsia-400 group-hover:scale-110 mb-1.5 transition" />
                    <span className="text-xs font-bold text-slate-200">
                      {(videoSourceType === 'gallery' || videoSourceType === 'photo') && storyVideoTheme
                        ? `Fondo activo: ${storyVideoTheme}`
                        : 'Seleccionar Fotos (JPG/PNG) o Video (MP4/MOV)'}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-1 text-center">
                      Puedes elegir una o varias fotos, o un video corto que se repite sin cortes toda la canción
                    </span>
                    <input
                      type="file"
                      accept="video/*,image/*"
                      multiple
                      onChange={handleGalleryVideoUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* 2. Local Song Upload */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Music className="w-4 h-4 text-pink-400" />
                    <span>2. Incorporar Canción Descargada (Audio)</span>
                  </label>
                  <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-800 hover:border-purple-500/60 rounded-2xl cursor-pointer bg-slate-950/60 transition group">
                    <Upload className="w-7 h-7 text-slate-500 group-hover:text-purple-400 mb-1.5 transition" />
                    <span className="text-xs font-bold text-slate-200">
                      {audioFileName
                        ? `Canción activa: ${audioFileName}`
                        : 'Seleccionar Canción MP3, WAV, M4A'}
                    </span>
                    <span className="text-[10px] text-slate-500 mt-1">
                      Sincroniza la letra con la voz del cantante y ajusta la duración total al audio
                    </span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={handleLocalAudioUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Google Drive Direct Button */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300">
                    Google Drive
                  </label>
                  <button
                    onClick={onOpenGoogleDrive}
                    className="w-full p-4 rounded-2xl bg-slate-950 border border-slate-800 hover:border-blue-500/50 flex items-center justify-between text-left transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
                        <Cloud className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-200">Explorar Google Drive</p>
                        <p className="text-[10px] text-slate-400">
                          Descarga canciones, fotos o videos directamente de tu nube
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-blue-400 font-bold">Abrir</span>
                  </button>
                </div>

                {/* Video que se asemeja a la historia */}
                <div className="space-y-2 p-3.5 bg-slate-950/80 rounded-2xl border border-slate-800">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <VideoIcon className="w-4 h-4 text-emerald-400" />
                      <span>Video de Historia / Web</span>
                    </label>
                    <button
                      onClick={() => onOpenSongStory(songTitle, songOrigin)}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-semibold"
                    >
                      Ver Opciones Web
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Asigna o descarga automáticamente cualquier video temático que se asemeje o aproxime a la historia de tu canción.
                  </p>
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleAutoMatchStoryVideo()}
                      disabled={isSearchingStoryVideo}
                      className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition disabled:opacity-50"
                    >
                      {isSearchingStoryVideo ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>Auto-Asignar Video</span>
                    </button>

                    {storyVideoUrl && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDownloadStoryVideo(false)}
                          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-600/40 text-xs font-bold rounded-xl flex items-center gap-1.5 transition"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Descargar MP4</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadStoryVideo(true)}
                          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-600/40 text-xs font-bold rounded-xl flex items-center gap-1.5 transition"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                          <span>Descargar Foto</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Target Folder in Library */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300">
                    Carpeta de Guardado en la Biblioteca
                  </label>
                  <select
                    value={selectedFolderId}
                    onChange={(e) => setSelectedFolderId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
                  >
                    <option value="root">Sin Carpeta (General)</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
