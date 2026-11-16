import { HttpErrorResponse } from '@angular/common/http';
import type { Priority, PromiseState, TicketStatus } from './api';

export const STATUSES: TicketStatus[] = ['UNRESOLVED', 'PENDING', 'RESOLVED'];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  UNRESOLVED: 'Sin resolver',
  PENDING: 'Pendiente',
  RESOLVED: 'Resuelto',
};

/** The statuses as a select offers them, in their order. */
export const STATUS_OPTIONS: readonly { id: TicketStatus; label: string }[] = STATUSES.map((id) => ({ id, label: STATUS_LABEL[id] }));

export const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};

/** The priorities as a select offers them, from the lowest. */
export const PRIORITY_OPTIONS: readonly { id: Priority; label: string }[] = PRIORITIES.map((id) => ({ id, label: PRIORITY_LABEL[id] }));

/** Text colour class per priority. */
export const PRIORITY_CLASS: Record<Priority, string> = {
  LOW: 'text-muted',
  MEDIUM: 'text-primary',
  HIGH: 'text-warning',
  CRITICAL: 'text-danger',
};

/**
 * A name as it is compared: lowercase, without accents, with single spaces. "ACME  Perú" and
 * "acme peru" are the same name. The server compares the names of its catalogs the same way.
 */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** A number of a date with two digits: 7 → "07". */
const pad = (n: number): string => String(n).padStart(2, '0');

/** Local calendar day as `YYYY-MM-DD`. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return '';
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** When a case was reported: its day and, when the case has one, its time. "10/11/2026 14:35". */
export function formatCaseDate(ticket: { date: string; time?: string | null }): string {
  return ticket.time ? `${formatDay(ticket.date)} ${ticket.time}` : formatDay(ticket.date);
}

/** A moment in time (ISO timestamp) → local `DD/MM/YYYY`. For timestamps such as the registration date. */
export function formatMomentDay(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

const dateTimeFormat = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' });

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTimeFormat.format(new Date(value)) : '';
}

/** Text colour class for each state of a delivery promise. */
export const PROMISE_CLASS: Record<PromiseState, string> = {
  overdue: 'text-danger',
  today: 'text-warning',
  soon: 'text-primary',
  later: 'text-muted',
};

/** "venció hace 2 días", "vence hoy", "vence mañana", "vence en 3 días", from a `YYYY-MM-DD` promised date. */
export function promiseText(promisedDate: string | null | undefined): string {
  if (!promisedDate) return '';
  const days = Math.round((Date.parse(`${promisedDate}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / 86_400_000);
  if (days < -1) return `venció hace ${-days} días`;
  if (days === -1) return 'venció ayer';
  if (days === 0) return 'vence hoy';
  if (days === 1) return 'vence mañana';
  return `vence en ${days} días`;
}

/** "hace 3 días", "hace 5 h", "hace 20 min". */
export function timeAgo(value: string | null | undefined): string {
  if (!value) return '';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} días`;
}

/** 48 → "2 días", 5 → "5 horas". Whole days are shown as days. */
export function formatHours(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) return hours === 24 ? '1 día' : `${hours / 24} días`;
  return hours === 1 ? '1 hora' : `${hours} horas`;
}

/** 95 → "1 h 35 min". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Message for the user from any thrown value. The API answers `{ message: string | string[] }`. */
export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'No hay conexión con el servidor';
    const message = (error.error as { message?: string | string[] } | null)?.message;
    if (Array.isArray(message)) return message.join('. ');
    if (typeof message === 'string') return message;
    // What the web server answers while the API restarts or is down: nothing the person did.
    if (error.status >= 502 && error.status <= 504) return 'El servidor no está disponible. Intenta de nuevo en un momento.';
    return `Error ${error.status}`;
  }
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado';
}

/**
 * Copies text to the clipboard. `navigator.clipboard` only exists on HTTPS or localhost,
 * and this app is often opened by IP on the office network, so there is a fallback.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to the fallback below.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  return copied;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Shrinks a photo in the browser before it goes to the AI provider: phone photos
 * are several MB and providers limit image size. Returns a JPEG whose longest
 * side is at most `maxSide`. GIFs and already-small images are returned as is.
 */
export async function shrinkImage(file: File, maxSide = 1600): Promise<File> {
  if (file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1_000_000 && (file.type === 'image/jpeg' || file.type === 'image/png')) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) return file;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

/**
 * Turns any image the browser can show into a PNG whose longest side is at most `maxSide`,
 * keeping its proportions and its transparency. Used for the company logo: the server takes
 * only small PNG, JPG or WebP files, and an SVG (which it refuses, as it can carry scripts)
 * becomes a plain picture here.
 */
export async function toSmallPng(file: File, maxSide: number): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // An SVG without a size of its own reports none: it is drawn as a square.
    const width = image.naturalWidth || maxSide;
    const height = image.naturalHeight || maxSide;
    const scale = Math.min(1, maxSide / Math.max(width, height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la imagen');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Read out at once (`toDataURL`), not through `toBlob`: its answer waits for the browser to
    // be idle, which in a tab that is not in view can take very long. The image is small.
    const encoded = atob(canvas.toDataURL('image/png').split(',')[1] ?? '');
    if (!encoded) throw new Error('No se pudo preparar la imagen');
    const bytes = Uint8Array.from(encoded, (char) => char.charCodeAt(0));
    return new File([bytes], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' });
  } catch (error) {
    // `decode` rejects with a browser message in English when the file is not an image.
    throw error instanceof Error && error.message.startsWith('No se pudo') ? error : new Error('El archivo no es una imagen que se pueda leer.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Image files found in a paste or drop event. */
export function imagesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((file) => file.type.startsWith('image/'));
}

/**
 * Image files of a paste, for the handlers that listen on the whole document. None when the
 * clipboard also has text and the paste goes into a field: a cell copied from Excel carries its
 * text and a picture of the cell, and the person wants the text in the field. The handler then
 * does nothing and the browser pastes the text.
 */
export function pastedImages(event: ClipboardEvent): File[] {
  const data = event.clipboardData;
  const target = event.target;
  const intoField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
  if (intoField && data?.types.includes('text/plain')) return [];
  return imagesFrom(data);
}
