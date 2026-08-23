const TYPE_RULES = [
  {
    id: 'guideline',
    label: 'ガイドライン・指針',
    words: ['ガイドライン', '推奨', '推奨度', 'エビデンス', 'clinical question', 'cq', 'grade', '指針', '推奨する'],
  },
  {
    id: 'research',
    label: '研究・論文',
    words: ['背景', '目的', '方法', '対象', '結果', '考察', '結論', '研究', '解析', '有意', 'p値', 'confidence interval'],
  },
  {
    id: 'report',
    label: '報告書・計画書',
    words: ['報告', '計画', '課題', '現状', '事業', '年度', '施策', '目標', '評価', '実績'],
  },
  {
    id: 'lecture',
    label: '研修・講義資料',
    words: ['学習目標', '研修', '講義', '演習', '授業', 'ポイント', '覚えて', '理解する', 'まとめ'],
  },
];

const DURATION_CONFIG = {
  1: { targetChars: 360, scenes: 4 },
  3: { targetChars: 980, scenes: 7 },
  5: { targetChars: 1620, scenes: 10 },
};

const IMPORTANT_TERMS = [
  '目的', '対象', '重要', '結果', '結論', '推奨', '必要', '注意', '課題', '方法', '効果',
  '増加', '減少', '改善', 'リスク', '有意', 'エビデンス', '限界', '今後', '実施', '評価',
];

const STOP_WORDS = new Set([
  'こと', 'ため', 'もの', 'これ', 'それ', 'また', 'および', '及び', 'について', 'として', 'による',
  'である', 'あります', 'する', 'した', 'される', 'された', 'できる', 'いる', 'なる', 'その', 'この',
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'were', 'was', 'are',
]);

export function analyzeDocument(document, options = {}) {
  const duration = Number(options.duration || 3);
  const audience = options.audience || 'general';
  const config = DURATION_CONFIG[duration] || DURATION_CONFIG[3];
  const type = classifyDocument(document.fullText);
  const sentences = buildSentences(document.blocks);

  if (!sentences.length) throw new Error('動画構成に利用できる文章が見つかりませんでした。');

  const frequencies = tokenFrequencies(sentences.map((s) => s.text).join(' '));
  const scored = sentences.map((sentence, index) => ({
    ...sentence,
    index,
    score: scoreSentence(sentence.text, index, sentences.length, frequencies, audience, type.id),
  }));

  const selected = selectSentences(scored, config.targetChars, config.scenes, audience);
  const scenes = groupIntoScenes(selected, config.scenes, type.id, document.title);
  const estimatedSeconds = estimateNarrationSeconds(scenes);

  return {
    documentType: type,
    scenes,
    estimatedSeconds,
    targetMinutes: duration,
    audience,
  };
}

export function estimateNarrationSeconds(scenes) {
  const chars = scenes.reduce((sum, scene) => sum + scene.narration.length, 0);
  // Japanese explanatory speech is roughly 280–340 characters/minute.
  return Math.max(10, Math.round(chars / 5.1));
}

export function buildScriptText(title, scenes) {
  const lines = [title, ''];
  scenes.forEach((scene, index) => {
    lines.push(`Scene ${index + 1}: ${scene.title}`);
    lines.push(scene.narration);
    if (scene.sources.length) lines.push(`出典位置: ${scene.sources.join(', ')}`);
    lines.push('');
  });
  return lines.join('\n');
}

export function buildSrt(scenes, durations = null) {
  let cursor = 0;
  const output = [];

  scenes.forEach((scene, index) => {
    const seconds = durations?.[index] ?? Math.max(4, scene.narration.length / 5.1);
    const start = cursor;
    const end = cursor + seconds;
    output.push(String(index + 1));
    output.push(`${srtTime(start)} --> ${srtTime(end)}`);
    output.push(scene.narration);
    output.push('');
    cursor = end + 0.35;
  });

  return output.join('\n');
}

