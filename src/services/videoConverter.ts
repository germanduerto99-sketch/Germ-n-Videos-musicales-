// Client-side utilities for uploading temporary recordings, downloading large MP4s via HTTP Range chunks
// (bypassing proxy 32 MB response limits), and converting WebM/raw blobs to MP4 (H.264/AAC) for Google Drive.

export async function uploadTempMediaInChunks(
  blob: Blob,
  ext: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  const CHUNK_SIZE = 1536 * 1024; // 1.5 MB chunks
  const totalSize = Math.max(1, blob.size);
  const totalChunks = Math.max(1, Math.ceil(totalSize / CHUNK_SIZE));
  let fileId = '';

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(blob.size, start + CHUNK_SIZE);
    const chunkBuffer = await blob.slice(start, end).arrayBuffer();

    const endpoint =
      i === 0
        ? `/api/upload-temp-media?ext=${encodeURIComponent(ext)}`
        : `/api/upload-temp-media?fileId=${encodeURIComponent(fileId)}&append=1`;

    let lastErr: unknown = null;
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
      throw lastErr instanceof Error
        ? lastErr
        : new Error('No se pudo subir el video al servidor para convertir a MP4.');
    }

    if (onProgress) {
      onProgress(Math.min(100, Math.round(((i + 1) / totalChunks) * 100)));
    }
  }

  return fileId;
}

/**
 * Fetches an MP4 from /api/rendered-video using 4 MB HTTP Range chunks so large videos (>32 MB)
 * download reliably through reverse proxies like Cloud Run without response size failures.
 */
export async function fetchMp4BlobInChunks(
  streamUrl: string,
  knownSizeBytes?: number,
  onProgressText?: (text: string) => void
): Promise<Blob> {
  const CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB per Range request
  let totalSize = knownSizeBytes && knownSizeBytes > 0 ? knownSizeBytes : 0;
  const parts: ArrayBuffer[] = [];
  let offset = 0;

  if (!totalSize) {
    // Probe first chunk (up to 4 MB) to learn total file size via Content-Range
    const probeRes = await fetch(streamUrl, {
      headers: { Range: `bytes=0-${CHUNK_BYTES - 1}` },
    });
    if (!probeRes.ok && probeRes.status !== 206) {
      throw new Error(`Error al descargar el MP4 convertido (HTTP ${probeRes.status}).`);
    }
    const firstBuf = await probeRes.arrayBuffer();
    parts.push(firstBuf);
    offset = firstBuf.byteLength;

    if (probeRes.status === 200) {
      return new Blob(parts, { type: 'video/mp4' });
    }

    const cr = probeRes.headers.get('Content-Range') || '';
    const match = cr.match(/\/(\d+)$/);
    if (match) {
      totalSize = parseInt(match[1], 10);
    } else {
      return new Blob(parts, { type: 'video/mp4' });
    }
  }

  while (offset < totalSize) {
    const end = Math.min(totalSize - 1, offset + CHUNK_BYTES - 1);
    let chunkBuf: ArrayBuffer | null = null;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(streamUrl, {
          headers: { Range: `bytes=${offset}-${end}` },
        });
        if (!res.ok && res.status !== 206) {
          throw new Error(`HTTP ${res.status}`);
        }
        chunkBuf = await res.arrayBuffer();
        break;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
      }
    }

    if (!chunkBuf) {
      throw new Error(
        `Error al descargar el MP4 convertido (${lastErr instanceof Error ? lastErr.message : 'red'}).`
      );
    }

    parts.push(chunkBuf);
    offset += chunkBuf.byteLength;

    if (onProgressText && totalSize > 0) {
      const pct = Math.min(100, Math.round((offset / totalSize) * 100));
      onProgressText(`Descargando video MP4 (${pct}%)...`);
    }

    if (chunkBuf.byteLength === 0) break;
  }

  return new Blob(parts, { type: 'video/mp4' });
}

export interface ConvertedMp4Result {
  mp4Blob: Blob;
  streamUrl: string;
  downloadUrl: string;
}

/**
 * Converts a recorded WebM (or non-standard video Blob) to universal H.264/AAC MP4 (+faststart)
 * via /api/convert-to-mp4 so Google Drive's built-in player can play it directly.
 */
