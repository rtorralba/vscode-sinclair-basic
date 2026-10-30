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
 * Decodes raw bytes from ZX Spectrum RAM into a human-readable Sinclair BASIC string literal.
 * Control codes (INK, PAPER, AT, etc.), UDGs ({A}-{U}), and character codes ({CODE n})
 * are represented using standard Sinclair BASIC / bas2tap notation instead of C-style hex.
 *
 * @param {Uint8Array|Array<number>} bytes
 * @returns {string}
 */
function decodeSpectrumString(bytes) {
  if (!bytes || bytes.length === 0) return '';
  let res = '';
  let i = 0;
  const len = bytes.length;

  while (i < len) {
    const b = bytes[i];

    // INK (16): followed by color 0..7 or 8, 9
    if (b === 16 && i + 1 < len && bytes[i + 1] <= 9) {
      res += `{INK ${bytes[i + 1]}}`;
      i += 2;
      continue;
    }

    // PAPER (17): followed by color 0..7 or 8, 9
    if (b === 17 && i + 1 < len && bytes[i + 1] <= 9) {
      res += `{PAPER ${bytes[i + 1]}}`;
      i += 2;
      continue;
    }

    // FLASH (18): followed by 0, 1 or 8
    if (b === 18 && i + 1 < len && (bytes[i + 1] === 0 || bytes[i + 1] === 1 || bytes[i + 1] === 8)) {
      res += `{FLASH ${bytes[i + 1]}}`;
      i += 2;
      continue;
    }

    // BRIGHT (19): followed by 0, 1 or 8
    if (b === 19 && i + 1 < len && (bytes[i + 1] === 0 || bytes[i + 1] === 1 || bytes[i + 1] === 8)) {
      res += `{BRIGHT ${bytes[i + 1]}}`;
      i += 2;
      continue;
    }

    // INVERSE (20): followed by 0 or 1
    if (b === 20 && i + 1 < len && (bytes[i + 1] === 0 || bytes[i + 1] === 1)) {
      res += `{INVERSE ${bytes[i + 1]}}`;
      i += 2;
      continue;
    }

    // OVER (21): followed by 0 or 1
    if (b === 21 && i + 1 < len && (bytes[i + 1] === 0 || bytes[i + 1] === 1)) {
      res += `{OVER ${bytes[i + 1]}}`;
      i += 2;
      continue;
    }

    // AT (22): followed by row (0..21) and col (0..31)
    if (b === 22 && i + 2 < len && bytes[i + 1] <= 21 && bytes[i + 2] <= 31) {
      res += `{AT ${bytes[i + 1]},${bytes[i + 2]}}`;
      i += 3;
      continue;
    }

    // TAB (23): followed by 2 bytes (col low, col high)
    if (b === 23 && i + 2 < len) {
      const tabCol = bytes[i + 1] | (bytes[i + 2] << 8);
      res += `{TAB ${tabCol}}`;
      i += 3;
      continue;
    }

    // UDG Graphics {A}..{U} (codes 144..164)
    if (b >= 144 && b <= 164) {
      const udgLetter = String.fromCharCode(65 + (b - 144));
      res += `{${udgLetter}}`;
      i++;
      continue;
    }

    // Printable ASCII characters
    if (b >= 32 && b <= 126) {
      if (b === 34) {
        res += '\\"';
      } else {
        res += String.fromCharCode(b);
      }
      i++;
      continue;
    }

    // Fallback for all other control/graphic codes: {CODE n}
    res += `{CODE ${b}}`;
    i++;
  }

  return res;
}

/**
 * Converts a 0-based flat array element index into 1-based Sinclair BASIC subscripts.
 *
 * @param {number} idx 0-based flat index
 * @param {Array<number>} dims Array of dimension sizes
 * @returns {Array<number>} 1-based subscripts
 */
