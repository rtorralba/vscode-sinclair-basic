// Sinclair BASIC TAP Decoder & Importer
// Copyright (C) 2026 Raül Torralba Adsuara
// Licensed under the GNU Affero General Public License v3.0 or later
//
// Decodes ZX Spectrum .tap files back to standard Sinclair BASIC (.bas)
// and modern pseudo-Sinclair BASIC (.jbas).

const { KEYWORDS } = require('./tapGenerator');
const { decodeSinclairFloat } = require('./debugger');
const { basToJBas } = require('./bas2jbas');

// Reverse mapping from byte code (0xA5..0xFF) to Sinclair BASIC keyword string
const TOKEN_TO_KEYWORD = {
  0xA5: 'RND', 0xA6: 'INKEY$', 0xA7: 'PI', 0xA8: 'FN', 0xA9: 'POINT',
  0xAA: 'SCREEN$', 0xAB: 'ATTR', 0xAC: 'AT', 0xAD: 'TAB', 0xAE: 'VAL$',
  0xAF: 'CODE', 0xB0: 'VAL', 0xB1: 'LEN', 0xB2: 'SIN', 0xB3: 'COS',
  0xB4: 'TAN', 0xB5: 'ASN', 0xB6: 'ACS', 0xB7: 'ATN', 0xB8: 'LN',
  0xB9: 'EXP', 0xBA: 'INT', 0xBB: 'SQR', 0xBC: 'SGN', 0xBD: 'ABS',
  0xBE: 'PEEK', 0xBF: 'IN', 0xC0: 'USR', 0xC1: 'STR$', 0xC2: 'CHR$',
  0xC3: 'NOT', 0xC4: 'BIN', 0xC5: 'OR', 0xC6: 'AND', 0xC7: '<=',
  0xC8: '>=', 0xC9: '<>', 0xCA: 'LINE', 0xCB: 'THEN', 0xCC: 'TO',
  0xCD: 'STEP', 0xCE: 'DEF FN', 0xCF: 'CAT', 0xD0: 'FORMAT', 0xD1: 'MOVE',
  0xD2: 'ERASE', 0xD3: 'OPEN #', 0xD4: 'CLOSE #', 0xD5: 'MERGE', 0xD6: 'VERIFY',
  0xD7: 'BEEP', 0xD8: 'CIRCLE', 0xD9: 'INK', 0xDA: 'PAPER', 0xDB: 'FLASH',
  0xDC: 'BRIGHT', 0xDD: 'INVERSE', 0xDE: 'OVER', 0xDF: 'OUT', 0xE0: 'LPRINT',
  0xE1: 'LLIST', 0xE2: 'STOP', 0xE3: 'READ', 0xE4: 'DATA', 0xE5: 'RESTORE',
  0xE6: 'NEW', 0xE7: 'BORDER', 0xE8: 'CONTINUE', 0xE9: 'DIM', 0xEA: 'REM',
  0xEB: 'FOR', 0xEC: 'GO TO', 0xED: 'GO SUB', 0xEE: 'INPUT', 0xEF: 'LOAD',
  0xF0: 'LIST', 0xF1: 'LET', 0xF2: 'PAUSE', 0xF3: 'NEXT', 0xF4: 'POKE',
  0xF5: 'PRINT', 0xF6: 'PLOT', 0xF7: 'RUN', 0xF8: 'SAVE', 0xF9: 'RANDOMIZE',
  0xFA: 'IF', 0xFB: 'CLS', 0xFC: 'DRAW', 0xFD: 'CLEAR', 0xFE: 'RETURN', 0xFF: 'COPY'
};

// Statements that do not take arguments
const NO_ARG_STATEMENTS = new Set(['CLS', 'STOP', 'RETURN', 'COPY', 'CONTINUE', 'NEW']);

// Functions that do not take arguments
const NO_ARG_FUNCTIONS = new Set(['RND', 'PI', 'INKEY$']);

