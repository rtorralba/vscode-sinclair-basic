/**
 * Sinclair BASIC (.bas) Subroutine Folding Provider Engine
 * 
 * Accurately detects subroutine functions in standard Sinclair BASIC (.bas):
 * When a `GO SUB <line>` / `GOSUB <line>` is encountered in the program,
 * identifies the function starting at that line number and folds up to its
 * corresponding `RETURN` statement.
 */

/**
 * Strips string literals and REM comments from a single line of Sinclair BASIC code,
 * replacing string contents with spaces to preserve character positions.
 * @param {string} line 
 * @returns {string}
 */
function getCodeOutsideStringsAndRem(line) {
  let result = '';
  let inString = false;
  let i = 0;
  const n = line.length;

  while (i < n) {
    const c = line[i];

    if (c === '"') {
      inString = !inString;
      result += ' ';
      i++;
      continue;
    }

    if (!inString) {
      // Sinclair BASIC REM comment: ignore rest of line
      if (line.slice(i, i + 3).toUpperCase() === 'REM') {
        const prev = i > 0 ? line[i - 1] : ' ';
        const next = i + 3 < n ? line[i + 3] : ' ';
        if (!/[a-zA-Z0-9_]/.test(prev) && !/[a-zA-Z0-9_]/.test(next)) {
          break;
        }
      }
      result += c;
    } else {
      result += ' ';
    }
    i++;
  }

  return result;
}

/**
 * Calculates subroutine folding ranges for Sinclair BASIC (.bas) programs.
 * 
 * @param {string|string[]} input - Full text or array of line strings
 * @returns {Array<{ start: number, end: number, kind?: string }>}
 */
function getBasFoldingRanges(input) {
  const lines = Array.isArray(input) ? input : input.split(/\r?\n/);
  const lineCount = lines.length;

  // 1. Map Sinclair BASIC line numbers to 0-indexed document line numbers
  const lineNumToIndex = new Map();

  for (let i = 0; i < lineCount; i++) {
    const m = lines[i].match(/^\s*(\d+)/);
    if (m) {
      const num = parseInt(m[1], 10);
      lineNumToIndex.set(num, i);
    }
  }

  // 2. Collect all GO SUB / GOSUB targets outside strings and comments
  const gosubTargets = new Set();
  const gosubRegex = /\b(?:GO\s*SUB|GOSUB)\s+(\d+(?:\s*,\s*\d+)*)/gi;

  for (let i = 0; i < lineCount; i++) {
    const code = getCodeOutsideStringsAndRem(lines[i]);

    let match;
    while ((match = gosubRegex.exec(code)) !== null) {
      const targetsStr = match[1];
      const targets = targetsStr.split(',').map(s => parseInt(s.trim(), 10));
      for (const t of targets) {
        if (!isNaN(t) && lineNumToIndex.has(t)) {
          gosubTargets.add(t);
        }
      }
    }
  }

  // 3. Sort targets by document line index
  const sortedTargets = Array.from(gosubTargets)
    .map(num => ({ num, lineIndex: lineNumToIndex.get(num) }))
    .sort((a, b) => a.lineIndex - b.lineIndex);

  const ranges = [];

  for (let t = 0; t < sortedTargets.length; t++) {
    const current = sortedTargets[t];
    const startLineIndex = current.lineIndex;

    // Boundary: the start of the next subroutine or the end of the document
    const nextSubLineIndex = (t + 1 < sortedTargets.length)
      ? sortedTargets[t + 1].lineIndex
      : lineCount;

    // Search for lines containing the RETURN statement between startLineIndex and nextSubLineIndex - 1
    let lastReturnLineIndex = -1;
    for (let k = startLineIndex; k < nextSubLineIndex; k++) {
      const lineCode = getCodeOutsideStringsAndRem(lines[k]);
      if (/\bRETURN\b/i.test(lineCode)) {
        lastReturnLineIndex = k;
      }
    }

    if (lastReturnLineIndex > startLineIndex) {
      ranges.push({
        start: startLineIndex,
        end: lastReturnLineIndex,
        kind: 'region'
      });
    }
  }

  return ranges;
}

module.exports = {
  getCodeOutsideStringsAndRem,
  getBasFoldingRanges
};
