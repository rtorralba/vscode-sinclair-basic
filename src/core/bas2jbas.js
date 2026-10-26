// Sinclair BASIC to JBAS Converter
// Copyright (C) 2026 Raül Torralba Adsuara
// Licensed under the GNU Affero General Public License v3.0 or later

let path;
try {
  path = require('path');
} catch {
  path = null;
}

const { splitStringsAndRem } = require('./renumber');

/**
 * Converts a title or label string into a clean snake_case label name.
 * e.g. "Game Over" -> "game_over", "Actualizar Marcador" -> "actualizar_marcador"
 * @param {string} text 
 * @returns {string}
 */
function slugifyTitle(text) {
  let clean = text
    .replace(/^SUB\s+/i, '')
    .replace(/[*#=_\-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!clean) return '';
  if (/^[0-9]/.test(clean)) {
    clean = 'label_' + clean;
  }
  return clean;
}

/**
 * Parses lines of a Sinclair BASIC program.
 * @param {string} basText 
 * @returns {Array<{ lineNum: number, code: string, raw: string, remTitle?: string }>}
 */
function parseBasLines(basText) {
  const rawLines = basText.split(/\r?\n/);
  const parsed = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const match = raw.match(/^\s*(\d+)\s*(.*)$/);
    if (!match) continue;

    const lineNum = parseInt(match[1], 10);
    const code = match[2];

    // Check if line is a REM comment with a title
    let remTitle = '';
    const remMatch = code.match(/^\s*REM\s+(?:SUB\s+)?([A-Za-z0-9\s_\-]+)$/i);
    if (remMatch) {
      remTitle = slugifyTitle(remMatch[1]);
    }

    parsed.push({ lineNum, code, raw, remTitle });
  }

  return parsed;
}

/**
 * Scans code chunks outside strings and REM to find all jump target line numbers.
 * @param {Array<{ lineNum: number, code: string }>} lines 
 * @returns {Map<number, { isSub: boolean, count: number }>}
 */
function findJumpTargets(lines) {
  const targets = new Map();
  const jumpPattern = /\b(GO\s*TO|GOTO|GO\s*SUB|GOSUB|RUN|RESTORE|LINE|THEN)\s+(\d+(?:\s*,\s*\d+)*)/gi;

  for (const line of lines) {
    const chunks = splitStringsAndRem(line.code);
    for (const chunk of chunks) {
      if (chunk.type !== 'code') continue;

      let match;
      jumpPattern.lastIndex = 0;
      while ((match = jumpPattern.exec(chunk.text)) !== null) {
        // Ensure this is not followed by an operator, which means a computed expression (e.g. 10*j, 10+offset)
        const matchEnd = match.index + match[0].length;
        const rest = chunk.text.slice(matchEnd);
        if (/^\s*[*\/+\-^<>=.(a-zA-Z_]/.test(rest)) {
          continue;
        }

        const keyword = match[1].toUpperCase().replace(/\s+/g, '');
        const targetList = match[2];
        const isSub = keyword === 'GOSUB';

        const numbers = targetList.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        for (const num of numbers) {
          const existing = targets.get(num) || { isSub: false, count: 0 };
          existing.count++;
          if (isSub) existing.isSub = true;
          targets.set(num, existing);
        }
      }
    }
  }

  return targets;
}

/**
 * Generates unique @label names for target line numbers.
 * @param {Array<{ lineNum: number, code: string, remTitle?: string }>} lines 
 * @param {Map<number, { isSub: boolean }>} targets 
 * @returns {Map<number, string>} Map from lineNum -> labelName (without '@')
 */
function generateLabels(lines, targets) {
  const lineMap = new Map();
  lines.forEach(l => lineMap.set(l.lineNum, l));

  const labelMap = new Map(); // lineNum -> labelName
  const usedNames = new Set();

  // Helper to register a unique label name
  function assignUnique(lineNum, baseName) {
    let name = baseName || `line_${lineNum}`;
    let candidate = name;
    let counter = 2;
    while (usedNames.has(candidate)) {
      candidate = `${name}_${counter}`;
      counter++;
    }
    usedNames.add(candidate);
    labelMap.set(lineNum, candidate);
  }

  // First pass: lines with explicit REM SUB titles or descriptive REM titles
  for (const [lineNum, info] of targets.entries()) {
    const line = lineMap.get(lineNum);
    if (line && line.remTitle) {
      assignUnique(lineNum, line.remTitle);
    }
  }

  // Second pass: remaining targets
  for (const [lineNum, info] of targets.entries()) {
    if (labelMap.has(lineNum)) continue;

    if (info.isSub) {
      assignUnique(lineNum, `sub_${lineNum}`);
    } else {
      assignUnique(lineNum, `line_${lineNum}`);
    }
  }

  return labelMap;
}

/**
 * Replaces jump target line numbers outside string literals and REM comments with @label.
 * @param {string} code 
 * @param {Map<number, string>} labelMap 
 * @returns {string}
 */
function updateJumpsToLabels(code, labelMap) {
  const chunks = splitStringsAndRem(code);
  const jumpPattern = /\b(GO\s*TO|GOTO|GO\s*SUB|GOSUB|RUN|RESTORE|LINE|THEN)\s+(\d+(?:\s*,\s*\d+)*)/gi;

  const newChunks = chunks.map(chunk => {
    if (chunk.type !== 'code') return chunk.text;

    return chunk.text.replace(jumpPattern, (fullMatch, keyword, targetsStr, offset, string) => {
      // If followed by an operator or identifier, it's a computed expression (e.g. GO TO 10*j)
      const matchEnd = offset + fullMatch.length;
      const rest = string.slice(matchEnd);
      if (/^\s*[*\/+\-^<>=.(a-zA-Z_]/.test(rest)) {
        return fullMatch;
      }

      const parts = targetsStr.split(/(\s*,\s*)/);
      const updatedParts = [];

      for (const part of parts) {
        const trimmed = part.trim();
        if (/^\d+$/.test(trimmed)) {
          const targetNum = parseInt(trimmed, 10);
          if (labelMap.has(targetNum)) {
            const labelName = labelMap.get(targetNum);
            const leading = part.slice(0, part.length - part.trimStart().length);
            const trailing = part.slice(part.trimEnd().length);
            updatedParts.push(`${leading}@${labelName}${trailing}`);
            continue;
          }
        }
        updatedParts.push(part);
      }

      return `${keyword} ${updatedParts.join('')}`;
    });
  });

  return newChunks.join('');
}

/**
 * Converts a REM comment statement in a line to a .jbas single-quote comment ('...).
 * @param {string} lineCode 
 * @returns {string}
 */
function convertRemToSingleQuote(lineCode) {
  const chunks = splitStringsAndRem(lineCode);
  let res = '';

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    if (chunk.type === 'rem') {
      const remText = chunk.text.replace(/^REM\s*/i, '');
      if (res.trim().length === 0) {
        res = `' ${remText}`.trimEnd();
      } else {
        // Strip trailing colon or spaces before inline comment
        res = res.replace(/:\s*$/, '').trimEnd();
        res += ` ' ${remText}`.trimEnd();
      }
      break;
    } else {
      res += chunk.text;
    }
  }

  return res;
}

/**
 * Converts Sinclair BASIC source code (.bas with line numbers) to modern .jbas pseudo-language.
 * 
 * @param {string} basText Sinclair BASIC text with line numbers
 * @param {Object} [options]
 * @param {boolean} [options.convertComments=true] Convert REM to single quote (') comments
 * @param {number} [options.indent=2] Number of spaces to indent code inside label blocks
 * @returns {string} Modern .jbas formatted text
 */
function basToJBas(basText, options = {}) {
  const convertComments = options.convertComments !== false;
  const indentSpaces = typeof options.indent === 'number' ? ' '.repeat(options.indent) : '  ';

  const isCRLF = basText.includes('\r\n');
  const eol = isCRLF ? '\r\n' : '\n';

  const lines = parseBasLines(basText);
  if (lines.length === 0) return '';

  const jumpTargets = findJumpTargets(lines);
  const labelMap = generateLabels(lines, jumpTargets);

  const outputLines = [];
  let inLabelBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let code = line.code;

    // Convert jumps (GO TO 10 -> GO TO @line_10)
    code = updateJumpsToLabels(code, labelMap);

    // Convert REM comments to ' comments if enabled
    if (convertComments) {
      code = convertRemToSingleQuote(code);
    }

    // Check if this line is a label definition target
    if (labelMap.has(line.lineNum)) {
      const labelName = labelMap.get(line.lineNum);

      // Separate routines with an empty line
      if (outputLines.length > 0 && outputLines[outputLines.length - 1] !== '') {
        outputLines.push('');
      }

      outputLines.push(`@${labelName}:`);
      inLabelBlock = true;

      // If the line was solely a REM SUB title that matched our label, we don't need a redundant comment line
      if (line.remTitle && line.code.match(/^\s*REM\s+(?:SUB\s+)?([A-Za-z0-9\s_\-]+)$/i)) {
        // Routine title is already captured by the label header
        continue;
      }

      if (code.trim().length > 0) {
        outputLines.push(`${indentSpaces}${code.trim()}`);
      }
    } else {
      // Regular line without a label
      if (code.trim().length === 0) continue;

      if (inLabelBlock) {
        outputLines.push(`${indentSpaces}${code.trim()}`);
      } else {
        outputLines.push(code.trim());
      }
    }
  }

  return outputLines.join(eol) + eol;
}

module.exports = {
  slugifyTitle,
  parseBasLines,
  findJumpTargets,
  generateLabels,
  updateJumpsToLabels,
  convertRemToSingleQuote,
  basToJBas
};
