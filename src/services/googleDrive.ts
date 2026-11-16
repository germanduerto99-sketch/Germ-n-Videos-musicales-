export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  webViewLink?: string;
}

// Extracts Google Drive file ID from full URLs or raw IDs
export function extractDriveFileId(input: string): string {
  const trimmed = input.trim();
  // Match standard https://drive.google.com/file/d/ID/view format
  const fileDMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileDMatch && fileDMatch[1]) return fileDMatch[1];

  // Match id=ID or id%3D
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch && idParamMatch[1]) return idParamMatch[1];

  // Match open?id=ID
  const openMatch = trimmed.match(/open\?id=([a-zA-Z0-9_-]+)/);
  if (openMatch && openMatch[1]) return openMatch[1];

  // If input is directly an alphanumeric ID (typically 25-50 chars)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed;
}

export async function fetchDriveMediaFiles(
  accessToken: string,
  filterType: 'all' | 'audio' | 'video' | 'image' = 'all',
  searchQuery: string = ''
): Promise<DriveFileItem[]> {
  try {
    let qParts: string[] = ['trashed = false'];

    if (searchQuery.trim()) {
      const sanitized = searchQuery.replace(/'/g, "\\'");
      // Allow searching by exact or partial name
      qParts.push(`name contains '${sanitized}'`);
    }

    if (filterType === 'audio') {
      qParts.push("(mimeType contains 'audio/' or name contains '.mp3' or name contains '.wav' or name contains '.m4a' or name contains '.ogg' or name contains '.flac')");
    } else if (filterType === 'video') {
      qParts.push("(mimeType contains 'video/' or name contains '.mp4' or name contains '.webm' or name contains '.mov' or name contains '.mkv')");
    } else if (filterType === 'image') {
      qParts.push("(mimeType contains 'image/' or name contains '.jpg' or name contains '.jpeg' or name contains '.png' or name contains '.webp')");
    } else {
      qParts.push("(mimeType contains 'audio/' or mimeType contains 'video/' or mimeType contains 'image/' or name contains '.mp3' or name contains '.wav' or name contains '.m4a' or name contains '.mp4' or name contains '.webm' or name contains '.jpg' or name contains '.jpeg' or name contains '.png' or name contains '.webp')");
    }

    const q = encodeURIComponent(qParts.join(' and '));
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink)&pageSize=60&orderBy=modifiedTime desc`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Error ${res.status} al consultar Google Drive`);
    }

    const data = await res.json();
    return (data.files as DriveFileItem[]) || [];
  } catch (err: unknown) {
    console.error('Error fetching Google Drive files:', err);
    throw err;
  }
}

export async function fetchDriveFileMetadata(
  fileId: string,
  accessToken: string
): Promise<DriveFileItem> {
  const cleanId = extractDriveFileId(fileId);
  const url = `https://www.googleapis.com/drive/v3/files/${cleanId}?fields=id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `No se pudo encontrar el archivo con ID "${cleanId}" en Google Drive.`);
  }

  return await res.json();
}

export async function downloadDriveFileBlob(
  fileId: string,
  accessToken?: string | null,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  const cleanId = extractDriveFileId(fileId);
  
  // First attempt via direct Google Drive API if token is provided
  if (accessToken) {
    try {
      const url = `https://www.googleapis.com/drive/v3/files/${cleanId}?alt=media`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (res.ok) {
        const contentLength = res.headers.get('content-length');
        if (!contentLength || !res.body) {
          return await res.blob();
        }

        const total = parseInt(contentLength, 10);
        let loaded = 0;
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            loaded += value.length;
            if (onProgress && total > 0) {
              onProgress(Math.round((loaded / total) * 100));
            }
          }
        }

        const mimeType = res.headers.get('content-type') || 'application/octet-stream';
        return new Blob(chunks as unknown as BlobPart[], { type: mimeType });
      }
    } catch {
      // Direct API failed, proceed to proxy fallback below
    }
  }

  // Fallback to proxy route with or without token
  const proxyUrl = `/api/drive-download?id=${encodeURIComponent(cleanId)}${accessToken ? `&token=${encodeURIComponent(accessToken)}` : ''}`;
  const proxyRes = await fetch(proxyUrl);

  if (!proxyRes.ok) {
    const errorData = await proxyRes.json().catch(() => ({}));
    throw new Error(errorData.error || `No se pudo descargar el archivo de Google Drive (${proxyRes.status}).`);
  }

  const contentLength = proxyRes.headers.get('content-length');
  if (!contentLength || !proxyRes.body) {
    return await proxyRes.blob();
  }

  const total = parseInt(contentLength, 10);
  let loaded = 0;
  const reader = proxyRes.body.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      if (onProgress && total > 0) {
        onProgress(Math.round((loaded / total) * 100));
      }
    }
  }

  const mimeType = proxyRes.headers.get('content-type') || 'application/octet-stream';
  return new Blob(chunks as unknown as BlobPart[], { type: mimeType });
}
