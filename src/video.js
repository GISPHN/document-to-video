const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const GAP_SECONDS = 0.35;

export async function renderVideo({
  canvas,
  scenes,
  audioSegments = null,
  audioContext = null,
  onProgress = () => {},
}) {
  if (!globalThis.MediaRecorder) {
    throw new Error('このブラウザでは動画生成機能を利用できません。ChromeまたはEdgeの最新版を利用してください。');
  }

  const context = canvas.getContext('2d');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  drawScene(context, scenes[0], 0, scenes.length);

  const canvasStream = canvas.captureStream(FPS);
  let mediaStream = canvasStream;
  let mediaDestination = null;

  if (audioSegments) {
    if (!audioContext) throw new Error('音声付き動画の生成に必要なAudioContextがありません。');
    await audioContext.resume();
    mediaDestination = audioContext.createMediaStreamDestination();
    mediaStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...mediaDestination.stream.getAudioTracks(),
    ]);
  }

  const mimeType = chooseMimeType();
  const recorder = new MediaRecorder(mediaStream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
    audioBitsPerSecond: audioSegments ? 128_000 : undefined,
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = () => reject(recorder.error || new Error('動画の録画処理でエラーが発生しました。'));
  });

  recorder.start(1000);
  await sleep(250);

  try {
    for (let index = 0; index < scenes.length; index += 1) {
      drawScene(context, scenes[index], index, scenes.length);
      onProgress(index, scenes.length, scenes[index]);

      if (audioSegments) {
        await playToRecordingDestination(audioContext, mediaDestination, audioSegments[index]);
      } else {
        const seconds = Math.max(4, scenes[index].narration.length / 5.1);
        await sleep(seconds * 1000);
      }

      if (index < scenes.length - 1) await sleep(GAP_SECONDS * 1000);
    }

    onProgress(scenes.length, scenes.length, null);
    await sleep(250);
    recorder.stop();
    await stopped;
  } finally {
    canvasStream.getTracks().forEach((track) => track.stop());
    mediaDestination?.stream.getTracks().forEach((track) => track.stop());
  }

  return new Blob(chunks, { type: mimeType.split(';')[0] || 'video/webm' });
}

export function sceneDurationsFromAudio(audioSegments) {
  return audioSegments.map((segment) => segment.duration + GAP_SECONDS);
}

function chooseMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || 'video/webm';
}

function playToRecordingDestination(audioContext, destination, segment) {
  if (!segment?.samples?.length) return Promise.resolve();
  const audioBuffer = audioContext.createBuffer(1, segment.samples.length, segment.sampleRate);
  audioBuffer.copyToChannel(segment.samples, 0);
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(destination);
  source.start();
  return new Promise((resolve) => {
    source.onended = resolve;
  });
}

function drawScene(ctx, scene, index, total) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = '#233f77';
  ctx.fillRect(0, 0, WIDTH, 14);

  ctx.fillStyle = '#6f7c91';
  ctx.font = '600 24px system-ui, "Noto Sans JP", sans-serif';
  ctx.fillText(`SCENE ${index + 1} / ${total}`, 72, 74);

  ctx.fillStyle = '#172033';
  ctx.font = '700 48px system-ui, "Noto Sans JP", sans-serif';
  drawWrappedText(ctx, scene.title, 72, 132, 1130, 62, 2);

  const bullets = narrationToBullets(scene.narration);
  let y = 260;
  for (const bullet of bullets) {
    ctx.fillStyle = '#233f77';
    ctx.beginPath();
    ctx.arc(84, y - 10, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#26344d';
    ctx.font = '400 31px system-ui, "Noto Sans JP", sans-serif';
    const lines = wrappedLines(ctx, bullet, 1030, 3);
    lines.forEach((line, lineIndex) => {
      ctx.fillText(line, 112, y + lineIndex * 45);
    });
    y += lines.length * 45 + 28;
    if (y > 590) break;
  }

  ctx.strokeStyle = '#e1e6ee';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(72, 635);
  ctx.lineTo(1208, 635);
  ctx.stroke();

  ctx.fillStyle = '#718097';
  ctx.font = '500 19px system-ui, "Noto Sans JP", sans-serif';
  const source = scene.sources?.length ? `出典位置: ${scene.sources.join(', ')}` : '出典位置: 入力した文章';
  ctx.fillText(shorten(source, 96), 72, 677);

  ctx.fillStyle = '#8a95a7';
  ctx.textAlign = 'right';
  ctx.fillText('Document to Video', 1208, 677);
  ctx.textAlign = 'left';
  ctx.restore();
}

function narrationToBullets(text) {
  const sentences = (text.match(/[^。！？!?]+[。！？!?]?/g) || [text])
    .map((value) => value.trim())
    .filter(Boolean);
  if (sentences.length <= 3) return sentences.map((item) => shorten(item, 150));

  const groups = [[], [], []];
  sentences.forEach((sentence, index) => {
    groups[index % 3].push(sentence);
  });
  return groups
    .map((group) => shorten(group.join(''), 150))
    .filter(Boolean);
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const lines = wrappedLines(ctx, text, maxWidth, maxLines);
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
}

function wrappedLines(ctx, text, maxWidth, maxLines) {
  const chars = [...text];
  const lines = [];
  let line = '';

  for (const char of chars) {
    const next = line + char;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = char;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }

  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    const consumed = lines.join('').length;
    if (consumed < text.length) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/…$/, '')}…`;
  }
  return lines;
}

function shorten(text, length) {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > length ? `${compact.slice(0, length - 1)}…` : compact;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
