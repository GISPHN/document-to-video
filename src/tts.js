import { PiperPlus } from 'piper-plus';
import * as ort from 'onnxruntime-web';

// CSS10 Japanese model is used as the default because the model card states
// that it follows the CSS10 public-domain license, making it a better fit for
// a general-purpose explainer tool than voices with additional usage terms.
const MODEL = 'ayousanz/piper-plus-css10-ja-6lang';
const MAX_CHUNK_CHARS = 135;
const SILENCE_SECONDS = 0.16;

let enginePromise = null;

export async function initializeTts(onProgress = () => {}) {
  if (!enginePromise) {
    // GitHub Pages does not provide cross-origin isolation by default.
    // One WASM thread is therefore the safest baseline across ordinary browsers.
    if (ort.env?.wasm) ort.env.wasm.numThreads = 1;

    enginePromise = PiperPlus.initialize({
      model: MODEL,
      ort,
      onProgress,
    }).catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

export async function previewNarration(text, onProgress = () => {}) {
  const tts = await initializeTts(onProgress);
  const result = await synthesizeLongText(tts, text);
  return playAudioData(result);
}

export async function synthesizeScenes(scenes, callbacks = {}) {
  const onModelProgress = callbacks.onModelProgress || (() => {});
  const onSceneProgress = callbacks.onSceneProgress || (() => {});
  const tts = await initializeTts(onModelProgress);
  const output = [];

  for (let index = 0; index < scenes.length; index += 1) {
    onSceneProgress(index, scenes.length, scenes[index]);
    const audio = await synthesizeLongText(tts, scenes[index].narration);
    output.push(audio);
  }

  onSceneProgress(scenes.length, scenes.length, null);
  return output;
}

async function synthesizeLongText(tts, text) {
  const chunks = chunkText(text, MAX_CHUNK_CHARS);
  const results = [];

  for (const chunk of chunks) {
    const result = await tts.synthesize(chunk, {
      language: 'ja',
      lengthScale: 1.2,
    });
    results.push({
      samples: result.samples,
      sampleRate: result.sampleRate,
      duration: result.duration,
    });
  }

  return concatenateAudio(results, SILENCE_SECONDS);
}

function chunkText(text, maxChars) {
  const sentences = (text.match(/[^。！？!?]+[。！？!?]?/g) || [text])
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let start = 0; start < sentence.length; start += maxChars) {
        chunks.push(sentence.slice(start, start + maxChars));
      }
      continue;
    }

    if (current && current.length + sentence.length > maxChars) {
      chunks.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

function concatenateAudio(results, gapSeconds) {
  if (!results.length) return { samples: new Float32Array(), sampleRate: 22050, duration: 0 };
  const sampleRate = results[0].sampleRate;
  const gapSamples = Math.round(gapSeconds * sampleRate);
  const normalized = results.map((item) => {
    if (item.sampleRate !== sampleRate) {
      throw new Error('音声のサンプルレートが一致しませんでした。');
    }
    return item.samples;
  });

  const totalLength = normalized.reduce((sum, samples) => sum + samples.length, 0)
    + gapSamples * Math.max(0, normalized.length - 1);
  const combined = new Float32Array(totalLength);
  let offset = 0;

  normalized.forEach((samples, index) => {
    combined.set(samples, offset);
    offset += samples.length;
    if (index < normalized.length - 1) offset += gapSamples;
  });

  return {
    samples: combined,
    sampleRate,
    duration: combined.length / sampleRate,
  };
}

async function playAudioData(audio) {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) throw new Error('このブラウザでは音声再生を利用できません。');
  const context = new AudioCtx();
  await context.resume();
  const buffer = context.createBuffer(1, audio.samples.length, audio.sampleRate);
  buffer.copyToChannel(audio.samples, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();

  await new Promise((resolve) => {
    source.onended = resolve;
  });
  await context.close();
}
