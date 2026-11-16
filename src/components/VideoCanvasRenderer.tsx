import React, { useEffect, useMemo, useRef } from 'react';
import { LyricLine, VideoStyleConfig } from '../types';

interface VideoCanvasRendererProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  songTitle: string;
  artist: string;
  lyrics: LyricLine[];
  currentTime: number;
  duration: number;
  style: VideoStyleConfig;
  audioAnalyser?: AnalyserNode | null;
  audioElementRef?: React.RefObject<HTMLAudioElement | null>;
  videoBackgroundElement?: HTMLVideoElement | null;
  videoBackgroundRef?: React.RefObject<HTMLVideoElement | null>;
  cameraVideoRef?: React.RefObject<HTMLVideoElement | null>;
  photoUrls?: string[];
  isCameraActive?: boolean;
  isRecording?: boolean;
}

interface AdaptiveVerseLayout {
  fontSize: number;
  lines: string[];
  lineWidths: number[];
  lineCumChars: number[];
  totalChars: number;
  subGap: number;
  blockHeight: number;
  widest: number;
}

interface GradientCache {
  key: string;
  bgGrad: CanvasGradient;
  videoOverlay: CanvasGradient;
  photoOverlay: CanvasGradient;
  barGrad: CanvasGradient;
}

// Bounded LRU cache for wrapped lyric geometry & text width measurements (eliminates 60fps GC allocations)
const MAX_LAYOUT_CACHE = 500;
const verseLayoutCache = new Map<string, AdaptiveVerseLayout>();

function cacheVerseLayout(key: string, val: AdaptiveVerseLayout) {
  if (verseLayoutCache.size >= MAX_LAYOUT_CACHE) {
    const firstKey = verseLayoutCache.keys().next().value;
    if (firstKey !== undefined) verseLayoutCache.delete(firstKey);
  }
  verseLayoutCache.set(key, val);
}

function wrapAllWords(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const testLine = currentLine + ' ' + words[i];
    if (ctx.measureText(testLine).width <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = words[i];
    }
  }
  lines.push(currentLine);
  return lines;
}

function getAdaptiveVerseLayout(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontFam: string,
  targetFontSize: number,
  maxWidth: number,
  maxBlockHeight: number,
  adaptiveEnabled: boolean
): AdaptiveVerseLayout {
  const key = `${text}|${fontFam}|${targetFontSize}|${Math.round(maxWidth)}|${Math.round(maxBlockHeight)}|${adaptiveEnabled ? 1 : 0}`;
  const cached = verseLayoutCache.get(key);
  if (cached) return cached;

  const scales = adaptiveEnabled ? [1, 0.9, 0.8, 0.72, 0.64] : [1];
  let chosenFontSize = targetFontSize;
  let chosenLines: string[] = [text.trim()];

  for (const s of scales) {
    const candidateSize = Math.max(15, Math.round(targetFontSize * s));
    ctx.font = `800 ${candidateSize}px "${fontFam}", sans-serif`;
    const wrapped = wrapAllWords(ctx, text, maxWidth);
    const subGap = candidateSize * 1.18;
    const totalH = wrapped.length * subGap;
    chosenFontSize = candidateSize;
    chosenLines = wrapped;

    if (!adaptiveEnabled) {
      // Non-adaptive fallback still fits up to 3 lines cleanly without clipping mid-word
      chosenLines = wrapped.slice(0, 3);
      break;
    }
    if (wrapped.length <= 2 && totalH <= maxBlockHeight) {
      break;
    }
    if (totalH <= maxBlockHeight && wrapped.length <= 3) {
      break;
    }
  }

  ctx.font = `800 ${chosenFontSize}px "${fontFam}", sans-serif`;
  const lineWidths: number[] = [];
  const lineCumChars: number[] = [];
  let widest = 0;
  let accChars = 0;

  for (let i = 0; i < chosenLines.length; i++) {
    const w = ctx.measureText(chosenLines[i]).width;
    lineWidths.push(w);
    if (w > widest) widest = w;
    lineCumChars.push(accChars);
    accChars += chosenLines[i].length;
  }

  const subGap = chosenFontSize * 1.18;
  const blockHeight = Math.max(subGap, chosenLines.length * subGap);

  const computed: AdaptiveVerseLayout = {
    fontSize: chosenFontSize,
    lines: chosenLines,
    lineWidths,
    lineCumChars,
    totalChars: Math.max(1, accChars),
    subGap,
    blockHeight,
    widest,
  };
  cacheVerseLayout(key, computed);
  return computed;
}

