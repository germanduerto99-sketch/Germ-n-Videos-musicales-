export interface LyricLine {
  id: string;
  time: number; // start time in seconds
  endTime?: number; // acoustic phrase end time in seconds (adapts to song pauses)
  text: string;
}

export type VisualizerTheme = 
  | 'spectrum-bars' 
  | 'neon-waves' 
  | 'vinyl-record' 
  | 'cosmic-particles' 
  | 'stage-spotlight' 
  | 'gradient-glow'
  | 'camera-live';

export type AspectRatio = '16:9' | '9:16' | '1:1';

export type FontFamily = 
  | 'Montserrat' 
  | 'Playfair Display' 
  | 'Orbitron' 
  | 'Dancing Script' 
  | 'Poppins' 
  | 'Space Mono';

export type LyricEffect =
  | 'karaoke-sweep'
  | 'neon-pulse'
  | 'fade-slide'
  | 'typewriter'
  | 'bounce-pop'
  | 'subtitle-clean';

export interface VideoStyleConfig {
  fontFamily: FontFamily;
  titleFontSize: number;
  lyricsFontSize: number;
  textColor: string;
  activeLyricColor: string;
  secondaryLyricColor: string;
  glowColor: string;
  backgroundColor: string;
  backgroundGradient: string;
  visualizerTheme: VisualizerTheme;
  lyricEffect?: LyricEffect;
  aspectRatio: AspectRatio;
  showVisualizer: boolean;
  showTitleHeader: boolean;
  adaptiveLyrics?: boolean;
  textAlignment: 'center' | 'left' | 'right';
  backgroundMediaUrl?: string; // custom image or video background
}

export interface VideoFolder {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

export interface LibraryVideo {
  id: string;
  title: string; // equal to song title
  artist: string;
  duration: number; // in seconds
  folderId?: string; // 'root' or folder id
  createdAt: number;
  modifiedAt: number;
  thumbnailUrl?: string;
  videoBlob?: Blob;
  videoUrl?: string;
  audioBlob?: Blob;
  audioUrl?: string;
  lyrics: LyricLine[];
  style: VideoStyleConfig;
  sourceType: 'generated' | 'gallery' | 'drive' | 'camera';
  fileSize?: number;
}

export interface SongStoryResult {
  title: string;
  artist?: string;
  origin?: string;
  story: string;
  meaning: string;
  releaseYear?: string;
  trivia: string[];
  videoSearchQueries: string[];
}