export async function convertVideoBlobToMp4(
  sourceBlob: Blob,
  title?: string,
  onProgressText?: (text: string) => void
): Promise<ConvertedMp4Result> {
  const cleanTitle = (title || 'video_musical').replace(/[/\\?%*:|"<>]/g, '_');

  const inputExt = sourceBlob.type.toLowerCase().includes('webm')
    ? '.webm'
    : sourceBlob.type.toLowerCase().includes('quicktime')
    ? '.mov'
    : sourceBlob.type.toLowerCase().includes('mp4')
    ? '.mp4'
    : '.webm';

  onProgressText?.('Subiendo video procesado para convertir a MP4 (0%)...');
  const fileId = await uploadTempMediaInChunks(sourceBlob, inputExt, (pct) => {
    onProgressText?.(`Subiendo video procesado para convertir a MP4 (${pct}%)...`);
  });

  onProgressText?.('Convirtiendo a MP4 (H.264/AAC) compatible con Google Drive...');
  const convertRes = await fetch('/api/convert-to-mp4', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, filename: cleanTitle }),
  });

  const convertData = await convertRes.json().catch(() => ({}));
  if (!convertRes.ok || !convertData.success || !convertData.streamUrl) {
    throw new Error(convertData.error || 'No se pudo convertir el video a formato MP4.');
  }

  onProgressText?.('Descargando archivo MP4 convertido (0%)...');
  const mp4Blob = await fetchMp4BlobInChunks(
    convertData.streamUrl,
    typeof convertData.sizeBytes === 'number' ? convertData.sizeBytes : undefined,
    onProgressText
  );

  return {
    mp4Blob,
    streamUrl: convertData.streamUrl,
    downloadUrl: convertData.downloadUrl || `${convertData.streamUrl}&download=1&filename=${encodeURIComponent(cleanTitle + '.mp4')}`,
  };
}

/**
 * Triggers a `.mp4` download for any LibraryVideo or video URL/Blob.
 * If the stored blob is legacy `.webm`, converts it on the fly to `.mp4` first.
 */
export async function downloadVideoAsMp4(options: {
  blob?: Blob | null;
  url?: string | null;
  title?: string;
  onStatus?: (msg: string) => void;
}): Promise<Blob | null> {
  const { blob, url, title, onStatus } = options;
  const cleanTitle = (title || 'video_musical').replace(/[/\\?%*:|"<>]/g, '_');

  let effectiveBlob: Blob | null = blob || null;

  // If we only have a blob: URL (e.g. from local picker or previous session), read it as Blob to inspect MIME type
  if (!effectiveBlob && url && url.startsWith('blob:')) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        effectiveBlob = await res.blob();
      }
    } catch {
      // ignore and fall back to direct link
    }
  }

  const isWebm = Boolean(effectiveBlob && effectiveBlob.type.toLowerCase().includes('webm'));

  if (effectiveBlob && isWebm) {
    const converted = await convertVideoBlobToMp4(effectiveBlob, cleanTitle, onStatus);
    const localUrl = URL.createObjectURL(converted.mp4Blob);
    const a = document.createElement('a');
    a.href = localUrl;
    a.download = `${cleanTitle}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(localUrl), 15000);
    return converted.mp4Blob;
  }

  // Already MP4 blob or server URL
  let downloadHref = url || '';
  let revokeLater = false;
  if (!effectiveBlob && downloadHref.startsWith('/api/rendered-video')) {
    effectiveBlob = await fetchMp4BlobInChunks(downloadHref, undefined, onStatus);
  }
  if (effectiveBlob && (!downloadHref || !downloadHref.startsWith('blob:') || downloadHref.startsWith('/api/rendered-video'))) {
    downloadHref = URL.createObjectURL(effectiveBlob);
    revokeLater = true;
  }
  if (!downloadHref) {
    throw new Error('El archivo de video no está disponible para descargar.');
  }

  const a = document.createElement('a');
  a.href = downloadHref;
  a.download = `${cleanTitle}.mp4`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  if (revokeLater) {
    setTimeout(() => URL.revokeObjectURL(downloadHref), 15000);
  }
  return effectiveBlob;
}
