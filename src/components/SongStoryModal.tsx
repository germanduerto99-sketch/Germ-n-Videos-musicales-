import React, { useState } from 'react';
import { SongStoryResult } from '../types';
import { 
  Sparkles, 
  Search, 
  Globe, 
  BookOpen, 
  Lightbulb, 
  X, 
  Loader2, 
  Film, 
  Music2, 
  FileText,
  Compass,
  Download,
  Check,
  Play,
  Image as ImageIcon
} from 'lucide-react';

interface StoryPhotoItem {
  id: string;
  title: string;
  category: string;
  tags: string[];
  previewUrl: string;
  downloadUrl: string;
}

interface SongStoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultSongTitle?: string;
  defaultOriginOrStory?: string;
  onConvertToVideo?: (songTitle: string, songOrigin: string) => void;
  onApplyStoryVideo?: (videoUrl: string, theme: string) => void;
  onApplyStoryPhoto?: (photo: { photoId: string; title: string; imageUrl: string; downloadUrl: string }) => void;
}

export const SongStoryModal: React.FC<SongStoryModalProps> = ({
  isOpen,
  onClose,
  defaultSongTitle = '',
  defaultOriginOrStory = '',
  onConvertToVideo,
  onApplyStoryVideo,
  onApplyStoryPhoto,
}) => {
  const [songTitle, setSongTitle] = useState(defaultSongTitle);
  const [songOrigin, setSongOrigin] = useState(defaultOriginOrStory);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SongStoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Matched Story Video State
  const [matchedVideo, setMatchedVideo] = useState<{
    id: string;
    title: string;
    videoUrl: string;
    description: string;
    thumbnail?: string;
  } | null>({
    id: 'sunset_romance',
    title: 'Atardecer y Recuerdos Románticos',
    videoUrl: '/api/video-stream?theme=sunset_romance',
    description: 'Tomas cinemáticas de atardecer y horizontes que se aproximan a la historia de la canción.',
    thumbnail: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=640&q=80'
  });
  const [alternativeVideos, setAlternativeVideos] = useState<any[]>([]);
  const [videoDownloadStatus, setVideoDownloadStatus] = useState<string | null>(null);
  const [storyPhotos, setStoryPhotos] = useState<StoryPhotoItem[]>([]);
  const [photoCategory, setPhotoCategory] = useState<string>('Todas');
  const [photoQuery, setPhotoQuery] = useState<string>('');

  // Embedded Web Video Player State
  const [embeddedSearchTerm, setEmbeddedSearchTerm] = useState<string>('');

  React.useEffect(() => {
    if (!isOpen) return;
    const qParam = photoQuery.trim() || songTitle.trim();
    const params = new URLSearchParams();
    if (qParam) params.set('q', qParam);
    if (photoCategory && photoCategory !== 'Todas') params.set('category', photoCategory);
    fetch(`/api/story-photos?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.photos)) {
          setStoryPhotos(d.photos);
        }
      })
      .catch(() => {});
  }, [isOpen, photoCategory, photoQuery]);

  const handleSearchStory = async () => {
    if (!songTitle.trim()) return;
    setLoading(true);
    setError(null);

    const queryTerm = songOrigin.trim()
      ? `${songTitle.trim()} ${songOrigin.slice(0, 40)} historia documental`
      : `${songTitle.trim()} historia documental cancion`;
    setEmbeddedSearchTerm(queryTerm);

    // Search and match video approximating the story in parallel
    fetch('/api/search-story-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songTitle: songTitle.trim(),
        songOrigin: songOrigin.trim(),
      }),
    })
      .then(res => res.json())
      .then(data => {
        if (data && data.selectedVideo) {
          setMatchedVideo(data.selectedVideo);
          setAlternativeVideos(data.alternatives || []);
        }
      })
      .catch(console.warn);

    const fallbackData: SongStoryResult = {
      title: songTitle.trim(),
      origin: songOrigin.trim() || undefined,
      story: songOrigin.trim()
        ? `Origen e inspiración de la canción:\n"${songOrigin.trim()}"\n\nEsta composición surge como un testimonio auténtico de vivencias y emociones que definen el ritmo, la narrativa y la armonía musical de la pieza.`
        : `La canción "${songTitle.trim()}" es una obra que conecta a través de su melodía y poesía lírica, explorando historias y momentos memorables para el oyente.`,
      meaning: songOrigin.trim()
        ? `El mensaje y significado profundos están arraigados en su origen: "${songOrigin.trim().slice(0, 100)}...", convirtiendo cada nota en un reflejo de su narrativa personal.`
        : `Un viaje a través de sentimientos universales, buscando conectar y emocionar a cada persona que escucha sus letras.`,
      releaseYear: 'Producción Original',
      trivia: [
        'El origen de la canción inspiró la progresión armónica y el tempo para el video musical.',
        'Cada estrofa fue concebida para sincronizarse con las letras en pantalla.',
        'Su historia y ritmo han sido diseñados para transmitir su mensaje con fuerza visual.'
      ],
      videoSearchQueries: [
        `${songTitle.trim()} historia cancion`,
        `${songTitle.trim()} video oficial con letras`,
        `${songTitle.trim()} significado documental`,
        `${songTitle.trim()} en vivo`
      ]
    };

    try {
      const res = await fetch('/api/song-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songTitle: songTitle.trim(),
          songOrigin: songOrigin.trim(),
        }),
      });

      if (res.ok) {
        const data: SongStoryResult = await res.json();
        if (data && data.story) {
          setResult(data);
          return;
        }
      }
    } catch (err: any) {
      console.warn('Network issue fetching song story from server:', err);
    } finally {
      setLoading(false);
    }

    // Always set result gracefully so the user always sees their story and web videos
    setResult(fallbackData);
  };

  const handleDownloadDirectVideo = (videoUrl: string, title: string) => {
    setVideoDownloadStatus('Descargando archivo de video (.mp4)...');
    const cleanTitle = (songTitle || title || 'video_historia').replace(/[/\\?%*:|"<>]/g, '_');
    const downloadEndpoint = videoUrl.includes('/api/video-stream')
      ? videoUrl.replace('/api/video-stream', '/api/video-download')
      : `/api/video-download?theme=sunset_romance`;
    const fullUrl = `${downloadEndpoint}&filename=${encodeURIComponent(cleanTitle + '_video.mp4')}`;
    const a = document.createElement('a');
    a.href = fullUrl;
    a.download = `${cleanTitle}_video.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => setVideoDownloadStatus(null), 3000);
  };

  const handleDownloadDirectPhoto = (videoUrl: string, title: string) => {
    setVideoDownloadStatus('Descargando foto HD (.jpg)...');
    const cleanTitle = (songTitle || title || 'foto_historia').replace(/[/\\?%*:|"<>]/g, '_');
    const photoEndpoint = videoUrl.includes('/api/video-stream')
      ? videoUrl.replace('/api/video-stream', '/api/photo-download')
      : `/api/photo-download?theme=sunset_romance`;
    const fullUrl = `${photoEndpoint}&filename=${encodeURIComponent(cleanTitle + '_foto.jpg')}`;
    const a = document.createElement('a');
    a.href = fullUrl;
    a.download = `${cleanTitle}_foto.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => setVideoDownloadStatus(null), 3000);
  };

  if (!isOpen) return null;

  const currentEmbedQuery = embeddedSearchTerm || (songTitle.trim() 
    ? `${songTitle.trim()} historia origen` 
    : 'historia de canciones documentales');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-950">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white shadow-lg">
              <Compass className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-white flex items-center gap-2">
                Buscar Videos e Historias de Canciones en la Web
              </h3>
              <p className="text-xs text-slate-400">
                Reproduce cualquier video web que se asemeje a la historia y al origen de tu canción
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

        {/* Input Bar */}
        <div className="p-4 sm:p-5 bg-slate-950/80 border-b border-slate-800 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {/* Song Title Input */}
            <div className="md:col-span-5 space-y-1">
              <label className="block text-xs font-semibold text-slate-300">
                Título de la canción
              </label>
              <input
                type="text"
                placeholder="Escribe el título de tu canción..."
                value={songTitle}
                onChange={(e) => setSongTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchStory()}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 shadow-inner"
              />
            </div>

            {/* Song Origin / Story Input - Replaces Artist */}
            <div className="md:col-span-7 space-y-1">
              <label className="block text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Historia u origen de mi canción (Opcional)</span>
                <span className="text-[10px] text-indigo-400 font-normal">Inspiración, anécdota o significado</span>
              </label>
              <input
                type="text"
                placeholder="Agrega parte de la historia, cómo se compuso o el origen de tu canción..."
                value={songOrigin}
                onChange={(e) => setSongOrigin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchStory()}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 shadow-inner"
              />
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <span className="text-[11px] text-slate-400">
              Busca videos web relacionados con la historia, el origen e inspiración de tu canción
            </span>
            <button
              onClick={handleSearchStory}
              disabled={loading || !songTitle.trim()}
              className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:opacity-90 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-lg transition disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Buscando videos relacionados...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Buscar Videos de la Historia</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-5 flex-1 overflow-y-auto space-y-6">
          {error && (
            <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-xl text-rose-300 text-xs">
              {error}
            </div>
          )}

          {/* DIRECT DOWNLOADABLE VIDEO MATCHING THE STORY */}
          {matchedVideo && (
            <div className="bg-gradient-to-br from-slate-950 via-purple-950/30 to-slate-950 rounded-2xl overflow-hidden border border-purple-500/40 shadow-2xl p-4 space-y-3 animate-fadeIn">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-pink-500 animate-pulse" />
                  <span className="text-sm font-bold text-white flex items-center gap-2">
                    <Film className="w-4 h-4 text-pink-400" />
                    <span>Video que se asemeja a la historia de tu canción:</span>
                    <span className="text-pink-300 font-semibold text-xs">"{matchedVideo.title}"</span>
                  </span>
                </div>
                {videoDownloadStatus && (
                  <span className="text-xs font-bold text-emerald-400 animate-fadeIn">
                    {videoDownloadStatus}
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {matchedVideo.description}
              </p>

              {/* Live Video Preview Player */}
              <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-black border border-slate-800 shadow-inner">
                <video
                  src={matchedVideo.videoUrl}
                  controls
                  loop
                  autoPlay
                  muted
                  playsInline
                  crossOrigin="anonymous"
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Action Buttons for this Video */}
              <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {onApplyStoryVideo && (
                    <button
                      type="button"
                      onClick={() => {
                        onApplyStoryVideo(matchedVideo.videoUrl, matchedVideo.title);
                        onClose();
                      }}
                      className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-purple-600/30 flex items-center gap-2 transition"
                    >
                      <Film className="w-4 h-4" />
                      <span>Usar este Video como Fondo en el Estudio</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDownloadDirectVideo(matchedVideo.videoUrl, matchedVideo.title)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl border border-slate-700 flex items-center gap-2 transition"
                    title="Descargar este archivo de video directamente a tu dispositivo"
                  >
                    <Download className="w-4 h-4 text-emerald-400" />
                    <span>Descargar Video (.mp4)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownloadDirectPhoto(matchedVideo.videoUrl, matchedVideo.title)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl border border-slate-700 flex items-center gap-2 transition"
                    title="Descargar imagen HD (.jpg) de esta escena"
                  >
                    <ImageIcon className="w-4 h-4 text-sky-400" />
                    <span>Descargar Foto (.jpg)</span>
                  </button>
                </div>

                <span className="text-[11px] text-slate-400 italic">
                  No tiene que ser exacto, se aproxima a la historia
                </span>
              </div>

              {/* Alternative Thematic Videos */}
              {alternativeVideos.length > 0 && (
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <span className="text-[11px] font-bold text-slate-400">
                    Otras opciones que también se aproximan a la historia:
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {alternativeVideos.map((alt) => (
                      <button
                        key={alt.id}
                        type="button"
                        onClick={() => setMatchedVideo(alt)}
                        className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/50 text-left transition flex flex-col justify-between"
                      >
                        <span className="text-xs font-bold text-slate-200 line-clamp-1">{alt.title}</span>
                        <span className="text-[10px] text-purple-400 mt-1">Ver y Usar</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SELECTABLE REAL PHOTOGRAPHY (Personas, Parejas, Paisajes, Escenas) FOR THE SONG STORY */}
          <div className="bg-slate-950/90 rounded-2xl border border-sky-500/30 p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-sky-400" />
                  <span>Escoger Foto para la Historia (Personas, Paisajes, Escenas...)</span>
                </h4>
                <p className="text-[11px] text-slate-400">
                  Elige una imagen real (persona, pareja, playa, montañas, ciudad, intérprete) para relacionarla con la canción o descargarla.
                </p>
              </div>
              <input
                type="text"
                value={photoQuery}
                onChange={(e) => setPhotoQuery(e.target.value)}
                placeholder="Buscar persona, playa, montaña..."
                className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 w-full sm:w-56"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {['Todas', 'Personas', 'Paisajes', 'Música', 'Ciudad'].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setPhotoCategory(cat)}
                  className={`px-3 py-1 rounded-xl text-[11px] font-bold transition ${
                    photoCategory === cat
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-900 text-slate-300 border border-slate-800 hover:border-sky-500/40'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {storyPhotos.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {storyPhotos.map((photo) => {
                  const cleanBase = (songTitle || photo.title || 'foto_historia').replace(/[/\\?%*:|"<>]/g, '_');
                  const dlHref = `/api/photo-download?photoId=${encodeURIComponent(photo.id)}&download=1&filename=${encodeURIComponent(cleanBase + '.jpg')}`;
                  return (
                    <div
                      key={photo.id}
                      className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col justify-between group hover:border-sky-500/60 transition"
                    >
                      <div className="aspect-video w-full overflow-hidden bg-slate-950 relative">
                        <img
                          src={photo.previewUrl}
                          alt={photo.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-bold text-sky-300">
                          {photo.category}
                        </span>
                      </div>
                      <div className="p-2 space-y-2">
                        <p className="text-[11px] font-semibold text-slate-200 line-clamp-1" title={photo.title}>
                          {photo.title}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {onApplyStoryPhoto && (
                            <button
                              type="button"
                              onClick={() => {
                                onApplyStoryPhoto({
                                  photoId: photo.id,
                                  title: photo.title,
                                  imageUrl: photo.previewUrl,
                                  downloadUrl: dlHref,
                                });
                                onClose();
                              }}
                              className="flex-1 py-1.5 px-2 bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold rounded-lg transition text-center"
                            >
                              Escoger
                            </button>
                          )}
                          <a
                            href={dlHref}
                            download={`${cleanBase}.jpg`}
                            className="py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-[10px] font-bold rounded-lg flex items-center gap-1 transition"
                            title="Descargar esta foto (.jpg)"
                          >
                            <Download className="w-3 h-3" />
                            <span>Bajar</span>
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* EMBEDDED WEB VIDEO PLAYER */}
          {songTitle.trim() && (
            <div className="bg-black rounded-2xl overflow-hidden border border-slate-800 shadow-2xl space-y-2 p-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <Film className="w-4 h-4 text-pink-400" />
                  <span>Videos Web Relacionados con la Historia: "{currentEmbedQuery}"</span>
                </span>
                <span className="text-[10px] text-slate-400">YouTube & Web</span>
              </div>

              {/* YouTube Search Embedded Player */}
              <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-black">
                <iframe
                  title="Video Web de la Historia"
                  src={`https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent(currentEmbedQuery)}&autoplay=0`}
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>

              {/* Quick Preset Queries for Videos */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 text-[11px]">
                <span className="text-slate-500 shrink-0">Temas:</span>
                {[
                  { label: 'Historia y Origen', q: `${songTitle} ${songOrigin.slice(0, 30)} historia origen cancion` },
                  { label: 'Significado de la Letra', q: `${songTitle} significado explicacion letra` },
                  { label: 'Inspiración Detrás de la Canción', q: `${songTitle} documental como se compuso` },
                  { label: 'En Vivo con Letras', q: `${songTitle} en vivo con letras` },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => setEmbeddedSearchTerm(item.q)}
                    className={`px-3 py-1 rounded-lg font-semibold shrink-0 transition ${
                      embeddedSearchTerm === item.q
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* AI Analyzed Story & Meaning */}
          {result && (
            <div className="space-y-5 animate-fadeIn">
              {/* Song Header */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-950/70 via-purple-950/40 to-slate-950 border border-indigo-800/40 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h4 className="text-xl font-black text-white">{result.title}</h4>
                  <p className="text-xs text-indigo-300">
                    {result.origin ? `Origen: ${result.origin.slice(0, 80)}...` : 'Historia y significado musical'}
                  </p>
                </div>
                {onConvertToVideo && (
                  <button
                    onClick={() => {
                      onConvertToVideo(result.title, result.origin || songOrigin);
                      onClose();
                    }}
                    className="px-4 py-2 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition"
                  >
                    <Music2 className="w-4 h-4" />
                    <span>Convertir Canción en Video en el Estudio</span>
                  </button>
                )}
              </div>

              {/* Story & Meaning */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <h5 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-indigo-400" />
                    Historia y Contexto de Creación
                  </h5>
                  <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                    {result.story}
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <h5 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-pink-400" />
                    Significado de la Letra y Narrativa
                  </h5>
                  <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                    {result.meaning}
                  </p>
                </div>
              </div>

              {/* Curiosidades */}
              {result.trivia && result.trivia.length > 0 && (
                <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5">
                  <h5 className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <Lightbulb className="w-4 h-4 text-amber-400" />
                    Datos Curiosos y Secretos de la Canción
                  </h5>
                  <ul className="space-y-1.5">
                    {result.trivia.map((fact, index) => (
                      <li key={index} className="text-xs text-slate-300 flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                          {index + 1}
                        </span>
                        <span>{fact}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs text-slate-400">
          <span>Videos web vinculados a la historia y origen de tu canción</span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
