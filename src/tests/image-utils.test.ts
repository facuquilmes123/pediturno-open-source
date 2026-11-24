import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { optimizeImage } from '@/lib/image-utils';

type CanvasToBlob = (callback: BlobCallback, type?: string, quality?: number) => void;

const originalCreateElement = document.createElement.bind(document);
const originalImageDescriptor = Object.getOwnPropertyDescriptor(window, 'Image');
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(window.URL, 'createObjectURL');
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(window.URL, 'revokeObjectURL');

function createImageFile(): File {
  return new File(['source-image'], 'source.png', { type: 'image/png' });
}

function mockImage(width: number, height: number, shouldFail = false) {
  class MockImage {
    naturalWidth = width;
    naturalHeight = height;
    width = width;
    height = height;
    decoding = '';
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event | string) => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => {
        if (shouldFail) {
          this.onerror?.(new Event('error'));
          return;
        }
        this.onload?.(new Event('load'));
      });
    }
  }

  Object.defineProperty(window, 'Image', { configurable: true, value: MockImage });
}

function mockObjectUrls() {
  const createObjectURL = vi.fn(() => 'blob:optimized-source');
  const revokeObjectURL = vi.fn();
  Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  return { createObjectURL, revokeObjectURL };
}

function mockCanvas(toBlob: CanvasToBlob) {
  const context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob,
  } as unknown as HTMLCanvasElement;

  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    if (tagName === 'canvas') return canvas;
    return originalCreateElement(tagName, options);
  }) as typeof document.createElement);

  return { canvas, context };
}

beforeEach(() => {
  mockObjectUrls();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalImageDescriptor) Object.defineProperty(window, 'Image', originalImageDescriptor);
  if (originalCreateObjectUrl) Object.defineProperty(window.URL, 'createObjectURL', originalCreateObjectUrl);
  else delete (window.URL as { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
  if (originalRevokeObjectUrl) Object.defineProperty(window.URL, 'revokeObjectURL', originalRevokeObjectUrl);
  else delete (window.URL as { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
});

describe('optimizeImage', () => {
  it('downsizing conserva la proporción, exporta WebP real y libera el object URL', async () => {
    mockImage(1_600, 900);
    const urls = mockObjectUrls();
    const { canvas, context } = mockCanvas((callback, type) => {
      callback(new Blob(['webp-image'], { type }));
    });

    const result = await optimizeImage(createImageFile());

    expect(result).toMatchObject({
      width: 800,
      height: 450,
      aspectRatio: 1600 / 900,
      sizeBytes: 10,
    });
    expect(result.blob.type).toBe('image/webp');
    expect(result.dataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(450);
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 450);
    expect(urls.createObjectURL).toHaveBeenCalledTimes(1);
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:optimized-source');
  });

  it('no agranda imágenes menores que el límite solicitado', async () => {
    mockImage(320, 180);
    const { canvas, context } = mockCanvas((callback, type) => {
      callback(new Blob(['webp-image'], { type }));
    });

    const result = await optimizeImage(createImageFile(), { maxWidth: 800, maxHeight: 800 });

    expect(result.width).toBe(320);
    expect(result.height).toBe(180);
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(180);
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 320, 180);
  });

  it('usa JPEG si WebP no está disponible y mantiene Blob y data URL coherentes', async () => {
    mockImage(800, 600);
    const toBlob = vi.fn<CanvasToBlob>((callback, type) => {
      callback(new Blob(['encoded'], { type: type === 'image/webp' ? 'image/png' : 'image/jpeg' }));
    });
    mockCanvas(toBlob);

    const result = await optimizeImage(createImageFile(), { format: 'image/webp' });

    expect(toBlob).toHaveBeenNthCalledWith(1, expect.any(Function), 'image/webp', 0.82);
    expect(toBlob).toHaveBeenNthCalledWith(2, expect.any(Function), 'image/jpeg', 0.82);
    expect(result.blob.type).toBe('image/jpeg');
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('rechaza imágenes con dimensiones de decodificación inseguras antes de crear el canvas', async () => {
    mockImage(12_001, 100);
    const createElement = vi.spyOn(document, 'createElement');

    await expect(optimizeImage(createImageFile())).rejects.toThrow('demasiado grande');

    expect(createElement).not.toHaveBeenCalled();
  });

  it('convierte un fallo del callback de exportación en un error claro', async () => {
    mockImage(800, 600);
    mockCanvas((callback) => callback(null));

    await expect(optimizeImage(createImageFile())).rejects.toThrow('No se pudo exportar la imagen optimizada.');
  });

  it('rechaza entradas y opciones inválidas antes de intentar decodificarlas', async () => {
    const invalidFile = new File(['not-an-image'], 'file.txt', { type: 'text/plain' });

    await expect(optimizeImage(invalidFile)).rejects.toThrow('Solo se admiten imágenes JPEG, PNG o WebP.');
    await expect(optimizeImage(createImageFile(), { quality: 1.1 })).rejects.toThrow('calidad de imagen');
  });
});
