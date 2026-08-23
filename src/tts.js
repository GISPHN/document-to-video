import { PiperPlus } from 'piper-plus';
import initPiperWasm, * as piperWasm from 'piper-plus/wasm/multilingual';
import * as ort from 'onnxruntime-web';

// CSS10 Japanese model is used as the default because the model card states
// that it follows the CSS10 public-domain license, making it a good fit for
// a general-purpose explainer tool.
const MODEL = 'ayousanz/piper-plus-css10-ja-6lang';
const MAX_CHUNK_CHARS = 135;
const SILENCE_SECONDS = 0.16;
const SPEAKER_EMBEDDING_DIM = 192;

let enginePromise = null;
let wasmModulePromise = null;

async function loadPiperWasm() {
  if (!wasmModulePromise) {
    // Import the public multilingual WASM export explicitly so Vite rewrites
    // the asset URLs correctly under the GitHub Pages repository subpath.
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
 * Piper Plus 0.6 can load newer distributed ONNX models whose graph exposes
 * speaker_embedding (and, on some exports, speaker_embedding_mask) as required
 * inputs. The 0.6 warmup path predates that requirement, and its normal
 * synthesize path only adds those feeds when voice cloning is explicitly used.
 *
 * For this app we need a fixed narrator, not voice cloning. Patch the actual
 * ORT session boundary after Piper's warmup has finished so every inference
 * receives the required neutral inputs:
 *   speaker_embedding      = zero vector
 *   speaker_embedding_mask = 0 (use the model's ordinary speaker/language path)
 *
 * We also supply sid=0 only when the ONNX graph declares sid and Piper did not
 * already provide it. Unknown inputs are never added.
 */
function installOrtInputCompatibility(tts) {
  const session = tts?._session;
  if (!session || typeof session.run !== 'function') {
    throw new Error('音声モデルの推論セッションを初期化できませんでした。');
  }
  if (session.__documentToVideoInputCompatibility) return;

  const inputNames = new Set(Array.from(session.inputNames || []));
  const originalRun = session.run.bind(session);

  session.run = async (feeds, ...args) => {
    const compatibleFeeds = { ...feeds };

    if (inputNames.has('speaker_embedding') && compatibleFeeds.speaker_embedding == null) {
      compatibleFeeds.speaker_embedding = new ort.Tensor(
        'float32',
        new Float32Array(SPEAKER_EMBEDDING_DIM),
        [1, SPEAKER_EMBEDDING_DIM],
      );
    }

    if (inputNames.has('speaker_embedding_mask')) {
      // mask=0 means the zero embedding is only a compatibility input and the
      // ordinary speaker/language conditioning should be used.
      compatibleFeeds.speaker_embedding_mask = new ort.Tensor(
        'int64',
        new BigInt64Array([0n]),
        [1],
      );
    } else {
      // Piper 0.6 adds this mask whenever speakerEmbedding is supplied. Some
      // zero-shot exports do not declare the mask, so never pass an unknown
      // input to ONNX Runtime.
      delete compatibleFeeds.speaker_embedding_mask;
    }

    if (inputNames.has('sid') && compatibleFeeds.sid == null) {
      compatibleFeeds.sid = new ort.Tensor('int64', new BigInt64Array([0n]), [1]);
    }

    return originalRun(compatibleFeeds, ...args);
  };

  Object.defineProperty(session, '__documentToVideoInputCompatibility', {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

async function finishLegacyWarmup(tts) {
  // Piper Plus 0.6 starts a warmup inference during initialization. That
  // inference can predate speaker_embedding support. Let it finish (it is
  // non-fatal in Piper), then clear the promise so synthesize() will not await
  // the legacy warmup again. The compatibility patch is installed afterwards,
  // before any user-requested inference runs.
  const warmup = tts?._warmupPromise;
  if (warmup && typeof warmup.then === 'function') {
    try {
      await warmup;
    } catch {
      // Warmup is an optimization only. A failed warmup must not prevent TTS.
    }
  }
  if (tts) tts._warmupPromise = null;
}

export async function initializeTts(onProgress = () => {}) {
  if (!enginePromise) {
    // GitHub Pages does not provide cross-origin isolation by default.
    // One WASM thread is the safest baseline across ordinary browsers.
    if (ort.env?.wasm) ort.env.wasm.numThreads = 1;

    enginePromise = PiperPlus.initialize({
      model: MODEL,
      ort,
      wasmLoader: loadPiperWasm,
      onProgress,
    })
      .then(async (tts) => {
        await finishLegacyWarmup(tts);
        installOrtInputCompatibility(tts);
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
    // Do not pass speakerEmbedding here. Piper 0.6 interprets an explicit
    // embedding as voice cloning (mask=1). The ORT compatibility layer above
    // supplies neutral required inputs with mask=0 for the fixed narrator.
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
  if (!results.length) {
    return { samples: new Float32Array(), sampleRate: 22050, duration: 0 };
  }

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
  if (!AudioCtx) {
    throw new Error('このブラウザでは音声再生を利用できません。');
  }

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