/**
 * Parses raw TAP buffer into an array of blocks.
 * Each block: { flag: number, payload: Uint8Array, checksum: number, rawLength: number }
 * 
 * @param {Uint8Array|Buffer|Array<number>} tapData 
 * @returns {Array<{ flag: number, payload: Uint8Array, checksum: number, rawLength: number }>}
 */
function parseTapBlocks(tapData) {
  const bytes = tapData instanceof Uint8Array ? tapData : new Uint8Array(tapData);
  const blocks = [];
  let offset = 0;

  while (offset + 2 <= bytes.length) {
    const blockLen = bytes[offset] | (bytes[offset + 1] << 8);
    offset += 2;
    if (blockLen <= 0 || offset + blockLen > bytes.length) {
      break;
    }
    const flag = bytes[offset];
    const payload = bytes.slice(offset + 1, offset + blockLen - 1);
    const checksum = bytes[offset + blockLen - 1];

    blocks.push({
      flag,
      payload,
      checksum,
      rawLength: blockLen
    });

    offset += blockLen;
  }

  return blocks;
}

/**
 * Detokenizes the raw bytes of a Sinclair BASIC line into human-readable text.
 * 
 * @param {Uint8Array|Array<number>} lineBytes Raw bytes ending with 0x0D (Enter)
 * @returns {string} Detokenized line text (without line number)
 */
