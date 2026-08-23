import { PiperPlus } from 'piper-plus';
import initPiperWasm, * as piperWasm from 'piper-plus/wasm/multilingual';
import * as ort from 'onnxruntime-web';

// CSS10 Japanese model is used as the default because the model card states
// that it follows the CSS10 public-domain license, making it a good fit for
// a general-purpose explainer tool.
const MODEL = 'ayousanz/piper-plus-css10-ja-6lang';
const MAX_CHUNK_CHARS = 135;
const SILENCE_SECONDS = 0.16;
const DEFAULT_SPEAKER_EMBEDDING_DIM = 256;

let enginePromise = null;
let wasmModulePromise = null;

async function loadPiperWasm() {
  if (!wasmModulePromise) {
    // Piper Plus 0.6 normally resolves the G2P WASM module with a runtime
    // relative path. After Vite bundles the app under a GitHub Pages subpath,
    // that relative URL can point to the wrong location. Importing the public
    // package export here lets Vite emit and rewrite the JS/WASM assets, while
    // wasmLoader gives Piper Plus the already-initialised module explicitly.
    wasmModulePromise = (async () => {
      await initPiperWasm();
      return piperWasm;
    })().catch((error) => {
      wasmModulePromise = null;
      throw error;
    });
  }
  return wasmModulePromise;
}

/**
 * Piper Plus 0.6 compatibility shim for distributed ONNX models that expose
 * speaker_embedding / speaker_embedding_mask as required inputs even during
 * ordinary single-speaker synthesis.
 *
 * The Piper Plus project documents the correct non-voice-cloning behaviour as
 * a zero-filled embedding with mask=0. That keeps inference on the normal
 * speaker/language-conditioning path. The native runtimes gained this fix
 * before the currently published browser package, so we add it at the
 * InferenceSession boundary until npm includes the same behaviour.
 */
function installSpeakerEmbeddingCompatibility(tts) {
  const session = tts?._session;
  if (!session || session.__documentToVideoSpeakerCompat) return;

  const inputNames = Array.from(session.inputNames || []);
  const needsEmbedding = inputNames.includes('speaker_embedding');
  const needsMask = inputNames.includes('speaker_embedding_mask');
  if (!needsEmbedding && !needsMask) return;

  const metadata = Array.from(session.inputMetadata || []);
  const embeddingMeta = metadata.find((item) => item?.name === 'speaker_embedding');
  const embeddingDim = resolveSpeakerEmbeddingDimension(embeddingMeta);
  const originalRun = session.run.bind(session);

  session.run = async (feeds, ...args) => {
    const compatibleFeeds = { ...feeds };

    if (needsEmbedding && compatibleFeeds.speaker_embedding == null) {
      compatibleFeeds.speaker_embedding = new ort.Tensor(
        'float32',
        new Float32Array(embeddingDim),
        [1, embeddingDim],
      );
    }

    // mask=0 is intentional. It tells models with the forward-compatible
    // voice-cloning hook to ignore the zero embedding and use their normal
    // speaker/language conditioning instead.
    if (needsMask) {
      compatibleFeeds.speaker_embedding_mask = new ort.Tensor(
        'int64',
        new BigInt64Array([0n]),
        [1],
      );
    }

    return originalRun(compatibleFeeds, ...args);
  };

  Object.defineProperty(session, '__documentToVideoSpeakerCompat', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

function resolveSpeakerEmbeddingDimension(metadata) {
  const shape = metadata?.isTensor ? metadata.shape : null;
  if (Array.isArray(shape)) {
    // Typical shape is [1, 256] (or another fixed embedding width). Ignore
    // batch dimension 1 and symbolic dimensions; fall back to the dimension
    // used by Piper Plus when the ONNX shape is symbolic.
    const fixedDimension = [...shape]
      .reverse()
      .find((value) => Number.isInteger(value) && value > 1);
    if (fixedDimension) return fixedDimension;
  }
  return DEFAULT_SPEAKER_EMBEDDING_DIM;
}

export async function initializeTts(onProgress = () => {}) {
  if (!enginePromise) {
    // GitHub Pages does not provide cross-origin isolation by default.
    // One WASM thread is therefore the safest baseline across ordinary browsers.
    if (ort.env?.wasm) ort.env.wasm.numThreads = 1;

    enginePromise = PiperPlus.initialize({
      model: MODEL,
      ort,
      wasmLoader: loadPiperWasm,
      onProgress,
    })
      .then((tts) => {
        installSpeakerEmbeddingCompatibility(tts);
        return tts;
      })
      .catch((error) => {
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
