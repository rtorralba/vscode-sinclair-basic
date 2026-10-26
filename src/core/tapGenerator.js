// ZX Story Flow - TAP File Generator
// Copyright (C) 2026 Raül Torralba Adsuara
// Licensed under the GNU Affero General Public License v3.0 or later
// See LICENSE file for details
//
// Converts ZX Spectrum BASIC code (string) to TAP file format (Buffer / ArrayBuffer).
// Implementation based on ZX Spectrum technical documentation.
// 
// Special thanks to Remy Sharp's txt2bas (https://github.com/remy/txt2bas)
// which helped identify and fix some edge cases in the tokenization process.

let fs;
try {
  fs = require('fs');
} catch {
  fs = null;
}

let path;
try {
  path = require('path');
} catch {
  path = null;
}

// ZX Spectrum BASIC keywords to token codes
const KEYWORDS = {
  'RND': 0xA5, 'INKEY$': 0xA6, 'PI': 0xA7, 'FN': 0xA8, 'POINT': 0xA9,
  'SCREEN$': 0xAA, 'ATTR': 0xAB, 'AT': 0xAC, 'TAB': 0xAD, 'VAL$': 0xAE,
  'CODE': 0xAF, 'VAL': 0xB0, 'LEN': 0xB1, 'SIN': 0xB2, 'COS': 0xB3,
  'TAN': 0xB4, 'ASN': 0xB5, 'ACS': 0xB6, 'ATN': 0xB7, 'LN': 0xB8,
  'EXP': 0xB9, 'INT': 0xBA, 'SQR': 0xBB, 'SGN': 0xBC, 'ABS': 0xBD,
  'PEEK': 0xBE, 'IN': 0xBF, 'USR': 0xC0, 'STR$': 0xC1, 'CHR$': 0xC2,
  'NOT': 0xC3, 'BIN': 0xC4, 'OR': 0xC5, 'AND': 0xC6, '<=': 0xC7,
  '>=': 0xC8, '<>': 0xC9, 'LINE': 0xCA, 'THEN': 0xCB, 'TO': 0xCC,
  'STEP': 0xCD, 'DEF FN': 0xCE, 'CAT': 0xCF, 'FORMAT': 0xD0, 'MOVE': 0xD1,
  'ERASE': 0xD2, 'OPEN #': 0xD3, 'CLOSE #': 0xD4, 'MERGE': 0xD5, 'VERIFY': 0xD6,
  'BEEP': 0xD7, 'CIRCLE': 0xD8, 'INK': 0xD9, 'PAPER': 0xDA, 'FLASH': 0xDB,
  'BRIGHT': 0xDC, 'INVERSE': 0xDD, 'OVER': 0xDE, 'OUT': 0xDF, 'LPRINT': 0xE0,
  'LLIST': 0xE1, 'STOP': 0xE2, 'READ': 0xE3, 'DATA': 0xE4, 'RESTORE': 0xE5,
  'NEW': 0xE6, 'BORDER': 0xE7, 'CONTINUE': 0xE8, 'DIM': 0xE9, 'REM': 0xEA,
  'FOR': 0xEB, 'GO TO': 0xEC, 'GOTO': 0xEC, 'GO SUB': 0xED, 'GOSUB': 0xED,
  'INPUT': 0xEE, 'LOAD': 0xEF, 'LIST': 0xF0, 'LET': 0xF1, 'PAUSE': 0xF2,
  'NEXT': 0xF3, 'POKE': 0xF4, 'PRINT': 0xF5, 'PLOT': 0xF6, 'RUN': 0xF7,
  'SAVE': 0xF8, 'RANDOMIZE': 0xF9, 'IF': 0xFA, 'CLS': 0xFB, 'DRAW': 0xFC,
  'CLEAR': 0xFD, 'RETURN': 0xFE, 'COPY': 0xFF
};

// Calculate XOR checksum
function calculateXORChecksum(data) {
  return data.reduce((checksum, item) => checksum ^ item, 0);
}

