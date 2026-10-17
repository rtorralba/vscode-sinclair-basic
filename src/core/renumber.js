#!/usr/bin/env node
/**
 * Sinclair BASIC Renumber Tool (JavaScript / Node.js / VS Code ready)
 * 
 * Renumbers line numbers in Sinclair BASIC programs and accurately updates
 * GO TO, GOTO, GO SUB, GOSUB, RESTORE, RUN, LINE, and THEN references.
 * Safely preserves string literals and REM comments without altering internal numbers.
 * 
 * Usable as:
 *  1) A module inside a VS Code extension or web/desktop app:
 *     const { renumberProgram } = require('./renumber');
 *     const { text, warnings } = renumberProgram(editorText, { start: 10, step: 10 });
 * 
 *  2) A standalone Node.js CLI:
 *     node renumber.js file.bas --start 10 --step 10
 */

const fs = require('fs');
const path = require('path');

/**
 * Checks if a character is alphanumeric (a-z, A-Z, 0-9).
 * Mimics Python's str.isalnum() for ASCII BASIC tokens.
 * @param {string|null} char 
 * @returns {boolean}
 */
function isAlphanumeric(char) {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122)   // a-z
  );
}

/**
 * Parses a Sinclair BASIC line into its components.
 * @param {string} rawLine 
 * @returns {{ leadingWs: string, lineNum: number|null, code: string, rawLine: string }}
 */
function parseLine(rawLine) {
  const m = rawLine.match(/^(\s*)(\d+)\s*(.*)$/);
  if (m) {
    return {
      leadingWs: m[1],
      lineNum: parseInt(m[2], 10),
      code: m[3],
      rawLine
    };
  }
  return {
    leadingWs: '',
    lineNum: null,
    code: rawLine,
    rawLine
  };
}

/**
 * Splits line code into chunks preserving quotes and REM comments.
 * Returns an array of objects: { text: string, type: 'code' | 'string' | 'rem' }
 * @param {string} lineCode 
 * @returns {Array<{ text: string, type: 'code'|'string'|'rem' }>}
 */
function splitStringsAndRem(lineCode) {
  const chunks = [];
  let i = 0;
  const n = lineCode.length;
  let currentCode = [];

  while (i < n) {
    const c = lineCode[i];

    // Check for string literal
    if (c === '"') {
      if (currentCode.length > 0) {
        chunks.push({ text: currentCode.join(''), type: 'code' });
        currentCode = [];
      }
      const start = i;
      i++;
      while (i < n && lineCode[i] !== '"') {
        i++;
      }
      if (i < n) {
        // Closing quote found
        i++;
      }
      chunks.push({ text: lineCode.slice(start, i), type: 'string' });
      continue;
    }

    // Check for REM keyword (case insensitive) outside strings
    const isRem = lineCode.slice(i, i + 3).toUpperCase() === 'REM';
    const prevChar = i > 0 ? lineCode[i - 1] : null;
    const nextChar = i + 3 < n ? lineCode[i + 3] : null;

    if (isRem && !isAlphanumeric(prevChar) && !isAlphanumeric(nextChar)) {
      if (currentCode.length > 0) {
        chunks.push({ text: currentCode.join(''), type: 'code' });
        currentCode = [];
      }
      chunks.push({ text: lineCode.slice(i), type: 'rem' });
      break;
    }

    currentCode.push(c);
    i++;
  }

  if (currentCode.length > 0) {
    chunks.push({ text: currentCode.join(''), type: 'code' });
  }

  return chunks;
}

/**
 * Updates line targets in codeStr using the provided mapping.
 * Handles GO TO, GOTO, GO SUB, GOSUB, RUN, RESTORE, LINE, THEN.
 * Also handles comma-separated lists e.g., ON n GO TO 10, 20, 30.
 * @param {string} codeStr 
 * @param {Map<number, number>} mapping 
 * @param {string[]} warnings 
 * @returns {string}
 */
function updateReferencesInCode(codeStr, mapping, warnings) {
  const pattern = /\b(GO\s*TO|GOTO|GO\s*SUB|GOSUB|RUN|RESTORE|LINE|THEN)\s+(\d+(?:\s*,\s*\d+)*)/gi;

  return codeStr.replace(pattern, (fullMatch, keyword, targetsStr) => {
    // Split comma separated target numbers if any
    const parts = targetsStr.split(/(\s*,\s*)/);
    const updatedParts = [];

    for (const part of parts) {
      const trimmed = part.trim();
      if (/^\d+$/.test(trimmed)) {
        const targetNum = parseInt(trimmed, 10);
        if (mapping.has(targetNum)) {
          const newTarget = String(mapping.get(targetNum));
          // Preserve original leading/trailing spaces around comma
          const leading = part.slice(0, part.length - part.trimStart().length);
          const trailing = part.slice(part.trimEnd().length);
          updatedParts.push(`${leading}${newTarget}${trailing}`);
        } else {
          warnings.push(`Target line ${targetNum} in '${keyword} ${targetsStr}' not found in program`);
          updatedParts.push(part);
        }
      } else {
        updatedParts.push(part);
      }
    }

    return `${keyword} ${updatedParts.join('')}`;
  });
}

/**
 * Core renumbering function on an in-memory string.
 * Perfect for VS Code commands, Language Servers, or web editors.
 * 
 * @param {string} sourceText 
 * @param {Object} [options]
 * @param {number} [options.start=10]
 * @param {number} [options.step=10]
 * @returns {{
 *   success: boolean,
 *   text: string,
 *   warnings: string[],
 *   mapping: Map<number, number>,
 *   linesCount: number
 * }}
 */
