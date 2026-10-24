/**
 * Sinclair BASIC (.bas) Subroutine & Function Folding Provider Engine
 * 
 * Accurately detects routines and blocks in standard Sinclair BASIC (.bas):
 * 1. Functions/subroutines with explicit headers:
 *    `REM SUB <Name>`, `REM FUNCTION <Name>`, `REM PROCEDURE <Name>`, `REM ROUTINE <Name>`
 * 2. Subroutines called via `GO SUB <line>` / `GOSUB <line>` folding to their `RETURN`
 * 3. Structured loops: `FOR <var> = ...` to `NEXT <var>`
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
 * Calculates subroutine and loop folding ranges for Sinclair BASIC (.bas) programs.
 * 
 * @param {string|string[]} input - Full text or array of line strings
 * @returns {Array<{ start: number, end: number, kind?: string }>}
 */
function getBasFoldingRanges(input) {
  const lines = Array.isArray(input) ? input : input.split(/\r?\n/);
  const lineCount = lines.length;

  // 1. Map Sinclair BASIC line numbers to 0-indexed document line numbers
  const lineNumToIndex = new Map();
  const subHeaderIndices = new Set();
  const subHeaderRegex = /^\s*(\d+)\s+REM\s+(?:SUB|FUNCTION|PROCEDURE|ROUTINE)\b/i;

  for (let i = 0; i < lineCount; i++) {
    const m = lines[i].match(/^\s*(\d+)/);
    if (m) {
      const num = parseInt(m[1], 10);
      lineNumToIndex.set(num, i);
      if (subHeaderRegex.test(lines[i])) {
        subHeaderIndices.add(i);
      }
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
          let idx = lineNumToIndex.get(t);
          // If the line immediately preceding is a REM SUB header, include the header
          if (idx > 0 && subHeaderIndices.has(idx - 1)) {
            idx = idx - 1;
          }
          gosubTargets.add(idx);
        }
      }
    }
  }

  // 3. Combine routine starts (explicit REM SUB headers and GO SUB targets)
  const allRoutineStarts = new Set([...subHeaderIndices, ...gosubTargets]);
  const sortedStarts = Array.from(allRoutineStarts).sort((a, b) => a - b);

  const ranges = [];
  const seenRanges = new Set();

  function addRange(start, end, kind = 'region') {
    if (end > start) {
      const key = `${start}:${end}`;
      if (!seenRanges.has(key)) {
        seenRanges.add(key);
        ranges.push({ start, end, kind });
      }
    }
  }

  // 4. Determine routine boundaries
  for (let t = 0; t < sortedStarts.length; t++) {
    const startLineIndex = sortedStarts[t];
    const nextSubLineIndex = (t + 1 < sortedStarts.length)
      ? sortedStarts[t + 1]
      : lineCount;

    // Search for RETURN statements between startLineIndex and nextSubLineIndex - 1
    let lastReturnLineIndex = -1;
    for (let k = startLineIndex; k < nextSubLineIndex; k++) {
      const lineCode = getCodeOutsideStringsAndRem(lines[k]);
      if (/\bRETURN\b/i.test(lineCode)) {
        lastReturnLineIndex = k;
      }
    }

    if (lastReturnLineIndex > startLineIndex) {
      addRange(startLineIndex, lastReturnLineIndex);
    } else if (subHeaderIndices.has(startLineIndex)) {
      // Routines without RETURN (e.g. main loop ending in GO TO or STOP)
      // Fold up to the last non-empty line before the next routine
      let lastCodeLine = nextSubLineIndex - 1;
      while (lastCodeLine > startLineIndex && !lines[lastCodeLine].trim()) {
        lastCodeLine--;
      }
      if (lastCodeLine > startLineIndex) {
        addRange(startLineIndex, lastCodeLine);
      }
    }
  }

  // 5. Detect FOR ... NEXT loops
  const forStack = [];
  for (let i = 0; i < lineCount; i++) {
    const lineCode = getCodeOutsideStringsAndRem(lines[i]);
    const forMatches = lineCode.match(/\bFOR\b/gi);
    if (forMatches) {
      for (let f = 0; f < forMatches.length; f++) {
        forStack.push(i);
      }
    }
    const nextMatches = lineCode.match(/\bNEXT\b/gi);
    if (nextMatches) {
      for (let n = 0; n < nextMatches.length; n++) {
        if (forStack.length > 0) {
          const forStart = forStack.pop();
          if (i > forStart) {
            addRange(forStart, i);
          }
        }
      }
    }
  }

  // Sort ranges: start ascending, end descending
  return ranges.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end;
  });
}

module.exports = {
  getCodeOutsideStringsAndRem,
  getBasFoldingRanges
};