function classifyDocument(text) {
  const lowered = text.toLowerCase();
  let best = { id: 'general', label: '一般資料', score: 0 };
  for (const rule of TYPE_RULES) {
    const score = rule.words.reduce((total, word) => total + countOccurrences(lowered, word.toLowerCase()), 0);
    if (score > best.score) best = { id: rule.id, label: rule.label, score };
  }
  return best;
}

function buildSentences(blocks) {
  const sentences = [];
  for (const block of blocks) {
    const fragments = splitSentences(block.text);
    for (const fragment of fragments) {
      const text = cleanSentence(fragment);
      if (text.length < 12) continue;
      sentences.push({ text, source: block.source, order: block.order });
    }
  }
  return sentences;
}

function splitSentences(text) {
  const normalized = text.replace(/\r/g, '').replace(/\n+/g, '。');
  const matches = normalized.match(/[^。！？!?]+[。！？!?]?/g) || [];
  return matches.map((value) => value.trim()).filter(Boolean);
}

function cleanSentence(text) {
  return text
    .replace(/^[-•・●○□■◆◇▶▷]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenFrequencies(text) {
  const tokens = extractTokens(text);
  const map = new Map();
  for (const token of tokens) map.set(token, (map.get(token) || 0) + 1);
  const max = Math.max(1, ...map.values());
  for (const [key, value] of map) map.set(key, value / max);
  return map;
}

function extractTokens(text) {
  const tokens = text.toLowerCase().match(/[一-龠々〆ヶぁ-んァ-ヴー]{2,}|[a-z]{3,}|\d+(?:\.\d+)?%?/g) || [];
  return tokens.filter((token) => !STOP_WORDS.has(token) && token.length <= 28);
}

function scoreSentence(text, index, total, frequencies, audience, typeId) {
  let score = 0;
  const tokens = extractTokens(text);
  const unique = [...new Set(tokens)];
  score += unique.reduce((sum, token) => sum + (frequencies.get(token) || 0), 0) / Math.max(1, unique.length);
  score *= 3.2;

  if (index < Math.min(8, total * 0.12)) score += 0.75;
  if (/\d/.test(text)) score += 0.55;
  if (/[％%]|倍|件|人|歳|年|月|日|円|km|cm|kg/i.test(text)) score += 0.35;
  score += IMPORTANT_TERMS.reduce((sum, term) => sum + (text.includes(term) ? 0.3 : 0), 0);

  if (text.length >= 35 && text.length <= 150) score += 0.45;
  if (text.length > 240) score -= 0.8;

  if (audience === 'general') {
    if (text.length <= 110) score += 0.35;
    if (/[A-Za-z]{5,}|[（(][A-Z]{2,}/.test(text)) score -= 0.15;
  }
  if (audience === 'professional' && /方法|解析|推奨|エビデンス|有意|対象|結果/.test(text)) score += 0.45;
  if (audience === 'student' && /とは|定義|意味|目的|基本|ポイント/.test(text)) score += 0.45;
  if (audience === 'manager' && /課題|結果|効果|費用|実施|必要|今後|目標|評価/.test(text)) score += 0.45;

  if (typeId === 'guideline' && /推奨|エビデンス|対象|CQ|clinical question|GRADE/i.test(text)) score += 0.7;
  if (typeId === 'research' && /目的|方法|結果|結論|有意|解析/.test(text)) score += 0.55;
  if (typeId === 'report' && /現状|課題|目標|実績|今後|評価/.test(text)) score += 0.55;
  if (typeId === 'lecture' && /目標|ポイント|まとめ|理解|例/.test(text)) score += 0.55;

  return score;
}

function selectSentences(scored, targetChars, sceneCount, audience) {
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const chosen = [];
  let chars = 0;

  for (const candidate of ranked) {
    if (chosen.length && chosen.some((item) => similarity(item.text, candidate.text) > 0.68)) continue;
    if (audience === 'general' && candidate.text.length > 260) continue;
    chosen.push(candidate);
    chars += candidate.text.length;
    if (chars >= targetChars && chosen.length >= sceneCount) break;
  }

  if (chosen.length < sceneCount) {
    for (const candidate of scored) {
      if (chosen.some((item) => item.index === candidate.index)) continue;
      chosen.push(candidate);
      if (chosen.length >= sceneCount) break;
    }
  }

  chosen.sort((a, b) => a.index - b.index);
  return chosen;
}

function groupIntoScenes(sentences, desiredScenes, typeId, documentTitle) {
  const sceneCount = Math.min(desiredScenes, sentences.length);
  const groups = Array.from({ length: sceneCount }, () => []);
  const totalChars = sentences.reduce((sum, s) => sum + s.text.length, 0);
  const ideal = totalChars / sceneCount;
  let groupIndex = 0;
  let groupChars = 0;

  for (const sentence of sentences) {
    if (groupIndex < sceneCount - 1 && groupChars >= ideal && groups[groupIndex].length) {
      groupIndex += 1;
      groupChars = 0;
    }
    groups[groupIndex].push(sentence);
    groupChars += sentence.text.length;
  }

  return groups.filter((group) => group.length).map((group, index, allGroups) => {
    const narration = group.map((item) => item.text).join('');
    const sources = [...new Set(group.map((item) => item.source))];
    return {
      id: crypto.randomUUID?.() || `${Date.now()}-${index}`,
      title: sceneTitle(group, index, allGroups.length, typeId, documentTitle),
      narration,
      sources,
    };
  });
}

function sceneTitle(group, index, total, typeId, documentTitle) {
  if (index === 0) return shortenTitle(documentTitle || 'この資料について');
  if (index === total - 1) return 'まとめと重要な点';

  const text = group.map((item) => item.text).join(' ');
  const mappings = {
    guideline: [
      ['対象|目的|範囲', '対象と目的'],
      ['方法|GRADE|システマティック|レビュー', '作成方法と根拠'],
      ['推奨|エビデンス|CQ|clinical question', '推奨とエビデンス'],
      ['注意|限界|適用', '活用するときの注意'],
    ],
    research: [
      ['背景|目的', '背景と研究目的'],
      ['対象|方法|解析', '対象と方法'],
      ['結果|有意|関連', '主な結果'],
      ['考察|結論|示唆', '解釈と結論'],
      ['限界', '研究の限界'],
    ],
    report: [
      ['現状|背景', '現状'],
      ['課題|問題', '主な課題'],
      ['目標|計画|施策', '目標と取り組み'],
      ['結果|実績|評価', '結果と評価'],
      ['今後', '今後の方向'],
    ],
    lecture: [
      ['目標|目的', 'この資料の目標'],
      ['定義|とは|基本', '基本となる考え方'],
      ['例|具体', '具体例'],
      ['ポイント|重要', '重要なポイント'],
    ],
  };

  for (const [pattern, label] of mappings[typeId] || []) {
    if (new RegExp(pattern, 'i').test(text)) return label;
  }

  const tokens = extractTokens(text)
    .filter((token) => !/^\d/.test(token))
    .sort((a, b) => b.length - a.length);
  const topic = tokens.find((token) => token.length >= 3 && token.length <= 12);
  return topic ? `${topic}について` : `ポイント ${index + 1}`;
}

function similarity(a, b) {
  const aSet = new Set(charBigrams(a));
  const bSet = new Set(charBigrams(b));
  if (!aSet.size || !bSet.size) return 0;
  let intersection = 0;
  for (const item of aSet) if (bSet.has(item)) intersection += 1;
  return intersection / (aSet.size + bSet.size - intersection);
}

function charBigrams(text) {
  const compact = text.replace(/\s/g, '');
  const result = [];
  for (let i = 0; i < compact.length - 1; i += 1) result.push(compact.slice(i, i + 2));
  return result;
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

function shortenTitle(title) {
  const clean = title.replace(/\s+/g, ' ').trim();
  return clean.length > 34 ? `${clean.slice(0, 33)}…` : clean;
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(milli).padStart(3, '0')}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}