function renumberProgram(sourceText, options = {}) {
  const start = typeof options.start === 'number' ? options.start : 10;
  const step = typeof options.step === 'number' ? options.step : 10;

  // Detect line endings (CRLF vs LF)
  const isCrlf = sourceText.includes('\r\n');
  const eol = isCrlf ? '\r\n' : '\n';

  const rawLines = sourceText.split(/\r?\n/);
  const hasTrailingNewline = sourceText.endsWith('\n');
  if (hasTrailingNewline && rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  const parsed = [];
  const oldNumbers = [];

  for (let idx = 0; idx < rawLines.length; idx++) {
    const p = parseLine(rawLines[idx]);
    parsed.push(p);
    if (p.lineNum !== null) {
      oldNumbers.push({ num: p.lineNum, idx });
    }
  }

  if (oldNumbers.length === 0) {
    return {
      success: false,
      text: sourceText,
      warnings: ['No line numbers found in program.'],
      mapping: new Map(),
      linesCount: 0
    };
  }

  // Create mapping
  const mapping = new Map();
  let newNum = start;
  for (const item of oldNumbers) {
    if (!mapping.has(item.num)) {
      mapping.set(item.num, newNum);
    }
    newNum += step;
  }

  const warnings = [];
  const newLines = [];
  let currentNewNum = start;

  for (const { leadingWs, lineNum, code, rawLine } of parsed) {
    if (lineNum === null) {
      newLines.push(rawLine);
      continue;
    }

    // Split into code, string, rem chunks
    const chunks = splitStringsAndRem(code);
    const updatedCodeParts = [];

    for (const chunk of chunks) {
      if (chunk.type === 'code') {
        updatedCodeParts.push(updateReferencesInCode(chunk.text, mapping, warnings));
      } else {
        updatedCodeParts.push(chunk.text);
      }
    }

    const updatedCode = updatedCodeParts.join('');
    const lineNumToUse = currentNewNum;
    currentNewNum += step;

    const newLine = updatedCode ? `${lineNumToUse} ${updatedCode}` : String(lineNumToUse);
    newLines.push(newLine);
  }

  let resultText = newLines.join(eol);
  if (hasTrailingNewline) {
    resultText += eol;
  }

  return {
    success: true,
    text: resultText,
    warnings: Array.from(new Set(warnings)),
    mapping,
    linesCount: oldNumbers.length
  };
}

/**
 * File-based renumbering with optional backup creation.
 * 
 * @param {string} inputFile 
 * @param {Object} [options]
 * @param {string} [options.outputFile]
 * @param {number} [options.start=10]
 * @param {number} [options.step=10]
 * @param {boolean} [options.makeBackup=true]
 * @returns {boolean}
 */
function renumberFile(inputFile, options = {}) {
  const start = typeof options.start === 'number' ? options.start : 10;
  const step = typeof options.step === 'number' ? options.step : 10;
  const makeBackup = options.makeBackup !== false;
  const outputFile = options.outputFile || inputFile;

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    return false;
  }

  const content = fs.readFileSync(inputFile, 'utf-8');
  const result = renumberProgram(content, { start, step });

  if (!result.success) {
    console.log(`No line numbers found in ${inputFile}.`);
    return false;
  }

  console.log(`Renumbering ${result.linesCount} lines (start=${start}, step=${step})...`);

  if (makeBackup && fs.existsSync(outputFile) && path.resolve(outputFile) === path.resolve(inputFile)) {
    const bakFile = inputFile + '.bak';
    fs.writeFileSync(bakFile, content, 'utf-8');
    console.log(`Backup created: ${bakFile}`);
  }

  fs.writeFileSync(outputFile, result.text, 'utf-8');
  console.log(`Successfully renumbered to: ${outputFile}`);

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of result.warnings) {
      console.log(`  - ${w}`);
    }
  }

  return true;
}

/**
 * CLI Argument parser & entry point
 */
function runCli() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(`Usage: node renumber.js <file.bas> [options]

Options:
  --start <num>    Starting line number (default: 10)
  --step <num>     Increment step (default: 10)
  --out <file>     Output file (default: overwrite input with backup)
  --no-backup      Do not create a .bak backup file
  -h, --help       Show this help message
`);
    process.exit(args.length === 0 ? 1 : 0);
  }

  let inputFile = null;
  let outputFile = null;
  let start = 10;
  let step = 10;
  let makeBackup = true;

  const fileArgs = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--start' && i + 1 < args.length) {
      start = parseInt(args[++i], 10);
    } else if (arg === '--step' && i + 1 < args.length) {
      step = parseInt(args[++i], 10);
    } else if (arg === '--out' && i + 1 < args.length) {
      outputFile = args[++i];
    } else if (arg === '--no-backup') {
      makeBackup = false;
    } else if (!arg.startsWith('-')) {
      fileArgs.push(arg);
    }
  }

  if (fileArgs.length === 0) {
    console.error('Error: No input file specified.');
    process.exit(1);
  }

  inputFile = fileArgs.join(' ');
  const ok = renumberFile(inputFile, { outputFile, start, step, makeBackup });
  process.exit(ok ? 0 : 1);
}

// Export functions for module/extension usage
module.exports = {
  parseLine,
  splitStringsAndRem,
  updateReferencesInCode,
  renumberProgram,
  renumberFile
};

// Execute CLI if run directly
if (require.main === module) {
  runCli();
}
