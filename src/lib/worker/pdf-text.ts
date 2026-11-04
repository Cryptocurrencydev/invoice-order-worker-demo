// PDF → text. Uses the PDF text layer; when a page has no usable text (a scan),
// falls back to OCR on the embedded page image.
import { PDFDocument, PDFName, PDFRawStream, type PDFDict } from "pdf-lib";

export interface PdfText {
  text: string;
  method: "text-layer" | "ocr" | "vision-ocr";
  pages: number;
  ocrConfidence?: number;
}

const MIN_TEXT_CHARS = 80;

/** Second OCR engine: transcribes page images (e.g. with a vision model). Used if tesseract fails or times out. */
export type VisionOcr = (jpegs: Uint8Array[]) => Promise<string>;

const OCR_TIMEOUT_MS = 45_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string) {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);
}

export async function pdfToText(bytes: Uint8Array, visionOcr?: VisionOcr): Promise<PdfText> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await extractText(doc, { mergePages: false });
  const pagesText = (text as string[]).map((t) => t.replace(/[ \t]+/g, " ").trim());
  const joined = pagesText.join("\n\n").trim();
  if (joined.replace(/\s/g, "").length >= MIN_TEXT_CHARS) return { text: joined, method: "text-layer", pages: totalPages };
  try {
    if (process.env.OCR_ENGINE === "vision") throw new Error("tesseract disabled");
    const ocr = await withTimeout(ocrPdf(bytes), OCR_TIMEOUT_MS, "OCR");
    if (ocr.text.replace(/\s/g, "").length >= MIN_TEXT_CHARS) return { text: ocr.text, method: "ocr", pages: totalPages, ocrConfidence: ocr.confidence };
  } catch (e) {
    if (!visionOcr) throw e;
  }
  if (!visionOcr) return { text: "", method: "ocr", pages: totalPages, ocrConfidence: 0 };
  const images = await extractJpegs(bytes);
  if (!images.length) return { text: "", method: "vision-ocr", pages: totalPages };
  return { text: (await visionOcr(images)).trim(), method: "vision-ocr", pages: totalPages };
}

/** Pulls JPEG page images (DCTDecode XObjects) straight out of the PDF — that's what scanners produce. */
export async function extractJpegs(bytes: Uint8Array): Promise<Uint8Array[]> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const out: Uint8Array[] = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict: PDFDict = obj.dict;
    if (dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const filter = dict.get(PDFName.of("Filter"));
    if (filter === PDFName.of("DCTDecode")) out.push(obj.contents);
  }
  return out;
}

async function ocrPdf(bytes: Uint8Array): Promise<{ text: string; confidence: number }> {
  const images = await extractJpegs(bytes);
  if (!images.length) return { text: "", confidence: 0 };
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, { cachePath: process.env.VERCEL ? "/tmp" : undefined, logger: () => {} });
  try {
    const texts: string[] = [];
    let conf = 0;
    for (const img of images) {
      const r = await worker.recognize(Buffer.from(img));
      texts.push(r.data.text);
      conf += r.data.confidence;
    }
    return { text: texts.join("\n\n").replace(/[ \t]+/g, " ").trim(), confidence: Math.round(conf / images.length) };
  } finally {
    await worker.terminate();
  }
}
