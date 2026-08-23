import './styles.css';
import { parseInput } from './parsers.js';
import {
  analyzeDocument,
  buildScriptText,
  buildSrt,
  estimateNarrationSeconds,
} from './analyzer.js';
import { previewNarration, synthesizeScenes } from './tts.js';
import { renderVideo } from './video.js';

const els = {
  fileInput: document.querySelector('#file-input'),
  dropZone: document.querySelector('#drop-zone'),
  fileStatus: document.querySelector('#file-status'),
  pasteText: document.querySelector('#paste-text'),
  audience: document.querySelector('#audience'),
  analyzeBtn: document.querySelector('#analyze-btn'),
  resultSection: document.querySelector('#result-section'),
  videoSection: document.querySelector('#video-section'),
  docType: document.querySelector('#doc-type'),
  sceneCount: document.querySelector('#scene-count'),
  estimatedDuration: document.querySelector('#estimated-duration'),
  sceneList: document.querySelector('#scene-list'),
  downloadScriptBtn: document.querySelector('#download-script-btn'),
  downloadSrtBtn: document.querySelector('#download-srt-btn'),
  voicePreviewBtn: document.querySelector('#voice-preview-btn'),
  createVideoBtn: document.querySelector('#create-video-btn'),
  createSilentVideoBtn: document.querySelector('#create-silent-video-btn'),
  progressBox: document.querySelector('#progress-box'),
  progressBar: document.querySelector('#progress-bar'),
  progressLabel: document.querySelector('#progress-label'),
  progressPercent: document.querySelector('#progress-percent'),
  progressDetail: document.querySelector('#progress-detail'),
  canvas: document.querySelector('#render-canvas'),
  videoResult: document.querySelector('#video-result'),
  previewVideo: document.querySelector('#preview-video'),
  downloadVideoLink: document.querySelector('#download-video-link'),
};

let selectedFile = null;
let parsedDocument = null;
let currentAnalysis = null;
let currentVideoUrl = null;

wireFileInput();
wireActions();

function wireFileInput() {
  els.fileInput.addEventListener('change', () => {
    selectedFile = els.fileInput.files?.[0] || null;
    showSelectedFile();
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add('dragging');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove('dragging');
    });
  });

  els.dropZone.addEventListener('drop', (event) => {
    selectedFile = event.dataTransfer?.files?.[0] || null;
    showSelectedFile();
  });

  els.dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      els.fileInput.click();
    }
  });
}

function wireActions() {
  els.analyzeBtn.addEventListener('click', handleAnalyze);
  els.downloadScriptBtn.addEventListener('click', handleScriptDownload);
  els.downloadSrtBtn.addEventListener('click', handleSrtDownload);
  els.voicePreviewBtn.addEventListener('click', handleVoicePreview);
  els.createVideoBtn.addEventListener('click', handleNarratedVideo);
  els.createSilentVideoBtn.addEventListener('click', handleSilentVideo);
}

async function handleAnalyze() {
  setBusy(els.analyzeBtn, true, '読み取っています…');
  hideVideoResult();

  try {
    parsedDocument = await parseInput({
      file: selectedFile,
      pastedText: els.pasteText.value,
    });

    const duration = selectedDuration();
    currentAnalysis = analyzeDocument(parsedDocument, {
      duration,
      audience: els.audience.value,
    });

    renderAnalysis(currentAnalysis);
    els.resultSection.hidden = false;
    els.videoSection.hidden = false;
    els.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    window.alert(error?.message || '資料の読み取り中にエラーが発生しました。');
  } finally {
    setBusy(els.analyzeBtn, false, '内容を整理する');
  }
}

function renderAnalysis(analysis) {
  els.docType.textContent = analysis.documentType.label;
  els.sceneCount.textContent = `${analysis.scenes.length} シーン`;
  els.estimatedDuration.textContent = formatDuration(analysis.estimatedSeconds);
  els.sceneList.innerHTML = '';

  analysis.scenes.forEach((scene, index) => {
    const article = document.createElement('article');
    article.className = 'scene-card';
    article.dataset.sceneIndex = String(index);
    article.innerHTML = `
      <div class="scene-card-header">
        <span class="scene-number">${index + 1}</span>
        <strong>シーン ${index + 1}</strong>
      </div>
      <div class="scene-card-body">
        <label class="field-label">画面タイトル</label>
        <input class="scene-title-input" value="${escapeAttribute(scene.title)}" />
        <label class="field-label">ナレーション</label>
        <textarea class="scene-narration-input">${escapeHtml(scene.narration)}</textarea>
        <div class="scene-meta">
          <span>出典位置: ${escapeHtml(scene.sources.join(', ') || '入力文章')}</span>
          <span class="scene-char-count">${scene.narration.length}文字</span>
        </div>
      </div>`;

    article.querySelector('.scene-narration-input').addEventListener('input', (event) => {
      article.querySelector('.scene-char-count').textContent = `${event.target.value.length}文字`;
      refreshEstimateFromEditor();
    });
    els.sceneList.appendChild(article);
  });
}