// Create a TAP block with length (2 bytes), flag (1 byte), data (N bytes), and checksum (1 byte)
function createTapBlock(flag, data) {
  const checksum = calculateXORChecksum(new Uint8Array([flag, ...data]));
  const blockLen = data.length + 2; // Flag + Checksum
  const buffer = new Uint8Array(2 + blockLen);
  buffer[0] = blockLen & 0xFF;
  buffer[1] = (blockLen >> 8) & 0xFF;
  buffer[2] = flag;
  buffer.set(data, 3);
  buffer[buffer.length - 1] = checksum;
  return buffer;
}

// Encode a number in ZX Spectrum 5-byte hidden format (integer or float)
function encodeNumber(val) {
  if (val === 0) {
    return [0x0E, 0x00, 0x00, 0x00, 0x00, 0x00];
  }
  // Check if it's an integer in -65535..65535
  if (Number.isInteger(val) && val >= -65535 && val <= 65535) {
    const sign = val < 0 ? 0xFF : 0x00;
    const unsigned = val < 0 ? (0x10000 + val) : val;
    return [0x0E, 0x00, sign, unsigned & 0xFF, (unsigned >> 8) & 0xFF, 0x00];
  }

  // Floating point format
  let sign = 0;
  let absVal = val;
  if (absVal < 0) {
    sign = 0x80;
    absVal = -absVal;
  }
  const exp = Math.floor(Math.log2(absVal)) + 1;
  const mantissa = absVal / Math.pow(2, exp); // in [0.5, 1)
  const expByte = exp + 128;
  if (expByte < 0 || expByte > 255) {
    return [0x0E, 0x00, 0x00, 0x00, 0x00, 0x00];
  }
  let m = Math.round(mantissa * 4294967296);
  if (m >= 4294967296) {
    m = 4294967295;
  }
  const b1 = ((m >>> 24) & 0x7F) | sign;
  const b2 = (m >>> 16) & 0xFF;
  const b3 = (m >>> 8) & 0xFF;
  const b4 = m & 0xFF;
  return [0x0E, expByte, b1, b2, b3, b4];
}