function indexToSubscripts(idx, dims) {
  const subs = new Array(dims.length);
  let rem = idx;
  for (let d = dims.length - 1; d >= 0; d--) {
    const size = dims[d] || 1;
    subs[d] = (rem % size) + 1;
    rem = Math.floor(rem / size);
  }
  return subs;
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
      const rawBytes = [];
      for (let i = 0; i < len; i++) {
        rawBytes.push(readByte(p + 3 + i));
      }
      const str = decodeSpectrumString(rawBytes);
      vars.push({ name, type: 'string', value: str, length: len, rawBytes });
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
      // Array variable (type 4: numeric array, type 6: character/string array)
      const isString = (type === 6);
      const name = String.fromCharCode(96 + letterCode) + (isString ? '$' : '');
      const len = (readByte(p + 1) & 0xFF) | ((readByte(p + 2) & 0xFF) << 8);
      const nextVarAddr = p + 3 + len;
      const numDims = readByte(p + 3) & 0xFF;
      const dimensions = [];
      for (let d = 0; d < numDims && (p + 4 + d * 2 + 1) < nextVarAddr; d++) {
        const dOff = p + 4 + d * 2;
        const dSize = (readByte(dOff) & 0xFF) | ((readByte(dOff + 1) & 0xFF) << 8);
        dimensions.push(dSize);
      }
      const dataStart = p + 4 + numDims * 2;
      const dimStr = dimensions.join(',');

      if (!isString) {
        const totalElements = dimensions.length > 0
          ? dimensions.reduce((acc, d) => acc * d, 1)
          : 0;
        const maxElements = Math.min(totalElements, 1000);
        const elements = [];
        for (let i = 0; i < maxElements; i++) {
          const elemAddr = dataStart + i * 5;
          if (elemAddr + 4 >= nextVarAddr || elemAddr + 4 >= maxAddr) break;
          const elemVal = decodeSinclairFloat(
            readByte(elemAddr),
            readByte(elemAddr + 1),
            readByte(elemAddr + 2),
            readByte(elemAddr + 3),
            readByte(elemAddr + 4)
          );
          const subs = indexToSubscripts(i, dimensions);
          elements.push({ index: subs.join(','), value: elemVal });
        }
        const preview = elements.slice(0, 8).map(e => e.value).join(', ')
          + (totalElements > 8 ? ', ...' : '');
        const value = `DIM(${dimStr}) [${preview}]`;
        vars.push({
          name,
          type: 'number-array',
          value,
          length: len,
          dimensions,
          elements
        });
      } else {
        if (dimensions.length === 1) {
          const charLen = dimensions[0] || 0;
          const maxChars = Math.min(charLen, 1000);
          const rawBytes = [];
          for (let i = 0; i < maxChars && (dataStart + i) < nextVarAddr && (dataStart + i) < maxAddr; i++) {
            rawBytes.push(readByte(dataStart + i));
          }
          const strVal = decodeSpectrumString(rawBytes);
          const value = `DIM(${dimStr}) "${strVal}"`;
          vars.push({
            name,
            type: 'string-array',
            value,
            length: len,
            dimensions,
            rawBytes
          });
        } else if (dimensions.length >= 2) {
          const strLen = dimensions[dimensions.length - 1] || 0;
          const rowDims = dimensions.slice(0, -1);
          const totalStrings = rowDims.reduce((acc, d) => acc * d, 1);
          const maxStrings = Math.min(totalStrings, 500);
          const elements = [];
          for (let i = 0; i < maxStrings; i++) {
            const strAddr = dataStart + i * strLen;
            if (strAddr + strLen > nextVarAddr || strAddr + strLen > maxAddr) break;
            const rowBytes = [];
            for (let c = 0; c < strLen; c++) {
              rowBytes.push(readByte(strAddr + c));
            }
            const subs = indexToSubscripts(i, rowDims);
            elements.push({
              index: subs.join(','),
              value: decodeSpectrumString(rowBytes),
              rawBytes: rowBytes
            });
          }
          const preview = elements.slice(0, 4).map(e => `"${e.value}"`).join(', ')
            + (totalStrings > 4 ? ', ...' : '');
          const value = `DIM(${dimStr}) [${preview}]`;
          vars.push({
            name,
            type: 'string-array',
            value,
            length: len,
            dimensions,
            elements
          });
        } else {
          vars.push({ name, type: 'string-array', value: 'DIM()', length: len, dimensions: [] });
        }
      }
      p = nextVarAddr;
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
 * Maps a 1-based source line number (e.g. from .jbas) to a Sinclair BASIC line number.
 * If the exact line has no statement (e.g. comment or label), scans forward to the next mapped statement.
 *
 * @param {number} sourceLine 1-based line number in source file
 * @param {Map<number, number>|Object} sourceToBasic Mapping of source line -> basic line
 * @returns {number|null}
 */
function mapSourceLineToBasic(sourceLine, sourceToBasic) {
  if (!sourceToBasic) return sourceLine;
  const getBasic = (l) => {
    if (sourceToBasic instanceof Map) return sourceToBasic.get(l);
    return sourceToBasic[l];
  };

  const exact = getBasic(sourceLine);
  if (exact !== undefined) return exact;

  // Search forward up to 500 lines for the next executable statement
  for (let l = sourceLine + 1; l <= sourceLine + 500; l++) {
    const next = getBasic(l);
    if (next !== undefined) return next;
  }
  return null;
}

/**
 * Maps a Sinclair BASIC line number to a 1-based source line number (e.g. in .jbas).
 *
 * @param {number} basicLine Sinclair BASIC line number
 * @param {Map<number, number>|Object} basicToSource Mapping of basic line -> source line
 * @returns {number}
 */
function mapBasicToSourceLine(basicLine, basicToSource) {
  if (!basicToSource) return basicLine;
  let res;
  if (basicToSource instanceof Map) {
    res = basicToSource.get(basicLine);
  } else {
    res = basicToSource[basicLine];
  }
  return res !== undefined ? res : basicLine;
}

/**
 * Returns all statement ranges [startCol, endCol] for a BASIC or JBAS line.
 *
 * @param {string} lineText
 * @returns {Array<{ stmtIndex: number, startCol: number, endCol: number }>}
 */
function getStatementRanges(lineText) {
  if (typeof lineText !== 'string') return [];
  const prefixMatch = lineText.match(/^(\s*@[a-zA-Z0-9_]+:\s*|\s*\d+\s*|\s*)/);
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
      if (lineText.slice(i, i + 3).toUpperCase() === 'REM' &&
          (i === codeStart || /\s|:/.test(lineText[i - 1]))) {
        inRem = true;
      } else if (ch === ':') {
        segments.push({ stmtIndex: segments.length + 1, startCol: segStart, endCol: i });
        segStart = i + 1;
        if (lineText[segStart] === ' ') segStart++;
      }
    }
  }
  segments.push({ stmtIndex: segments.length + 1, startCol: segStart, endCol: lineText.length });
  return segments;
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
  const segments = getStatementRanges(lineText);
  const idx = Math.max(1, stmtIndex) - 1;
  if (idx < segments.length) {
    return { startCol: segments[idx].startCol, endCol: segments[idx].endCol };
  }
  const prefixMatch = (typeof lineText === 'string') ? lineText.match(/^(\s*@[a-zA-Z0-9_]+:\s*|\s*\d+\s*|\s*)/) : null;
  const codeStart = prefixMatch ? prefixMatch[0].length : 0;
  return { startCol: codeStart, endCol: lineText ? lineText.length : 0 };
}

