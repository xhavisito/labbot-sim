/**
 * Exportación de video del canvas WebGL con MediaRecorder (webm o mp4 según lo que soporte el
 * navegador). La captura es SOLO el canvas: el HUD y los paneles (DOM) nunca salen en el video.
 */

export type VideoFormat = 'auto' | 'webm' | 'mp4';

const CANDIDATES: Record<Exclude<VideoFormat, 'auto'>, string[]> = {
  mp4: ['video/mp4;codecs=avc1.640034', 'video/mp4;codecs=avc1', 'video/mp4'],
  webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
};

/** Primer tipo MIME que el navegador sabe grabar para el formato pedido (null = ninguno). */
export function pickMime(format: VideoFormat, isSupported: (m: string) => boolean = (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)): string | null {
  const order = format === 'auto' ? [...CANDIDATES.webm, ...CANDIDATES.mp4] : [...CANDIDATES[format], ...CANDIDATES[format === 'mp4' ? 'webm' : 'mp4']];
  return order.find(isSupported) ?? null;
}

export const extensionFor = (mime: string): 'mp4' | 'webm' => (mime.startsWith('video/mp4') ? 'mp4' : 'webm');

export interface Recording {
  mime: string;
  stop(): Promise<Blob>;
}

/** Empieza a grabar el canvas a `fps` cuadros por segundo. */
export function startRecording(canvas: HTMLCanvasElement, format: VideoFormat, fps = 60, bitsPerSecond = 40_000_000): Recording {
  const mime = pickMime(format);
  if (!mime) throw new Error('Este navegador no puede grabar video del canvas (MediaRecorder).');
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitsPerSecond });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(250);
  return {
    mime,
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: mime.split(';')[0] }));
        };
        rec.stop();
      }),
  };
}

export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
