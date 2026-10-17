#!/usr/bin/env node
/**
 * jbas2bas - Pseudo-Sinclair BASIC Compiler
 * 
 * Compiles modern .jbas source files into standard numbered Sinclair .bas files:
 *  - Strips single-quote comments ('...) while preserving quotes in string literals.
 *  - Strips empty lines.
 *  - Resolves label definitions (@label:) to sequential line numbers.
 *  - Replaces all @label references (e.g. GO TO @label, THEN @label) with line numbers.
 *  - Outputs clean numbered Sinclair BASIC ready for bas2tap.
 */

const fs = require('fs');
const path = require('path');

/**
 * Strips single quote comments ('...) from a line while respecting string literals.
 * @param {string} line 
 * @returns {string}
 */
function stripComments(line) {
  let inString = false;
  let i = 0;
  const n = line.length;

  while (i < n) {
    const c = line[i];
    if (c === '"') {
      inString = !inString;
      i++;
      continue;
    }
    if (!inString && c === "'") {
      return line.slice(0, i).trimEnd();
    }
    i++;
  }
  return line;
}

/**
 * Replaces @label occurrences outside string literals with their resolved line numbers.
 * @param {string} code 
 * @param {Map<string, number>} labelMap 
 * @param {string[]} errors 
 * @param {number} sourceLineIndex 
 * @returns {string}
 */
function replaceLabelsOutsideStrings(code, labelMap, errors, sourceLineIndex) {
  let result = '';
  let i = 0;
  const n = code.length;

  while (i < n) {
    const c = code[i];

    // Preserve string literal as-is
    if (c === '"') {
      const start = i;
      i++;
      while (i < n && code[i] !== '"') {
        i++;
      }
      if (i < n) i++; // closing quote
      result += code.slice(start, i);
      continue;
    }

    // Check for @label reference
    if (c === '@') {
      const match = code.slice(i).match(/^@([a-zA-Z0-9_]+)/);
      if (match) {
        const labelName = match[1];
        if (labelMap.has(labelName)) {
          result += String(labelMap.get(labelName));
        } else {
          errors.push(`Line ${sourceLineIndex}: Undefined label '@${labelName}'`);
          result += match[0];
        }
        i += match[0].length;
        continue;
      }
    }

    result += c;
    i++;
  }

  return result;
}

/**
 * Compiles a .jbas string into a numbered Sinclair .bas string.
 * 
 * @param {string} sourceText 
 * @param {Object} [options]
 * @param {number} [options.start=10]
 * @param {number} [options.step=10]
 * @returns {{
 *   success: boolean,
 *   text: string,
 *   labels: Map<string, number>,
 *   errors: string[],
 *   warnings: string[],
 *   linesCount: number
 * }}
 */