/**
 * Finds the 1-based statement index for a given 1-based column on a line.
 * If column is not specified or at/before statement 1, returns 1.
 *
 * @param {string} lineText
 * @param {number} [column1] 1-based column
 * @returns {number} 1-based statement index
 */
function findStatementIndexAtColumn(lineText, column1) {
  if (!column1 || column1 <= 1) return 1;
  const col0 = column1 - 1;
  const ranges = getStatementRanges(lineText);
  for (const r of ranges) {
    if (col0 >= r.startCol && col0 <= r.endCol) {
      return r.stmtIndex;
    }
  }
  if (ranges.length > 0 && col0 > ranges[ranges.length - 1].endCol) {
    return ranges[ranges.length - 1].stmtIndex;
  }
  return 1;
}

/**
 * Core Debug Adapter Protocol (DAP) message handler for Sinclair BASIC.
 * Pure JavaScript, zero VS Code API dependencies.
 */
class SinclairBasicDebugAdapterCore {
  constructor(options = {}) {
    this.sendEvent = options.sendEvent || (() => {});
    this.sendResponse = options.sendResponse || (() => {});
    this.onAction = options.onAction || (() => {});

    this.seq = 1;
    this.currentLine = null;
    this.currentStmt = null;
    this.currentVars = [];
    this.currentDocText = '';
    this.currentFilePath = '';
    this.breakpoints = new Map();
    this.sourceMap = null;
  }

