// Sinclair BASIC - Debugger Core Engine (ZX Spectrum 48K)
// Copyright (C) 2026 Raül Torralba Adsuara
// Licensed under the GNU Affero General Public License v3.0 or later

/**
 * Address in ZX Spectrum 48K ROM where each BASIC statement is dispatched:
 * At 0x1B3D:
 *   - HL is pushed with return address 0x1B76
 *   - PPC (0x5C45) holds the 16-bit line number (little-endian)
 *   - SUBPPC (0x5C47) holds the 1-based statement index on that line
 */
const ROM48_STMT_ADDR = 0x1B3D;

/**
 * Alternative entry point (0x1B29) used for BREAK checks and loop entry.
 */
const ROM48_LOOP_ADDR = 0x1B29;

/**
 * Decodes Sinclair ZX Spectrum 5-byte floating-point number to a JS number.
 *
 * Format:
 * - If byte 0 is 0: 16-bit integer in bytes 2-3 (sign in byte 1: 0x00 or 0xFF)
 * - Otherwise: exponent = byte 0 - 128, mantissa in bytes 1-4 with implicit highest bit
 */
function decodeSinclairFloat(b0, b1, b2, b3, b4) {
  if (b0 === 0) {
    const sign = (b1 === 0xFF) ? -1 : 1;
    const val = (b2 & 0xFF) | ((b3 & 0xFF) << 8);
    return sign * val;
  }
  const exp = b0 - 128;
  const mant = (((b1 & 0x7F) | 0x80) * 0x1000000) +
               ((b2 & 0xFF) * 0x10000) +
               ((b3 & 0xFF) * 0x100) +
               (b4 & 0xFF);
  let val = mant * Math.pow(2, exp - 31);
  if (b1 & 0x80) val = -val;
  return Math.round(val * 1000000) / 1000000;
}

/**
 * Reads and parses all BASIC variables from ZX Spectrum 48K RAM.
 *
 * @param {Function} readByte Function (addr) => byte (0-255)
 * @returns {Array<Object>} List of variables { name, type, value, ... }
 */
function readSpectrumVariables(readByte) {
  const varsStart = (readByte(0x5C4B) & 0xFF) | ((readByte(0x5C4C) & 0xFF) << 8);
  const vars = [];
  let p = varsStart;
  const maxAddr = 0xFF00; // Safe upper bound for RAM

  while (p < maxAddr) {
    const b = readByte(p);
    // End of variables is marked by 0x80 (128)
    if (b === 0x80 || b === 0xFF || b === 0) break;

    const type = (b >> 5) & 7;
    const letterCode = b & 0x1F;

    if (type === 3) {
      // Single-letter numeric variable: e.g. 'a' to 'z'
      const name = String.fromCharCode(96 + letterCode);
      const val = decodeSinclairFloat(
        readByte(p + 1), readByte(p + 2), readByte(p + 3), readByte(p + 4), readByte(p + 5)
      );
      vars.push({ name, type: 'number', value: val });
      p += 6;
    } else if (type === 5) {
      // Multi-letter numeric variable: e.g. 'py', 'oldpy', 'score'
      let name = String.fromCharCode(96 + letterCode);
      p++;
      while (p < maxAddr) {
        const c = readByte(p);
        name += String.fromCharCode(c & 0x7F);
        p++;
        if (c & 0x80) break; // Last character of the name has bit 7 set
      }
      const val = decodeSinclairFloat(
        readByte(p), readByte(p + 1), readByte(p + 2), readByte(p + 3), readByte(p + 4)
      );
      vars.push({ name, type: 'number', value: val });
      p += 5;
    } else if (type === 2) {
      // String variable: e.g. 'a$' to 'z$'
      const name = String.fromCharCode(96 + letterCode) + '$';
      const len = (readByte(p + 1) & 0xFF) | ((readByte(p + 2) & 0xFF) << 8);
      let str = '';
      for (let i = 0; i < len; i++) {
        const ch = readByte(p + 3 + i);
        if (ch >= 32 && ch <= 126) {
          str += String.fromCharCode(ch);
        } else {
          str += `\\x${ch.toString(16).padStart(2, '0').toUpperCase()}`;
        }
      }
      vars.push({ name, type: 'string', value: str, length: len });
      p += 3 + len;
    } else if (type === 7) {
      // FOR-NEXT control variable
      const name = String.fromCharCode(96 + letterCode);
      const val = decodeSinclairFloat(
        readByte(p + 1), readByte(p + 2), readByte(p + 3), readByte(p + 4), readByte(p + 5)
      );
      const limit = decodeSinclairFloat(
        readByte(p + 6), readByte(p + 7), readByte(p + 8), readByte(p + 9), readByte(p + 10)
      );
      const step = decodeSinclairFloat(
        readByte(p + 11), readByte(p + 12), readByte(p + 13), readByte(p + 14), readByte(p + 15)
      );
      const loopLine = (readByte(p + 16) & 0xFF) | ((readByte(p + 17) & 0xFF) << 8);
      const loopStmt = readByte(p + 18) & 0xFF;
      vars.push({ name, type: 'for', value: val, limit, step, loopLine, loopStmt });
      p += 19;
    } else if (type === 4 || type === 6) {
      // Array variable
      const isString = (type === 6);
      const name = String.fromCharCode(96 + letterCode) + (isString ? '$' : '');
      const len = (readByte(p + 1) & 0xFF) | ((readByte(p + 2) & 0xFF) << 8);
      vars.push({ name, type: isString ? 'string-array' : 'number-array', length: len });
      p += 3 + len;
    } else {
      // Unrecognized structure, terminate cleanly
      break;
    }
  }

  return vars;
}

