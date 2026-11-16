import React, { useState } from 'react';
import { LibraryVideo } from '../types';
import { downloadVideoAsMp4 } from '../services/videoConverter';
import { X, Download, Film, Music, FileText, Share2, Loader2 } from 'lucide-react';

interface VideoPlayerModalProps {
  video: LibraryVideo | null;
  onClose: () => void;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({ video, onClose }) => {
  const [showLyricsPanel, setShowLyricsPanel] = useState(true);
  const [isConvertingMp4, setIsConvertingMp4] = useState(false);

  if (!video) return null;

  const videoSrc = video.videoUrl || (video.videoBlob ? URL.createObjectURL(video.videoBlob) : '');
  const audioSrc = video.audioUrl || (video.audioBlob ? URL.createObjectURL(video.audioBlob) : '');

  const handleDownload = async () => {
    const src = videoSrc || audioSrc;
    if (!src) return;
    const cleanTitle = (video.title || 'video').replace(/[/\\?%*:|"<>]/g, '_');
    if (!videoSrc) {
      const a = document.createElement('a');
      a.href = src;
      a.download = `${cleanTitle}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    setIsConvertingMp4(true);
    try {
      await downloadVideoAsMp4({
        blob: video.videoBlob,
        url: video.videoUrl || videoSrc,
        title: cleanTitle,
      });
    } finally {
      setIsConvertingMp4(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/90 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Top Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center text-white shrink-0">
              <Film className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-base text-white truncate" title={video.title}>
                {video.title}
              </h3>
              <p className="text-xs text-purple-400 truncate">
                {video.artist || 'Canción en video'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLyricsPanel(!showLyricsPanel)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                showLyricsPanel
                  ? 'bg-purple-600/30 text-purple-300 border border-purple-500/50'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Letras</span>
            </button>

            <button
              onClick={handleDownload}
              disabled={isConvertingMp4}
              className="px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-md transition disabled:opacity-60"
            >
              {isConvertingMp4 ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{isConvertingMp4 ? 'Convirtiendo MP4...' : 'Descargar MP4'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Player and lyrics view */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-black">
          {/* Main Video View */}
          <div className="flex-1 flex items-center justify-center p-4 relative bg-black min-h-[300px]">
            {videoSrc && videoSrc.trim() !== '' ? (
              <video
                src={videoSrc}
                controls
                autoPlay
                className="max-h-[72vh] max-w-full rounded-lg shadow-2xl object-contain"
              />
            ) : audioSrc && audioSrc.trim() !== '' ? (
              <div className="flex flex-col items-center justify-center p-6 space-y-4 w-full max-w-md text-center bg-slate-900/60 rounded-2xl border border-slate-800">
                <div className="w-28 h-28 rounded-2xl bg-gradient-to-tr from-purple-600 to-pink-600 flex items-center justify-center shadow-xl shadow-purple-600/30 overflow-hidden relative">
                  {video.thumbnailUrl ? (
                    <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover" />
                  ) : (
                    <Music className="w-12 h-12 text-white" />
                  )}
                </div>
                <div>
                  <h4 className="text-lg font-bold text-white truncate max-w-xs">{video.title}</h4>
                  <p className="text-xs text-purple-400 truncate max-w-xs">{video.artist || 'Canción en biblioteca'}</p>
                </div>
                <audio
                  src={audioSrc}
                  controls
                  autoPlay
                  className="w-full accent-purple-500"
                />
              </div>
            ) : (
              <div className="text-center text-slate-500 p-8">
                <Music className="w-12 h-12 mx-auto mb-2 text-slate-600" />
                <p>El reproductor de video no está disponible.</p>
              </div>
            )}
          </div>

          {/* Side Lyrics Panel */}
          {showLyricsPanel && video.lyrics && video.lyrics.length > 0 && (
            <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-950 p-4 overflow-y-auto max-h-[30vh] lg:max-h-full">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-purple-400" />
                Letra sincronizada de la canción
              </h4>
              <div className="space-y-2">
                {video.lyrics.map((line, idx) => (
                  <div
                    key={line.id || idx}
                    className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/80 hover:border-purple-500/40 text-xs text-slate-300 flex items-start gap-2"
                  >
                    <span className="font-mono text-[10px] text-purple-400 shrink-0 mt-0.5">
                      {Math.floor(line.time / 60)}:
                      {Math.floor(line.time % 60)
                        .toString()
                        .padStart(2, '0')}
                    </span>
                    <span className="leading-snug">{line.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