function detokenizeLine(lineBytes) {
  const bytes = lineBytes instanceof Uint8Array ? lineBytes : new Uint8Array(lineBytes);
  const len = bytes.length;
  let res = '';
  let i = 0;
  let inString = false;
  let inRem = false;

  while (i < len) {
    const b = bytes[i];

    // 0x0D (Enter / End of line)
    if (b === 0x0D) {
      break;
    }

    // Number marker (0x0E): 5-byte hidden representation follows
    if (b === 0x0E && i + 5 < len) {
      // Check if ASCII digits were already emitted immediately before 0x0E
      const hasPrecedingDigits = /(?:\d|\.\d+)$/.test(res);
      if (!hasPrecedingDigits) {
        // Protected / hidden number: decode the 5 bytes directly
        const numVal = decodeSinclairFloat(
          bytes[i + 1],
          bytes[i + 2],
          bytes[i + 3],
          bytes[i + 4],
          bytes[i + 5]
        );
        res += String(numVal);
      }
      i += 6;
      continue;
    }

    // Double quote handling (string literals)
    if (b === 0x22) { // '"'
      if (!inRem) {
        if (!inString) {
          // Opening quote: if preceded by alphanumeric char or closing paren, add space
          if (res.length > 0 && /[a-zA-Z0-9)]$/.test(res)) {
            res += ' ';
          }
          inString = true;
          res += '"';
          i++;
          continue;
        } else {
          // Inside string: check for escaped double quote ("")
          if (i + 1 < len && bytes[i + 1] === 0x22) {
            res += '""';
            i += 2;
            continue;
          }
          inString = false;
          res += '"';
          i++;
          continue;
        }
      }
    }

    // Inside string literals: parse control codes and characters
    if (inString) {
      // INK (16)
      if (b === 16 && i + 1 < len) {
        res += `{INK ${bytes[i + 1]}}`;
        i += 2;
        continue;
      }
      // PAPER (17)
      if (b === 17 && i + 1 < len) {
        res += `{PAPER ${bytes[i + 1]}}`;
        i += 2;
        continue;
      }
      // FLASH (18)
      if (b === 18 && i + 1 < len) {
        res += `{FLASH ${bytes[i + 1]}}`;
        i += 2;
        continue;
      }
      // BRIGHT (19)
      if (b === 19 && i + 1 < len) {
        res += `{BRIGHT ${bytes[i + 1]}}`;
        i += 2;
        continue;
      }
      // INVERSE (20)
      if (b === 20 && i + 1 < len) {
        res += `{INVERSE ${bytes[i + 1]}}`;
        i += 2;
        continue;
      }
      // OVER (21)
      if (b === 21 && i + 1 < len) {
        res += `{OVER ${bytes[i + 1]}}`;
        i += 2;
        continue;
      }
      // AT (22)
      if (b === 22 && i + 2 < len) {
        res += `{AT ${bytes[i + 1]},${bytes[i + 2]}}`;
        i += 3;
        continue;
      }
      // TAB (23)
      if (b === 23 && i + 2 < len) {
        const tabVal = bytes[i + 1] | (bytes[i + 2] << 8);
        res += `{TAB ${tabVal}}`;
        i += 3;
        continue;
      }
      // UDGs {A}..{U} (144..164)
      if (b >= 144 && b <= 164) {
        const udg = String.fromCharCode(65 + (b - 144));
        res += `{${udg}}`;
        i++;
        continue;
      }
      // Copyright symbol (0x7F)
      if (b === 0x7F) {
        res += '{(c)}';
        i++;
        continue;
      }
      // British Pound (0x60 in Spectrum charset)
      if (b === 0x60) {
        res += '£';
        i++;
        continue;
      }
      // Printable ASCII
      if (b >= 32 && b <= 126) {
        res += String.fromCharCode(b);
        i++;
        continue;
      }
      // Fallback for non-printable control characters
      res += `{CODE ${b}}`;
      i++;
      continue;
    }

    // REM keyword (0xEA)
    if (b === 0xEA && !inRem) {
      inRem = true;
      if (res.length > 0 && !res.endsWith(' ') && !res.endsWith(':')) {
        res += ' ';
      }
      res += 'REM';
      i++;
      if (i < len && bytes[i] === 0x20) {
        res += ' ';
        i++;
      } else if (i < len && bytes[i] !== 0x0D) {
        res += ' ';
      }
      continue;
    }

    // Inside REM comments: output comment text until 0x0D
    if (inRem) {
      if (b >= 32 && b <= 126) {
        res += String.fromCharCode(b);
      } else if (b >= 144 && b <= 164) {
        res += `{${String.fromCharCode(65 + (b - 144))}}`;
      } else if (b === 0x7F) {
        res += '{(c)}';
      } else if (b >= 0xA5 && b <= 0xFF) {
        // In Spectrum ROM, keywords in REM are detokenized
        res += TOKEN_TO_KEYWORD[b] || `{CODE ${b}}`;
      } else {
        res += `{CODE ${b}}`;
      }
      i++;
      continue;
    }

    // Control codes outside strings (INK, PAPER, FLASH, BRIGHT, INVERSE, OVER, AT, TAB)
    // In Spectrum programs, retro coders sometimes embed control bytes outside strings for visual coloring
    // in LIST or banner lines. We convert them to valid Sinclair BASIC statements so the program runs cleanly!
    if (b >= 16 && b <= 21 && i + 1 < len) {
      const kw = b === 16 ? 'INK' : b === 17 ? 'PAPER' : b === 18 ? 'FLASH' : b === 19 ? 'BRIGHT' : b === 20 ? 'INVERSE' : 'OVER';
      const val = bytes[i + 1];
      if (res.length > 0 && !res.endsWith(': ') && !res.endsWith(' ')) {
        res += ': ';
      }
      res += `${kw} ${val}`;
      i += 2;
      const nextByte = i < len ? bytes[i] : 0x0D;
      if (nextByte !== 0x0D && nextByte !== 0x3A) {
        res += ': ';
      }
      continue;
    }

    if (b === 22 && i + 2 < len) {
      const row = bytes[i + 1];
      const col = bytes[i + 2];
      if (res.length > 0 && !res.endsWith(': ') && !res.endsWith(' ')) {
        res += ': ';
      }
      res += `PRINT AT ${row},${col};`;
      i += 3;
      const nextByte = i < len ? bytes[i] : 0x0D;
      if (nextByte !== 0x0D && nextByte !== 0x3A) {
        res += ' ';
      }
      continue;
    }

    if (b === 23 && i + 2 < len) {
      const tabVal = bytes[i + 1] | (bytes[i + 2] << 8);
      if (res.length > 0 && !res.endsWith(': ') && !res.endsWith(' ')) {
        res += ': ';
      }
      res += `PRINT TAB ${tabVal};`;
      i += 3;
      const nextByte = i < len ? bytes[i] : 0x0D;
      if (nextByte !== 0x0D && nextByte !== 0x3A) {
        res += ' ';
      }
      continue;
    }

    // Colon statement separator (0x3A)
    if (b === 0x3A) {
      res = res.trimEnd() + ': ';
      i++;
      while (i < len && bytes[i] === 0x20) {
        i++;
      }
      continue;
    }

    // Keywords (0xA5..0xFF)
    if (b >= 0xA5 && b <= 0xFF) {
      const kw = TOKEN_TO_KEYWORD[b];
      if (kw) {
        // Leading space: if previous character is alphanumeric, quote, or symbol
        if (res.length > 0 && !res.endsWith(' ') && !res.endsWith(':') && !res.endsWith('(')) {
          res += ' ';
        }

        res += kw;

        // Trailing space handling
        const nextByte = i + 1 < len ? bytes[i + 1] : 0x0D;

        if (kw === 'AND' || kw === 'OR') {
          res += ' ';
        } else if (kw === '<=' || kw === '>=' || kw === '<>') {
          // No trailing space needed for comparison operators
        } else if (NO_ARG_STATEMENTS.has(kw) || NO_ARG_FUNCTIONS.has(kw)) {
          // No trailing space needed
        } else if (kw === 'DEF FN') {
          res += ' ';
        } else {
          // Keyword statement or function with argument
          if (nextByte !== 0x0D && nextByte !== 0x3A && nextByte !== 0x20) {
            if (nextByte === 0x28) { // '('
              // e.g. SIN(x), CHR$(n) -> no space before '('
            } else {
              res += ' ';
            }
          }
        }

        i++;
        // Skip duplicate spaces in input if any
        while (i < len && bytes[i] === 0x20) {
          i++;
        }
        continue;
      }
    }

    // Space (0x20)
    if (b === 0x20) {
      if (!res.endsWith(' ')) {
        res += ' ';
      }
      i++;
      continue;
    }

    // Copyright symbol (0x7F)
    if (b === 0x7F) {
      res += '{(c)}';
      i++;
      continue;
    }

    // British Pound (0x60 in Spectrum charset)
    if (b === 0x60) {
      res += '£';
      i++;
      continue;
    }

    // Regular ASCII printable character (32..126)
    if (b >= 32 && b <= 126) {
      res += String.fromCharCode(b);
      i++;
      continue;
    }

    // UDGs {A}..{U}
    if (b >= 144 && b <= 164) {
      res += `{${String.fromCharCode(65 + (b - 144))}}`;
      i++;
      continue;
    }

    // Fallback
    res += `{CODE ${b}}`;
    i++;
  }

  return res.trimEnd();
}

