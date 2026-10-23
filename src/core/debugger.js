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

      case 'setBreakpoints': {
        const sourcePath = (args.source && (args.source.path || args.source.name)) || '';
        const clientBreakpoints = Array.isArray(args.breakpoints) ? args.breakpoints : [];
        const basicLines = [];

        const lines = this.currentDocText ? this.currentDocText.split(/\r?\n/) : [];
        for (const bp of clientBreakpoints) {
          const docLine0 = bp.line - 1;
          if (docLine0 >= 0 && docLine0 < lines.length) {
            const m = lines[docLine0].match(/^\s*(\d+)/);
            if (m) {
              basicLines.push(parseInt(m[1], 10));
            } else {
              basicLines.push(bp.line);
            }
          } else {
            basicLines.push(bp.line);
          }
        }

        this.breakpoints.set(sourcePath, new Set(basicLines));
        this.onAction('setBreakpoints', {
          sourcePath,
          lines: basicLines,
          rawBreakpoints: clientBreakpoints
        });

        this._sendSuccess(request, {
          breakpoints: clientBreakpoints.map(bp => ({
            verified: true,
            line: bp.line
          }))
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
          const docLine0 = findDocumentLine(this.currentDocText, this.currentLine);
          const docLine1 = docLine0 >= 0 ? (docLine0 + 1) : 1;
          const lineText = (docLine0 >= 0 && this.currentDocText)
            ? this.currentDocText.split(/\r?\n/)[docLine0]
            : '';
          const stmtRange = findStatementRange(lineText, this.currentStmt || 1);

          const fileName = this.currentFilePath
            ? this.currentFilePath.replace(/\\/g, '/').split('/').pop()
            : 'program.bas';

          frames.push({
            id: 1,
            name: `Línea ${this.currentLine} [Sentencia ${this.currentStmt || 1}]`,
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
        const dapVars = (this.currentVars || []).map(v => {
          let valStr = '';
          if (v.type === 'string') {
            valStr = `"${v.value}"`;
          } else if (v.type === 'for') {
            valStr = `${v.value} (TO ${v.limit} STEP ${v.step})`;
          } else {
            valStr = String(v.value);
          }
          return {
            name: v.name,
            value: valStr,
            type: v.type,
            variablesReference: 0
          };
        });

        this._sendSuccess(request, {
          variables: dapVars
        });
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
  SinclairBasicDebugAdapterCore
};

