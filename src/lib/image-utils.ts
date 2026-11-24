/**
 * Utilidades para optimización y adaptación automática de resoluciones de imágenes en el cliente.
 * Reduce imágenes grandes sin deformarlas ni agrandarlas.
 */

const SUPPORTED_INPUT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SUPPORTED_OUTPUT_TYPES = new Set(['image/webp', 'image/jpeg']);
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_EDGE = 12_000;
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_OUTPUT_EDGE = 8_192;
const MAX_OUTPUT_PIXELS = 16_000_000;

export interface OptimizeImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'image/webp' | 'image/jpeg';
}

export interface OptimizedImageResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  aspectRatio: number;
  sizeBytes: number;
}

interface ResolvedOptions {
  maxWidth: number;
  maxHeight: number;
  quality: number;
  format: 'image/webp' | 'image/jpeg';
}

function normalizeMimeType(type: string): string {
  return type.toLowerCase().split(';', 1)[0].trim();
}

function assertBrowserCapabilities(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !window.Image || !window.FileReader) {
    throw new Error('La optimización de imágenes requiere un navegador compatible.');
  }
}

function assertSourceFile(file: File | Blob): void {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('Selecciona una imagen válida.');
  }

  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('La imagen no puede superar los 10 MiB.');
  }

  if (!SUPPORTED_INPUT_TYPES.has(normalizeMimeType(file.type))) {
    throw new Error('Solo se admiten imágenes JPEG, PNG o WebP.');
  }
}

function resolveOptions(options: OptimizeImageOptions): ResolvedOptions {
  const resolved: ResolvedOptions = {
    maxWidth: options.maxWidth ?? 800,
    maxHeight: options.maxHeight ?? 800,
    quality: options.quality ?? 0.82,
    format: options.format ?? 'image/webp',
  };

  if (!Number.isInteger(resolved.maxWidth) || !Number.isInteger(resolved.maxHeight) ||
    resolved.maxWidth < 1 || resolved.maxHeight < 1 ||
    resolved.maxWidth > MAX_OUTPUT_EDGE || resolved.maxHeight > MAX_OUTPUT_EDGE) {
    throw new Error(`Las dimensiones máximas deben ser enteros entre 1 y ${MAX_OUTPUT_EDGE} píxeles.`);
  }

  if (!Number.isFinite(resolved.quality) || resolved.quality < 0 || resolved.quality > 1) {
    throw new Error('La calidad de imagen debe estar entre 0 y 1.');
  }

  if (!SUPPORTED_OUTPUT_TYPES.has(resolved.format)) {
    throw new Error('El formato de salida debe ser WebP o JPEG.');
  }

  return resolved;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen optimizada.'));
    reader.onabort = () => reject(new Error('La lectura de la imagen fue cancelada.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('No se pudo convertir la imagen optimizada.'));
        return;
      }
      resolve(reader.result);
    };

    try {
      reader.readAsDataURL(blob);
    } catch {
      reject(new Error('No se pudo leer la imagen optimizada.'));
    }
  });
}

function loadImageFromSource(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.decoding = 'async';
    image.onerror = () => reject(new Error('No se pudo decodificar la imagen seleccionada.'));
    image.onload = () => resolve(image);

    try {
      image.src = source;
    } catch {
      reject(new Error('No se pudo cargar la imagen seleccionada.'));
    }
  });
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const urlApi = window.URL;
  if (typeof urlApi?.createObjectURL === 'function' && typeof urlApi.revokeObjectURL === 'function') {
    let objectUrl: string;
    try {
      objectUrl = urlApi.createObjectURL(blob);
    } catch {
      throw new Error('No se pudo preparar la imagen seleccionada.');
    }

    try {
      return await loadImageFromSource(objectUrl);
    } finally {
      urlApi.revokeObjectURL(objectUrl);
    }
  }

  return loadImageFromSource(await readAsDataUrl(blob));
}

function canvasToBlob(canvas: HTMLCanvasElement, format: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('No se pudo exportar la imagen optimizada.'));
          return;
        }
        resolve(blob);
      }, format, quality);
    } catch {
      reject(new Error('No se pudo exportar la imagen optimizada.'));
    }
  });
}

async function exportCanvas(canvas: HTMLCanvasElement, format: ResolvedOptions['format'], quality: number): Promise<Blob> {
  const primaryBlob = await canvasToBlob(canvas, format, quality);
  if (normalizeMimeType(primaryBlob.type) === format) {
    return primaryBlob;
  }

  if (format === 'image/webp') {
    const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (normalizeMimeType(jpegBlob.type) === 'image/jpeg') {
      return jpegBlob;
    }
  }

  throw new Error('Este navegador no puede exportar la imagen en un formato compatible.');
}

function getSourceDimensions(image: HTMLImageElement): { width: number; height: number } {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('La imagen tiene dimensiones inválidas.');
  }

  if (width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE || width * height > MAX_SOURCE_PIXELS) {
    throw new Error('La imagen es demasiado grande para procesarla de forma segura.');
  }

  return { width, height };
}

function getTargetDimensions(width: number, height: number, options: ResolvedOptions): { width: number; height: number } {
  const scale = Math.min(1, options.maxWidth / width, options.maxHeight / height);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  if (targetWidth * targetHeight > MAX_OUTPUT_PIXELS) {
    throw new Error('La resolución de salida es demasiado grande para procesarla de forma segura.');
  }

  return { width: targetWidth, height: targetHeight };
}

/**
 * Procesa y optimiza una imagen en el navegador mediante un Canvas invisible.
 * Conserva la proporción original y nunca agranda una imagen pequeña.
 */
export async function optimizeImage(
  file: File | Blob,
  options: OptimizeImageOptions = {}
): Promise<OptimizedImageResult> {
  assertBrowserCapabilities();
  assertSourceFile(file);
  const resolvedOptions = resolveOptions(options);
  const image = await loadImage(file);
  const source = getSourceDimensions(image);
  const target = getTargetDimensions(source.width, source.height, resolvedOptions);
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('No se pudo inicializar el procesamiento de la imagen.');
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  try {
    context.drawImage(image, 0, 0, target.width, target.height);
  } catch {
    throw new Error('No se pudo procesar la imagen seleccionada.');
  }

  const blob = await exportCanvas(canvas, resolvedOptions.format, resolvedOptions.quality);
  const dataUrl = await readAsDataUrl(blob);

  return {
    blob,
    dataUrl,
    width: target.width,
    height: target.height,
    aspectRatio: source.width / source.height,
    sizeBytes: blob.size,
  };
}
