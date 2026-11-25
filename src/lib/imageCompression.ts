import JSZip from 'jszip';

export interface ImageCompressionOptions {
  maxDimension?: number;
  quality?: number;
  /**
   * When true (used for ZIP archives), keeps .jpg as JPEG and .webp as WebP,
   * and converts .png to WebP (or JPEG fallback) when smaller so filenames stay predictable.
   */
  preserveFormat?: boolean;
}

export interface ImageCompressionResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  wasCompressed: boolean;
}

export interface ZipCompressionResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  imageCount: number;
  compressedCount: number;
}

const RASTER_EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const EXT_FOR_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/png': '.png',
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getLowerExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(idx).toLowerCase() : '';
}

function replaceFileExtension(fileName: string, nextExt: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx <= 0) return `${fileName}${nextExt}`;
  return `${fileName.slice(0, idx)}${nextExt}`;
}

function isCompressibleRasterImage(file: File): boolean {
  const ext = getLowerExtension(file.name);
  if (ext === '.gif' || ext === '.pdf' || ext === '.svg') return false;
  if (file.type === 'image/gif' || file.type === 'application/pdf' || file.type === 'image/svg+xml') {
    return false;
  }
  return (
    file.type === 'image/jpeg' ||
    file.type === 'image/png' ||
    file.type === 'image/webp' ||
    ext in RASTER_EXT_MIME
  );
}

interface LoadedImageSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

async function loadImageSource(file: Blob): Promise<LoadedImageSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => {
          try {
            bitmap.close();
          } catch {
            // ignore
          }
        },
      };
    } catch {
      // Fallback to HTMLImageElement below
    }
  }

  return new Promise<LoadedImageSource>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to decode image for compression.'));
    };
    img.src = objectUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

export async function compressImageFile(
  file: File,
  options: ImageCompressionOptions = {}
): Promise<ImageCompressionResult> {
  const originalSize = file.size;
  if (
    typeof document === 'undefined' ||
    !isCompressibleRasterImage(file) ||
    originalSize === 0
  ) {
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      wasCompressed: false,
    };
  }

  const maxDimension = options.maxDimension ?? 1600;
  const quality = options.quality ?? 0.8;
  const preserveFormat = options.preserveFormat ?? false;

  let loaded: LoadedImageSource | null = null;
  try {
    loaded = await loadImageSource(file);
    const { width, height } = loaded;
    if (!width || !height) {
      return {
        file,
        originalSize,
        compressedSize: originalSize,
        wasCompressed: false,
      };
    }

    const largestSide = Math.max(width, height);
    const scale = largestSide > maxDimension ? maxDimension / largestSide : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const wasResized = targetWidth !== width || targetHeight !== height;

    // Skip re-encoding already tiny images that don't need resizing
    if (!wasResized && originalSize <= 25 * 1024) {
      return {
        file,
        originalSize,
        compressedSize: originalSize,
        wasCompressed: false,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        file,
        originalSize,
        compressedSize: originalSize,
        wasCompressed: false,
      };
    }

    const inputExt = getLowerExtension(file.name);
    const inputMime = file.type || RASTER_EXT_MIME[inputExt] || 'image/jpeg';

    let desiredMime: string;
    if (preserveFormat && inputMime === 'image/jpeg') {
      desiredMime = 'image/jpeg';
    } else if (preserveFormat && inputMime === 'image/webp') {
      desiredMime = 'image/webp';
    } else {
      desiredMime = 'image/webp';
    }

    // Fill white background if encoding to JPEG so transparent areas don't turn black
    if (desiredMime === 'image/jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(loaded.source, 0, 0, targetWidth, targetHeight);

    let blob = await canvasToBlob(canvas, desiredMime, quality);

    // Fallback to JPEG if browser cannot encode WebP (e.g., returned PNG instead)
    if (desiredMime === 'image/webp' && (!blob || blob.type !== 'image/webp')) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(loaded.source, 0, 0, targetWidth, targetHeight);
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    }

    if (!blob || blob.size === 0) {
      return {
        file,
        originalSize,
        compressedSize: originalSize,
        wasCompressed: false,
      };
    }

    // Keep original if compression made it larger and image didn't need resizing
    if (!wasResized && blob.size >= originalSize) {
      return {
        file,
        originalSize,
        compressedSize: originalSize,
        wasCompressed: false,
      };
    }

    const finalMime = blob.type || desiredMime;
    const finalExt =
      preserveFormat && inputMime === 'image/jpeg' && finalMime === 'image/jpeg'
        ? inputExt || '.jpg'
        : EXT_FOR_MIME[finalMime] || inputExt || '.jpg';
    const nextFileName = replaceFileExtension(file.name, finalExt);

    const compressedFile = new File([blob], nextFileName, {
      type: finalMime,
      lastModified: Date.now(),
    });

    return {
      file: compressedFile,
      originalSize,
      compressedSize: compressedFile.size,
      wasCompressed: true,
    };
  } catch {
    // Graceful fallback: never block upload if client canvas decoding fails
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      wasCompressed: false,
    };
  } finally {
    loaded?.cleanup();
  }
}