// Tokenize a line of BASIC code
function tokenizeLine(line) {
  const res = [];
  let i = 0;
  let afterBin = false;
  const keys = Object.keys(KEYWORDS).sort((a, b) => b.length - a.length);

  while (i < line.length) {
    // Strings in double quotes
    if (line[i] === '"') {
      afterBin = false;
      res.push(line.charCodeAt(i));
      i++;
      while (i < line.length && line[i] !== '"') {
        // Control sequences or UDG in {...} format (matching bas2tap)
        if (line[i] === '{') {
          const closeIdx = line.indexOf('}', i + 1);
          const nextQuote = line.indexOf('"', i + 1);
          if (closeIdx !== -1 && (nextQuote === -1 || closeIdx < nextQuote)) {
            const content = line.slice(i + 1, closeIdx).trim();
            const upper = content.toUpperCase();

            // 1. Single letter UDG {A}..{U}
            if (content.length === 1 && upper >= 'A' && upper <= 'U') {
              res.push(144 + upper.charCodeAt(0) - 65);
              i = closeIdx + 1;
              continue;
            }

            // 2. Control codes: INK, PAPER, FLASH, BRIGHT, INVERSE, OVER
            let m = upper.match(/^INK\s+(\d+)$/);
            if (m) {
              res.push(16, parseInt(m[1], 10) & 0xFF);
              i = closeIdx + 1;
              continue;
            }
            m = upper.match(/^PAPER\s+(\d+)$/);
            if (m) {
              res.push(17, parseInt(m[1], 10) & 0xFF);
              i = closeIdx + 1;
              continue;
            }
            m = upper.match(/^FLASH\s+(\d+)$/);
            if (m) {
              res.push(18, parseInt(m[1], 10) & 0xFF);
              i = closeIdx + 1;
              continue;
            }
            m = upper.match(/^BRIGHT\s+(\d+)$/);
            if (m) {
              res.push(19, parseInt(m[1], 10) & 0xFF);
              i = closeIdx + 1;
              continue;
            }
            m = upper.match(/^INVERSE\s+(\d+)$/);
            if (m) {
              res.push(20, parseInt(m[1], 10) & 0xFF);
              i = closeIdx + 1;
              continue;
            }
            m = upper.match(/^OVER\s+(\d+)$/);
            if (m) {
              res.push(21, parseInt(m[1], 10) & 0xFF);
              i = closeIdx + 1;
              continue;
            }
            m = upper.match(/^AT\s+(\d+)\s*,\s*(\d+)$/);
            if (m) {
              res.push(22, parseInt(m[1], 10) & 0xFF, parseInt(m[2], 10) & 0xFF);
              i = closeIdx + 1;
              continue;
            }
            m = upper.match(/^TAB\s+(\d+)(?:\s*,\s*(\d+))?$/);
            if (m) {
              if (m[2] !== undefined) {
                res.push(23, parseInt(m[1], 10) & 0xFF, parseInt(m[2], 10) & 0xFF);
              } else {
                const tabVal = parseInt(m[1], 10);
                res.push(23, tabVal & 0xFF, (tabVal >> 8) & 0xFF);
              }
              i = closeIdx + 1;
              continue;
            }
            m = upper.match(/^CODE\s+(\d+)$/);
            if (m) {
              res.push(parseInt(m[1], 10) & 0xFF);
              i = closeIdx + 1;
              continue;
            }
            m = upper.match(/^#([0-9A-F]{1,2})$/);
            if (m) {
              res.push(parseInt(m[1], 16) & 0xFF);
              i = closeIdx + 1;
              continue;
            }
            m = upper.match(/^\\X([0-9A-F]{1,2})$/);
            if (m) {
              res.push(parseInt(m[1], 16) & 0xFF);
              i = closeIdx + 1;
              continue;
            }
          }
        }

        // Backslash escapes: \A..\U, \xHH, \\, \"
        if (line[i] === '\\') {
          // UDG in \A..\U format
          if (i + 1 < line.length) {
            const udg = line[i + 1].toUpperCase();
            const code = udg.charCodeAt(0);
            if (code >= 65 && code <= 85) {
              res.push(144 + code - 65);
              i += 2;
              continue;
            }
          }
          // Hex escape \xHH
          const hexMatch = line.slice(i).match(/^\\x([0-9a-fA-F]{2})/i);
          if (hexMatch) {
            res.push(parseInt(hexMatch[1], 16) & 0xFF);
            i += 4;
            continue;
          }
          // Escaped backslash \\ or escaped quote \"
          if (i + 1 < line.length && (line[i + 1] === '\\' || line[i + 1] === '"')) {
            res.push(line.charCodeAt(i + 1));
            i += 2;
            continue;
          }
        }
        res.push(line.charCodeAt(i));
        i++;
      }
      if (i < line.length) {
        res.push(line.charCodeAt(i));
        i++;
        while (i < line.length && line[i] === ' ') {
          i++;
        }
      }
      continue;
    }

    // Colon statement separator: consume trailing whitespace (matching standard Sinclair BASIC and bas2tap)
    if (line[i] === ':') {
      afterBin = false;
      res.push(0x3A);
      i++;
      while (i < line.length && line[i] === ' ') {
        i++;
      }
      continue;
    }

    // Control codes or UDG outside quotes in {...} format
    if (line[i] === '{') {
      const closeIdx = line.indexOf('}', i + 1);
      if (closeIdx !== -1) {
        const content = line.slice(i + 1, closeIdx).trim();
        const upper = content.toUpperCase();

        let m = upper.match(/^CODE\s+(\d+)$/);
        if (m) {
          res.push(parseInt(m[1], 10) & 0xFF);
          i = closeIdx + 1;
          continue;
        }
        m = upper.match(/^#([0-9A-F]{1,2})$/);
        if (m) {
          res.push(parseInt(m[1], 16) & 0xFF);
          i = closeIdx + 1;
          continue;
        }
        m = upper.match(/^\\X([0-9A-F]{1,2})$/);
        if (m) {
          res.push(parseInt(m[1], 16) & 0xFF);
          i = closeIdx + 1;
          continue;
        }
        if (content.length === 1 && upper >= 'A' && upper <= 'U') {
          res.push(144 + upper.charCodeAt(0) - 65);
          i = closeIdx + 1;
          continue;
        }
        if (content === '(c)' || content === '(C)') {
          res.push(0x7F);
          i = closeIdx + 1;
          continue;
        }
      }
    }

    const sub = line.substr(i);
    // Match integer or floating point number
    const matchNum = sub.match(/^(\d+(?:\.\d+)?|\.\d+)/);
    if (matchNum) {
      const prev = i > 0 ? line[i - 1] : ' ';
      if (!/[A-Za-z0-9_]/.test(prev)) {
        const str = matchNum[1];
        const val = afterBin ? parseInt(str, 2) : parseFloat(str);
        afterBin = false;
        for (let k = 0; k < str.length; k++) {
          res.push(str.charCodeAt(k));
        }
        const hidden = encodeNumber(val);
        hidden.forEach(b => res.push(b));
        i += str.length;
        continue;
      }
    }

    let found = false;
    const subUpper = sub.toUpperCase();
    for (const k of keys) {
      if (subUpper.startsWith(k)) {
        const startsWithAlpha = /^[A-Za-z0-9]/.test(k);
        const endsWithAlpha = /[A-Za-z0-9]$/.test(k);

        // If keyword starts with alphanumeric char, ensure preceding char is not alphanumeric
        if (startsWithAlpha) {
          const prevChar = i > 0 ? line[i - 1] : ' ';
          if (/[A-Za-z0-9_]/.test(prevChar)) continue;
        }

        // If keyword ends with alphanumeric char, ensure succeeding char is not alphanumeric
        if (endsWithAlpha) {
          const endChar = line[i + k.length];
          if (endChar && /[A-Za-z0-9_]/.test(endChar)) continue;
        }

        const token = KEYWORDS[k];
        res.push(token);

        // If REM keyword, skip trailing spaces after REM, then copy rest of line as raw ASCII
        if (token === 0xEA) {
          i += k.length;
          while (i < line.length && line[i] === ' ') {
            i++;
          }
          while (i < line.length) {
            res.push(line.charCodeAt(i));
            i++;
          }
          found = true;
          break;
        }

        afterBin = (token === 0xC4);
        i += k.length;
        // In the ZX Spectrum ROM, keywords automatically include trailing spaces when
        // listed or printed. Therefore, trailing spaces following keywords in the source text
        // must be consumed so that duplicate spaces are not introduced (e.g. LET py=0, CHR$ 18).
        while (i < line.length && line[i] === ' ') {
          i++;
        }
        found = true;
        break;
      }
    }
    if (found) continue;

    if (line[i] !== ' ') afterBin = false;
    res.push(line.charCodeAt(i));
    i++;
  }

  // End of line in ZX Spectrum BASIC (0x0D Enter)
  res.push(0x0D);
  return res;
}

/**
 * Normalizes a tap block filename (max 10 characters).
 * @param {string} fname 
 * @returns {string}
 */
function normalizeFileName(fname) {
  const base = path.basename(fname);
  const clean = base.replace(/\.[^.]+$/, '').toLowerCase();
  return clean.slice(0, 10);
}

/**
 * Parse control codes like {(c)}
 * @param {string} basicCode 
 * @returns {string}
 */
function parseControlCodes(basicCode) {
  return basicCode.replace(/\{(\(c\))\}/gi, "\x7F");
}

/**
 * Compiles a Sinclair BASIC text program into TAP blocks.
 * 
 * @param {string} basicCode BASIC source code text with line numbers.
 * @param {string} [filename="program"] Tape header name (up to 10 chars).
 * @param {number} [autostart=0] Autostart line number (0 = auto-detect first line).
 * @returns {Uint8Array[]} Array of TAP blocks (header + data).
 */
function bas2tap(basicCode, filename = "program", autostart = 0) {
  const code = parseControlCodes(basicCode);

  // Split only by unquoted new lines
  const lines = code.split(/\r?\n(?=(?:[^"]*"[^"]*")*[^"]*$)/).filter(l => l.trim().length > 0);
  const plainData = [];
  let detectedFirstLine = 10;
  let hasDetectedFirstLine = false;

  lines.forEach(line => {
    const l = line.replace(/^\s+/, '');
    const match = l.match(/^(\d+)\s*(.*)$/s);
    if (!match) return;

    const lineNum = parseInt(match[1], 10);
    const content = match[2];

    if (!hasDetectedFirstLine) {
      detectedFirstLine = lineNum;
      hasDetectedFirstLine = true;
    }

    const tokens = tokenizeLine(content);
    plainData.push((lineNum >> 8) & 0xFF);
    plainData.push(lineNum & 0xFF);
    const len = tokens.length;
    plainData.push(len & 0xFF);
    plainData.push((len >> 8) & 0xFF);
    tokens.forEach(t => plainData.push(t));
  });

  const dataUint = new Uint8Array(plainData);

  // Header Data Payload (17 bytes)
  // Type 0x00 = Program
  const headerData = new Uint8Array(17);
  headerData[0] = 0x00;

  const fname = (normalizeFileName(filename) + '          ').slice(0, 10);
  for (let i = 0; i < 10; i++) {
    headerData[i + 1] = fname.charCodeAt(i);
  }

  const len = dataUint.length;
  headerData[11] = len & 0xFF;
  headerData[12] = (len >> 8) & 0xFF;

  const autoLine = (typeof autostart === 'number' && autostart > 0) ? autostart : detectedFirstLine;
  headerData[13] = autoLine & 0xFF;
  headerData[14] = (autoLine >> 8) & 0xFF;

  headerData[15] = len & 0xFF;
  headerData[16] = (len >> 8) & 0xFF;

  const headerBlock = createTapBlock(0x00, headerData);
  const dataBlock = createTapBlock(0xFF, dataUint);

  return [headerBlock, dataBlock];
}

/**
 * Converts a list of TAP blocks into a contiguous ArrayBuffer/Buffer.
 * @param {Uint8Array[]} blocks 
 * @returns {Buffer}
 */
function tap2buffer(blocks) {
  let totalLen = 0;
  blocks.forEach(b => { totalLen += b.length; });
  const tapData = new Uint8Array(totalLen);
  let offset = 0;
  blocks.forEach(b => {
    tapData.set(b, offset);
    offset += b.length;
  });
  return typeof Buffer !== 'undefined' ? Buffer.from(tapData.buffer) : tapData;
}

/**
 * Compiles BASIC code directly to a .tap file on disk.
 * 
 * @param {string} basicCode 
 * @param {string} targetTapPath 
 * @param {Object} [options]
 * @param {string} [options.filename] Tape block name
 * @param {number} [options.autostart] Autostart line number
 * @returns {{ tapPath: string, autoStartLine: number, bytesCount: number, data: Uint8Array }}
 */
function generateTapFile(basicCode, targetTapPath, options = {}) {
  const baseName = options.filename || (path ? path.basename(targetTapPath, '.tap') : 'program');
  const autostart = options.autostart || 0;

  const blocks = bas2tap(basicCode, baseName, autostart);
  const buffer = tap2buffer(blocks);

  if (fs && path) {
    const dir = path.dirname(targetTapPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetTapPath, buffer);
  }

  // Read back actual autostart line from header
  const autoStartLine = blocks[0][3 + 13] | (blocks[0][3 + 14] << 8);

  return {
    tapPath: targetTapPath,
    autoStartLine,
    bytesCount: buffer.length,
    data: buffer
  };
}

module.exports = {
  KEYWORDS,
  tokenizeLine,
  createTapBlock,
  encodeNumber,
  bas2tap,
  tap2buffer,
  generateTapFile
};
