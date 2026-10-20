/**
 * Sinclair BASIC (.bas) Go-To-Definition & Jump Navigation Engine
 * 
 * Accurately detects jump targets in standard numbered Sinclair BASIC (.bas):
 * When Ctrl+Click (or Go to Definition / F12) is used on a line number after:
 * - GO SUB / GOSUB
 * - GO TO / GOTO
 * - RUN
 * - RESTORE
 * - LINE
 * - THEN <line>
 * - Multi-target jumps: ON x GO SUB 100, 200, 300 / ON x GO TO 100, 200
 * 
 * Navigates directly to the target line number in the document.
 */

const { getCodeOutsideStringsAndRem } = require('./folding');

/**
 * Searches for a jump target line number at the specified character column on a line of Sinclair BASIC.
 * @param {string} lineText 
 * @param {number} charIndex 
 * @returns {{ targetLineNumber: number, startCol: number, endCol: number, keyword: string } | null}
 */
function findBasJumpTargetAtPosition(lineText, charIndex) {
  if (typeof lineText !== 'string' || charIndex < 0 || charIndex > lineText.length) {
    return null;
  }

  const masked = getCodeOutsideStringsAndRem(lineText);
  if (masked.length < lineText.length && charIndex >= masked.length) {
    // Inside REM comment
    return null;
  }

  // If character in lineText is inside a string literal, lineText is non-space and masked is space
  if (charIndex < lineText.length) {
    if (lineText[charIndex] === '"' || (masked[charIndex] === ' ' && lineText[charIndex] !== ' ')) {
      return null;
    }
  }

  // Match jump statements: GO SUB, GOSUB, GO TO, GOTO, RUN, RESTORE, LINE, THEN
  const jumpRegex = /\b(GO\s*SUB|GOSUB|GO\s*TO|GOTO|RUN|RESTORE|LINE|THEN)\s+(\d+(?:\s*,\s*\d+)*)/gi;
  let match;

  while ((match = jumpRegex.exec(masked)) !== null) {
    const fullMatch = match[0];
    const keyword = match[1];
    const targetsStr = match[2];

    const targetsStart = match.index + fullMatch.length - targetsStr.length;
    const numRegex = /\b(\d+)\b/g;
    let numMatch;

    while ((numMatch = numRegex.exec(targetsStr)) !== null) {
      const numStr = numMatch[1];
      const startCol = targetsStart + numMatch.index;
      const endCol = startCol + numStr.length;

      if (charIndex >= startCol && charIndex <= endCol) {
        return {
          targetLineNumber: parseInt(numStr, 10),
          startCol,
          endCol,
          keyword
        };
      }
    }
  }

  return null;
}

/**
 * Finds the 0-indexed line index and column of a target BASIC line number.
 * @param {string|string[]} documentTextOrLines 
 * @param {number} targetLineNumber 
 * @returns {{ lineIndex: number, col: number, text: string } | null}
 */
function findBasLineIndex(documentTextOrLines, targetLineNumber) {
  const targetNum = typeof targetLineNumber === 'number'
    ? targetLineNumber
    : parseInt(targetLineNumber, 10);

  if (isNaN(targetNum)) return null;

  // Support vscode.TextDocument objects with lineCount and lineAt
  if (documentTextOrLines && typeof documentTextOrLines.lineCount === 'number' && typeof documentTextOrLines.lineAt === 'function') {
    const count = documentTextOrLines.lineCount;
    for (let i = 0; i < count; i++) {
      const line = documentTextOrLines.lineAt(i).text;
      const match = line.match(/^(\s*)(\d+)\b/);
      if (match) {
        const lineNum = parseInt(match[2], 10);
        if (lineNum === targetNum) {
          return {
            lineIndex: i,
            col: match[1].length,
            text: line
          };
        }
      }
    }
    return null;
  }

  const lines = Array.isArray(documentTextOrLines)
    ? documentTextOrLines
    : (typeof documentTextOrLines === 'string' ? documentTextOrLines.split(/\r?\n/) : []);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)(\d+)\b/);
    if (match) {
      const lineNum = parseInt(match[2], 10);
      if (lineNum === targetNum) {
        return {
          lineIndex: i,
          col: match[1].length,
          text: line
        };
      }
    }
  }

  return null;
}

/**
 * High-level helper: returns definition location for a position in a .bas file.
 * @param {string|string[]} documentTextOrLines 
 * @param {number} lineIndex 
 * @param {number} charIndex 
 * @returns {{ targetLineNumber: number, origin: { startCol: number, endCol: number, keyword: string }, target: { lineIndex: number, col: number, text: string } } | null}
 */
function getBasDefinition(documentTextOrLines, lineIndex, charIndex) {
  const lines = Array.isArray(documentTextOrLines)
    ? documentTextOrLines
    : documentTextOrLines.split(/\r?\n/);

  if (lineIndex < 0 || lineIndex >= lines.length) return null;

  const lineText = lines[lineIndex];
  const jumpTarget = findBasJumpTargetAtPosition(lineText, charIndex);
  if (!jumpTarget) return null;

  const targetLocation = findBasLineIndex(lines, jumpTarget.targetLineNumber);
  if (!targetLocation) return null;

  return {
    targetLineNumber: jumpTarget.targetLineNumber,
    origin: {
      startCol: jumpTarget.startCol,
      endCol: jumpTarget.endCol,
      keyword: jumpTarget.keyword
    },
    target: targetLocation
  };
}

module.exports = {
  findBasJumpTargetAtPosition,
  findBasLineIndex,
  getBasDefinition
};
