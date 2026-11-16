import type { Plugin } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';

const geminiCooldownUntil: Record<string, number> = {};

function isGeminiModelAvailable(model: string): boolean {
  const until = geminiCooldownUntil[model] || 0;
  return Date.now() >= until;
}

function handleGeminiCallFailure(model: string, err: unknown): void {
  const msg = String((err as any)?.message || err || '');
  const isQuotaOrRate = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.toLowerCase().includes('quota');
  // Cooldown 30m on quota exhaustion, 60s on transient errors so UI never stalls or logs error storms
  geminiCooldownUntil[model] = Date.now() + (isQuotaOrRate ? 30 * 60 * 1000 : 60 * 1000);
}

export function createApiMiddleware(): (req: any, res: any, next: () => void) => Promise<void> | void {
  return async (req: any, res: any, next: () => void) => {
        if (!req.url?.startsWith('/api/')) {
          return next();
        }

        // Helper to send json
        const sendJson = (statusCode: number, data: unknown) => {
          res.statusCode = statusCode;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        };

        // Helper to parse JSON body
        const parseBody = (): Promise<any> => {
          return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', (chunk: Buffer | string) => {
              body += chunk;
            });
            req.on('end', () => {
              try {
                resolve(body ? JSON.parse(body) : {});
              } catch (e) {
                reject(e);
              }
            });
            req.on('error', reject);
          });
        };

        const cleanPath = req.url ? req.url.split('?')[0].replace(/\/$/, '') : '';

        try {
          if (cleanPath === '/api/song-story' && req.method === 'POST') {
            const body = await parseBody();
            const { songTitle, artist, songOrigin } = body;

            if (!songTitle) {
              return sendJson(400, { error: 'El título de la canción es requerido' });
            }

            const buildCuratedStory = () => ({
              title: songTitle,
              artist: artist || '',
              origin: songOrigin || '',
              story: songOrigin 
                ? `Origen e inspiración de la canción:\n"${songOrigin}"\n\nEsta canción plasma vivencias auténticas y emociones profundas que dan vida a cada nota y melodía.`
                : `La canción "${songTitle}" es una pieza emotiva que conecta a través de su lírica y armonía musical, narrando un viaje de experiencias y recuerdos.`,
              meaning: songOrigin
                ? `El mensaje central está inspirado directamente en su origen: "${songOrigin.slice(0, 100)}...", explorando el sentir humano y la expresión personal.`
                : `Explora el viaje emocional de la composición, abordando temas de superación, amor y vivencias personales.`,
              releaseYear: 'Producción Original',
              trivia: [
                'El origen y la historia detrás de esta pieza marcan el compás y sentimiento del video musical.',
                'Cada verso fue concebido para transmitir la esencia única de su inspiración.',
                'Su ritmo y atmósfera han sido estructurados para sincronizarse con letras en pantalla.'
              ],
              videoSearchQueries: [
                `${songTitle} ${songOrigin ? songOrigin.slice(0, 30) : ''} historia origen video`,
                `${songTitle} significado documental`,
                `${songTitle} video oficial con letras`,
                `${songTitle} inspiracion cancion`
              ]
            });

            const apiKey = process.env.GEMINI_API_KEY;
            const storyModel = 'gemini-3.1-flash-lite';
            if (!apiKey || !isGeminiModelAvailable(storyModel)) {
              return sendJson(200, buildCuratedStory());
            }

            try {
              const ai = new GoogleGenAI({
                apiKey,
                httpOptions: {
                  headers: {
                    'User-Agent': 'aistudio-build',
                  },
                },
              });

              const prompt = `Analiza detalladamente la canción musical "${songTitle}" ${artist ? `del artista "${artist}"` : ''}.
${songOrigin ? `DATOS CLAVE DEL ORIGEN / HISTORIA PROPORCIONADOS POR EL USUARIO/AUTOR:\n"${songOrigin}"\nIncorpora fielmente este origen y trasfondo en el análisis de la historia, la inspiración y el significado profundo.` : ''}
Proporciona:
1. La historia real detrás de la canción (cómo se compuso, hechos que inspiraron al autor, contexto y el origen indicado).
2. El significado profundo de la letra y el mensaje que transmite.
3. El año o contexto temporal.
4. 3 datos curiosos o reflexiones destacadas.
5. 4 términos recomendados de búsqueda para encontrar videos web en YouTube o documentales que se asemejen a esta historia y origen.
Responde en español con formato estructurado JSON.`;

              const response = await ai.models.generateContent({
                model: storyModel,
                contents: prompt,
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      artist: { type: Type.STRING },
                      origin: { type: Type.STRING, description: 'Origen e historia de la canción' },
                      story: { type: Type.STRING, description: 'Historia completa de la composición e inspiración' },
                      meaning: { type: Type.STRING, description: 'Significado lírico y mensaje' },
                      releaseYear: { type: Type.STRING, description: 'Año o contexto' },
                      trivia: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: '3 datos curiosos o reflexiones de la canción'
                      },
                      videoSearchQueries: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: '4 búsquedas recomendadas para videos que se asemejen a la historia'
                      }
                    },
                    required: ['title', 'story', 'meaning', 'trivia', 'videoSearchQueries'],
                  },
                },
              });

              const responseText = response.text || '{}';
              const parsed = JSON.parse(responseText);
              if (!parsed.origin && songOrigin) {
                parsed.origin = songOrigin;
              }
              return sendJson(200, parsed);
            } catch (aiErr) {
              handleGeminiCallFailure(storyModel, aiErr);
              return sendJson(200, buildCuratedStory());
            }
          }

          // Helpers for parsing LRC and extracting real synced lyrics with automatic pause alignment
          const parseLrcLyrics = (lrcText: string, maxDuration = 600) => {
            const items: { id: string; time: number; endTime?: number; text: string }[] = [];
            const lines = String(lrcText || '').split(/\r?\n/);
            const tagRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
            for (const rawLine of lines) {
              const trimmed = rawLine.trim();
              if (!trimmed) continue;
              const matches = [...trimmed.matchAll(tagRegex)];
              if (matches.length === 0) continue;
              const cleanText = trimmed.replace(tagRegex, '').replace(/<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim();
              if (!cleanText) continue;
              for (const m of matches) {
                const mins = parseInt(m[1], 10) || 0;
                const secs = parseInt(m[2], 10) || 0;
                const fracStr = m[3] || '0';
                const frac = parseInt(fracStr, 10) / (fracStr.length === 3 ? 1000 : fracStr.length === 2 ? 100 : 10);
                const t = Math.round((mins * 60 + secs + frac) * 10) / 10;
                if (t <= maxDuration + 2) {
                  items.push({ id: `lrc-${items.length}-${Date.now()}`, time: Math.min(maxDuration, t), text: cleanText });
                }
              }
            }
            items.sort((a, b) => a.time - b.time);
            return items;
          };

          interface AcousticSegment {
            startSec: number;
            endSec: number;
          }

          // Analyze the actual audio waveform to detect intros, pauses, silences, and active center-lead vocal phrases (~150ms via FFmpeg)
          const analyzeAudioActivityAndPauses = async (
            audioPath: string,
            fallbackDur: number,
            minVocalStartSec = 0
          ): Promise<{ duration: number; segments: AcousticSegment[]; firstActiveSec: number }> => {
            const fallback = Math.max(5, Number(fallbackDur) || 60);
            const clampStart = Math.max(0, Number(minVocalStartSec) || 0);
            if (!audioPath || !fs.existsSync(audioPath)) {
              const s0 = clampStart > 0.2 ? clampStart : Math.min(1.5, fallback * 0.05);
              return { duration: fallback, segments: [{ startSec: s0, endSec: Math.max(s0 + 1, fallback - 1.0) }], firstActiveSec: s0 };
            }

            try {
              const pcmBuffer: Buffer = await new Promise((resolve, reject) => {
                const chunks: Buffer[] = [];
                // Extract 2 channels tightly filtered to lead-singer formant core (400Hz-2600Hz) to exclude bass, kick, and cymbals
                const child = spawn('ffmpeg', [
                  '-v', 'error',
                  '-i', audioPath,
                  '-vn',
                  '-af', 'highpass=f=400,lowpass=f=2600',
                  '-ac', '2',
                  '-ar', '8000',
                  '-f', 'f32le',
                  'pipe:1',
                ]);
                child.stdout.on('data', (d: Buffer) => chunks.push(d));
                child.on('error', (err) => reject(err));
                child.on('close', (code) => {
                  if (chunks.length === 0 && code !== 0) {
                    return reject(new Error(`ffmpeg exited ${code}`));
                  }
                  resolve(Buffer.concat(chunks));
                });
              });

              const channels = 2;
              const framesPerWindow = 800; // 0.1s per analysis window
              const floatsPerWindow = framesPerWindow * channels;
              const totalWindows = Math.floor(pcmBuffer.byteLength / (4 * floatsPerWindow));
              const probedDur = totalWindows > 0 ? totalWindows * 0.1 : fallback;

              if (totalWindows < 10) {
                const s0 = clampStart > 0.2 ? Math.min(probedDur - 1, clampStart) : 0.5;
                return { duration: probedDur, segments: [{ startSec: s0, endSec: Math.max(s0 + 0.8, probedDur - 0.5) }], firstActiveSec: s0 };
              }

              const midRms = new Float32Array(totalWindows);
              const sideRms = new Float32Array(totalWindows);
              let globalMidSum = 0;
              let globalSideSum = 0;

              for (let w = 0; w < totalWindows; w++) {
                let sumMidSq = 0;
                let sumSideSq = 0;
                const byteBase = w * floatsPerWindow * 4;
                for (let s = 0; s < framesPerWindow; s++) {
                  const l = pcmBuffer.readFloatLE(byteBase + s * 8);
                  const r = pcmBuffer.readFloatLE(byteBase + s * 8 + 4);
                  const mid = 0.5 * (l + r);
                  const side = 0.5 * (l - r);
                  sumMidSq += mid * mid;
                  sumSideSq += side * side;
                }
                midRms[w] = Math.sqrt(sumMidSq / framesPerWindow);
                sideRms[w] = Math.sqrt(sumSideSq / framesPerWindow);
                globalMidSum += midRms[w];
                globalSideSum += sideRms[w];
              }

              // Strongly suppress wide stereo backing instruments during instrumental breaks without voice
              const isStereoMix = globalMidSum > 0 && (globalSideSum / globalMidSum) > 0.08;
              const vocalRms = new Float32Array(totalWindows);
              for (let w = 0; w < totalWindows; w++) {
                if (!isStereoMix) {
                  vocalRms[w] = midRms[w];
                } else {
                  const centerDiff = Math.max(0, midRms[w] - 0.72 * sideRms[w]);
                  const centerRatio = midRms[w] / (midRms[w] + sideRms[w] + 1e-6);
                  const focusWeight = Math.max(0.15, Math.min(1, (centerRatio - 0.45) / 0.34));
                  vocalRms[w] = centerDiff * focusWeight;
                }
              }

              // Smooth with symmetric 0.5s window to prevent micro-dips/tremolo jumping
              const smooth = new Float32Array(totalWindows);
              for (let f = 0; f < totalWindows; f++) {
                let acc = 0;
                let cnt = 0;
                for (let k = Math.max(0, f - 2); k <= Math.min(totalWindows - 1, f + 2); k++) {
                  acc += vocalRms[k];
                  cnt++;
                }
                smooth[f] = acc / cnt;
              }

              // Contrast-preserving p82 vocal ceiling so multi-pause songs (35-50% instrumental breaks) never pull threshold down
              const sortedAll = Array.from(smooth).sort((a, b) => a - b);
              const p10 = sortedAll[Math.floor(sortedAll.length * 0.10)] || 0;
              const p50 = sortedAll[Math.floor(sortedAll.length * 0.50)] || 0;
              const p65 = sortedAll[Math.floor(sortedAll.length * 0.65)] || p50;
              const p82 = sortedAll[Math.floor(sortedAll.length * 0.82)] || p65;
              if (p82 < 0.002) {
                const s0 = clampStart > 0.2 ? Math.min(probedDur - 1, clampStart) : 0.5;
                return { duration: probedDur, segments: [{ startSec: s0, endSec: Math.max(s0 + 0.8, probedDur - 0.5) }], firstActiveSec: s0 };
              }
              const globalFloor = Math.max(0.0028, Math.min(p82 * 0.36, p10 + (p82 - p10) * 0.30));
              const maxCap = Math.max(globalFloor, p82 * 0.48);

              const startIdxMin = Math.floor(clampStart * 10);
              const active: number[] = new Array(totalWindows).fill(0);
              for (let f = startIdxMin; f < totalWindows; f++) {
                let localSum = 0;
                let localCnt = 0;
                for (let k = Math.max(startIdxMin, f - 60); k <= Math.min(totalWindows - 1, f + 60); k++) {
                  localSum += smooth[k];
                  localCnt++;
                }
                const localMean = localCnt > 0 ? localSum / localCnt : globalFloor;
                // Keep floor high enough that quiet or mid-length instrumental breaks don't drop localMean into false positives
                const thresh = Math.min(maxCap, Math.max(globalFloor, localMean * 0.65));
                active[f] = smooth[f] >= thresh ? 1 : 0;
              }

              // Bridge brief phrasing breaths (<= 1.0s) while keeping >= 1.1s instrumental breaks open across Pause 1, 2, 3+
              let gapRun = 0;
              for (let f = startIdxMin; f < active.length; f++) {
                if (active[f] === 0) {
                  gapRun++;
                } else {
                  if (gapRun > 0 && gapRun <= 10 && f - gapRun > startIdxMin) {
                    for (let k = f - gapRun; k < f; k++) active[k] = 1;
                  }
                  gapRun = 0;
                }
              }

              // Build contiguous active segments (ignoring brief pre-vocal noise or isolated instrumental hits)
              const rawSegments: AcousticSegment[] = [];
              let segStart = -1;
              for (let f = startIdxMin; f < active.length; f++) {
                if (active[f] === 1 && segStart === -1) {
                  segStart = f;
                } else if (active[f] === 0 && segStart !== -1) {
                  if (f - segStart >= 5) {
                    rawSegments.push({ startSec: segStart * 0.1, endSec: f * 0.1 });
                  }
                  segStart = -1;
                }
              }
              if (segStart !== -1 && active.length - segStart >= 5) {
                rawSegments.push({ startSec: segStart * 0.1, endSec: active.length * 0.1 });
              }

              // Drop short isolated blips (< 0.9s) surrounded by > 1.5s silence on both sides (typical guitar/brass solo stabs)
              const segments: AcousticSegment[] = rawSegments.filter((seg, idx) => {
                const segLen = seg.endSec - seg.startSec;
                if (segLen >= 0.9) return true;
                const prevEnd = idx > 0 ? rawSegments[idx - 1].endSec : 0;
                const nextStart = idx < rawSegments.length - 1 ? rawSegments[idx + 1].startSec : probedDur;
                const gapBefore = seg.startSec - prevEnd;
                const gapAfter = nextStart - seg.endSec;
                return !(gapBefore > 1.5 && gapAfter > 1.5);
              });

              // If user explicitly marked vocal entrance and first detected segment started later, anchor cleanly at clampStart
              if (clampStart > 0.2) {
                if (segments.length === 0) {
                  const s0 = Math.min(probedDur - 1, clampStart);
                  segments.push({ startSec: s0, endSec: Math.max(s0 + 1, probedDur - 0.5) });
                } else if (segments[0].startSec > clampStart + 1.0) {
                  segments.unshift({ startSec: clampStart, endSec: Math.min(segments[0].startSec - 0.1, clampStart + 4) });
                } else {
                  segments[0].startSec = Math.max(clampStart, Math.min(segments[0].startSec, clampStart + 0.5));
                }
              }

              const totalActive = segments.reduce((acc, s) => acc + (s.endSec - s.startSec), 0);
              if (segments.length === 0 || totalActive < 1.5) {
                const s0 = clampStart > 0.2 ? Math.min(probedDur - 1, clampStart) : Math.min(1.5, probedDur * 0.05);
                return {
                  duration: probedDur,
                  segments: [{ startSec: s0, endSec: Math.max(s0 + 1, probedDur - 1.0) }],
                  firstActiveSec: s0,
                };
              }

              return {
                duration: probedDur,
                segments,
                firstActiveSec: segments[0].startSec,
              };
            } catch {
              const s0 = clampStart > 0.2 ? Math.min(fallback - 1, clampStart) : Math.min(1.5, fallback * 0.05);
              return {
                duration: fallback,
                segments: [{ startSec: s0, endSec: Math.max(s0 + 1, fallback - 1.0) }],
                firstActiveSec: s0,
              };
            }
          };

          // Map cumulative lyric weight onto active audio segments so pauses & intros never drift lyrics ahead
          const alignLyricsWithAcousticSegments = (
            plainText: string,
            durationSec: number,
            segments?: AcousticSegment[]
          ) => {
            const lines = String(plainText || '')
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l));
            if (lines.length === 0) return [];

            const dur = Math.max(5, Number(durationSec) || 60);
            const activeSegs: AcousticSegment[] =
              segments && segments.length > 0
                ? segments
                : [{ startSec: Math.min(2, dur * 0.05), endSec: Math.max(3, dur - Math.min(2.5, dur * 0.06)) }];

            const totalActive = activeSegs.reduce((sum, s) => sum + Math.max(0.2, s.endSec - s.startSec), 0);
            const weights = lines.map((line) =>
              Math.max(4, line.replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ]/g, '').length)
            );
            const totalWeight = weights.reduce((a, b) => a + b, 0);

            // Locate which active segment and exact wall-clock second an active-timeline offset falls into
            const locateActiveOffset = (activeOffset: number): { segIdx: number; songTime: number } => {
              let remaining = Math.max(0, Math.min(totalActive, activeOffset));
              for (let idx = 0; idx < activeSegs.length; idx++) {
                const seg = activeSegs[idx];
                const segLen = Math.max(0.2, seg.endSec - seg.startSec);
                // Strictly '<' before last segment so boundary right at segEnd lands on the start of the next segment
                if (idx === activeSegs.length - 1 ? remaining <= segLen : remaining < segLen - 0.05) {
                  return { segIdx: idx, songTime: seg.startSec + Math.min(segLen, remaining) };
                }
                remaining -= segLen;
              }
              return { segIdx: activeSegs.length - 1, songTime: activeSegs[activeSegs.length - 1].endSec };
            };

            let accWeight = 0;
            const synced = lines.map((text, idx) => {
              const startActive = (accWeight / totalWeight) * totalActive;
              accWeight += weights[idx];
              const endActive = (accWeight / totalWeight) * totalActive;

              const startLoc = locateActiveOffset(startActive);
              const endLoc = locateActiveOffset(endActive);

              let rawStart = startLoc.songTime;
              let rawEnd = endLoc.songTime;

              if (startLoc.segIdx !== endLoc.segIdx) {
                const remainInStartSeg = activeSegs[startLoc.segIdx].endSec - rawStart;
                const lineActiveDur = Math.max(0.4, endActive - startActive);
                if (remainInStartSeg < lineActiveDur * 0.55) {
                  // More of this verse falls AFTER the pause -> enter cleanly right when the next vocal segment begins
                  const targetSeg = activeSegs[Math.min(activeSegs.length - 1, startLoc.segIdx + 1)];
                  rawStart = targetSeg.startSec;
                  rawEnd = Math.max(rawStart + 0.8, Math.min(targetSeg.endSec, rawEnd));
                } else {
                  // Most of this verse falls BEFORE the pause -> finish cleanly right as the pause begins
                  rawEnd = Math.max(rawStart + 0.8, activeSegs[startLoc.segIdx].endSec);
                }
              }

              const tStart = Math.round(rawStart * 10) / 10;
              const tEnd = Math.round(Math.max(tStart + 0.6, rawEnd) * 10) / 10;
              return {
                id: `line-${idx}-${Date.now()}`,
                time: Math.min(dur - 0.5, tStart),
                endTime: Math.min(dur, tEnd),
                text,
              };
            });

            // Enforce strictly smooth non-overlapping monotonic timestamps
            for (let i = 0; i < synced.length; i++) {
              if (i > 0 && synced[i].time < synced[i - 1].time + 0.7) {
                synced[i].time = Math.min(dur - 0.5, Math.round((synced[i - 1].time + 0.7) * 10) / 10);
              }
              if (synced[i].endTime && synced[i].endTime! < synced[i].time + 0.6) {
                synced[i].endTime = Math.min(dur, Math.round((synced[i].time + 0.6) * 10) / 10);
              }
            }
            for (let i = 0; i < synced.length - 1; i++) {
              if ((synced[i].endTime ?? dur) > synced[i + 1].time) {
                synced[i].endTime = Math.round(Math.max(synced[i].time + 0.5, synced[i + 1].time - 0.1) * 10) / 10;
              }
            }
            return synced;
          };

          // Refine timestamped LRC/Gemini lines with detected song pauses (adds endTime & shifts prepended silence)
          const refineSyncedLyricsWithPauses = (
            items: { id: string; time: number; endTime?: number; text: string }[],
            durationSec: number,
            segments?: AcousticSegment[],
            firstActiveSec?: number
          ) => {
            if (!items || items.length === 0) return items;
            const cloned = items.map((l) => ({ ...l }));

            // If downloaded MP3 has extra leading silence/intro before vocals enter while LRC starts at 0s, shift cleanly
            if (typeof firstActiveSec === 'number' && firstActiveSec > 2.2 && cloned[0].time < 1.2) {
              const shift = Math.round((firstActiveSec - cloned[0].time) * 10) / 10;
              if (cloned[cloned.length - 1].time + shift < durationSec - 0.5) {
                cloned.forEach((l) => {
                  l.time = Math.round((l.time + shift) * 10) / 10;
                });
              }
            }

            if (segments && segments.length > 0) {
              // 1. Repair lines caught inside non-vocal instrumental breaks across Pause 1, 2, 3+ WITHOUT rippling later verses off the end
              for (let i = 0; i < cloned.length; i++) {
                const t = cloned[i].time;
                const inVocalSeg = segments.some((s) => t >= s.startSec - 0.5 && t <= s.endSec - 0.15);
                if (!inVocalSeg) {
                  const nextSeg = segments.find((s) => s.startSec > t + 0.4);
                  if (nextSeg) {
                    const prevSegEnd = segments.reduce((acc, s) => (s.endSec <= t + 0.25 ? Math.max(acc, s.endSec) : acc), 0);
                    const gapLen = nextSeg.startSec - prevSegEnd;
                    if (gapLen >= 1.5) {
                      const nextLine = i < cloned.length - 1 ? cloned[i + 1] : null;
                      // If ONLY this single line clipped into the pause and next line is already aligned at vocal re-entry, fix just this line
                      if (nextLine && nextLine.time >= nextSeg.startSec - 0.6) {
                        if (nextLine.time - nextSeg.startSec >= 1.1) {
                          cloned[i].time = Math.min(durationSec - 0.5, Math.round(nextSeg.startSec * 10) / 10);
                        } else if (i > 0 && prevSegEnd - cloned[i - 1].time >= 1.1) {
                          cloned[i].time = Math.max(
                            Math.round((cloned[i - 1].time + 0.7) * 10) / 10,
                            Math.round((prevSegEnd - 0.9) * 10) / 10
                          );
                        }
                      } else {
                        // Multiple remaining verses drifted through instrumental break -> preserve synced prefix [0..i-1] & align remaining verses across ALL remaining segments
                        const remainSegs = segments
                          .filter((s) => s.endSec > nextSeg.startSec + 0.5)
                          .map((s) => (s.startSec < nextSeg.startSec ? { startSec: nextSeg.startSec, endSec: s.endSec } : s));
                        if (remainSegs.length > 0) {
                          const realignedTail = alignLyricsWithAcousticSegments(
                            cloned.slice(i).map((l) => l.text).join('\n'),
                            durationSec,
                            remainSegs
                          );
                          for (let k = 0; k < realignedTail.length && i + k < cloned.length; k++) {
                            cloned[i + k].time = realignedTail[k].time;
                            cloned[i + k].endTime = realignedTail[k].endTime;
                          }
                        }
                        break;
                      }
                    }
                  }
                }
              }

              // 2. Uncovered Post-Pause Vocal Segment Guard:
              // If lyrics ran out early BEFORE the 2nd, 3rd, or final post-pause vocal section (leaving a >= 4s vocal segment with 0 verses -> frozen lyrics!),
              // keep the synced opening prefix proportional to earlier vocal time and align the suffix across all remaining vocal segments.
              const sigSegs = segments.filter((s) => s.endSec - s.startSec >= 3.5);
              if (sigSegs.length >= 2 && cloned.length >= 4) {
                for (let m = 1; m < sigSegs.length; m++) {
                  const targetSeg = sigSegs[m];
                  const prevSeg = sigSegs[m - 1];
                  const pauseBefore = targetSeg.startSec - prevSeg.endSec;
                  if (pauseBefore < 1.3 && m < sigSegs.length - 1) continue;

                  const countInTarget = cloned.filter(
                    (l) => l.time >= targetSeg.startSec - 0.8 && l.time <= targetSeg.endSec - 0.2
                  ).length;

                  if (countInTarget === 0 && targetSeg.endSec - targetSeg.startSec >= 4.0) {
                    const totalSigDur = sigSegs.reduce((acc, s) => acc + (s.endSec - s.startSec), 0);
                    const durBefore = sigSegs.slice(0, m).reduce((acc, s) => acc + (s.endSec - s.startSec), 0);
                    const idealPrefix = Math.max(1, Math.min(cloned.length - 2, Math.round(cloned.length * (durBefore / Math.max(1, totalSigDur)))));
                    const alreadyBeforeCount = cloned.filter((l) => l.time < targetSeg.startSec - 0.5).length;
                    const splitIdx = Math.max(1, Math.min(cloned.length - 2, Math.min(alreadyBeforeCount, idealPrefix)));

                    const anchorStart = Math.max((cloned[splitIdx - 1]?.time ?? 0) + 0.8, prevSeg.endSec > cloned[splitIdx - 1].time + 1.5 ? prevSeg.startSec : cloned[splitIdx - 1].time + 0.8);
                    const remainSegs = segments
                      .filter((s) => s.endSec > targetSeg.startSec + 0.5 || (s.startSec >= anchorStart && s.endSec > anchorStart + 0.8))
                      .map((s) => (s.startSec < anchorStart ? { startSec: anchorStart, endSec: s.endSec } : s));

                    if (remainSegs.length > 0) {
                      const realignedTail = alignLyricsWithAcousticSegments(
                        cloned.slice(splitIdx).map((l) => l.text).join('\n'),
                        durationSec,
                        remainSegs
                      );
                      for (let k = 0; k < realignedTail.length && splitIdx + k < cloned.length; k++) {
                        cloned[splitIdx + k].time = realignedTail[k].time;
                        cloned[splitIdx + k].endTime = realignedTail[k].endTime;
                      }
                    }
                    break;
                  }
                }
              }

              // 3. Shield against collapsed/stalled trailing timestamps (never freeze verses on the exact same second)
              let badIdx = -1;
              for (let i = 1; i < cloned.length; i++) {
                if (cloned[i].time - cloned[i - 1].time < 0.45 || cloned[i].time >= durationSec - 0.45) {
                  badIdx = i;
                  break;
                }
              }
              if (badIdx !== -1 && badIdx <= cloned.length - 1) {
                const safeStart = Math.min(durationSec - 1.0, (cloned[badIdx - 1]?.time ?? 0) + 0.8);
                const tailSegs = segments
                  .filter((s) => s.endSec > safeStart + 0.5)
                  .map((s) => (s.startSec < safeStart ? { startSec: safeStart, endSec: s.endSec } : s));
                if (tailSegs.length > 0) {
                  const realignedTail = alignLyricsWithAcousticSegments(
                    cloned.slice(badIdx).map((l) => l.text).join('\n'),
                    durationSec,
                    tailSegs
                  );
                  for (let k = 0; k < realignedTail.length && badIdx + k < cloned.length; k++) {
                    cloned[badIdx + k].time = realignedTail[k].time;
                    cloned[badIdx + k].endTime = realignedTail[k].endTime;
                  }
                }
              }

              for (let i = 0; i < cloned.length; i++) {
                const startT = cloned[i].time;
                const nextT = i < cloned.length - 1 ? cloned[i + 1].time : durationSec;
                const containingSeg = segments.find((s) => startT >= s.startSec - 0.8 && startT <= s.endSec + 0.3);
                if (containingSeg && containingSeg.endSec < nextT - 1.2) {
                  // Song pauses before next line: finish verse cleanly at the acoustic pause instead of stretching
                  cloned[i].endTime = Math.round(Math.max(startT + 1.0, containingSeg.endSec) * 10) / 10;
                } else {
                  cloned[i].endTime = Math.round(Math.min(durationSec, Math.max(startT + 0.8, nextT - 0.1)) * 10) / 10;
                }
              }
            }
            return cloned;
          };

          const distributePlainLyrics = (plainText: string, durationSec: number, segments?: AcousticSegment[]) =>
            alignLyricsWithAcousticSegments(plainText, durationSec, segments);

          const cleanQueryName = (raw: string) =>
            String(raw || '')
              .replace(/\.[^/.]+$/, '')
              .replace(/\[[^\]]*\]/g, ' ')
              .replace(/\((?:official|video|audio|lyric|lyrics|letra|hd|hq|4k|visualizer|en vivo|live|remaster|remastered)[^)]*\)/gi, ' ')
              .replace(/^\d{1,3}[\s._-]+/, '')
              .replace(/[_]+/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();

          const searchLrclibLyrics = async (
            rawTitle: string,
            rawArtist: string,
            targetDuration: number,
            acousticSegments?: AcousticSegment[]
          ) => {
            const cleanedTitle = cleanQueryName(rawTitle);
            const cleanedArtist = cleanQueryName(rawArtist);
            if (!cleanedTitle && !cleanedArtist) return null;

            let qTrack = cleanedTitle;
            let qArtist = cleanedArtist;
            if (!qArtist && qTrack.includes(' - ')) {
              const parts = qTrack.split(' - ');
              qArtist = parts[0].trim();
              qTrack = parts.slice(1).join(' - ').trim();
            }

            const queryCandidates = [
              qArtist && qTrack ? `${qArtist} ${qTrack}` : qTrack || qArtist,
              qTrack,
            ].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);

            const normalizeWords = (s: string) =>
              String(s || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter((w) => w.length >= 2 && !['de', 'la', 'el', 'en', 'los', 'las', 'con', 'the', 'and', 'feat', 'ft', 'mp3', 'audio'].includes(w));

            const queryWords = normalizeWords(`${qTrack} ${qArtist}`);
            if (queryWords.length === 0) return null;

            for (const q of queryCandidates) {
              try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 5500);
                const resp = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
                  signal: controller.signal,
                  headers: { 'User-Agent': 'GermanVideosMusicales/1.0' }
                });
                clearTimeout(timer);
                if (!resp.ok) continue;
                const list = (await resp.json()) as any[];
                if (!Array.isArray(list) || list.length === 0) continue;

                let best: any = null;
                let bestScore = -1;
                for (const item of list) {
                  if (!item || (!item.syncedLyrics && !item.plainLyrics)) continue;
                  const candWords = normalizeWords(`${item.trackName || ''} ${item.artistName || ''}`);
                  const overlap = queryWords.filter((w) => candWords.some((cw) => cw.includes(w) || w.includes(cw))).length;
                  const overlapRatio = overlap / queryWords.length;
                  if (overlap === 0 || overlapRatio < 0.4) continue;

                  let score = overlapRatio * 60;
                  if (item.syncedLyrics) score += 50;
                  else if (item.plainLyrics) score += 15;
                  if (targetDuration > 5 && Number(item.duration) > 5) {
                    const diff = Math.abs(Number(item.duration) - targetDuration);
                    if (diff <= 6) score += 40;
                    else if (diff <= 15) score += 20;
                    else if (diff > 45) score -= 20;
                  }
                  if (score > bestScore) {
                    bestScore = score;
                    best = item;
                  }
                }

                if (best && bestScore >= 40) {
                  const dur = targetDuration > 5 ? targetDuration : Number(best.duration) || 180;
                  const parsed = best.syncedLyrics
                    ? parseLrcLyrics(best.syncedLyrics, dur)
                    : distributePlainLyrics(best.plainLyrics, dur, acousticSegments);
                  if (parsed.length > 0) {
                    return {
                      lyrics: parsed,
                      source: best.syncedLyrics ? 'lrclib-synced' : 'lrclib-plain',
                      detectedTitle: best.trackName || qTrack,
                      detectedArtist: best.artistName || qArtist,
                      rawPlain: best.plainLyrics || parsed.map((l) => l.text).join('\n'),
                    };
                  }
                }
              } catch {
                // ignore network timeouts
              }
            }
            return null;
          };

          const extractAudioTagsAndLyrics = async (audioPath: string, fallbackDur: number) => {
            const tags: Record<string, string> = {};
            let probedDur = fallbackDur;
            await new Promise<void>((resolve) => {
              execFile(
                'ffprobe',
                ['-v', 'quiet', '-print_format', 'json', '-show_format', audioPath],
                (err, stdout) => {
                  if (!err && stdout) {
                    try {
                      const json = JSON.parse(stdout);
                      const d = parseFloat(json?.format?.duration);
                      if (isFinite(d) && d > 0) probedDur = d;
                      const rawTags = json?.format?.tags || {};
                      for (const [k, v] of Object.entries(rawTags)) {
                        if (typeof v === 'string') tags[k.toLowerCase()] = v;
                      }
                    } catch {
                      // ignore
                    }
                  }
                  resolve();
                }
              );
            });

            const embeddedLyricText =
              tags['lyrics'] ||
              tags['unsyncedlyrics'] ||
              tags['uslt'] ||
              tags['sylt'] ||
              Object.entries(tags).find(([k]) => k.includes('lyric'))?.[1] ||
              '';

            let lyrics: { id: string; time: number; text: string }[] = [];
            if (embeddedLyricText.trim().length > 0) {
              const lrcAttempt = parseLrcLyrics(embeddedLyricText, probedDur);
              lyrics = lrcAttempt.length > 0 ? lrcAttempt : distributePlainLyrics(embeddedLyricText, probedDur);
            }

            return {
              duration: probedDur,
              detectedTitle: tags['title'] || '',
              detectedArtist: tags['artist'] || tags['album_artist'] || '',
              lyrics,
              rawPlain: embeddedLyricText,
            };
          };

          const alignProvidedLyricsWithGeminiVoice = async (
            audioPath: string,
            rawPlainLyrics: string,
            targetDur: number,
            acousticSegments?: AcousticSegment[]
          ) => {
            const apiKey = process.env.GEMINI_API_KEY;
            const candidateModels = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'].filter(isGeminiModelAvailable);
            if (!apiKey || candidateModels.length === 0 || !audioPath || !fs.existsSync(audioPath)) return null;

            const lines = String(rawPlainLyrics || '')
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l));
            if (lines.length === 0) return null;

            const compactPath = path.join(os.tmpdir(), `gmv_vo_${Date.now()}.mp3`);
            try {
              await new Promise<void>((resolve, reject) => {
                execFile(
                  'ffmpeg',
                  ['-y', '-i', audioPath, '-t', String(Math.min(480, Math.ceil(targetDur || 240))), '-vn', '-ar', '16000', '-ac', '1', '-b:a', '32k', compactPath],
                  (err) => (err ? reject(err) : resolve())
                );
              });

              const audioBuf = fs.readFileSync(compactPath);
              if (audioBuf.length > 18 * 1024 * 1024) return null;
              const base64Audio = audioBuf.toString('base64');

              const vocalHint = acousticSegments && acousticSegments.length > 0
                ? `\nTramos donde entra y continúa la voz (respeta las pausas instrumentales entre ellos): ${acousticSegments.map((s) => `${s.startSec.toFixed(1)}s-${s.endSec.toFixed(1)}s`).join(', ')}.`
                : '';

              const ai = new GoogleGenAI({
                apiKey,
                httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
              });

              for (const modelName of candidateModels) {
                try {
                  const response = await ai.models.generateContent({
                    model: modelName,
                    contents: {
                      parts: [
                        { inlineData: { mimeType: 'audio/mp3', data: base64Audio } },
                        {
                          text: `Escucha atentamente la voz del cantante o intérprete en este audio (duración total: ${Math.round(targetDur)} segundos). Devuelve TODOS los ${lines.length} versos completos en orden, con el segundo exacto en que el cantante empieza a cantarlo ("time") y termina ("endTime"). No detengas ni cortes la lista tras los solos instrumentales.${vocalHint}\n\nVERSOS:\n${lines.map((l, idx) => `${idx + 1}. ${l}`).join('\n')}`,
                        },
                      ],
                    },
                    config: {
                      responseMimeType: 'application/json',
                      responseSchema: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            time: { type: Type.NUMBER, description: 'Segundo exacto en que el cantante empieza el verso' },
                            endTime: { type: Type.NUMBER, description: 'Segundo exacto en que termina el verso' },
                            text: { type: Type.STRING, description: 'Texto del verso' },
                          },
                          required: ['time', 'endTime', 'text'],
                        },
                      },
                    },
                  });

                  const parsed = JSON.parse(response.text || '[]');
                  if (!Array.isArray(parsed)) continue;
                  const validItems = parsed.filter((item: any) => item && typeof item.text === 'string' && typeof item.time === 'number' && isFinite(item.time));
                  // Never accept a truncated Gemini list that drops verses after a break
                  if (validItems.length < Math.max(2, Math.ceil(lines.length * 0.85))) continue;

                  // Map 100% of original user lines cleanly in order
                  const result = lines.map((text, idx) => {
                    const srcIdx = Math.min(validItems.length - 1, Math.round((idx / Math.max(1, lines.length - 1)) * (validItems.length - 1)));
                    const src = validItems[srcIdx];
                    const t = Math.max(0, Math.min(targetDur - 0.5, Math.round(src.time * 10) / 10));
                    const e = Math.max(t + 0.6, Math.min(targetDur, Math.round((src.endTime || t + 3) * 10) / 10));
                    return { id: `voice-ai-${idx}-${Date.now()}`, time: t, endTime: e, text };
                  });

                  // Ensure strictly monotonic pacing (never collapse trailing verses onto the same second)
                  for (let i = 1; i < result.length; i++) {
                    if (result[i].time < result[i - 1].time + 0.55) {
                      result[i].time = Math.min(targetDur - 0.4, Math.round((result[i - 1].time + 0.6) * 10) / 10);
                    }
                    if ((result[i].endTime ?? 0) < result[i].time + 0.5) {
                      result[i].endTime = Math.min(targetDur, Math.round((result[i].time + 1.2) * 10) / 10);
                    }
                  }
                  const collapsedEndCount = result.filter((r) => r.time >= targetDur - 0.6).length;
                  if (collapsedEndCount > 1) continue;

                  return result;
                } catch (err) {
                  handleGeminiCallFailure(modelName, err);
                }
              }
              return null;
            } catch {
              return null;
            } finally {
              try { if (fs.existsSync(compactPath)) fs.unlinkSync(compactPath); } catch { /* ignore */ }
            }
          };

          const transcribeAudioWithGemini = async (audioPath: string, targetDur: number) => {
            const apiKey = process.env.GEMINI_API_KEY;
            const transcribeModel = 'gemini-3.5-transcribe';
            if (!apiKey || !isGeminiModelAvailable(transcribeModel)) return null;

            const compactPath = path.join(os.tmpdir(), `gmv_tr_${Date.now()}.mp3`);
            try {
              await new Promise<void>((resolve, reject) => {
                execFile(
                  'ffmpeg',
                  ['-y', '-i', audioPath, '-t', String(Math.min(480, Math.ceil(targetDur || 240))), '-vn', '-ar', '16000', '-ac', '1', '-b:a', '32k', compactPath],
                  (err) => (err ? reject(err) : resolve())
                );
              });

              const audioBuf = fs.readFileSync(compactPath);
              if (audioBuf.length > 18 * 1024 * 1024) return null;
              const base64Audio = audioBuf.toString('base64');

              const ai = new GoogleGenAI({
                apiKey,
                httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
              });

              const response = await ai.models.generateContent({
                model: transcribeModel,
                contents: {
                  parts: [
                    { inlineData: { mimeType: 'audio/mp3', data: base64Audio } },
                    {
                      text: `Transcribe exactamente la letra cantada por la voz del intérprete en este audio en su idioma original, línea por línea con marcas de tiempo [mm:ss] al inicio de cada verso (ejemplo: [00:12] Primer verso). Duración total: ${Math.round(targetDur)}s. Si es puramente instrumental sin voz cantada, responde únicamente INSTRUMENTAL.`,
                    },
                  ],
                },
              });

              const txt = (response.text || '').trim();
              if (!txt || /^instrumental$/i.test(txt)) return null;
              const lrcParsed = parseLrcLyrics(txt, targetDur);
              const lyrics = lrcParsed.length > 0 ? lrcParsed : distributePlainLyrics(txt, targetDur);
              if (lyrics.length === 0) return null;
              return {
                lyrics,
                source: 'gemini-audio-transcribe',
                rawPlain: lyrics.map((l) => l.text).join('\n'),
              };
            } catch (err) {
              handleGeminiCallFailure(transcribeModel, err);
              return null;
            } finally {
              try { if (fs.existsSync(compactPath)) fs.unlinkSync(compactPath); } catch { /* ignore */ }
            }
          };

          // Transfer verified synced LRC vocal timestamps onto the user's exact pasted lines when the same song matches on LRCLIB (never swaps the user's text)
          const matchSyncedTimestampsForUserLyrics = async (
            userRawLyrics: string,
            rawTitle: string,
            rawArtist: string,
            dur: number,
            acousticSegments?: AcousticSegment[]
          ) => {
            const userLines = String(userRawLyrics || '')
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l));
            if (userLines.length < 2) return null;

            const lrcMatch = await searchLrclibLyrics(rawTitle, rawArtist, dur, acousticSegments);
            if (!lrcMatch || lrcMatch.source !== 'lrclib-synced' || !lrcMatch.lyrics || lrcMatch.lyrics.length < 2) {
              return null;
            }

            const normWords = (s: string) =>
              s
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter((w) => w.length >= 3);

            const userWordSet = new Set(normWords(userLines.join(' ')));
            const lrcWordSet = new Set(normWords(lrcMatch.lyrics.map((l) => l.text).join(' ')));
            if (userWordSet.size < 4 || lrcWordSet.size < 4) return null;

            let matches = 0;
            for (const w of userWordSet) {
              if (lrcWordSet.has(w)) matches++;
            }
            const similarity = matches / userWordSet.size;
            if (similarity < 0.42) return null;

            // Map each user line monotonically onto the matched LRC vocal timeline (keeping 100% of user text)
            const refLines = lrcMatch.lyrics;
            let lastRefCursor = 0;
            const mapped = userLines.map((text, idx) => {
              const uw = new Set(normWords(text));
              let bestRefIdx = Math.min(refLines.length - 1, Math.round((idx / Math.max(1, userLines.length - 1)) * (refLines.length - 1)));
              let bestScore = -1;
              const searchEnd = Math.min(refLines.length - 1, lastRefCursor + 4);
              for (let r = lastRefCursor; r <= searchEnd; r++) {
                const rw = normWords(refLines[r].text);
                if (rw.length === 0 || uw.size === 0) continue;
                const common = rw.filter((w) => uw.has(w)).length;
                const sc = common / Math.max(uw.size, rw.length);
                if (sc > bestScore) {
                  bestScore = sc;
                  bestRefIdx = r;
                }
              }
              if (bestScore >= 0.45) {
                lastRefCursor = Math.min(refLines.length - 1, bestRefIdx + 1);
                return { id: `lrc-user-${idx}-${Date.now()}`, time: refLines[bestRefIdx].time, text };
              }
              const propIdx = Math.min(refLines.length - 1, Math.round((idx / Math.max(1, userLines.length - 1)) * (refLines.length - 1)));
              return { id: `lrc-user-${idx}-${Date.now()}`, time: refLines[propIdx].time, text };
            });

            // Enforce monotonic spacing
            for (let i = 1; i < mapped.length; i++) {
              if (mapped[i].time <= mapped[i - 1].time + 0.5) {
                mapped[i].time = Math.min(dur - 0.4, Math.round((mapped[i - 1].time + 0.8) * 10) / 10);
              }
            }
            return mapped;
          };

          if (cleanPath === '/api/extract-song-lyrics' && req.method === 'POST') {
            const body = await parseBody();
            const { audioFileId, songTitle = '', artist = '', fileName = '', durationSeconds = 180, rawLyrics = '', vocalStartOffsetSec = 0 } = body;

            const safeAudioId = typeof audioFileId === 'string' && /^gmv_[a-zA-Z0-9_.-]+$/.test(audioFileId) ? audioFileId : '';
            const audioPath = safeAudioId ? path.join(os.tmpdir(), safeAudioId) : '';

            // Analyze lead-singer center vocal waveform & pauses when audio file is available
            const acoustic = audioPath && fs.existsSync(audioPath)
              ? await analyzeAudioActivityAndPauses(audioPath, Number(durationSeconds) || 180, Number(vocalStartOffsetSec) || 0)
              : null;

            const effectiveBaseDur = acoustic?.duration || Math.max(10, Number(durationSeconds) || 60);

            if (typeof rawLyrics === 'string' && rawLyrics.trim().length > 0) {
              const lrcParsed = parseLrcLyrics(rawLyrics, effectiveBaseDur);
              let lyrics = lrcParsed.length > 0
                ? refineSyncedLyricsWithPauses(lrcParsed, effectiveBaseDur, acoustic?.segments, acoustic?.firstActiveSec)
                : null;
              let sourceTag = lrcParsed.length > 0 ? 'lrc-acoustic' : 'vocal-auto';

              if (!lyrics) {
                const matchedLrc = Number(vocalStartOffsetSec) <= 0
                  ? await matchSyncedTimestampsForUserLyrics(rawLyrics, songTitle || fileName, artist, effectiveBaseDur, acoustic?.segments)
                  : null;
                if (matchedLrc) {
                  lyrics = refineSyncedLyricsWithPauses(matchedLrc, effectiveBaseDur, acoustic?.segments, acoustic?.firstActiveSec);
                  sourceTag = 'lrc-voice-matched';
                } else {
                  const geminiAligned = await alignProvidedLyricsWithGeminiVoice(audioPath, rawLyrics, effectiveBaseDur, acoustic?.segments);
                  if (geminiAligned && geminiAligned.length > 0) {
                    lyrics = refineSyncedLyricsWithPauses(geminiAligned, effectiveBaseDur, acoustic?.segments, acoustic?.firstActiveSec);
                    sourceTag = 'gemini-voice-sync';
                  } else {
                    lyrics = distributePlainLyrics(rawLyrics, effectiveBaseDur, acoustic?.segments);
                  }
                }
              }

              return sendJson(200, {
                success: true,
                source: sourceTag,
                pausesDetected: acoustic ? Math.max(0, acoustic.segments.length - 1) : 0,
                lyrics,
                rawPlain: lyrics.map((l) => l.text).join('\n'),
              });
            }

            let effectiveDur = effectiveBaseDur;
            let detectedTitle = '';
            let detectedArtist = '';

            if (audioPath && fs.existsSync(audioPath)) {
              const tagRes = await extractAudioTagsAndLyrics(audioPath, effectiveDur);
              effectiveDur = tagRes.duration || effectiveDur;
              detectedTitle = tagRes.detectedTitle;
              detectedArtist = tagRes.detectedArtist;

              if (tagRes.lyrics.length > 0) {
                const isLrcTagged = /\[\d{1,3}:\d{2}/.test(tagRes.rawPlain);
                const aligned = isLrcTagged
                  ? refineSyncedLyricsWithPauses(tagRes.lyrics, effectiveDur, acoustic?.segments, acoustic?.firstActiveSec)
                  : distributePlainLyrics(tagRes.rawPlain, effectiveDur, acoustic?.segments);
                return sendJson(200, {
                  success: true,
                  source: 'id3-embedded',
                  pausesDetected: acoustic ? Math.max(0, acoustic.segments.length - 1) : 0,
                  detectedTitle,
                  detectedArtist,
                  lyrics: aligned,
                  rawPlain: aligned.map((l) => l.text).join('\n'),
                });
              }

              const transcribed = await transcribeAudioWithGemini(audioPath, effectiveDur || 180);
              if (transcribed && transcribed.lyrics.length > 0) {
                const refined = refineSyncedLyricsWithPauses(transcribed.lyrics, effectiveDur || 180, acoustic?.segments, acoustic?.firstActiveSec);
                return sendJson(200, {
                  success: true,
                  source: transcribed.source,
                  pausesDetected: acoustic ? Math.max(0, acoustic.segments.length - 1) : 0,
                  detectedTitle,
                  detectedArtist,
                  lyrics: refined,
                  rawPlain: transcribed.rawPlain,
                });
              }
            }

            // Fallback / primary web synced lyrics lookup (aligned to audio onset & pauses)
            const lookupTitle = detectedTitle || songTitle || fileName;
            const lookupArtist = detectedArtist || artist;
            const lrcMatch = await searchLrclibLyrics(lookupTitle, lookupArtist, effectiveDur || 180, acoustic?.segments);
            if (lrcMatch && lrcMatch.lyrics.length > 0) {
              const refined = refineSyncedLyricsWithPauses(lrcMatch.lyrics, effectiveDur || 180, acoustic?.segments, acoustic?.firstActiveSec);
              return sendJson(200, {
                success: true,
                source: lrcMatch.source,
                pausesDetected: acoustic ? Math.max(0, acoustic.segments.length - 1) : 0,
                detectedTitle: detectedTitle || lrcMatch.detectedTitle,
                detectedArtist: detectedArtist || lrcMatch.detectedArtist,
                lyrics: refined,
                rawPlain: lrcMatch.rawPlain,
              });
            }

            return sendJson(200, {
              success: false,
              source: 'none',
              detectedTitle,
              detectedArtist,
              lyrics: [],
            });
          }

          if (cleanPath === '/api/ai-sync-lyrics' && req.method === 'POST') {
            const body = await parseBody();
            const { songTitle = '', artist = '', rawLyrics, durationSeconds = 180, audioFileId, vocalStartOffsetSec = 0 } = body;

            const safeAudioId = typeof audioFileId === 'string' && /^gmv_[a-zA-Z0-9_.-]+$/.test(audioFileId) ? audioFileId : '';
            const audioPath = safeAudioId ? path.join(os.tmpdir(), safeAudioId) : '';
            const manualVocalStart = Math.max(0, Number(vocalStartOffsetSec) || 0);
            const acoustic = audioPath && fs.existsSync(audioPath)
              ? await analyzeAudioActivityAndPauses(audioPath, Number(durationSeconds) || 180, manualVocalStart)
              : null;

            const dur = acoustic?.duration || Math.max(10, Number(durationSeconds) || 60);
            if (rawLyrics && typeof rawLyrics === 'string' && rawLyrics.trim().length > 0) {
              const lrcParsed = parseLrcLyrics(rawLyrics, dur);
              let synced = lrcParsed.length > 0
                ? refineSyncedLyricsWithPauses(lrcParsed, dur, acoustic?.segments, acoustic?.firstActiveSec)
                : null;
              let sourceTag = lrcParsed.length > 0 ? 'lrc-acoustic' : (acoustic ? 'acoustic-auto' : 'manual-synced');

              if (!synced) {
                const matchedLrc = manualVocalStart === 0
                  ? await matchSyncedTimestampsForUserLyrics(rawLyrics, songTitle, artist, dur, acoustic?.segments)
                  : null;
                if (matchedLrc) {
                  synced = refineSyncedLyricsWithPauses(matchedLrc, dur, acoustic?.segments, acoustic?.firstActiveSec);
                  sourceTag = 'lrc-voice-matched';
                } else {
                  const geminiAligned = await alignProvidedLyricsWithGeminiVoice(audioPath, rawLyrics, dur, acoustic?.segments);
                  if (geminiAligned && geminiAligned.length > 0) {
                    if (manualVocalStart > 0 && Math.abs(geminiAligned[0].time - manualVocalStart) > 0.5) {
                      const anchorShift = Math.round((manualVocalStart - geminiAligned[0].time) * 10) / 10;
                      geminiAligned.forEach((l) => {
                        l.time = Math.max(0, Math.min(dur - 0.4, Math.round((l.time + anchorShift) * 10) / 10));
                        if (l.endTime) {
                          l.endTime = Math.max(l.time + 0.5, Math.min(dur, Math.round((l.endTime + anchorShift) * 10) / 10));
                        }
                      });
                    }
                    synced = refineSyncedLyricsWithPauses(geminiAligned, dur, acoustic?.segments, manualVocalStart > 0 ? manualVocalStart : acoustic?.firstActiveSec);
                    sourceTag = 'gemini-voice-sync';
                  } else {
                    synced = distributePlainLyrics(rawLyrics, dur, acoustic?.segments);
                    if (manualVocalStart > 0 && synced.length > 0 && synced[0].time > manualVocalStart + 0.5) {
                      const shiftBack = Math.round((synced[0].time - manualVocalStart) * 10) / 10;
                      synced = synced.map((l) => ({
                        ...l,
                        time: Math.max(0, Math.round((l.time - shiftBack) * 10) / 10),
                        endTime: l.endTime ? Math.max(0.6, Math.round((l.endTime - shiftBack) * 10) / 10) : undefined,
                      }));
                    }
                  }
                }
              }

              return sendJson(200, {
                success: true,
                title: songTitle,
                artist: artist || '',
                source: sourceTag,
                pausesDetected: acoustic ? Math.max(0, acoustic.segments.length - 1) : 0,
                lyrics: synced
              });
            }

            if (audioPath && fs.existsSync(audioPath)) {
              const transcribed = await transcribeAudioWithGemini(audioPath, dur);
              if (transcribed && transcribed.lyrics.length > 0) {
                const refined = refineSyncedLyricsWithPauses(transcribed.lyrics, dur, acoustic?.segments, acoustic?.firstActiveSec);
                return sendJson(200, {
                  title: songTitle,
                  artist: artist || '',
                  source: transcribed.source,
                  pausesDetected: acoustic ? Math.max(0, acoustic.segments.length - 1) : 0,
                  lyrics: refined,
                  rawPlain: transcribed.rawPlain,
                });
              }
            }

            const lrcMatch = await searchLrclibLyrics(songTitle, artist, dur, acoustic?.segments);
            if (lrcMatch && lrcMatch.lyrics.length > 0) {
              const refined = refineSyncedLyricsWithPauses(lrcMatch.lyrics, dur, acoustic?.segments, acoustic?.firstActiveSec);
              return sendJson(200, {
                title: songTitle,
                artist: artist || '',
                source: lrcMatch.source,
                pausesDetected: acoustic ? Math.max(0, acoustic.segments.length - 1) : 0,
                lyrics: refined,
                rawPlain: lrcMatch.rawPlain,
              });
            }

            return sendJson(200, {
              title: songTitle,
              artist: artist || '',
              source: 'none',
              lyrics: []
            });
          }

          // Search and match video approximating the story of the song
          if (cleanPath === '/api/search-story-video' && req.method === 'POST') {
            const body = await parseBody();
            const songTitle = body.songTitle || body.title || '';
            const songOrigin = body.songOrigin || body.origin || '';
            const story = body.story || '';
            const artist = body.artist || '';

            const THEMATIC_VIDEOS = [
              {
                id: 'sunset_romance',
                title: 'Atardecer y Recuerdos Románticos',
                tags: ['amor', 'romance', 'atardecer', 'playa', 'recuerdos', 'nostalgia', 'corazon', 'tristeza', 'balada', 'sentimiento', 'olvido', 'pasion', 'especial'],
                file: 'sunset_romance.mp4',
                thumbnail: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=640&q=80',
                description: 'Cielo dorado y tonos cálidos en movimiento continuo, ideal para canciones emotivas, románticas y baladas.'
              },
              {
                id: 'night_city',
                title: 'Ciudad Nocturna y Luces de Neón',
                tags: ['ciudad', 'noche', 'urbano', 'luces', 'calle', 'desvelo', 'ritmo', 'auto', 'carretera', 'pop', 'rap', 'trap', 'moderno'],
                file: 'night_city.mp4',
                thumbnail: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=640&q=80',
                description: 'Rascacielos y haces de neón azul y violeta metropolitano para ritmos modernos, urbanos y nocturnos.'
              },
              {
                id: 'travel_nature',
                title: 'Viaje en Carretera, Naturaleza y Libertad',
                tags: ['viaje', 'carretera', 'libertad', 'naturaleza', 'montana', 'paisaje', 'escapada', 'vida', 'destino', 'camino', 'horizonte'],
                file: 'travel_nature.mp4',
                thumbnail: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=640&q=80',
                description: 'Horizontes abiertos en tonos esmeralda y oro para canciones de viaje, superación y libertad.'
              },
              {
                id: 'stage_concert',
                title: 'Concierto y Luces de Escenario',
                tags: ['fiesta', 'energia', 'fuego', 'rock', 'baile', 'alegria', 'fuerza', 'pasion', 'concierto', 'bateria', 'guitarra', 'electrica'],
                file: 'stage_concert.mp4',
                thumbnail: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=640&q=80',
                description: 'Rayos intensos magenta y oro que recrean la fuerza de un escenario y show en vivo.'
              },
              {
                id: 'party_celebration',
                title: 'Fiesta, Ritmo y Baile',
                tags: ['baile', 'fiesta', 'colores', 'alegria', 'ritmo', 'sabor', 'latino', 'amigos', 'celebracion', 'verano', 'cumbia', 'salsa', 'bailable'],
                file: 'party_celebration.mp4',
                thumbnail: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=640&q=80',
                description: 'Pulsaciones dinámicas y festivas llenas de color para bailar y celebrar la música.'
              },
              {
                id: 'calm_acoustic',
                title: 'Momento Acústico y Melódico',
                tags: ['guitarra', 'suave', 'paz', 'cafe', 'acustico', 'intimo', 'hogar', 'alma', 'tranquilidad', 'tiempo'],
                file: 'calm_acoustic.mp4',
                thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=640&q=80',
                description: 'Ambiente cálido y sereno en tonalidades ámbar para canciones suaves y acústicas.'
              }
            ];

            // Match best theme based on keywords
            const combinedText = `${songTitle} ${songOrigin} ${story} ${artist}`.toLowerCase();
            let bestIndex = 0;
            let highestScore = -1;

            THEMATIC_VIDEOS.forEach((item, idx) => {
              let score = 0;
              item.tags.forEach(tag => {
                if (combinedText.includes(tag)) score += 2;
              });
              if (score > highestScore) {
                highestScore = score;
                bestIndex = idx;
              }
            });

            const matched = THEMATIC_VIDEOS[bestIndex];
            const cleanName = (songTitle || 'video_cancion').replace(/[/\\?%*:|"<>]/g, '_');
            const streamUrl = `/api/video-stream?theme=${matched.id}`;
            const downloadUrl = `/api/video-download?theme=${matched.id}&filename=${encodeURIComponent(cleanName + '_video_relacionado.mp4')}`;

            const alternatives = THEMATIC_VIDEOS.map(v => ({
              ...v,
              videoUrl: `/api/video-stream?theme=${v.id}`,
              downloadUrl: `/api/video-download?theme=${v.id}&filename=${encodeURIComponent(cleanName + '_' + v.id + '.mp4')}`
            }));

            return sendJson(200, {
              success: true,
              selectedVideo: {
                ...matched,
                videoUrl: streamUrl,
                downloadUrl
              },
              matchedVideo: {
                ...matched,
                videoUrl: streamUrl,
                downloadUrl
              },
              theme: matched.title,
              description: matched.description,
              videoUrl: streamUrl,
              downloadUrl,
              alternatives
            });
          }

          // Video Stream endpoint with Range (206) support for smooth video element buffering and canvas drawing
          if (cleanPath === '/api/video-stream') {
            const urlObj = new URL(req.url, 'http://localhost:3000');
            const theme = urlObj.searchParams.get('theme') || 'sunset_romance';
            const validThemes: Record<string, string> = {
              'sunset_romance': 'sunset_romance.mp4',
              'night_city': 'night_city.mp4',
              'travel_nature': 'travel_nature.mp4',
              'stage_concert': 'stage_concert.mp4',
              'party_celebration': 'party_celebration.mp4',
              'calm_acoustic': 'calm_acoustic.mp4',
              'sunset-romance': 'sunset_romance.mp4',
              'night-city': 'night_city.mp4',
              'travel-road': 'travel_nature.mp4',
              'stage-energy': 'stage_concert.mp4',
              'party-celebration': 'party_celebration.mp4',
              'calm-acoustic': 'calm_acoustic.mp4'
            };

            const fileName = validThemes[theme] || 'sunset_romance.mp4';
            const filePath = path.join(process.cwd(), 'public', 'videos', fileName);

            if (!fs.existsSync(filePath)) {
              return sendJson(404, { error: 'Archivo de video no encontrado' });
            }

            const stat = fs.statSync(filePath);
            const fileSize = stat.size;
            const range = req.headers.range;

            if (range) {
              const parts = range.replace(/bytes=/, '').split('-');
              const start = parseInt(parts[0], 10);
              const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
              const chunksize = (end - start) + 1;
              const fileStream = fs.createReadStream(filePath, { start, end });

              res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/mp4',
                'Access-Control-Allow-Origin': '*'
              });
              fileStream.pipe(res);
              return;
            } else {
              res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*'
              });
              fs.createReadStream(filePath).pipe(res);
              return;
            }
          }

          // Direct Video Download endpoint
          if (cleanPath === '/api/video-download') {
            const urlObj = new URL(req.url, 'http://localhost:3000');
            const theme = urlObj.searchParams.get('theme') || 'sunset_romance';
            const filename = urlObj.searchParams.get('filename') || 'video_relacionado.mp4';

            const validThemes: Record<string, string> = {
              'sunset_romance': 'sunset_romance.mp4',
              'night_city': 'night_city.mp4',
              'travel_nature': 'travel_nature.mp4',
              'stage_concert': 'stage_concert.mp4',
              'party_celebration': 'party_celebration.mp4',
              'calm_acoustic': 'calm_acoustic.mp4',
              'sunset-romance': 'sunset_romance.mp4',
              'night-city': 'night_city.mp4',
              'travel-road': 'travel_nature.mp4',
              'stage-energy': 'stage_concert.mp4',
              'party-celebration': 'party_celebration.mp4',
              'calm-acoustic': 'calm_acoustic.mp4'
            };

            const fileName = validThemes[theme] || 'sunset_romance.mp4';
            const filePath = path.join(process.cwd(), 'public', 'videos', fileName);

            if (!fs.existsSync(filePath)) {
              return sendJson(404, { error: 'Archivo de video no encontrado' });
            }

            const stat = fs.statSync(filePath);
            res.writeHead(200, {
              'Content-Length': stat.size,
              'Content-Type': 'video/mp4',
              'Content-Disposition': `attachment; filename="${filename}"`,
              'Access-Control-Allow-Origin': '*'
            });
            fs.createReadStream(filePath).pipe(res);
            return;
          }

          // Curated real-world photography for song stories (people, portraits, couples, landscapes, musicians, scenes)
          const STORY_PHOTOS = [
            {
              id: 'person_portrait',
              title: 'Retrato de Persona · Sentimiento',
              category: 'Personas',
              tags: ['persona', 'mujer', 'rostro', 'mirada', 'historia', 'ella', 'alma', 'recuerdo', 'amor', 'tristeza'],
              sourceUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1280&q=85',
            },
            {
              id: 'man_portrait',
              title: 'Retrato Masculino · Mirada y Camino',
              category: 'Personas',
              tags: ['persona', 'hombre', 'chico', 'el', 'rostro', 'historia', 'pensamiento', 'nostalgia', 'vida'],
              sourceUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=1280&q=85',
            },
            {
              id: 'couple_romance',
              title: 'Pareja · Historia de Amor y Besos',
              category: 'Personas',
              tags: ['pareja', 'amor', 'romance', 'abrazo', 'beso', 'corazon', 'novios', 'juntos', 'historia', 'balada'],
              sourceUrl: 'https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=1280&q=85',
            },
            {
              id: 'friends_party',
              title: 'Personas Celebrando · Amistad y Alegría',
              category: 'Personas',
              tags: ['amigos', 'gente', 'personas', 'fiesta', 'baile', 'alegria', 'celebracion', 'familia', 'sabor', 'ritmo'],
              sourceUrl: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1280&q=85',
            },
            {
              id: 'singer_stage',
              title: 'Cantante / Intérprete en Vivo',
              category: 'Música',
              tags: ['cantante', 'interprete', 'voz', 'microfono', 'concierto', 'escenario', 'musica', 'canto'],
              sourceUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1280&q=85',
            },
            {
              id: 'guitar_memories',
              title: 'Músico y Guitarra Acústica',
              category: 'Música',
              tags: ['guitarra', 'acustico', 'serenata', 'trova', 'compositor', 'cuerdas', 'hogar', 'paz'],
              sourceUrl: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=1280&q=85',
            },
            {
              id: 'sunset_beach',
              title: 'Paisaje de Playa y Atardecer',
              category: 'Paisajes',
              tags: ['paisaje', 'playa', 'mar', 'oceano', 'olas', 'atardecer', 'sol', 'verano', 'arena', 'cielo'],
              sourceUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1280&q=85',
            },
            {
              id: 'mountain_landscape',
              title: 'Paisaje de Montañas y Lago',
              category: 'Paisajes',
              tags: ['paisaje', 'montana', 'lago', 'naturaleza', 'valle', 'agua', 'paz', 'cielo', 'libertad'],
              sourceUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1280&q=85',
            },
            {
              id: 'forest_sunrise',
              title: 'Bosque con Luz del Amanecer',
              category: 'Paisajes',
              tags: ['bosque', 'arboles', 'paisaje', 'amanecer', 'luz', 'esperanza', 'naturaleza', 'sendero'],
              sourceUrl: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=1280&q=85',
            },
            {
              id: 'road_journey',
              title: 'Viaje en Carretera y Horizonte',
              category: 'Paisajes',
              tags: ['viaje', 'carretera', 'camino', 'aventura', 'horizonte', 'paisaje', 'auto', 'destino', 'libertad'],
              sourceUrl: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1280&q=85',
            },
            {
              id: 'night_city',
              title: 'Ciudad Nocturna y Luces',
              category: 'Ciudad',
              tags: ['ciudad', 'noche', 'edificios', 'luces', 'calle', 'urbano', 'desvelo', 'moderno', 'neon'],
              sourceUrl: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1280&q=85',
            },
            {
              id: 'concert_lights',
              title: 'Escenario y Luces de Show',
              category: 'Música',
              tags: ['escenario', 'show', 'concierto', 'luces', 'rock', 'pop', 'energia', 'baile'],
              sourceUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1280&q=85',
            },
          ];

          const THEME_TO_PHOTO_ID: Record<string, string> = {
            sunset_romance: 'couple_romance',
            night_city: 'night_city',
            travel_nature: 'mountain_landscape',
            stage_concert: 'singer_stage',
            party_celebration: 'friends_party',
            calm_acoustic: 'guitar_memories',
          };

          const ensureStoryPhotoCached = async (photoId: string): Promise<string | null> => {
            const item = STORY_PHOTOS.find((p) => p.id === photoId) || STORY_PHOTOS[0];
            const cachePath = path.join(os.tmpdir(), `gmv_story_photo_${item.id}.jpg`);
            if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 2000) {
              return cachePath;
            }
            try {
              const r = await fetch(item.sourceUrl);
              if (!r.ok) return null;
              const ab = await r.arrayBuffer();
              if (ab.byteLength < 1000) return null;
              fs.writeFileSync(cachePath, Buffer.from(ab));
              return cachePath;
            } catch {
              return null;
            }
          };

          // Catalog & search for selectable story photos (people, landscapes, musicians, city, etc.)
          if (cleanPath === '/api/story-photos' && req.method === 'GET') {
            const urlObj = new URL(req.url, 'http://localhost:3000');
            const q = (urlObj.searchParams.get('q') || '').trim().toLowerCase();
            const cat = (urlObj.searchParams.get('category') || '').trim().toLowerCase();

            let filtered = STORY_PHOTOS.map((p) => {
              let score = 0;
              if (q) {
                const hay = `${p.title} ${p.category} ${p.tags.join(' ')}`.toLowerCase();
                for (const word of q.split(/\s+/).filter(Boolean)) {
                  if (hay.includes(word)) score += 3;
                }
              }
              return { item: p, score };
            });

            if (cat && cat !== 'todas' && cat !== 'all') {
              filtered = filtered.filter(({ item }) => item.category.toLowerCase() === cat);
            }

            if (q) {
              const matchedOnly = filtered.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
              if (matchedOnly.length > 0) {
                filtered = matchedOnly;
              }
            }

            return sendJson(200, {
              success: true,
              photos: filtered.map(({ item }) => ({
                id: item.id,
                title: item.title,
                category: item.category,
                tags: item.tags,
                previewUrl: `/api/photo-download?photoId=${encodeURIComponent(item.id)}`,
                downloadUrl: `/api/photo-download?photoId=${encodeURIComponent(item.id)}&download=1&filename=${encodeURIComponent(item.id + '.jpg')}`,
              })),
            });
          }

          // Serve or download real story photography (person, landscape, etc.) via server proxy/cache
          if (cleanPath === '/api/photo-download') {
            const urlObj = new URL(req.url, 'http://localhost:3000');
            const requestedPhotoId = urlObj.searchParams.get('photoId') || '';
            const theme = urlObj.searchParams.get('theme') || 'sunset_romance';
            const isDownload = urlObj.searchParams.get('download') !== '0' && (!requestedPhotoId || urlObj.searchParams.get('download') === '1');
            const resolvedPhotoId = requestedPhotoId || THEME_TO_PHOTO_ID[theme] || 'couple_romance';
            const filename = (urlObj.searchParams.get('filename') || `${resolvedPhotoId}.jpg`).replace(/["\r\n]/g, '');

            const cachedPhotoPath = await ensureStoryPhotoCached(resolvedPhotoId);
            if (cachedPhotoPath && fs.existsSync(cachedPhotoPath)) {
              const imgBuf = fs.readFileSync(cachedPhotoPath);
              const headers: Record<string, string | number> = {
                'Content-Length': imgBuf.byteLength,
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': '*',
              };
              if (isDownload) {
                headers['Content-Disposition'] = `attachment; filename="${filename}"`;
              }
              res.writeHead(200, headers);
              res.end(imgBuf);
              return;
            }

            // Fallback to local FFmpeg frame if offline
            const validThemes: Record<string, string> = {
              'sunset_romance': 'sunset_romance.mp4',
              'night_city': 'night_city.mp4',
              'travel_nature': 'travel_nature.mp4',
              'stage_concert': 'stage_concert.mp4',
              'party_celebration': 'party_celebration.mp4',
              'calm_acoustic': 'calm_acoustic.mp4',
            };
            const fileName = validThemes[theme] || 'sunset_romance.mp4';
            const videoFilePath = path.join(process.cwd(), 'public', 'videos', fileName);
            if (!fs.existsSync(videoFilePath)) {
              return sendJson(404, { error: 'Foto temática no encontrada' });
            }
            const imgBuf: Buffer = await new Promise((resolve, reject) => {
              const chunks: Buffer[] = [];
              const child = spawn('ffmpeg', [
                '-v', 'error',
                '-ss', '1.0',
                '-i', videoFilePath,
                '-vframes', '1',
                '-q:v', '2',
                '-f', 'image2pipe',
                '-vcodec', 'mjpeg',
                'pipe:1'
              ]);
              child.stdout.on('data', (d: Buffer) => chunks.push(d));
              child.on('error', reject);
              child.on('close', (code) => {
                if (chunks.length === 0 && code !== 0) return reject(new Error('ffmpeg frame failed'));
                resolve(Buffer.concat(chunks));
              });
            });
            res.writeHead(200, {
              'Content-Length': imgBuf.byteLength,
              'Content-Type': 'image/jpeg',
              ...(isDownload ? { 'Content-Disposition': `attachment; filename="${filename}"` } : {}),
              'Access-Control-Allow-Origin': '*'
            });
            res.end(imgBuf);
            return;
          }

          if (req.url?.startsWith('/api/drive-download')) {
            const urlObj = new URL(req.url, 'http://localhost:3000');
            const fileId = urlObj.searchParams.get('id');
            const reqToken = req.headers.authorization?.replace(/^Bearer\s+/i, '') || urlObj.searchParams.get('token');

            if (!fileId) {
              return sendJson(400, { error: 'Se requiere el ID del archivo de Google Drive' });
            }

            // Try with Bearer token if available, or fall back to public download
            let downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
            const headers: Record<string, string> = {};
            if (reqToken) {
              headers['Authorization'] = `Bearer ${reqToken}`;
            } else {
              downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
            }

            let driveRes = await fetch(downloadUrl, { headers });
            if (!driveRes.ok && reqToken) {
              driveRes = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`);
            }

            if (!driveRes.ok) {
              return sendJson(driveRes.status, { 
                error: 'No se pudo descargar el archivo de Google Drive. Verifica que el archivo exista o tenga el enlace compartido.' 
              });
            }

            const contentType = driveRes.headers.get('content-type') || 'application/octet-stream';
            const contentLength = driveRes.headers.get('content-length');
            res.statusCode = 200;
            res.setHeader('Content-Type', contentType);
            if (contentLength) res.setHeader('Content-Length', contentLength);
            res.setHeader('Access-Control-Allow-Origin', '*');

            const arrayBuffer = await driveRes.arrayBuffer();
            res.end(Buffer.from(arrayBuffer));
            return;
          }

          // Stream binary upload (single or chunked append for large gallery videos / songs) directly to /tmp
          if (cleanPath === '/api/upload-temp-media' && req.method === 'POST') {
            const urlObj = new URL(req.url, 'http://localhost:3000');
            const isAppend = urlObj.searchParams.get('append') === '1';
            const requestedId = urlObj.searchParams.get('fileId') || '';
            const safeRequestedId = /^gmv_[a-zA-Z0-9_.-]+$/.test(requestedId) ? requestedId : '';

            const rawExt = (urlObj.searchParams.get('ext') || '.bin').replace(/[^a-zA-Z0-9.]/g, '');
            const ext = rawExt.startsWith('.') ? rawExt : `.${rawExt}`;
            const fileId = (isAppend && safeRequestedId)
              ? safeRequestedId
              : `gmv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
            const tmpPath = path.join(os.tmpdir(), fileId);

            if (!isAppend) {
              // Best-effort cleanup of old gmv_* files older than 2 hours
              try {
                const now = Date.now();
                for (const entry of fs.readdirSync(os.tmpdir())) {
                  if (entry.startsWith('gmv_')) {
                    const full = path.join(os.tmpdir(), entry);
                    const st = fs.statSync(full);
                    if (now - st.mtimeMs > 2 * 60 * 60 * 1000) {
                      fs.unlinkSync(full);
                    }
                  }
                }
              } catch {
                // ignore cleanup errors
              }
            }

            await new Promise<void>((resolve, reject) => {
              const writeStream = fs.createWriteStream(tmpPath, { flags: isAppend ? 'a' : 'w' });
              req.pipe(writeStream);
              writeStream.on('finish', () => resolve());
              writeStream.on('error', reject);
              req.on('error', reject);
            });

            return sendJson(200, { success: true, fileId });
          }

          // Render loop video OR photo(s) slideshow with FFmpeg to match exact song duration with burned-in lyrics
          if (cleanPath === '/api/render-loop-video' && req.method === 'POST') {
            const body = await parseBody();
            const {
              videoFileId,
              photoFileIds,
              storyPhotoIds,
              videoTheme,
              audioFileId,
              durationSeconds,
              aspectRatio = '16:9',
              songTitle = '',
              artist = '',
              lyrics = [],
              showTitleHeader = true,
              lyricEffect = 'karaoke-sweep'
            } = body;

            const safeId = (val: unknown) => typeof val === 'string' && /^gmv_[a-zA-Z0-9_.-]+$/.test(val) ? val : '';
            const safeAudioId = safeId(audioFileId);
            if (!safeAudioId) {
              return sendJson(400, { error: 'Se requiere una canción o audio válido para generar el video.' });
            }
            const audioPath = path.join(os.tmpdir(), safeAudioId);
            if (!fs.existsSync(audioPath)) {
              return sendJson(404, { error: 'El archivo de audio temporal expiró o no existe.' });
            }

            const photoPaths: string[] = Array.isArray(photoFileIds)
              ? photoFileIds
                  .map((pid) => safeId(pid))
                  .filter(Boolean)
                  .map((pid) => path.join(os.tmpdir(), pid))
                  .filter((p) => fs.existsSync(p))
              : [];

            if (photoPaths.length === 0 && Array.isArray(storyPhotoIds)) {
              for (const spid of storyPhotoIds) {
                if (typeof spid === 'string' && spid.trim()) {
                  const cached = await ensureStoryPhotoCached(spid.trim());
                  if (cached && fs.existsSync(cached)) photoPaths.push(cached);
                }
              }
            }

            let videoPath = '';
            if (photoPaths.length === 0) {
              const safeVideoId = safeId(videoFileId);
              if (safeVideoId) {
                const candidate = path.join(os.tmpdir(), safeVideoId);
                if (fs.existsSync(candidate)) videoPath = candidate;
              }
              if (!videoPath) {
                const validThemes: Record<string, string> = {
                  'sunset_romance': 'sunset_romance.mp4',
                  'night_city': 'night_city.mp4',
                  'travel_nature': 'travel_nature.mp4',
                  'stage_concert': 'stage_concert.mp4',
                  'party_celebration': 'party_celebration.mp4',
                  'calm_acoustic': 'calm_acoustic.mp4',
                };
                const themeFile = validThemes[String(videoTheme || 'sunset_romance')] || 'sunset_romance.mp4';
                videoPath = path.join(process.cwd(), 'public', 'videos', themeFile);
              }

              if (!fs.existsSync(videoPath)) {
                return sendJson(404, { error: 'No se encontró el video o foto de fondo.' });
              }
            }

            // Probe exact audio duration with ffprobe
            const probedDuration: number = await new Promise((resolve) => {
              execFile('ffprobe', [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                audioPath
              ], (err, stdout) => {
                if (!err && stdout) {
                  const val = parseFloat(stdout.trim());
                  if (isFinite(val) && val > 0) return resolve(val);
                }
                resolve(Number(durationSeconds) > 0 ? Number(durationSeconds) : 30);
              });
            });

            const targetDuration = Math.max(1, probedDuration);
            const targetW = aspectRatio === '9:16' ? 720 : aspectRatio === '1:1' ? 1080 : 1280;
            const targetH = aspectRatio === '9:16' ? 1280 : aspectRatio === '1:1' ? 1080 : 720;

            const formatAssTime = (secs: number) => {
              const s = Math.max(0, secs);
              const h = Math.floor(s / 3600);
              const m = Math.floor((s % 3600) / 60);
              const sec = Math.floor(s % 60);
              const cs = Math.floor((s % 1) * 100);
              return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
            };

            const escapeAss = (str: string) =>
              String(str || '').replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\N');

            const validLyrics = Array.isArray(lyrics)
              ? lyrics
                  .filter((l: any) => l && typeof l.text === 'string' && l.text.trim().length > 0)
                  .sort((a: any, b: any) => Number(a.time || 0) - Number(b.time || 0))
              : [];

            const hasHeaderText = showTitleHeader && (String(songTitle).trim() || String(artist).trim());
            const assPath = path.join(os.tmpdir(), `gmv_subs_${Date.now()}.ass`);
            let useAss = false;

            if (hasHeaderText || validLyrics.length > 0) {
              useAss = true;
              const events: string[] = [];
              const endStr = formatAssTime(targetDuration);
              if (hasHeaderText) {
                const titleLine = escapeAss(String(songTitle || '').trim());
                const artistLine = escapeAss(String(artist || '').trim());
                if (titleLine) {
                  events.push(`Dialogue: 0,0:00:00.00,${endStr},Title,,0,0,0,,${titleLine}`);
                }
                if (artistLine) {
                  events.push(`Dialogue: 0,0:00:00.00,${endStr},Artist,,0,0,0,,${artistLine}`);
                }
              }

              const wrapAssLine = (txt: string, maxChars: number) => {
                const words = txt.trim().split(/\s+/);
                const rows: string[] = [];
                let cur = '';
                for (const w of words) {
                  if (!cur) cur = w;
                  else if (cur.length + 1 + w.length <= maxChars) cur += ' ' + w;
                  else { rows.push(cur); cur = w; }
                }
                if (cur) rows.push(cur);
                return rows.join('\\N');
              };

              const maxCharsPerLine = aspectRatio === '9:16' ? 26 : aspectRatio === '1:1' ? 34 : 44;
              const longestChars = validLyrics.reduce((mx, l) => Math.max(mx, String(l.text || '').trim().length), 0);
              const adaptiveAssScale = longestChars > maxCharsPerLine * 2.2 ? 0.82 : longestChars > maxCharsPerLine * 1.4 ? 0.90 : 1.0;
              const assLyricFontPx = Math.max(22, Math.round(targetW * 0.044 * adaptiveAssScale));
              const assNextFontPx = Math.max(16, Math.round(targetW * 0.028 * adaptiveAssScale));

              for (let i = 0; i < validLyrics.length; i++) {
                const cur = validLyrics[i];
                const startT = Math.max(0, Number(cur.time) || 0);
                const nextT = i < validLyrics.length - 1 ? Number(validLyrics[i + 1].time) : targetDuration;
                const phraseEnd = Number(cur.endTime) > startT ? Number(cur.endTime) : nextT;
                const endT = Math.min(targetDuration, nextT, Math.max(startT + 0.9, phraseEnd));
                if (startT < targetDuration) {
                  const spanCs = Math.max(30, Math.round((endT - startT) * 100));
                  const wrapped = wrapAssLine(escapeAss(cur.text.trim()), maxCharsPerLine);
                  let effectTag = `{\\fad(140,120)\\kf${spanCs}}`;
                  if (lyricEffect === 'bounce-pop') {
                    effectTag = `{\\fad(90,100)\\t(0,180,\\fscx112\\fscy112)\\t(180,360,\\fscx100\\fscy100)}`;
                  } else if (lyricEffect === 'fade-slide') {
                    effectTag = `{\\fad(320,260)}`;
                  } else if (lyricEffect === 'neon-pulse') {
                    effectTag = `{\\fad(120,120)\\be3\\t(0,220,\\fscx106\\fscy106)\\t(220,450,\\fscx100\\fscy100)}`;
                  } else if (lyricEffect === 'typewriter') {
                    effectTag = `{\\fad(60,100)\\k${spanCs}}`;
                  } else if (lyricEffect === 'subtitle-clean') {
                    effectTag = `{\\fad(180,150)}`;
                  }
                  events.push(`Dialogue: 1,${formatAssTime(startT)},${formatAssTime(endT)},Lyric,,0,0,0,,${effectTag}${wrapped}`);

                  if (i < validLyrics.length - 1 && lyricEffect !== 'subtitle-clean') {
                    const nxt = wrapAssLine(escapeAss(validLyrics[i + 1].text.trim()), maxCharsPerLine);
                    const nxtShowEnd = Math.min(targetDuration, Math.max(endT, nextT));
                    events.push(`Dialogue: 0,${formatAssTime(startT)},${formatAssTime(nxtShowEnd)},NextLyric,,0,0,0,,{\\fad(140,120)}${nxt}`);
                  }
                }
              }

              const assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: ${targetW}
PlayResY: ${targetH}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Liberation Sans,${Math.round(targetW * 0.036)},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,8,40,40,${Math.round(targetH * 0.05)},1
Style: Artist,Liberation Sans,${Math.round(targetW * 0.022)},&H00E9D5FF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,8,40,40,${Math.round(targetH * 0.11)},1
Style: Lyric,Liberation Sans,${assLyricFontPx},&H005E3FF4,&H00FFFFFF,&H00000000,&HB0090D16,-1,0,0,0,100,100,0,0,1,4,2,2,45,45,${Math.round(targetH * 0.15)},1
Style: NextLyric,Liberation Sans,${assNextFontPx},&H60E2E8F0,&H60E2E8F0,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,45,45,${Math.round(targetH * 0.07)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
              fs.writeFileSync(assPath, assContent, 'utf-8');
            }

            const renderId = `gmv_out_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp4`;
            const outPath = path.join(os.tmpdir(), renderId);
            const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

            let ffmpegArgs: string[] = [];
            if (photoPaths.length === 1) {
              const vfParts = [
                `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`,
                `crop=${targetW}:${targetH}`,
                `setsar=1`,
                `fps=24`
              ];
              if (useAss) vfParts.push(`ass=${escapedAssPath}`);
              ffmpegArgs = [
                '-y',
                '-threads', '0',
                '-loop', '1',
                '-framerate', '24',
                '-i', photoPaths[0],
                '-i', audioPath,
                '-t', targetDuration.toFixed(3),
                '-map', '0:v:0',
                '-map', '1:a:0',
                '-vf', vfParts.join(','),
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-tune', 'stillimage',
                '-g', '48',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                outPath
              ];
            } else if (photoPaths.length > 1) {
              const perPhotoDur = Math.max(1.5, (targetDuration + 0.5) / photoPaths.length);
              const inputArgs: string[] = ['-y', '-threads', '0'];
              const filterSteps: string[] = [];
              const concatLabels: string[] = [];
              photoPaths.forEach((p, idx) => {
                inputArgs.push('-loop', '1', '-framerate', '24', '-t', perPhotoDur.toFixed(2), '-i', p);
                filterSteps.push(
                  `[${idx}:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,fps=24[v${idx}]`
                );
                concatLabels.push(`[v${idx}]`);
              });
              const audioInputIdx = photoPaths.length;
              inputArgs.push('-i', audioPath);
              const assFilter = useAss ? `,ass=${escapedAssPath}` : '';
              const filterComplex = `${filterSteps.join(';')};${concatLabels.join('')}concat=n=${photoPaths.length}:v=1:a=0${assFilter}[outv]`;

              ffmpegArgs = [
                ...inputArgs,
                '-t', targetDuration.toFixed(3),
                '-filter_complex', filterComplex,
                '-map', '[outv]',
                '-map', `${audioInputIdx}:a:0`,
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-g', '48',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                outPath
              ];
            } else {
              const vfParts = [
                `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`,
                `crop=${targetW}:${targetH}`,
                `setsar=1`,
                `fps=30`
              ];
              if (useAss) {
                vfParts.push(`ass=${escapedAssPath}`);
              }

              ffmpegArgs = [
                '-y',
                '-threads', '0',
                '-stream_loop', '-1',
                '-i', videoPath,
                '-i', audioPath,
                '-t', targetDuration.toFixed(3),
                '-map', '0:v:0',
                '-map', '1:a:0',
                '-vf', vfParts.join(','),
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-g', '60',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                outPath
              ];
            }

            await new Promise<void>((resolve, reject) => {
              execFile('ffmpeg', ffmpegArgs, { maxBuffer: 1024 * 1024 * 10 }, (err, _stdout, stderr) => {
                if (useAss) {
                  try { fs.unlinkSync(assPath); } catch { /* ignore */ }
                }
                if (err) {
                  console.error('FFmpeg render error:', stderr || err.message);
                  return reject(new Error('No se pudo generar el video MP4. Verifica que los archivos sean válidos.'));
                }
                resolve();
              });
            });

            const outStat = fs.statSync(outPath);
            const cleanName = (String(songTitle || 'video_musical')).replace(/[/\\?%*:|"<>]/g, '_');
            return sendJson(200, {
              success: true,
              renderId,
              sizeBytes: outStat.size,
              duration: targetDuration,
              streamUrl: `/api/rendered-video?id=${encodeURIComponent(renderId)}`,
              downloadUrl: `/api/rendered-video?id=${encodeURIComponent(renderId)}&download=1&filename=${encodeURIComponent(cleanName + '.mp4')}`
            });
          }

          // Convert any uploaded video (e.g. Canvas MediaRecorder WebM) to universal H.264/AAC MP4 (+faststart) for Google Drive
          if (cleanPath === '/api/convert-to-mp4' && req.method === 'POST') {
            const body = await parseBody();
            const { fileId, filename = 'video_musical' } = body || {};
            if (!fileId || !/^gmv_[a-zA-Z0-9_.-]+$/.test(fileId)) {
              return sendJson(400, { error: 'ID de archivo inválido para convertir a MP4.' });
            }

            const inputPath = path.join(os.tmpdir(), fileId);
            if (!fs.existsSync(inputPath)) {
              return sendJson(404, { error: 'El video temporal para convertir no se encontró en el servidor.' });
            }

            const renderId = `gmv_out_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp4`;
            const outPath = path.join(os.tmpdir(), renderId);

            // Detect if input contains an audio stream so silent recordings still convert cleanly
            const hasAudio = await new Promise<boolean>((resolve) => {
              execFile(
                'ffprobe',
                ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', inputPath],
                { timeout: 10000 },
                (err, stdout) => {
                  if (err) return resolve(false);
                  resolve(Boolean(stdout && stdout.trim().length > 0));
                }
              );
            });

            const ffmpegArgs = [
              '-y',
              '-threads', '0',
              '-fflags', '+genpts',
              '-i', inputPath,
              '-map', '0:v:0',
              ...(hasAudio ? ['-map', '0:a:0'] : []),
              '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30',
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              '-crf', '23',
              '-maxrate', '2500k',
              '-bufsize', '5000k',
              '-pix_fmt', 'yuv420p',
              '-g', '60',
              ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2', '-shortest'] : ['-an']),
              '-movflags', '+faststart',
              outPath,
            ];

            await new Promise<void>((resolve, reject) => {
              execFile('ffmpeg', ffmpegArgs, { maxBuffer: 1024 * 1024 * 16 }, (err, _stdout, stderr) => {
                // Clean up temporary uploaded source file after conversion attempt
                try {
                  if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                } catch { /* ignore */ }
                if (err) {
                  console.error('FFmpeg convert-to-mp4 error:', stderr || err.message);
                  return reject(new Error('No se pudo convertir el video a MP4.'));
                }
                resolve();
              });
            });

            const outStat = fs.statSync(outPath);
            const cleanName = String(filename || 'video_musical').replace(/[/\\?%*:|"<>]/g, '_');
            return sendJson(200, {
              success: true,
              renderId,
              sizeBytes: outStat.size,
              streamUrl: `/api/rendered-video?id=${encodeURIComponent(renderId)}`,
              downloadUrl: `/api/rendered-video?id=${encodeURIComponent(renderId)}&download=1&filename=${encodeURIComponent(cleanName + '.mp4')}`,
            });
          }

          // Stream or download a rendered loop video
          if (cleanPath === '/api/rendered-video') {
            const urlObj = new URL(req.url, 'http://localhost:3000');
            const id = urlObj.searchParams.get('id') || '';
            if (!/^gmv_out_[a-zA-Z0-9_.-]+\.mp4$/.test(id)) {
              return sendJson(400, { error: 'ID de video inválido' });
            }
            const filePath = path.join(os.tmpdir(), id);
            if (!fs.existsSync(filePath)) {
              return sendJson(404, { error: 'Video generado no encontrado' });
            }

            const isDownload = urlObj.searchParams.get('download') === '1';
            const filename = (urlObj.searchParams.get('filename') || 'video_musical.mp4').replace(/["\r\n]/g, '');
            const stat = fs.statSync(filePath);
            const fileSize = stat.size;
            const range = req.headers.range;

            if (isDownload) {
              res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Access-Control-Allow-Origin': '*'
              });
              fs.createReadStream(filePath).pipe(res);
              return;
            }

            if (range) {
              const parts = range.replace(/bytes=/, '').split('-');
              const start = parseInt(parts[0], 10);
              const rawEnd = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
              const end = Math.min(fileSize - 1, isNaN(rawEnd) ? fileSize - 1 : rawEnd);
              if (isNaN(start) || start < 0 || start >= fileSize || end < start) {
                res.writeHead(416, {
                  'Content-Range': `bytes */${fileSize}`,
                  'Access-Control-Allow-Origin': '*'
                });
                res.end();
                return;
              }
              const chunksize = (end - start) + 1;
              res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/mp4',
                'Access-Control-Allow-Origin': '*'
              });
              fs.createReadStream(filePath, { start, end }).pipe(res);
              return;
            } else {
              res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*'
              });
              fs.createReadStream(filePath).pipe(res);
              return;
            }
          }

          sendJson(404, { error: 'Ruta no encontrada' });
        } catch (err: any) {
          console.error('API Error:', err);
          sendJson(500, { error: err.message || 'Error interno del servidor' });
        }
      };
}

export function createApiPlugin(): Plugin {
  const middleware = createApiMiddleware();
  return {
    name: 'german-music-videos-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