/**
 * Decodes a Sinclair BASIC data block payload into an array of lines and formatted BASIC text.
 * 
 * @param {Uint8Array} payload The data block payload (flag byte 0xFF already stripped)
 * @param {number} [varOffset=0] Program length in bytes (ignoring variables after varOffset)
 * @returns {{ lines: Array<{ lineNum: number, text: string }>, basText: string }}
 */
function decodeBasicProgram(payload, varOffset = 0) {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const maxLen = (varOffset > 0 && varOffset <= bytes.length) ? varOffset : bytes.length;
  const lines = [];
  let offset = 0;

  while (offset + 4 <= maxLen) {
    const lineNum = (bytes[offset] << 8) | bytes[offset + 1];
    const lineLen = bytes[offset + 2] | (bytes[offset + 3] << 8);
    offset += 4;

    // Line number out of range (Spectrum BASIC lines: 0..9999).
    // In RAM, values >= 16384 mark start of variable area.
    if (lineNum > 9999 || lineLen <= 0 || offset + lineLen > bytes.length) {
      break;
    }

    const lineBytes = bytes.slice(offset, offset + lineLen);
    offset += lineLen;

    const text = detokenizeLine(lineBytes);
    lines.push({
      lineNum,
      text,
      fullLine: `${lineNum} ${text}`
    });
  }

  const basText = lines.map(l => l.fullLine).join('\n') + (lines.length > 0 ? '\n' : '');
  return { lines, basText };
}