/**
 * Finds the 0-indexed document line number matching a given Sinclair BASIC line number.
 *
 * @param {string} documentText The full text of the .bas file
 * @param {number} targetBasicLine The BASIC line number to find (e.g. 74)
 * @returns {number} 0-indexed document line number or -1 if not found
 */
function findDocumentLine(documentText, targetBasicLine) {
  if (typeof documentText !== 'string' || typeof targetBasicLine !== 'number') return -1;
  const lines = documentText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*(\d+)/);
    if (match && parseInt(match[1], 10) === targetBasicLine) {
      return i;
    }
  }
  return -1;
}

/**
 * Finds the character range [startCol, endCol] of a given 1-based statement on a BASIC line.
 * Statements are separated by colons ':' that are outside string literals and REM comments.
 *
 * @param {string} lineText The text of the specific line (e.g. '74 LET a=1: LET b=2')
 * @param {number} stmtIndex 1-based statement index
 * @returns {{ startCol: number, endCol: number }}
 */
function findStatementRange(lineText, stmtIndex) {
  if (typeof lineText !== 'string') return { startCol: 0, endCol: 0 };
  
  // Find start of BASIC code past the line number
  const prefixMatch = lineText.match(/^\s*\d+\s*/);
  const codeStart = prefixMatch ? prefixMatch[0].length : 0;
  
  let inString = false;
  let inRem = false;
  const segments = [];
  let segStart = codeStart;

  for (let i = codeStart; i < lineText.length; i++) {
    const ch = lineText[i];
    if (ch === '"') {
      inString = !inString;
    } else if (!inString && !inRem) {
      // Check for REM
      if (lineText.slice(i, i + 3).toUpperCase() === 'REM' &&
          (i === codeStart || /\s|:/.test(lineText[i - 1]))) {
        inRem = true;
      } else if (ch === ':') {
        segments.push({ startCol: segStart, endCol: i });
        segStart = i + 1;
        // Skip leading space after colon
        if (lineText[segStart] === ' ') segStart++;
      }
    }
  }
  // Push the final statement segment
  segments.push({ startCol: segStart, endCol: lineText.length });

  const idx = Math.max(1, stmtIndex) - 1;
  if (idx < segments.length) {
    return segments[idx];
  }
  return { startCol: codeStart, endCol: lineText.length };
}

module.exports = {
  ROM48_STMT_ADDR,
  ROM48_LOOP_ADDR,
  decodeSinclairFloat,
  readSpectrumVariables,
  findDocumentLine,
  findStatementRange
};