function compileJBas(sourceText, options = {}) {
  const start = typeof options.start === 'number' ? options.start : 10;
  const step = typeof options.step === 'number' ? options.step : 10;

  const rawLines = sourceText.split(/\r?\n/);
  const isCrlf = sourceText.includes('\r\n');
  const eol = isCrlf ? '\r\n' : '\n';

  const errors = [];
  const warnings = [];
  const labelMap = new Map();

  // PASS 1: Strip comments, collect labels, identify statements
  const statements = [];
  let pendingLabels = [];

  for (let idx = 0; idx < rawLines.length; idx++) {
    const origLineNum = idx + 1;
    let line = stripComments(rawLines[idx]).trim();

    if (!line) {
      // Empty line (or comment-only line) -> skip
      continue;
    }

    // Extract any leading label definitions: @name:
    while (true) {
      const labelMatch = line.match(/^@([a-zA-Z0-9_]+):\s*(.*)$/);
      if (labelMatch) {
        const labelName = labelMatch[1];
        if (labelMap.has(labelName) || pendingLabels.includes(labelName)) {
          warnings.push(`Line ${origLineNum}: Duplicate label definition '@${labelName}'`);
        }
        pendingLabels.push(labelName);
        line = labelMatch[2].trim();
      } else {
        break;
      }
    }

    // If code remains after label extraction, it's a statement
    if (line) {
      statements.push({
        origLineNum,
        code: line,
        labels: pendingLabels
      });
      pendingLabels = [];
    }
  }

  if (statements.length === 0) {
    return {
      success: false,
      text: '',
      labels: labelMap,
      errors: ['Source contains no BASIC statements.'],
      warnings,
      linesCount: 0
    };
  }

  // Assign line numbers and map labels
  let currentNum = start;
  for (const stmt of statements) {
    stmt.lineNum = currentNum;
    for (const lbl of stmt.labels) {
      labelMap.set(lbl, currentNum);
    }
    currentNum += step;
  }

  // If there are trailing labels with no statement, map them to currentNum (or warn)
  if (pendingLabels.length > 0) {
    for (const lbl of pendingLabels) {
      labelMap.set(lbl, currentNum);
      warnings.push(`Label '@${lbl}' defined at the very end of file (maps to line ${currentNum})`);
    }
  }

  // PASS 2: Replace label references with line numbers
  const outputLines = [];
  for (const stmt of statements) {
    const resolvedCode = replaceLabelsOutsideStrings(stmt.code, labelMap, errors, stmt.origLineNum);
    outputLines.push(`${stmt.lineNum} ${resolvedCode}`);
  }

  const resultText = outputLines.join(eol) + eol;

  return {
    success: errors.length === 0,
    text: resultText,
    labels: labelMap,
    errors,
    warnings,
    linesCount: statements.length
  };
}

/**
 * Compiles a .jbas file to a .bas file on disk.
 * 
 * @param {string} inputFile 
 * @param {string} [outputFile] 
 * @param {Object} [options] 
 * @returns {boolean}
 */
function compileJBasFile(inputFile, outputFile, options = {}) {
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    return false;
  }

  if (!outputFile) {
    const dir = path.dirname(inputFile);
    const base = path.basename(inputFile, path.extname(inputFile));
    outputFile = path.join(dir, `${base}.bas`);
  }

  const outDir = path.dirname(outputFile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const content = fs.readFileSync(inputFile, 'utf-8');
  const res = compileJBas(content, options);

  if (res.warnings.length > 0) {
    console.log('Warnings:');
    res.warnings.forEach(w => console.log(`  - ${w}`));
  }

  if (!res.success) {
    console.error('Errors during compilation:');
    res.errors.forEach(e => console.error(`  - ${e}`));
    return false;
  }

  fs.writeFileSync(outputFile, res.text, 'utf-8');
  console.log(`Compiled ${res.linesCount} lines to ${outputFile} (labels: ${res.labels.size})`);
  return true;
}

/**
 * CLI runner
 */
function runCli() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(`Usage: node jbas2bas.js <input.jbas> [output.bas] [options]

Options:
  --start <num>    Starting line number (default: 10)
  --step <num>     Increment step (default: 10)
  -h, --help       Show this help message
`);
    process.exit(args.length === 0 ? 1 : 0);
  }

  let inputFile = null;
  let outputFile = null;
  let start = 10;
  let step = 10;

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--start' && i + 1 < args.length) {
      start = parseInt(args[++i], 10);
    } else if (arg === '--step' && i + 1 < args.length) {
      step = parseInt(args[++i], 10);
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    console.error('Error: No input file specified.');
    process.exit(1);
  }

  inputFile = positional[0];
  if (positional.length > 1) {
    outputFile = positional[1];
  }

  const ok = compileJBasFile(inputFile, outputFile, { start, step });
  process.exit(ok ? 0 : 1);
}

module.exports = {
  stripComments,
  replaceLabelsOutsideStrings,
  compileJBas,
  compileJBasFile
};

if (require.main === module) {
  runCli();
}