export const VideoCanvasRenderer: React.FC<VideoCanvasRendererProps> = ({
  canvasRef,
  songTitle,
  artist,
  lyrics,
  currentTime,
  duration,
  style,
  audioAnalyser,
  audioElementRef,
  videoBackgroundElement,
  videoBackgroundRef,
  cameraVideoRef,
  photoUrls = [],
  isCameraActive = false,
}) => {
  const animFrameIdRef = useRef<number | null>(null);
  const particlesRef = useRef<Array<{ x: number; y: number; size: number; speed: number; angle: number; color: string }>>([]);
  const vinylAngleRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const lastFrameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadedImagesRef = useRef<HTMLImageElement[]>([]);
  const gradientCacheRef = useRef<GradientCache | null>(null);

  // Pre-sort valid lyrics once when lyrics array changes instead of 60 times per second
  const sortedLyrics = useMemo(
    () =>
      [...(lyrics || [])]
        .filter((l) => l && l.text && l.text.trim().length > 0)
        .sort((a, b) => a.time - b.time),
    [lyrics]
  );

  // Preload selected background photos for smooth Ken Burns & slideshow rendering
  useEffect(() => {
    if (!photoUrls || photoUrls.length === 0) {
      loadedImagesRef.current = [];
      return;
    }
    const imgs: HTMLImageElement[] = [];
    photoUrls.forEach((url) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      imgs.push(img);
    });
    loadedImagesRef.current = imgs;
  }, [photoUrls]);

  // Initialize cosmic particles once
  useEffect(() => {
    const particles = [];
    for (let i = 0; i < 56; i++) {
      particles.push({
        x: Math.random() * 1920,
        y: Math.random() * 1080,
        size: Math.random() * 3.8 + 1.5,
        speed: Math.random() * 0.8 + 0.3,
        angle: Math.random() * Math.PI * 2,
        color: ['#EC4899', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B'][Math.floor(Math.random() * 5)],
      });
    }
    particlesRef.current = particles;
  }, []);

  // Live refs to prevent stale closures during canvas animation
  const currentTimeRef = useRef<number>(currentTime);
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const propsRef = useRef({
    songTitle,
    artist,
    sortedLyrics,
    duration,
    style,
    audioAnalyser,
    audioElementRef,
    videoBackgroundElement,
    videoBackgroundRef,
    cameraVideoRef,
    isCameraActive,
  });

  useEffect(() => {
    propsRef.current = {
      songTitle,
      artist,
      sortedLyrics,
      duration,
      style,
      audioAnalyser,
      audioElementRef,
      videoBackgroundElement,
      videoBackgroundRef,
      cameraVideoRef,
      isCameraActive,
    };
  }, [songTitle, artist, sortedLyrics, duration, style, audioAnalyser, audioElementRef, videoBackgroundElement, videoBackgroundRef, cameraVideoRef, isCameraActive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Opaque rendering path (`alpha: false`) skips transparent pixel blending across every pixel
    const ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
    if (!ctx) return;

    let bufferLength = 64;
    let dataArray = new Uint8Array(bufferLength);
    if (audioAnalyser) {
      audioAnalyser.fftSize = 128;
      bufferLength = audioAnalyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);
    }

    const getGradients = (width: number, height: number, st: VideoStyleConfig): GradientCache => {
      const key = `${width}x${height}|${st.backgroundColor}|${st.activeLyricColor}|${st.glowColor}`;
      if (gradientCacheRef.current && gradientCacheRef.current.key === key) {
        return gradientCacheRef.current;
      }

      const bgGrad = ctx.createLinearGradient(0, 0, width, height);
      bgGrad.addColorStop(0, st.backgroundColor || '#090D16');
      bgGrad.addColorStop(0.5, '#13112c');
      bgGrad.addColorStop(1, '#05070e');

      const videoOverlay = ctx.createLinearGradient(0, 0, 0, height);
      videoOverlay.addColorStop(0, 'rgba(0,0,0,0.45)');
      videoOverlay.addColorStop(0.35, 'rgba(0,0,0,0.20)');
      videoOverlay.addColorStop(0.7, 'rgba(0,0,0,0.40)');
      videoOverlay.addColorStop(1, 'rgba(0,0,0,0.75)');

      const photoOverlay = ctx.createLinearGradient(0, 0, 0, height);
      photoOverlay.addColorStop(0, 'rgba(0,0,0,0.16)');
      photoOverlay.addColorStop(0.18, 'rgba(0,0,0,0)');
      photoOverlay.addColorStop(0.65, 'rgba(0,0,0,0)');
      photoOverlay.addColorStop(1, 'rgba(0,0,0,0.68)');

      const baseY = height * 0.88;
      const barGrad = ctx.createLinearGradient(0, baseY - height * 0.22, 0, baseY);
      barGrad.addColorStop(0, st.activeLyricColor);
      barGrad.addColorStop(1, st.glowColor);

      const next: GradientCache = { key, bgGrad, videoOverlay, photoOverlay, barGrad };
      gradientCacheRef.current = next;
      return next;
    };

    const render = (nowTs: number) => {
      const dt = lastFrameTimeRef.current > 0 ? Math.min(0.1, (nowTs - lastFrameTimeRef.current) / 1000) : 0.016;
      lastFrameTimeRef.current = nowTs;

      const width = canvas.width;
      const height = canvas.height;
      const currentProps = propsRef.current;
      const liveAudioEl = currentProps.audioElementRef?.current;
      const curTime =
        liveAudioEl && !liveAudioEl.paused && !liveAudioEl.seeking && isFinite(liveAudioEl.currentTime)
          ? liveAudioEl.currentTime
          : currentTimeRef.current;

      const activeStyle = currentProps.style;
      const grads = getGradients(width, height, activeStyle);

      const currentVideoBg = currentProps.isCameraActive
        ? currentProps.cameraVideoRef?.current || currentProps.videoBackgroundElement
        : currentProps.videoBackgroundRef?.current || currentProps.videoBackgroundElement;

      // Extract frequency data cleanly (lead vocal band 300Hz-3.2kHz emphasis)
      let audioLevel = 0;
      if (currentProps.audioAnalyser) {
        if (dataArray.length !== currentProps.audioAnalyser.frequencyBinCount) {
          bufferLength = currentProps.audioAnalyser.frequencyBinCount;
          dataArray = new Uint8Array(bufferLength);
        }
        currentProps.audioAnalyser.getByteFrequencyData(dataArray);
        let sum = 0;
        let vocalSum = 0;
        const vocalStart = Math.min(1, bufferLength - 1);
        const vocalEnd = Math.min(bufferLength - 1, 10);
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
          if (i >= vocalStart && i <= vocalEnd) vocalSum += dataArray[i];
        }
        const totalLvl = sum / (bufferLength * 255);
        const vocalLvl = vocalSum / (Math.max(1, vocalEnd - vocalStart + 1) * 255);
        audioLevel = Math.min(1, vocalLvl * 0.65 + totalLvl * 0.35);
      } else {
        audioLevel = curTime > 0 ? 0.2 + Math.sin(curTime * 4) * 0.1 : 0.05;
      }

      // 1. Draw Opaque Background Layer (Video / Photo Slideshow / Cached Gradient)
      const readyPhotos = loadedImagesRef.current.filter((img) => img.complete && img.naturalWidth > 0);
      const hasActiveVideo = Boolean(currentVideoBg && currentVideoBg.videoWidth > 0 && currentVideoBg.readyState >= 2);
      const isLoopingVideoWait = Boolean(currentVideoBg && currentVideoBg.src && !hasActiveVideo && lastFrameCanvasRef.current);

      if (hasActiveVideo && currentVideoBg) {
        const vW = currentVideoBg.videoWidth || 640;
        const vH = currentVideoBg.videoHeight || 480;
        const ratio = Math.max(width / vW, height / vH);
        const drawW = vW * ratio;
        const drawH = vH * ratio;
        const centerShiftX = (width - drawW) / 2;
        const centerShiftY = (height - drawH) / 2;

        ctx.drawImage(currentVideoBg, 0, 0, vW, vH, centerShiftX, centerShiftY, drawW, drawH);

        if (!lastFrameCanvasRef.current) {
          lastFrameCanvasRef.current = document.createElement('canvas');
        }
        const cacheCanvas = lastFrameCanvasRef.current;
        if (cacheCanvas.width !== width || cacheCanvas.height !== height) {
          cacheCanvas.width = width;
          cacheCanvas.height = height;
        }
        const cacheCtx = cacheCanvas.getContext('2d', { alpha: false });
        if (cacheCtx) {
          cacheCtx.drawImage(currentVideoBg, 0, 0, vW, vH, centerShiftX, centerShiftY, drawW, drawH);
        }

        ctx.fillStyle = grads.videoOverlay;
        ctx.fillRect(0, 0, width, height);
      } else if (isLoopingVideoWait && lastFrameCanvasRef.current) {
        ctx.drawImage(lastFrameCanvasRef.current, 0, 0, width, height);
        ctx.fillStyle = grads.videoOverlay;
        ctx.fillRect(0, 0, width, height);
      } else if (!currentProps.isCameraActive && readyPhotos.length > 0) {
        const safeDur = Math.max(1, currentProps.duration || 30);
        const sliceDur = safeDur / readyPhotos.length;
        const photoIdx = Math.min(readyPhotos.length - 1, Math.max(0, Math.floor(curTime / sliceDur)));
        const activePhoto = readyPhotos[photoIdx];
        const localFrac = Math.min(1, Math.max(0, (curTime - photoIdx * sliceDur) / Math.max(1, sliceDur)));
        const zoom = 1 + 0.045 * Math.sin(localFrac * Math.PI + curTime * 0.1);

        const pW = activePhoto.naturalWidth;
        const pH = activePhoto.naturalHeight;
        const ratio = Math.max(width / pW, height / pH) * zoom;
        const drawW = pW * ratio;
        const drawH = pH * ratio;
        const shiftX = (width - drawW) / 2;
        const shiftY = (height - drawH) / 2;

        ctx.fillStyle = '#05070e';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(activePhoto, 0, 0, pW, pH, shiftX, shiftY, drawW, drawH);

        ctx.fillStyle = grads.photoOverlay;
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.fillStyle = grads.bgGrad;
        ctx.fillRect(0, 0, width, height);

        const glowRad = Math.min(width, height) * (0.35 + audioLevel * 0.25);
        const orbGrad = ctx.createRadialGradient(width / 2, height * 0.45, 10, width / 2, height * 0.45, glowRad);
        orbGrad.addColorStop(0, `${activeStyle.glowColor}38`);
        orbGrad.addColorStop(0.6, `${activeStyle.activeLyricColor}14`);
        orbGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = orbGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // 2. Visualizer (optimized zero-per-bar shadowBlur)
      if (activeStyle.showVisualizer) {
        drawVisualizerTheme(ctx, width, height, activeStyle, grads.barGrad, dataArray, bufferLength, audioLevel, curTime, dt, particlesRef.current, vinylAngleRef);
      }

      // 3. Header Title
      if (activeStyle.showTitleHeader) {
        drawHeaderTitle(ctx, width, height, currentProps.songTitle, currentProps.artist, activeStyle, curTime, currentProps.duration);
      }

      // 4. Adaptive Synchronized Lyrics with Dynamic Transitions
      drawRollingLyrics(ctx, width, height, currentProps.sortedLyrics, curTime, currentProps.duration, audioLevel, activeStyle);

      animFrameIdRef.current = requestAnimationFrame(render);
    };

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [canvasRef, audioAnalyser]);

  return null;
};

