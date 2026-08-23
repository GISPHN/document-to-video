import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import JSZip from 'jszip';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv']);

export async function parseInput({ file, pastedText }) {
  if (file) return parseFile(file);
  const text = (pastedText || '').trim();
  if (!text) throw new Error('資料または文章を入力してください。');
  return buildTextDocument(text, '貼り付けた文章', 'text');
}

async function parseFile(file) {
  const ext = extensionOf(file.name);
  if (ext === 'pdf') return parsePdf(file);
  if (ext === 'docx') return parseDocx(file);
  if (ext === 'pptx') return parsePptx(file);
  if (TEXT_EXTENSIONS.has(ext)) {
    const text = await file.text();
    return buildTextDocument(text, file.name, ext);
  }
  throw new Error('このファイル形式にはまだ対応していません。PDF、DOCX、PPTX、TXT、Markdown、CSVを利用してください。');
}

async function parsePdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const blocks = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    let current = '';
    const lines = [];

    for (const item of content.items) {
      if (!('str' in item)) continue;
      current += `${item.str}${item.hasEOL ? '\n' : ' '}`;
    }

    for (const line of current.split(/\n+/)) {
      const cleaned = normalizeWhitespace(line);
      if (cleaned) lines.push(cleaned);
    }

    const pageText = lines.join('\n');
    if (pageText) {
      blocks.push({ text: pageText, source: `p.${pageNo}`, order: pageNo });
    }
  }

  if (!blocks.length) {
    throw new Error('PDFから文字を取得できませんでした。画像だけのスキャンPDFは初版では未対応です。');
  }

  return finalizeDocument(blocks, file.name, 'pdf');
}

async function parseDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const paragraphs = result.value
    .split(/\n+/)
    .map(normalizeWhitespace)
    .filter(Boolean);

  const blocks = paragraphs.map((text, index) => ({
    text,
    source: `段落 ${index + 1}`,
    order: index + 1,
  }));

  if (!blocks.length) throw new Error('Wordファイルから文章を取得できませんでした。');
  return finalizeDocument(blocks, file.name, 'docx');
}

async function parsePptx(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const blocks = [];
  for (const path of slideFiles) {
    const slideNo = slideNumber(path);
    const xml = await zip.file(path).async('text');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const texts = [...doc.getElementsByTagName('a:t')]
      .map((node) => normalizeWhitespace(node.textContent || ''))
      .filter(Boolean);
    const text = texts.join('。');
    if (text) blocks.push({ text, source: `スライド ${slideNo}`, order: slideNo });
  }

  if (!blocks.length) throw new Error('PowerPointから文章を取得できませんでした。');
  return finalizeDocument(blocks, file.name, 'pptx');
}

function buildTextDocument(text, sourceName, kind) {
  const lines = text
    .replace(/\r/g, '')
    .split(/\n+/)
    .map(normalizeWhitespace)
    .filter(Boolean);
  const blocks = lines.map((line, index) => ({
    text: line,
    source: `行 ${index + 1}`,
    order: index + 1,
  }));
  return finalizeDocument(blocks, sourceName, kind);
}

function finalizeDocument(blocks, sourceName, kind) {
  const fullText = blocks.map((b) => b.text).join('\n');
  return {
    title: inferTitle(blocks, sourceName),
    sourceName,
    kind,
    blocks,
    fullText,
    characterCount: fullText.length,
  };
}

function inferTitle(blocks, sourceName) {
  const first = blocks
    .flatMap((block) => block.text.split(/\n+/))
    .map(normalizeWhitespace)
    .find((line) => line.length >= 4 && line.length <= 90);
  if (first) return first.replace(/^#+\s*/, '');
  return sourceName.replace(/\.[^.]+$/, '');
}

function normalizeWhitespace(value) {
  return value.replace(/[\t\u3000 ]+/g, ' ').trim();
}

function extensionOf(name) {
  const match = name.toLowerCase().match(/\.([^.]+)$/);
  return match ? match[1] : '';
}

function slideNumber(path) {
  const match = path.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}
