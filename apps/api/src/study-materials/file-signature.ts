import { MaterialFileType } from '@prisma/client';

const MAX_IMAGE_SIDE_PX = 10_000; // decompression-bomb guard for OCR

const startsWith = (buf: Buffer, bytes: number[]) =>
  buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);

/**
 * Detects the real type from magic bytes. The client-supplied MIME type and
 * file name are ignored entirely — they are attacker-controlled.
 */
export function detectUploadFileType(buf: Buffer): MaterialFileType | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return MaterialFileType.PDF; // %PDF-
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return width <= MAX_IMAGE_SIDE_PX && height <= MAX_IMAGE_SIDE_PX ? MaterialFileType.PNG : null;
  }
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return MaterialFileType.JPEG;
  // DOCX = ZIP container holding word/document.xml (names are stored uncompressed in ZIP headers).
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) && buf.includes('word/document.xml')) {
    return MaterialFileType.DOCX;
  }
  return null;
}

export const FILE_EXTENSIONS: Record<MaterialFileType, string> = {
  PDF: 'pdf',
  PNG: 'png',
  JPEG: 'jpg',
  DOCX: 'docx',
  URL: 'url',
};