// Optimized Visualizer Drawing (avoids expensive per-bar/per-particle shadowBlur loops)
function drawVisualizerTheme(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  style: VideoStyleConfig,
  barGrad: CanvasGradient,
  dataArray: Uint8Array,
  bufferLength: number,
  audioLevel: number,
  currentTime: number,
  dt: number,
  particles: Array<{ x: number; y: number; size: number; speed: number; angle: number; color: string }>,
  vinylAngleRef: React.MutableRefObject<number>
) {
  const theme = style.visualizerTheme;

  if (theme === 'spectrum-bars') {
    const numBars = 44;
    const barWidth = (width * 0.8) / numBars;
    const startX = (width - numBars * barWidth) / 2;
    const baseY = height * 0.88;
    const maxBarH = height * 0.20;

    ctx.save();
    ctx.fillStyle = barGrad;
    ctx.globalAlpha = 0.88;
    for (let i = 0; i < numBars; i++) {
      const dataIdx = Math.floor((i / numBars) * (bufferLength / 2));
      const val = dataArray[dataIdx] || Math.sin(currentTime * 5 + i * 0.2) * 40 + 50;
      const barHeight = Math.max(6, (val / 255) * maxBarH);
      const x = startX + i * barWidth;
      const y = baseY - barHeight;

      ctx.beginPath();
      ctx.roundRect(x + 2, y, barWidth - 4, barHeight, [4, 4, 0, 0]);
      ctx.fill();
    }
    ctx.restore();
  } else if (theme === 'neon-waves') {
    ctx.save();
    const baseY = height * 0.86;
    ctx.lineWidth = 3 + audioLevel * 4;
    ctx.strokeStyle = style.activeLyricColor;

    ctx.beginPath();
    ctx.moveTo(0, baseY);
    const step = width / 56;
    for (let i = 0; i <= 56; i++) {
      const x = i * step;
      const freqIdx = Math.floor((i / 56) * (bufferLength / 2));
      const val = (dataArray[freqIdx] || 50) / 255;
      const wave = Math.sin(i * 0.3 + currentTime * 6) * (28 + val * 55);
      ctx.lineTo(x, baseY + wave);
    }
    ctx.stroke();

    ctx.strokeStyle = `${style.glowColor}88`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 56; i++) {
      const x = i * step;
      const wave = Math.cos(i * 0.25 - currentTime * 4) * (18 + audioLevel * 38);
      if (i === 0) ctx.moveTo(x, baseY + wave);
      else ctx.lineTo(x, baseY + wave);
    }
    ctx.stroke();
    ctx.restore();
  } else if (theme === 'vinyl-record') {
    ctx.save();
    vinylAngleRef.current += (0.75 + audioLevel * 1.3) * dt;
    const radius = Math.min(width, height) * 0.14;
    const centerX = width * 0.14;
    const centerY = height * 0.83;

    ctx.translate(centerX, centerY);
    ctx.rotate(vinylAngleRef.current);

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a0f';
    ctx.fill();
    ctx.strokeStyle = '#262636';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let r = radius * 0.42; r < radius; r += 12) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = style.activeLyricColor;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
  } else if (theme === 'cosmic-particles') {
    ctx.save();
    const mult = Math.max(0.4, dt * 60);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.y -= p.speed * (1 + audioLevel * 2) * mult;
      p.x += Math.sin(p.angle + currentTime) * 0.4 * mult;
      if (p.y < 0) p.y = height;
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;

      const rad = p.size * (1 + audioLevel * 0.75);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad * 1.9, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// Helper: Header Title Drawing (responsive for 16:9, 9:16, 1:1)
function drawHeaderTitle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  songTitle: string,
  artist: string,
  style: VideoStyleConfig,
  currentTime: number,
  duration: number
) {
  ctx.save();
  const pad = width * 0.05;
  const isPortrait = height > width;
  const headerY = isPortrait ? height * 0.075 : height * 0.11;

  const fontFam = style.fontFamily || 'Montserrat';
  const maxHeaderW = width * 0.88;
  let titleSize = Math.max(20, Math.round(style.titleFontSize * (width / 1280)));
  ctx.font = `bold ${titleSize}px "${fontFam}", sans-serif`;
  const titleText = songTitle || 'Título de la Canción';
  const titleW = ctx.measureText(titleText).width;
  if (titleW > maxHeaderW) {
    titleSize = Math.max(16, Math.floor(titleSize * (maxHeaderW / titleW)));
    ctx.font = `bold ${titleSize}px "${fontFam}", sans-serif`;
  }

  ctx.textAlign = style.textAlignment;
  const textX = style.textAlignment === 'center' ? width / 2 : style.textAlignment === 'left' ? pad : width - pad;

  ctx.shadowColor = style.glowColor;
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(titleText, textX, headerY);

  if (artist) {
    const artistSize = Math.max(13, Math.round(titleSize * 0.52));
    ctx.font = `600 ${artistSize}px "${fontFam}", sans-serif`;
    ctx.shadowBlur = 4;
    ctx.fillStyle = style.secondaryLyricColor;
    ctx.fillText(artist, textX, headerY + titleSize * 0.82);
  }

  const barY = headerY + (artist ? titleSize * 1.32 : titleSize * 0.72);
  const barWidth = isPortrait ? width * 0.8 : width * 0.42;
  const barX = (width - barWidth) / 2;
  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.beginPath();
  ctx.roundRect(barX, barY, barWidth, 4, 2);
  ctx.fill();

  ctx.fillStyle = style.activeLyricColor;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barWidth * progress, 4, 2);
  ctx.fill();

  ctx.restore();
}