function syncScenesFromEditor() {
  if (!currentAnalysis) return [];
  const cards = [...els.sceneList.querySelectorAll('.scene-card')];
  currentAnalysis.scenes = cards.map((card, index) => ({
    ...currentAnalysis.scenes[index],
    title: card.querySelector('.scene-title-input').value.trim() || `シーン ${index + 1}`,
    narration: card.querySelector('.scene-narration-input').value.trim(),
  }));
  return currentAnalysis.scenes;
}

function refreshEstimateFromEditor() {
  const scenes = syncScenesFromEditor();
  if (!scenes.length) return;
  els.estimatedDuration.textContent = formatDuration(estimateNarrationSeconds(scenes));
}

function handleScriptDownload() {
  const scenes = syncScenesFromEditor();
  if (!scenes.length) return;
  const title = parsedDocument?.title || '動画台本';
  downloadText(buildScriptText(title, scenes), `${safeFilename(title)}_script.txt`, 'text/plain;charset=utf-8');
}

function handleSrtDownload() {
  const scenes = syncScenesFromEditor();
  if (!scenes.length) return;
  const title = parsedDocument?.title || '動画';
  downloadText(buildSrt(scenes), `${safeFilename(title)}.srt`, 'application/x-subrip;charset=utf-8');
}

async function handleVoicePreview() {
  const scenes = syncScenesFromEditor();
  if (!scenes.length || !scenes[0].narration) return;
  setBusy(els.voicePreviewBtn, true, '準備中…');
  showProgress('音声モデルを準備しています', 4, '初回はモデルのダウンロードが発生します。');

  try {
    await previewNarration(scenes[0].narration.slice(0, 120), (info) => {
      const value = Math.max(4, Math.min(92, Math.round((info.progress || 0) * 90)));
      showProgress('音声モデルを準備しています', value, info.message || '');
    });
    showProgress('音声の試聴が完了しました', 100, '');
  } catch (error) {
    showProgress('音声を準備できませんでした', 0, error?.message || '音声モデルの読み込みに失敗しました。');
    window.alert('日本語音声を準備できませんでした。ネットワーク環境を確認するか、「音声なし動画を作る」を利用してください。');
  } finally {
    setBusy(els.voicePreviewBtn, false, '音声を試す');
  }
}

async function handleNarratedVideo() {
  const scenes = syncScenesFromEditor();
  if (!validateScenes(scenes)) return;

  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) {
    window.alert('このブラウザでは音声付き動画を作成できません。ChromeまたはEdgeの最新版を利用してください。');
    return;
  }

  setVideoButtonsDisabled(true);
  hideVideoResult();
  let audioContext = null;

  try {
    // Create the context immediately from the button gesture so browser autoplay
    // restrictions do not suspend the recording audio graph later.
    audioContext = new AudioCtx();
    await audioContext.resume();

    showProgress('日本語音声を準備しています', 3, '初回は音声モデルをダウンロードします。');
    const audioSegments = await synthesizeScenes(scenes, {
      onModelProgress: (info) => {
        const value = 3 + Math.round((info.progress || 0) * 22);
        showProgress('日本語音声を準備しています', Math.min(25, value), info.message || '');
      },
      onSceneProgress: (index, total, scene) => {
        const value = 25 + Math.round((index / Math.max(1, total)) * 30);
        const detail = scene ? `シーン ${index + 1} / ${total}: ${scene.title}` : 'ナレーション音声が完成しました。';
        showProgress('ナレーションを作成しています', Math.min(55, value), detail);
      },
    });

    showProgress('動画をレンダリングしています', 56, '動画の長さとほぼ同じ時間がかかります。');
    const blob = await renderVideo({
      canvas: els.canvas,
      scenes,
      audioSegments,
      audioContext,
      onProgress: (index, total, scene) => {
        const value = 56 + Math.round((index / Math.max(1, total)) * 43);
        const detail = scene ? `シーン ${index + 1} / ${total} を録画中` : '動画を書き出しています。';
        showProgress('動画をレンダリングしています', Math.min(99, value), detail);
      },
    });

    const durations = audioSegments.map((item) => item.duration);
    currentAnalysis.audioDurations = durations;
    showVideoResult(blob);
    showProgress('動画が完成しました', 100, '下のプレビューで確認して保存してください。');
  } catch (error) {
    console.error(error);
    showProgress('動画を作成できませんでした', 0, error?.message || '不明なエラー');
    window.alert('ナレーション付き動画を作成できませんでした。音声モデルの読み込みに失敗した場合は、音声なし動画も利用できます。');
  } finally {
    if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
    setVideoButtonsDisabled(false);
  }
}