  setSourceMap(sourceMap) {
    this.sourceMap = sourceMap || null;
  }

  setDocument(filePath, docText) {
    this.currentFilePath = filePath || '';
    this.currentDocText = docText || '';
  }

  handleMessage(message) {
    if (!message) return;
    if (message.type === 'request') {
      this.handleRequest(message);
    }
  }

  _sendSuccess(request, body = {}) {
    this.sendResponse({
      seq: this.seq++,
      type: 'response',
      request_seq: request.seq,
      command: request.command,
      success: true,
      body: body
    });
  }

  _sendError(request, message) {
    this.sendResponse({
      seq: this.seq++,
      type: 'response',
      request_seq: request.seq,
      command: request.command,
      success: false,
      message: message
    });
  }

  handleRequest(request) {
    const { command, arguments: args = {} } = request;

    switch (command) {
      case 'initialize': {
        this._sendSuccess(request, {
          supportsConfigurationDoneRequest: true,
          supportsRestartRequest: true,
          supportsTerminateRequest: true,
          supportsBreakpointLocationsRequest: true,
          supportsConditionalBreakpoints: false,
          supportsHitConditionalBreakpoints: false,
          supportsSetVariable: false,
          supportsStepBack: false,
          supportsStepInTargetsRequest: false
        });
        this.sendEvent('initialized', {});
        break;
      }

      case 'launch': {
        if (args.program) {
          this.currentFilePath = args.program;
        }
        this.onAction('launch', args);
        this._sendSuccess(request, {});
        break;
      }

      case 'breakpointLocations': {
        const line = args.line;
        const lines = this.currentDocText ? this.currentDocText.split(/\r?\n/) : [];
        const docLine0 = line - 1;
        const locations = [];

        if (docLine0 >= 0 && docLine0 < lines.length) {
          const lineText = lines[docLine0];
          const ranges = getStatementRanges(lineText);
          for (const r of ranges) {
            locations.push({
              line: line,
              column: r.startCol + 1
            });
          }
        }

        this._sendSuccess(request, {
          breakpoints: locations.length > 0 ? locations : [{ line: line, column: 1 }]
        });
        break;
      }

      case 'setBreakpoints': {
        const sourcePath = (args.source && (args.source.path || args.source.name)) || '';
        const clientBreakpoints = Array.isArray(args.breakpoints) ? args.breakpoints : [];
        const targetBreakpoints = [];
        const lines = this.currentDocText ? this.currentDocText.split(/\r?\n/) : [];

        for (const bp of clientBreakpoints) {
          const docLine0 = bp.line - 1;
          const lineText = (docLine0 >= 0 && docLine0 < lines.length) ? lines[docLine0] : '';
          const stmtIndex = findStatementIndexAtColumn(lineText, bp.column);

          let basicLine = null;
          if (this.sourceMap && this.sourceMap.sourceToBasic) {
            basicLine = mapSourceLineToBasic(bp.line, this.sourceMap.sourceToBasic);
          } else {
            if (docLine0 >= 0 && docLine0 < lines.length) {
              const m = lines[docLine0].match(/^\s*(\d+)/);
              if (m) {
                basicLine = parseInt(m[1], 10);
              } else {
                basicLine = bp.line;
              }
            } else {
              basicLine = bp.line;
            }
          }

          if (basicLine !== null && basicLine !== undefined) {
            targetBreakpoints.push({
              line: basicLine,
              stmt: stmtIndex
            });
          }
        }

        this.breakpoints.set(sourcePath, targetBreakpoints);
        this.onAction('setBreakpoints', {
          sourcePath,
          breakpoints: targetBreakpoints,
          lines: targetBreakpoints.map(b => b.line),
          rawBreakpoints: clientBreakpoints
        });

        this._sendSuccess(request, {
          breakpoints: clientBreakpoints.map(bp => {
            const docLine0 = bp.line - 1;
            const lineText = (docLine0 >= 0 && docLine0 < lines.length) ? lines[docLine0] : '';
            const stmtIndex = findStatementIndexAtColumn(lineText, bp.column);
            const ranges = getStatementRanges(lineText);
            const r = ranges[stmtIndex - 1];
            return {
              verified: true,
              line: bp.line,
              column: r ? (r.startCol + 1) : (bp.column || 1)
            };
          })
        });
        break;
      }

      case 'setExceptionBreakpoints': {
        this._sendSuccess(request, {});
        break;
      }

      case 'configurationDone': {
        this.onAction('configurationDone', {});
        this._sendSuccess(request, {});
        break;
      }

      case 'threads': {
        this._sendSuccess(request, {
          threads: [
            { id: 1, name: 'ZX Spectrum 48K (Sinclair BASIC)' }
          ]
        });
        break;
      }

      case 'stackTrace': {
        const frames = [];
        if (this.currentLine != null) {
          let docLine0 = -1;
          let docLine1 = 1;
          let frameName = '';

          if (this.sourceMap && this.sourceMap.basicToSource) {
            docLine1 = mapBasicToSourceLine(this.currentLine, this.sourceMap.basicToSource);
            docLine0 = docLine1 - 1;
            frameName = `Línea ${docLine1} [BASIC ${this.currentLine}:${this.currentStmt || 1}]`;
          } else {
            docLine0 = findDocumentLine(this.currentDocText, this.currentLine);
            docLine1 = docLine0 >= 0 ? (docLine0 + 1) : 1;
            frameName = `Línea ${this.currentLine} [Sentencia ${this.currentStmt || 1}]`;
          }

          const lines = this.currentDocText ? this.currentDocText.split(/\r?\n/)[docLine0] : '';
          const lineText = (docLine0 >= 0 && this.currentDocText)
            ? this.currentDocText.split(/\r?\n/)[docLine0]
            : '';
          const stmtRange = findStatementRange(lineText, this.currentStmt || 1);

          const fileName = this.currentFilePath
            ? this.currentFilePath.replace(/\\/g, '/').split('/').pop()
            : 'program.bas';

          frames.push({
            id: 1,
            name: frameName,
            source: {
              name: fileName,
              path: this.currentFilePath
            },
            line: docLine1,
            column: stmtRange.startCol + 1,
            endColumn: stmtRange.endCol + 1
          });
        }

        this._sendSuccess(request, {
          stackFrames: frames,
          totalFrames: frames.length
        });
        break;
      }

      case 'scopes': {
        this._sendSuccess(request, {
          scopes: [
            {
              name: 'Variables en RAM (VARS)',
              presentationHint: 'locals',
              variablesReference: 1000,
              expensive: false
            }
          ]
        });
        break;
      }

      case 'variables': {
        const varRef = args.variablesReference;
        if (varRef === 1000) {
          const dapVars = (this.currentVars || []).map((v, idx) => {
            let valStr = '';
            let childRef = 0;
            if (v.type === 'string') {
              valStr = `"${v.value}"`;
              if (v.rawBytes && v.rawBytes.length > 0) {
                childRef = 2000 + idx;
              }
            } else if (v.type === 'for') {
              const limitStr = v.limit !== undefined ? v.limit : '?';
              const stepStr = v.step !== undefined ? v.step : 1;
              valStr = `${v.value} (TO ${limitStr} STEP ${stepStr})`;
            } else if (v.type === 'number-array' || v.type === 'string-array') {
              valStr = v.value || `DIM (${v.length} bytes)`;
              if ((v.elements && v.elements.length > 0) || (v.rawBytes && v.rawBytes.length > 0)) {
                childRef = 2000 + idx;
              }
            } else {
              valStr = String(v.value);
            }
            return {
              name: v.name,
              value: valStr,
              type: v.type,
              variablesReference: childRef
            };
          });

          this._sendSuccess(request, {
            variables: dapVars
          });
        } else if (varRef >= 2000) {
          const varIdx = varRef - 2000;
          const targetVar = this.currentVars && this.currentVars[varIdx];
          const children = [];
          if (targetVar && targetVar.type === 'number-array' && Array.isArray(targetVar.elements)) {
            targetVar.elements.forEach((el) => {
              children.push({
                name: `${targetVar.name}(${el.index})`,
                value: String(el.value),
                type: 'number',
                variablesReference: 0
              });
            });
          } else if (targetVar && targetVar.type === 'string-array' && Array.isArray(targetVar.elements)) {
            targetVar.elements.forEach((el) => {
              children.push({
                name: `${targetVar.name}(${el.index})`,
                value: `"${el.value}"`,
                type: 'string',
                variablesReference: 0
              });
            });
          } else if (targetVar && targetVar.rawBytes) {
            const isCharArray = targetVar.type === 'string-array';
            targetVar.rawBytes.forEach((b, i) => {
              const charDesc = (b >= 32 && b <= 126)
                ? `"${String.fromCharCode(b)}"`
                : `{CODE ${b}}`;
              children.push({
                name: isCharArray ? `${targetVar.name}(${i + 1})` : `(${i + 1})`,
                value: `${b}  ${charDesc}`,
                type: 'CODE',
                variablesReference: 0
              });
            });
          }
          this._sendSuccess(request, {
            variables: children
          });
        } else {
          this._sendSuccess(request, { variables: [] });
        }
        break;
      }

      case 'continue': {
        this.onAction('continue', {});
        this._sendSuccess(request, { allThreadsContinued: true });
        this.sendEvent('continued', { threadId: 1, allThreadsContinued: true });
        break;
      }

      case 'pause': {
        this.onAction('pause', {});
        this._sendSuccess(request, {});
        break;
      }

      case 'next': {
        this.onAction('stepLine', {});
        this._sendSuccess(request, {});
        break;
      }

      case 'stepIn': {
        this.onAction('stepStmt', {});
        this._sendSuccess(request, {});
        break;
      }

      case 'stepOut': {
        this.onAction('stepLine', {});
        this._sendSuccess(request, {});
        break;
      }

      case 'restart': {
        this.onAction('restart', {});
        this._sendSuccess(request, {});
        break;
      }

      case 'disconnect':
      case 'terminate': {
        this.onAction('stop', {});
        this._sendSuccess(request, {});
        this.sendEvent('terminated', {});
        this.sendEvent('exited', { exitCode: 0 });
        break;
      }

      default: {
        this._sendSuccess(request, {});
        break;
      }
    }
  }

  notifyPaused(line, stmt, vars, reason = 'breakpoint') {
    this.currentLine = line;
    this.currentStmt = stmt;
    this.currentVars = Array.isArray(vars) ? vars : [];
    this.sendEvent('stopped', {
      reason: reason,
      threadId: 1,
      allThreadsStopped: true,
      description: `Línea ${line}, Sentencia ${stmt}`
    });
  }

  notifyResumed() {
    this.sendEvent('continued', {
      threadId: 1,
      allThreadsContinued: true
    });
  }

  notifyTerminated() {
    this.sendEvent('terminated', {});
    this.sendEvent('exited', { exitCode: 0 });
  }
}

module.exports = {
  ROM48_STMT_ADDR,
  ROM48_LOOP_ADDR,
  decodeSinclairFloat,
  readSpectrumVariables,
  findDocumentLine,
  findStatementRange,
  getStatementRanges,
  findStatementIndexAtColumn,
  SinclairBasicDebugAdapterCore,
  decodeSpectrumString,
  mapSourceLineToBasic,
  mapBasicToSourceLine
};