// Helper: Adaptive Synchronized Lyrics with Dynamic Transitions & Zero-Collision Stack Geometry
function drawRollingLyrics(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sortedLyrics: LyricLine[],
  currentTime: number,
  duration: number,
  audioLevel: number,
  style: VideoStyleConfig
) {
  if (!sortedLyrics || sortedLyrics.length === 0) return;

  ctx.save();

  const firstTime = sortedLyrics[0].time;
  const isBeforeFirst = currentTime < firstTime;
  let activeIndex = 0;

  if (!isBeforeFirst) {
    for (let i = 0; i < sortedLyrics.length; i++) {
      if (currentTime >= sortedLyrics[i].time) {
        activeIndex = i;
      } else {
        break;
      }
    }
  }

  const isPortrait = height > width;
  const isSquare = Math.abs(width - height) < 20;
  const adaptiveEnabled = style.adaptiveLyrics !== false;
  const effect = style.lyricEffect || 'karaoke-sweep';
  const fontFam = style.fontFamily || 'Montserrat';

  const safeTop = isPortrait ? height * 0.21 : height * 0.22;
  const safeBottom = isPortrait ? height * 0.84 : height * 0.86;
  const centerY =
    effect === 'subtitle-clean'
      ? isPortrait
        ? height * 0.76
        : height * 0.78
      : isPortrait
      ? height * 0.50
      : isSquare
      ? height * 0.52
      : height * 0.55;

  const refScale = isPortrait ? width / 840 : width / 1280;
  const baseFontSize = Math.max(18, Math.round(style.lyricsFontSize * refScale));
  const activeTargetSize = Math.round(baseFontSize * 1.24);
  const inactiveScale = 0.78;
  const maxTextWidth = width * (isPortrait ? 0.88 : 0.84);
  const maxVerseHeight = (safeBottom - safeTop) * (isPortrait ? 0.34 : 0.42);
  const verseGap = Math.max(16, Math.round(baseFontSize * 0.85));

  // Progress & dynamic transition easing
  let transitionProgress = 0;
  let lineProgress = 0;
  let lineElapsedSec = 0;
  let isInMusicalPause = false;
  let pauseRemainingSec = 0;

  if (!isBeforeFirst) {
    const currentLineStart = sortedLyrics[activeIndex].time;
    const nextLineStart =
      activeIndex < sortedLyrics.length - 1
        ? Math.max(currentLineStart + 0.5, sortedLyrics[activeIndex + 1].time)
        : Math.max(duration || currentLineStart + 5, currentLineStart + 4);
    const rawEnd = sortedLyrics[activeIndex].endTime;
    const activePhraseEnd = rawEnd && rawEnd > currentLineStart ? Math.min(nextLineStart, rawEnd) : nextLineStart;

    lineElapsedSec = Math.max(0, currentTime - currentLineStart);

    if (currentTime <= activePhraseEnd) {
      const phraseSpan = Math.max(0.5, activePhraseEnd - currentLineStart);
      lineProgress = Math.max(0, Math.min(1, lineElapsedSec / phraseSpan));
    } else {
      lineProgress = 1;
      if (activeIndex < sortedLyrics.length - 1 && nextLineStart - currentTime > 1.2) {
        isInMusicalPause = true;
        pauseRemainingSec = Math.ceil(nextLineStart - currentTime);
      }
    }

    if (effect !== 'subtitle-clean' && activeIndex < sortedLyrics.length - 1) {
      const intervalSpan = nextLineStart - currentLineStart;
      const transitionDur = Math.max(0.20, Math.min(0.46, intervalSpan * 0.28));
      const timeToNext = nextLineStart - currentTime;
      if (timeToNext <= transitionDur && timeToNext >= 0) {
        const u = 1 - timeToNext / transitionDur;
        transitionProgress = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      }
    }
  }

  const textX = style.textAlignment === 'center' ? width / 2 : style.textAlignment === 'left' ? width * 0.08 : width * 0.92;
  ctx.textAlign = style.textAlignment;
  ctx.textBaseline = 'middle';

  // Compute adaptive layouts for visible window so wrapped multi-line verses NEVER overlap adjacent verses
  const range = effect === 'subtitle-clean' ? 0 : isPortrait ? 3 : 2;
  const offsets: number[] = [];
  for (let off = -range; off <= (effect === 'subtitle-clean' ? 0 : range + 1); off++) {
    offsets.push(off);
  }

  const layoutMap = new Map<number, AdaptiveVerseLayout>();
  for (const off of offsets) {
    const idx = activeIndex + off;
    if (idx < 0 || idx >= sortedLyrics.length) continue;
    layoutMap.set(
      off,
      getAdaptiveVerseLayout(ctx, sortedLyrics[idx].text, fontFam, activeTargetSize, maxTextWidth, maxVerseHeight, adaptiveEnabled)
    );
  }

  // Dynamic Y centers stacked by real measured blockHeight * drawScale
  const yPositions = new Map<number, number>();
  const centerLayout = layoutMap.get(0);
  const nextLayout = layoutMap.get(1);
  const scrollTravel =
    centerLayout && nextLayout
      ? (centerLayout.blockHeight * 0.5 + (nextLayout.blockHeight * inactiveScale) * 0.5 + verseGap)
      : baseFontSize * 2.55;
  const smoothScrollPx = transitionProgress * scrollTravel;

  yPositions.set(0, centerY - smoothScrollPx);

  for (let off = 1; off <= range + 1; off++) {
    const curL = layoutMap.get(off);
    const prevL = layoutMap.get(off - 1);
    const prevY = yPositions.get(off - 1);
    if (!curL || !prevL || prevY === undefined) break;
    const prevHalf = prevL.blockHeight * (off - 1 === 0 ? 1 : inactiveScale) * 0.5;
    const curHalf = curL.blockHeight * inactiveScale * 0.5;
    yPositions.set(off, prevY + prevHalf + verseGap + curHalf);
  }

  for (let off = -1; off >= -range; off--) {
    const curL = layoutMap.get(off);
    const nextL = layoutMap.get(off + 1);
    const nextY = yPositions.get(off + 1);
    if (!curL || !nextL || nextY === undefined) break;
    const nextHalf = nextL.blockHeight * (off + 1 === 0 ? 1 : inactiveScale) * 0.5;
    const curHalf = curL.blockHeight * inactiveScale * 0.5;
    yPositions.set(off, nextY - nextHalf - verseGap - curHalf);
  }

  for (const offset of offsets) {
    const lineIdx = activeIndex + offset;
    const layout = layoutMap.get(offset);
    const baseLineY = yPositions.get(offset);
    if (!layout || baseLineY === undefined || lineIdx < 0 || lineIdx >= sortedLyrics.length) continue;

    const line = sortedLyrics[lineIdx];
    const isActive = offset === 0 && !isBeforeFirst && !isInMusicalPause;
    const isUpcomingAfterPause = isInMusicalPause && offset === 1;

    let extraY = 0;
    let drawScale = isActive ? 1 : inactiveScale;
    let enterAlpha = 1;

    if (isActive) {
      if (effect === 'fade-slide') {
        const t = Math.min(1, lineElapsedSec / 0.28);
        const ease = 1 - Math.pow(1 - t, 3);
        extraY = (1 - ease) * 14;
        enterAlpha = Math.max(0.28, ease);
        drawScale = inactiveScale + (1 - inactiveScale) * ease;
      } else if (effect === 'bounce-pop') {
        const t = Math.min(1, lineElapsedSec / 0.28);
        drawScale = t < 0.5 ? 0.85 + 0.22 * (t * 2) : 1.07 - 0.07 * ((t - 0.5) * 2);
      } else if (effect === 'neon-pulse') {
        const ramp = Math.min(1, lineElapsedSec / 0.16);
        const baseScale = inactiveScale + (1 - inactiveScale) * ramp;
        drawScale = baseScale + Math.min(0.05, audioLevel * 0.055);
      } else {
        const ramp = Math.min(1, lineElapsedSec / 0.16);
        drawScale = inactiveScale + (1 - inactiveScale) * ramp;
      }
    } else if (offset === 1 && transitionProgress > 0) {
      // Dynamic smooth magnification as upcoming line glides toward center
      drawScale = inactiveScale + (1 - inactiveScale) * transitionProgress * 0.65;
    }

    const y = baseLineY + extraY;
    if (y + layout.blockHeight * 0.35 < safeTop || y - layout.blockHeight * 0.35 > safeBottom) continue;

    const distFromCenter = Math.abs(offset);
    const baseOpacity = isActive
      ? 1
      : isUpcomingAfterPause
      ? 0.92
      : isBeforeFirst && offset === 0
      ? 0.92
      : isInMusicalPause && offset === 0
      ? 0.42
      : Math.max(0.20, 0.78 - distFromCenter * 0.24);
    const opacity = baseOpacity * enterAlpha;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = `800 ${layout.fontSize}px "${fontFam}", sans-serif`;

    if (drawScale !== 1) {
      ctx.translate(textX, y);
      ctx.scale(drawScale, drawScale);
      ctx.translate(-textX, -y);
    }

    if (isActive && (effect === 'karaoke-sweep' || effect === 'typewriter')) {
      const boxW = Math.min(width * 0.92, layout.widest + 46);
      const boxH = layout.blockHeight + 20;
      const boxX =
        style.textAlignment === 'center'
          ? textX - boxW / 2
          : style.textAlignment === 'left'
          ? textX - 18
          : textX - boxW + 18;
      const boxY = y - boxH / 2;

      ctx.fillStyle = 'rgba(7, 10, 22, 0.72)';
      ctx.strokeStyle = `${style.activeLyricColor}88`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 16);
      ctx.fill();
      ctx.stroke();
    }

    const totalTypedChars =
      isActive && effect === 'typewriter' ? Math.max(1, Math.ceil(layout.totalChars * Math.min(1, lineProgress * 1.1))) : 99999;
    const sweepCharCursor = layout.totalChars * lineProgress;

    layout.lines.forEach((subLine, subIdx) => {
      const subY = y + (subIdx - (layout.lines.length - 1) / 2) * layout.subGap;
      let renderSubLine = subLine;

      if (isActive && effect === 'typewriter') {
        const lineStartChar = layout.lineCumChars[subIdx];
        const take = Math.max(0, Math.min(subLine.length, totalTypedChars - lineStartChar));
        if (take <= 0) return;
        renderSubLine = subLine.slice(0, take) + (take < subLine.length ? '|' : '');
      }

      if (isActive) {
        if (effect === 'neon-pulse') {
          ctx.shadowColor = style.glowColor;
          ctx.shadowBlur = 14 + audioLevel * 12;
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(5, 8, 20, 0.85)';
          ctx.strokeText(renderSubLine, textX, subY);
          ctx.fillStyle = style.activeLyricColor;
          ctx.fillText(renderSubLine, textX, subY);
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#FFFFFF';
          ctx.globalAlpha = opacity * 0.42;
          ctx.fillText(renderSubLine, textX, subY);
          ctx.globalAlpha = opacity;
        } else if (effect === 'bounce-pop' || effect === 'fade-slide' || effect === 'subtitle-clean') {
          ctx.lineWidth = 5;
          ctx.strokeStyle = 'rgba(5, 8, 20, 0.90)';
          ctx.strokeText(renderSubLine, textX, subY);
          ctx.fillStyle = effect === 'subtitle-clean' ? '#FFFFFF' : style.activeLyricColor;
          ctx.fillText(renderSubLine, textX, subY);
        } else if (effect === 'typewriter') {
          ctx.shadowColor = style.glowColor;
          ctx.shadowBlur = 8;
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(renderSubLine, textX, subY);
          ctx.shadowBlur = 0;
        } else {
          // Default: character-length weighted karaoke-sweep across multi-line wraps
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(5, 8, 20, 0.72)';
          ctx.strokeText(subLine, textX, subY);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(subLine, textX, subY);

          const lineStartChar = layout.lineCumChars[subIdx];
          const subProgress = Math.max(0, Math.min(1, (sweepCharCursor - lineStartChar) / Math.max(1, subLine.length)));

          if (subProgress > 0) {
            const w = layout.lineWidths[subIdx];
            const lineStartX =
              style.textAlignment === 'center'
                ? textX - w / 2
                : style.textAlignment === 'left'
                ? textX
                : textX - w;
            const sweepW = w * subProgress;

            ctx.save();
            ctx.beginPath();
            ctx.rect(lineStartX - 4, subY - layout.fontSize * 0.75, sweepW + 8, layout.fontSize * 1.5);
            ctx.clip();
            ctx.fillStyle = style.activeLyricColor;
            ctx.fillText(subLine, textX, subY);
            ctx.restore();
          }
        }
      } else {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(5, 8, 20, 0.75)';
        ctx.strokeText(subLine, textX, subY);
        ctx.fillStyle = (isBeforeFirst && offset === 0) || isUpcomingAfterPause ? '#F8FAFC' : style.secondaryLyricColor;
        ctx.fillText(subLine, textX, subY);
      }
    });

    ctx.restore();
  }

  // Smooth countdown badge during intro or long musical pause
  const topHintY = Math.max(safeTop + 16, centerY - (centerLayout ? centerLayout.blockHeight * 0.5 : baseFontSize) - baseFontSize * 1.2);
  if (isBeforeFirst && firstTime - currentTime > 0.3) {
    const secsToStart = Math.ceil(firstTime - currentTime);
    ctx.font = `700 ${Math.max(13, Math.round(baseFontSize * 0.62))}px "${fontFam}", sans-serif`;
    ctx.fillStyle = style.activeLyricColor;
    ctx.fillText(`♪ La letra inicia en ${secsToStart}s...`, textX, topHintY);
  } else if (isInMusicalPause && pauseRemainingSec >= 2) {
    ctx.font = `700 ${Math.max(12, Math.round(baseFontSize * 0.58))}px "${fontFam}", sans-serif`;
    ctx.fillStyle = style.activeLyricColor;
    ctx.fillText(`♪ Pausa musical (${pauseRemainingSec}s)...`, textX, topHintY);
  }

  ctx.restore();
}
