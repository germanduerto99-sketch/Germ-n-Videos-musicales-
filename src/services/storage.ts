import { LibraryVideo, VideoFolder, VideoStyleConfig } from '../types';

const DB_NAME = 'GermanVideosMusicalesDB';
const DB_VERSION = 1;
const STORE_VIDEOS = 'videos';
const STORE_FOLDERS = 'folders';

export const defaultStyle: VideoStyleConfig = {
  fontFamily: 'Montserrat',
  titleFontSize: 42,
  lyricsFontSize: 28,
  textColor: '#E2E8F0',
  activeLyricColor: '#F43F5E',
  secondaryLyricColor: '#94A3B8',
  glowColor: '#EC4899',
  backgroundColor: '#090D16',
  backgroundGradient: 'linear-gradient(135deg, #090D16 0%, #1E1B4B 50%, #0F172A 100%)',
  visualizerTheme: 'spectrum-bars',
  lyricEffect: 'karaoke-sweep',
  aspectRatio: '16:9',
  showVisualizer: true,
  showTitleHeader: true,
  adaptiveLyrics: true,
  textAlignment: 'center',
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
        const videoStore = db.createObjectStore(STORE_VIDEOS, { keyPath: 'id' });
        videoStore.createIndex('title', 'title', { unique: false });
        videoStore.createIndex('folderId', 'folderId', { unique: false });
        videoStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
        const folderStore = db.createObjectStore(STORE_FOLDERS, { keyPath: 'id' });
        folderStore.createIndex('name', 'name', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getFolders(): Promise<VideoFolder[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FOLDERS, 'readonly');
    const store = tx.objectStore(STORE_FOLDERS);
    const request = store.getAll();

    request.onsuccess = () => {
      const folders = request.result as VideoFolder[];
      if (folders.length === 0) {
        // Seed default folders
        const defaults: VideoFolder[] = [
          { id: 'f-favoritos', name: 'Mis Favoritos', color: '#EC4899', createdAt: Date.now() - 300000 },
          { id: 'f-canciones', name: 'Canciones en Video', color: '#8B5CF6', createdAt: Date.now() - 200000 },
          { id: 'f-recuerdos', name: 'Galería y Cámara', color: '#06B6D4', createdAt: Date.now() - 100000 },
        ];
        const writeTx = db.transaction(STORE_FOLDERS, 'readwrite');
        const writeStore = writeTx.objectStore(STORE_FOLDERS);
        defaults.forEach(f => writeStore.put(f));
        resolve(defaults);
      } else {
        resolve(folders);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function createFolder(name: string, color: string = '#8B5CF6'): Promise<VideoFolder> {
  const db = await openDB();
  const newFolder: VideoFolder = {
    id: 'folder-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
    name: name.trim(),
    color,
    createdAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FOLDERS, 'readwrite');
    const store = tx.objectStore(STORE_FOLDERS);
    const request = store.add(newFolder);
    request.onsuccess = () => resolve(newFolder);
    request.onerror = () => reject(request.error);
  });
}

export async function updateFolder(id: string, name: string, color?: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FOLDERS, 'readwrite');
    const store = tx.objectStore(STORE_FOLDERS);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const folder = getReq.result as VideoFolder;
      if (!folder) return reject(new Error('Carpeta no encontrada'));
      folder.name = name.trim();
      if (color) folder.color = color;
      const putReq = store.put(folder);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function deleteFolder(id: string): Promise<void> {
  const db = await openDB();
  // Move videos in this folder to 'root'
  const videos = await getVideos();
  const tx = db.transaction([STORE_FOLDERS, STORE_VIDEOS], 'readwrite');
  const folderStore = tx.objectStore(STORE_FOLDERS);
  const videoStore = tx.objectStore(STORE_VIDEOS);

  folderStore.delete(id);
  videos.filter(v => v.folderId === id).forEach(v => {
    v.folderId = 'root';
    v.modifiedAt = Date.now();
    videoStore.put(v);
  });

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getVideos(): Promise<LibraryVideo[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VIDEOS, 'readonly');
    const store = tx.objectStore(STORE_VIDEOS);
    const request = store.getAll();

    request.onsuccess = () => {
      const videos = request.result as LibraryVideo[];
      // Attach object URLs for blobs if needed
      videos.forEach(v => {
        if (v.videoBlob && !v.videoUrl) {
          v.videoUrl = URL.createObjectURL(v.videoBlob);
        }
        if (v.audioBlob && !v.audioUrl) {
          v.audioUrl = URL.createObjectURL(v.audioBlob);
        }
      });
      resolve(videos);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveVideo(video: LibraryVideo): Promise<LibraryVideo> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VIDEOS, 'readwrite');
    const store = tx.objectStore(STORE_VIDEOS);

    // Ensure modifiedAt
    const item = {
      ...video,
      modifiedAt: Date.now(),
    };

    const request = store.put(item);
    request.onsuccess = () => resolve(item);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteVideo(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VIDEOS, 'readwrite');
    const store = tx.objectStore(STORE_VIDEOS);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function updateVideoMetadata(
  id: string,
  updates: Partial<Pick<LibraryVideo, 'title' | 'artist' | 'folderId' | 'lyrics' | 'style'>>
): Promise<LibraryVideo> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VIDEOS, 'readwrite');
    const store = tx.objectStore(STORE_VIDEOS);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const video = getReq.result as LibraryVideo;
      if (!video) return reject(new Error('Video no encontrado'));

      const updated: LibraryVideo = {
        ...video,
        ...updates,
        modifiedAt: Date.now(),
      };

      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve(updated);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function clearAllVideos(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VIDEOS, 'readwrite');
    const store = tx.objectStore(STORE_VIDEOS);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