export async function compressZipImages(
  zipFile: File,
  options: {
    maxDimension?: number;
    quality?: number;
    includeRawPaths?: Set<string>;
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<ZipCompressionResult> {
  const originalSize = zipFile.size;
  const isFiltered = Boolean(options.includeRawPaths);
  try {
    const sourceZip = await JSZip.loadAsync(zipFile);
    const outZip = new JSZip();

    const entries = Object.entries(sourceZip.files).filter(([rawName, entry]) => {
      if (entry.dir) return false;
      const normalized = rawName.replace(/\\/g, '/').replace(/^\/+/, '');
      if (
        !normalized ||
        normalized.startsWith('__MACOSX/') ||
        normalized.includes('/__MACOSX/') ||
        normalized.split('/').some((seg) => seg === '..' || seg.startsWith('._'))
      ) {
        return false;
      }
      if (options.includeRawPaths && !options.includeRawPaths.has(normalized)) {
        return false;
      }
      return true;
    });

    const rasterEntries = entries.filter(([rawName]) => {
      const ext = getLowerExtension(rawName);
      return ext in RASTER_EXT_MIME;
    });

    let done = 0;
    let compressedCount = 0;

    for (const [rawName, entry] of entries) {
      const normalized = rawName.replace(/\\/g, '/').replace(/^\/+/, '');
      const ext = getLowerExtension(normalized);

      if (ext in RASTER_EXT_MIME) {
        const rawBlob = await entry.async('blob');
        const mime = RASTER_EXT_MIME[ext];
        const baseName = normalized.split('/').pop() || normalized;
        const dirPrefix = normalized.includes('/')
          ? normalized.slice(0, normalized.lastIndexOf('/') + 1)
          : '';
        const tempFile = new File([rawBlob], baseName, { type: mime });
        const result = await compressImageFile(tempFile, {
          maxDimension: options.maxDimension ?? 1600,
          quality: options.quality ?? 0.78,
          preserveFormat: true,
        });

        const nextPath = `${dirPrefix}${result.file.name}`;
        outZip.file(nextPath, await result.file.arrayBuffer(), {
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        });
        if (result.wasCompressed) {
          compressedCount += 1;
        }
        done += 1;
        options.onProgress?.(done, rasterEntries.length);
      } else {
        const rawBuf = await entry.async('arraybuffer');
        outZip.file(normalized, rawBuf, {
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        });
      }
    }

    const outBlob = await outZip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    if (
      outBlob.size > 0 &&
      (isFiltered || compressedCount > 0 || outBlob.size < originalSize)
    ) {
      const compressedZip = new File([outBlob], zipFile.name, {
        type: 'application/zip',
        lastModified: Date.now(),
      });
      return {
        file: compressedZip,
        originalSize,
        compressedSize: compressedZip.size,
        imageCount: rasterEntries.length,
        compressedCount,
      };
    }

    return {
      file: zipFile,
      originalSize,
      compressedSize: originalSize,
      imageCount: rasterEntries.length,
      compressedCount: 0,
    };
  } catch {
    return {
      file: zipFile,
      originalSize,
      compressedSize: originalSize,
      imageCount: 0,
      compressedCount: 0,
    };
  }
}
