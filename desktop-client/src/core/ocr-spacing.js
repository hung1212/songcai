// Only insert separators supported by independently recognized image geometry.
// Never guess a two-digit grouping, change digits, remove repetitions or touch
// text pasted by the user. All coordinates here are pixels in the same image.
const median = values => { const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const center = box => box.x + box.width / 2;
const validBox = box => box && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(box[k])) && box.width > 0 && box.height > 0;
function sameRow(a, b) {
  if (!validBox(a) || !validBox(b)) return false;
  const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return overlap >= Math.min(a.height, b.height) * 0.65 && Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < Math.max(a.height, b.height) * 0.5;
}
function aligned(run, lines, characters = false) {
  if (!validBox(run.box)) return [];
  return lines.filter(line => sameRow(run.box, line.box)).flatMap(line => {
    const tokens = (line.tokens || []).filter(token => validBox(token.box) && center(token.box) >= run.box.x && center(token.box) <= run.box.x + run.box.width);
    if (!tokens.length) return [];
    const digits = tokens.map(t => characters ? t.text.replace(/[Il|]/g, '1') : t.text).join('');
    if (digits !== run.text || tokens.some(t => t.box.x < run.box.x - run.box.height * 0.35 || t.box.x + t.box.width > run.box.x + run.box.width + run.box.height * 0.35)) return [];
    if (tokens.some((token, i) => i && token.box.x < tokens[i - 1].box.x + tokens[i - 1].box.width - 0.01)) return [];
    if (characters && tokens.length !== run.text.length) return [];
    return [{ line, tokens }];
  });
}

export function restoreOcrSpaces(ocr) {
  const rawText = String(ocr.text || '');
  if (!ocr.spacingEvidence || !Array.isArray(ocr.lines)) return { ...ocr, text: rawText, rawText, spacingChanges: [] };
  const { wordLines = [], characterLines = [], warning } = ocr.spacingEvidence;
  const spacingChanges = [];
  const lines = ocr.lines.map((line, lineIndex) => {
    const raw = line.text;
    const runs = (line.runs || []).filter(run => /^\d+$/.test(run.text) && raw.slice(run.start, run.end) === run.text);
    const charMatches = runs.map(run => aligned(run, characterLines, true));
    // Calibrate against tight adjacent digits on this same line, so a wide
    // typeface or general letter-spacing alone cannot manufacture separators.
    const tightSteps = charMatches.flatMap(matches => matches.length === 1 ? matches[0].tokens.flatMap((token, i, tokens) => {
      if (!i) return [];
      const height = median([token.box.height, tokens[i - 1].box.height]);
      const step = (center(token.box) - center(tokens[i - 1].box)) / height;
      return step >= 0.45 && step <= 1 ? [step] : [];
    }) : []);
    const pitch = tightSteps.length >= 2 ? median(tightSteps.sort((a, b) => a - b).slice(0, Math.max(2, Math.ceil(tightSteps.length / 2)))) : null;
    const edits = [];
    for (let n = 0; n < runs.length; n++) {
      const run = runs[n];
      if (run.text.length < 2) continue;
      const characterMatch = charMatches[n].length === 1 ? charMatches[n][0] : null;
      const breaks = new Map();
      const gapAt = offset => {
        if (!characterMatch) return null;
        const left = characterMatch.tokens[offset - 1].box, right = characterMatch.tokens[offset].box;
        const height = median([left.height, right.height]);
        return { step: (center(right) - center(left)) / height, gap: (right.x - left.x - left.width) / height };
      };
      if (pitch !== null && characterMatch) {
        for (let offset = 1; offset < run.text.length; offset++) {
          const gap = gapAt(offset);
          if (gap.step > Math.max(1.02, pitch * 1.2) && gap.gap >= 0.22) breaks.set(offset, 'character-gap');
        }
      }
      const wordMatches = aligned(run, wordLines);
      if (wordMatches.length === 1) {
        const { tokens, line: secondary } = wordMatches[0];
        let offset = 0;
        for (let i = 1; i < tokens.length; i++) {
          offset += tokens[i - 1].text.length;
          const left = tokens[i - 1], right = tokens[i], gap = gapAt(offset);
          const separator = secondary.text.slice(left.end, right.start);
          const wordGap = (right.box.x - left.box.x - left.box.width) / Math.min(left.box.height, right.box.height);
          if (/^\s+$/.test(separator) && (gap ? gap.step > 0.95 && gap.gap >= 0.22 : wordGap >= 0.08)) breaks.set(offset, 'word-gap');
        }
      }
      if (!breaks.size) continue;
      const restored = [...run.text].map((c, i) => (breaks.has(i) ? ' ' : '') + c).join('');
      const change = { line: lineIndex + 1, start: run.start, end: run.end, original: run.text, restored,
        separators: [...breaks].map(([offset, evidence]) => ({ offset, evidence })) };
      edits.push(change); spacingChanges.push(change);
    }
    let text = raw;
    for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.restored + text.slice(edit.end);
    return { ...line, rawText: raw, text };
  });
  return { text: lines.map(line => line.text).join('\n'), rawText, lines, engine: ocr.engine, spacingChanges,
    spacingWarning: warning || '', lowConfidenceLines: lines.flatMap((line, i) => line.confidence < 0.8 ? [i + 1] : []) };
}