/**
 * Extracts all Sinclair BASIC programs found in a TAP file.
 * Pairs Program headers (flag 0x00, type 0) with their following Data blocks (flag 0xFF).
 * Also falls back to scanning raw data blocks if no headers exist.
 * 
 * @param {Uint8Array|Buffer|Array<number>} tapBuffer 
 * @returns {Array<{ name: string, autostart: number, varOffset: number, basText: string, jbasText: string, linesCount: number }>}
 */
function extractProgramsFromTap(tapBuffer) {
  const blocks = parseTapBlocks(tapBuffer);
  const programs = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];

    // Check for Program Header (flag 0x00, payload length 17, type byte 0x00)
    if (b.flag === 0x00 && b.payload.length >= 17 && b.payload[0] === 0x00) {
      // Filename in bytes 1..10
      let name = '';
      for (let c = 1; c <= 10; c++) {
        name += String.fromCharCode(b.payload[c]);
      }
      name = name.trim() || 'program';

      const autostart = b.payload[13] | (b.payload[14] << 8);
      const varOffset = b.payload[15] | (b.payload[16] << 8);

      // Next block should be Data block (flag 0xFF)
      let dataBlock = null;
      if (i + 1 < blocks.length && blocks[i + 1].flag === 0xFF) {
        dataBlock = blocks[i + 1];
        i++; // skip data block
      }

      if (dataBlock) {
        const decoded = decodeBasicProgram(dataBlock.payload, varOffset);
        if (decoded.lines.length > 0) {
          const jbasText = basToJBas(decoded.basText);
          programs.push({
            name,
            autostart: autostart < 32768 ? autostart : 0,
            varOffset,
            basText: decoded.basText,
            jbasText,
            linesCount: decoded.lines.length
          });
        }
      }
    }
  }

  // Fallback: If no header blocks found, check if any data block contains a valid BASIC program
  if (programs.length === 0) {
    for (const b of blocks) {
      if (b.flag === 0xFF && b.payload.length > 4) {
        const decoded = decodeBasicProgram(b.payload);
        if (decoded.lines.length > 0) {
          const jbasText = basToJBas(decoded.basText);
          programs.push({
            name: 'program',
            autostart: 0,
            varOffset: 0,
            basText: decoded.basText,
            jbasText,
            linesCount: decoded.lines.length
          });
          break;
        }
      }
    }
  }

  return programs;
}

/**
 * High-level helper: extracts the primary Sinclair BASIC program from a TAP buffer.
 * 
 * @param {Uint8Array|Buffer|Array<number>} tapBuffer 
 * @returns {{ name: string, autostart: number, basText: string, jbasText: string, linesCount: number }|null}
 */
function tapToBas(tapBuffer) {
  const programs = extractProgramsFromTap(tapBuffer);
  return programs.length > 0 ? programs[0] : null;
}

module.exports = {
  TOKEN_TO_KEYWORD,
  parseTapBlocks,
  detokenizeLine,
  decodeBasicProgram,
  extractProgramsFromTap,
  tapToBas,
  tapToJBas: (tapBuffer) => {
    const res = tapToBas(tapBuffer);
    return res ? res.jbasText : null;
  }
};
