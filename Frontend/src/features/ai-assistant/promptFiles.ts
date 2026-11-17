/**
 * Files attached to a test case request (screenshots, PDFs, text files), read in the browser into what the API takes.
 *
 * - Images are scaled down to at most 1568 px on the long edge (beyond that a model gains nothing and the request grows)
 *   and sent base64-encoded; PDFs are sent as they are. Text files are read as text.
 * - The limits mirror the server's (qa-api ai-tasks), so a person learns about a file that is too large right away,
 *   not after sending.
 */
import type { PromptAttachment } from './api.js';

/** Most files one request may carry. */
export const MAX_FILES = 5;
/** Largest image or PDF after scaling, in bytes (the server takes about 4 MB). */
const MAX_BINARY_BYTES = 4 * 1024 * 1024;
/** Largest text file, in characters. */
const MAX_TEXT_CHARS = 30_000;
/** Longest image edge sent to the model. */
const MAX_EDGE = 1568;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_EXTENSIONS = /\.(txt|md|csv|json|feature|xml|html?|ya?ml|log)$/i;

/** What the file picker offers. */
export const ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,application/pdf,.txt,.md,.csv,.json,.feature,.xml,.html,.htm,.yaml,.yml,.log';

/** An attached file as the prompt box shows it, with what will be sent. */
export interface PromptFile extends PromptAttachment {
  /** Stable key for the list. */
  key: string;
  /** Size shown on the chip, in bytes of the original file. */
  size: number;
  /** A preview URL for images (revoke when the file is removed). */
  preview?: string;
}

/** Why a file cannot be attached, in words for a toast. */
export class FileRefused extends Error {}

const kib = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
/** "640 KB", "2.1 MB": a file's size for its chip. */
export const sizeLabel = kib;

/** A blob read as a data URL or as text, through FileReader (which every browser has, unlike `Blob.text`). */
const readAs = (blob: Blob, as: 'dataUrl' | 'text') =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new FileRefused('The file could not be read.'));
    if (as === 'text') reader.readAsText(blob);
    else reader.readAsDataURL(blob);
  });

/** Base64 of a blob, without the `data:` prefix. */
async function base64Of(blob: Blob): Promise<string> {
  const url = await readAs(blob, 'dataUrl');
  return url.slice(url.indexOf(',') + 1);
}

/** The image scaled to fit `MAX_EDGE`, or the file itself when it already fits (GIFs keep their frames). */
async function fitted(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= MAX_BINARY_BYTES) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // Screenshots keep crisp text as PNG; a large photo is smaller as JPEG.
  const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (png && png.size <= MAX_BINARY_BYTES) return png;
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  return jpeg ?? file;
}

/** Read one file for sending, or explain why it cannot be attached. */
export async function readPromptFile(file: File): Promise<PromptFile> {
  const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`;
  const name = file.name || 'pasted-image.png';
  if (IMAGE_TYPES.has(file.type)) {
    const blob = await fitted(file);
    if (blob.size > MAX_BINARY_BYTES) throw new FileRefused(`${name} is larger than 4 MB.`);
    return {
      key,
      name,
      size: file.size,
      mediaType: blob.type as PromptAttachment['mediaType'],
      data: await base64Of(blob),
      preview: URL.createObjectURL(blob),
    };
  }
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BINARY_BYTES) throw new FileRefused(`${name} is larger than 4 MB.`);
    return { key, name, size: file.size, mediaType: 'application/pdf', data: await base64Of(file) };
  }
  if (file.type.startsWith('text/') || TEXT_EXTENSIONS.test(name)) {
    const text = await readAs(file, 'text');
    if (text.length > MAX_TEXT_CHARS)
      throw new FileRefused(`${name} is too long; attach a shorter part of it.`);
    return { key, name, size: file.size, mediaType: 'text/plain', data: text };
  }
  throw new FileRefused(`${name} cannot be attached. Use an image, a PDF or a text file.`);
}
