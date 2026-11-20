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

/**
 * Masks string literals with spaces and truncates single-quote (') and REM comments
 * outside strings for a .jbas line.
 * @param {string} lineText
 * @returns {string}
 */
function maskJBasStringsAndComments(lineText) {
  let out = '';
  let inString = false;
  let i = 0;
  const n = lineText.length;

  while (i < n) {
    const c = lineText[i];

    if (c === '"') {
      inString = !inString;
      out += ' ';
      i++;
      continue;
    }

    if (inString) {
      out += ' ';
      i++;
      continue;
    }

    if (c === "'") {
      break;
    }

    if (
      (c === 'R' || c === 'r') &&
      i + 3 <= n &&
      lineText.slice(i, i + 3).toUpperCase() === 'REM'
    ) {
      const prev = i > 0 ? lineText[i - 1] : ' ';
      const next = i + 3 < n ? lineText[i + 3] : ' ';
      if (!/[a-zA-Z0-9_]/.test(prev) && !/[a-zA-Z0-9_]/.test(next)) {
        break;
      }
    }

    out += c;
    i++;
  }

  return out;
}

/**
 * Finds a @label reference at the specified character column on a .jbas line
 * (ignoring strings and comments).
 * @param {string} lineText
 * @param {number} charIndex
 * @returns {{ labelName: string, startCol: number, endCol: number } | null}
 */
function findJBasLabelAtPosition(lineText, charIndex) {
  if (typeof lineText !== 'string' || charIndex < 0 || charIndex > lineText.length) {
    return null;
  }

  const masked = maskJBasStringsAndComments(lineText);
  if (charIndex > masked.length) {
    return null;
  }

  const labelRegex = /@([a-zA-Z0-9_]+)/g;
  let match;
  while ((match = labelRegex.exec(masked)) !== null) {
    const startCol = match.index;
    const endCol = startCol + match[0].length;
    if (charIndex >= startCol && charIndex <= endCol) {
      return {
        labelName: match[1],
        startCol,
        endCol
      };
    }
  }

  return null;
}

/**
 * Finds the definition of `@labelName:` in a .jbas document.
 * Supports leading and chained labels (e.g. `@a: @b: PRINT "HI"`), case-insensitively.
 * @param {string|string[]|{ lineCount: number, lineAt: (i: number) => { text: string } }} documentTextOrLines
 * @param {string} labelName
 * @returns {{ lineIndex: number, startCol: number, endCol: number, labelName: string, text: string } | null}
 */
function findJBasLabelDefinition(documentTextOrLines, labelName) {
  if (!labelName || typeof labelName !== 'string') return null;
  const cleanName = labelName.startsWith('@') ? labelName.slice(1) : labelName;
  if (!cleanName) return null;
  const targetLower = cleanName.toLowerCase();

  const isTextDoc = documentTextOrLines &&
    typeof documentTextOrLines.lineCount === 'number' &&
    typeof documentTextOrLines.lineAt === 'function';

  const lines = isTextDoc
    ? null
    : (Array.isArray(documentTextOrLines)
      ? documentTextOrLines
      : (typeof documentTextOrLines === 'string' ? documentTextOrLines.split(/\r?\n/) : []));

  const count = isTextDoc ? documentTextOrLines.lineCount : lines.length;

  for (let i = 0; i < count; i++) {
    const line = isTextDoc ? documentTextOrLines.lineAt(i).text : lines[i];
    const masked = maskJBasStringsAndComments(line);
    let pos = 0;

    // Scan one or more chained leading label definitions: @label1: @label2: ...
    while (pos < masked.length) {
      while (pos < masked.length && /\s/.test(masked[pos])) {
        pos++;
      }
      const rest = masked.slice(pos);
      const match = rest.match(/^@([a-zA-Z0-9_]+)\s*:/);
      if (!match) {
        break;
      }
      const foundName = match[1];
      const startCol = pos;
      const endCol = pos + 1 + foundName.length;
      if (foundName.toLowerCase() === targetLower) {
        return {
          lineIndex: i,
          startCol,
          endCol,
          labelName: foundName,
          text: line
        };
      }
      pos += match[0].length;
    }
  }

  return null;
}

/**
 * High-level helper: returns definition location for a position in a .jbas file.
 * @param {string|string[]} documentTextOrLines
 * @param {number} lineIndex
 * @param {number} charIndex
 * @returns {{ labelName: string, origin: { startCol: number, endCol: number }, target: { lineIndex: number, startCol: number, endCol: number, labelName: string, text: string } } | null}
 */
function getJBasDefinition(documentTextOrLines, lineIndex, charIndex) {
  const lines = Array.isArray(documentTextOrLines)
    ? documentTextOrLines
    : documentTextOrLines.split(/\r?\n/);

  if (lineIndex < 0 || lineIndex >= lines.length) return null;

  const lineText = lines[lineIndex];
  const labelRef = findJBasLabelAtPosition(lineText, charIndex);
  if (!labelRef) return null;

  const targetLocation = findJBasLabelDefinition(lines, labelRef.labelName);
  if (!targetLocation) return null;

  return {
    labelName: labelRef.labelName,
    origin: {
      startCol: labelRef.startCol,
      endCol: labelRef.endCol
    },
    target: targetLocation
  };
}

module.exports = {
  findBasJumpTargetAtPosition,
  findBasLineIndex,
  getBasDefinition,
  maskJBasStringsAndComments,
  findJBasLabelAtPosition,
  findJBasLabelDefinition,
  getJBasDefinition
};