async function handleSilentVideo() {
  const scenes = syncScenesFromEditor();
  if (!validateScenes(scenes)) return;
  setVideoButtonsDisabled(true);
  hideVideoResult();

  try {
    showProgress('音声なし動画をレンダリングしています', 2, '動画の長さとほぼ同じ時間がかかります。');
    const blob = await renderVideo({
      canvas: els.canvas,
      scenes,
      onProgress: (index, total, scene) => {
        const value = 2 + Math.round((index / Math.max(1, total)) * 97);
        const detail = scene ? `シーン ${index + 1} / ${total} を録画中` : '動画を書き出しています。';
        showProgress('音声なし動画をレンダリングしています', Math.min(99, value), detail);
      },
    });
    showVideoResult(blob);
    showProgress('動画が完成しました', 100, '下のプレビューで確認して保存してください。');
  } catch (error) {
    console.error(error);
    showProgress('動画を作成できませんでした', 0, error?.message || '不明なエラー');
    window.alert(error?.message || '動画の作成に失敗しました。');
  } finally {
    setVideoButtonsDisabled(false);
  }
}

function showVideoResult(blob) {
  if (currentVideoUrl) URL.revokeObjectURL(currentVideoUrl);
  currentVideoUrl = URL.createObjectURL(blob);
  els.previewVideo.src = currentVideoUrl;
  els.downloadVideoLink.href = currentVideoUrl;
  const title = safeFilename(parsedDocument?.title || 'document-video');
  els.downloadVideoLink.download = `${title}.webm`;
  els.videoResult.hidden = false;
  els.videoResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideVideoResult() {
  els.videoResult.hidden = true;
  els.previewVideo.removeAttribute('src');
  els.previewVideo.load();
  if (currentVideoUrl) {
    URL.revokeObjectURL(currentVideoUrl);
    currentVideoUrl = null;
  }
}

function showSelectedFile() {
  if (!selectedFile) {
    els.fileStatus.hidden = true;
    return;
  }
  els.fileStatus.hidden = false;
  els.fileStatus.textContent = `選択中: ${selectedFile.name}（${formatBytes(selectedFile.size)}）`;
}

function showProgress(label, percent, detail) {
  els.progressBox.hidden = false;
  const rounded = Math.max(0, Math.min(100, Math.round(percent)));
  els.progressLabel.textContent = label;
  els.progressPercent.textContent = `${rounded}%`;
  els.progressBar.value = rounded;
  els.progressDetail.textContent = detail || '';
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function setVideoButtonsDisabled(disabled) {
  els.createVideoBtn.disabled = disabled;
  els.createSilentVideoBtn.disabled = disabled;
  els.voicePreviewBtn.disabled = disabled;
}

function selectedDuration() {
  return Number(document.querySelector('input[name="duration"]:checked')?.value || 3);
}

function validateScenes(scenes) {
  if (!scenes.length) {
    window.alert('先に資料の内容を整理してください。');
    return false;
  }
  if (scenes.some((scene) => !scene.narration.trim())) {
    window.alert('ナレーションが空のシーンがあります。台本を確認してください。');
    return false;
  }
  return true;
}

function downloadText(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function formatDuration(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min}分${String(sec).padStart(2, '0')}秒`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function safeFilename(value) {
  return value.replace(/[\\/:*?"<>|\r\n]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'document-video';
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}
