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

const { translateWildcardsToChr } = require('./wildcards');

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
 * Converts single-quote comments ('...) to Sinclair BASIC REM comments.
 * Respects string literals and handles both full-line and inline comments.
 * @param {string} line 
 * @returns {string}
 */
function convertCommentsToRem(line) {
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
      const before = line.slice(0, i).trimEnd();
      const commentText = line.slice(i + 1);
      const remSpacing = (commentText.startsWith(' ') || commentText.length === 0) ? '' : ' ';
      if (!before) {
        return `REM${remSpacing}${commentText}`;
      }
      if (before.endsWith(':')) {
        return `${before} REM${remSpacing}${commentText}`;
      }
      return `${before}: REM${remSpacing}${commentText}`;
    }
    i++;
  }
  return line;
}

/**
 * Replaces @label occurrences outside string literals with their resolved line numbers.
 * Safely preserves REM comments without treating @ mentions inside comments as labels.
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

    // Check for REM keyword outside strings - preserve rest of line as-is
    const isRem = code.slice(i, i + 3).toUpperCase() === 'REM';
    const prevChar = i > 0 ? code[i - 1] : ' ';
    const nextChar = i + 3 < n ? code[i + 3] : ' ';
    const isWordBoundary = !/[a-zA-Z0-9_]/.test(prevChar) && !/[a-zA-Z0-9_]/.test(nextChar);

    if (isRem && isWordBoundary) {
      result += code.slice(i);
      break;
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
 * Compacts unnecessary whitespace around operators (=, +, -, *, /, ^, <, >, <=, >=, <>, :, ;, ,, (, ))
 * outside string literals and REM comments. Preserves string literals and REM comments exactly as-is.
 * 
 * @param {string} code 
 * @returns {string}
 */
function compactWhitespaceOutsideStrings(code) {
  let result = '';
  let inString = false;
  let i = 0;
  const n = code.length;

  while (i < n) {
    // Preserve string literals exactly as-is
    if (code[i] === '"') {
      const start = i;
      i++;
      while (i < n && code[i] !== '"') {
        i++;
      }
      if (i < n) i++;
      result += code.slice(start, i);
      continue;
    }

    // Preserve REM comments to end of line as-is
    const sub = code.slice(i);
    const isRem = sub.toUpperCase().startsWith('REM');
    const prevChar = i > 0 ? code[i - 1] : ' ';
    const nextChar = i + 3 < n ? code[i + 3] : ' ';
    if (isRem && !/[a-zA-Z0-9_]/.test(prevChar) && !/[a-zA-Z0-9_]/.test(nextChar)) {
      result += code.slice(i);
      break;
    }

    // Collect non-string segment
    const segStart = i;
    while (i < n && code[i] !== '"') {
      const sub2 = code.slice(i);
      if (sub2.toUpperCase().startsWith('REM')) {
        const p = i > 0 ? code[i - 1] : ' ';
        const nx = i + 3 < n ? code[i + 3] : ' ';
        if (!/[a-zA-Z0-9_]/.test(p) && !/[a-zA-Z0-9_]/.test(nx)) {
          break;
        }
      }
      i++;
    }

    let seg = code.slice(segStart, i);
    // Compact spaces around relational operators, punctuation, parentheses and multipliers
    seg = seg.replace(/ *(<=|>=|<>|<|>|=|\*|\/|\^|:|;|,|\(|\)) */g, '$1');
    // Compact spaces around + and - without merging consecutive signs (e.g. + + or - -)
    seg = seg.replace(/(?<=[^+]) *\+ *(?=[^+])/g, '+');
    seg = seg.replace(/(?<=[^-]) *- *(?=[^-])/g, '-');
    // Collapse any remaining multiple consecutive spaces
    seg = seg.replace(/ {2,}/g, ' ');

    // If segment ends with an operator, strip trailing spaces before string literal
    if (/[=+\-*\/^<>(),;:]\s*$/.test(seg)) {
      seg = seg.replace(/\s+$/, '');
    }
    // If segment starts with an operator and previous was a string literal, strip leading spaces
    if (/^\s*[=+\-*\/^<>(),;:]/.test(seg) && result.endsWith('"')) {
      seg = seg.replace(/^\s+/, '');
    }

    result += seg;
  }

  return result.trim();
}

/**
 * Folds constant string concatenation terms (CHR$ n + "...", etc.) into a single string literal with control codes.
 * @param {Array<{ type: 'str'|'chr', value: string|number }>} terms 
 * @returns {string} String literal representation (with surrounding quotes)
 */
function foldStringTerms(terms) {
  let folded = '';
  let k = 0;
  while (k < terms.length) {
    const t = terms[k];
    if (t.type === 'str') {
      folded += t.value;
      k++;
      continue;
    }
    if (t.type === 'chr') {
      const code = t.value;
      const next = terms[k + 1];

      // INK (16) + color (0-9)
      if (code === 16 && next && next.type === 'chr' && next.value >= 0 && next.value <= 9) {
        folded += `{INK ${next.value}}`;
        k += 2;
        continue;
      }
      // PAPER (17) + color (0-9)
      if (code === 17 && next && next.type === 'chr' && next.value >= 0 && next.value <= 9) {
        folded += `{PAPER ${next.value}}`;
        k += 2;
        continue;
      }
      // FLASH (18) + 0, 1, 8
      if (code === 18 && next && next.type === 'chr' && (next.value === 0 || next.value === 1 || next.value === 8)) {
        folded += `{FLASH ${next.value}}`;
        k += 2;
        continue;
      }
      // BRIGHT (19) + 0, 1, 8
      if (code === 19 && next && next.type === 'chr' && (next.value === 0 || next.value === 1 || next.value === 8)) {
        folded += `{BRIGHT ${next.value}}`;
        k += 2;
        continue;
      }
      // INVERSE (20) + 0, 1
      if (code === 20 && next && next.type === 'chr' && (next.value === 0 || next.value === 1)) {
        folded += `{INVERSE ${next.value}}`;
        k += 2;
        continue;
      }
      // OVER (21) + 0, 1
      if (code === 21 && next && next.type === 'chr' && (next.value === 0 || next.value === 1)) {
        folded += `{OVER ${next.value}}`;
        k += 2;
        continue;
      }
      // AT (22) + row (0-21) + col (0-31) - skip row 13 or col 13 because byte 13 is 0x0D (Enter) in Sinclair BASIC
      const next2 = terms[k + 2];
      if (code === 22 && next && next.type === 'chr' && next.value >= 0 && next.value <= 21 && next.value !== 13 &&
          next2 && next2.type === 'chr' && next2.value >= 0 && next2.value <= 31 && next2.value !== 13) {
        folded += `{AT ${next.value},${next2.value}}`;
        k += 3;
        continue;
      }

      // Standalone CHR$ code
      if (code === 13) {
        folded += '"+CHR$ 13+"';
      } else if (code >= 32 && code <= 126 && code !== 34 && code !== 123 && code !== 125) {
        folded += String.fromCharCode(code);
      } else {
        folded += `{CODE ${code}}`;
      }
      k++;
    }
  }
  return `"${folded}"`;
}

/**
 * Optimizes constant string expressions and PRINT statements containing attribute modifiers.
 * 1. Folds constant CHR$ chains (e.g. CHR$ 17 + CHR$ 4 + " " -> "{PAPER 4} ").
 * 2. In PRINT statements, absorbs constant attributes (AT y,x; INK c; PAPER c...) into following string literals.
 * 
 * @param {string} code 
 * @returns {string}
 */
function optimizeAttributesAndStrings(code) {
  // 1. Separate REM comment if present outside strings
  let remIndex = -1;
  let inStr = false;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '"') {
      inStr = !inStr;
    } else if (!inStr) {
      if (code.slice(i, i + 3).toUpperCase() === 'REM') {
        const prev = i > 0 ? code[i - 1] : ' ';
        const next = i + 3 < code.length ? code[i + 3] : ' ';
        if (!/[a-zA-Z0-9_]/.test(prev) && !/[a-zA-Z0-9_]/.test(next)) {
          remIndex = i;
          break;
        }
      }
    }
  }

  let mainCode = remIndex !== -1 ? code.slice(0, remIndex) : code;
  const remPart = remIndex !== -1 ? code.slice(remIndex) : '';

  // 2. Fold constant string concatenations: CHR$ 17 + CHR$ 4 + " " + ...
  const chainRegex = /(?:\"[^\"]*\"|CHR\$\s*\(?\s*\d+\s*\)?)(?:\s*\+\s*(?:\"[^\"]*\"|CHR\$\s*\(?\s*\d+\s*\)?))+/gi;
  mainCode = mainCode.replace(chainRegex, (match) => {
    const terms = [];
    const termRegex = /\"([^\"]*)\"|CHR\$\s*\(?\s*(\d+)\s*\)?/gi;
    let m;
    while ((m = termRegex.exec(match)) !== null) {
      if (m[1] !== undefined) {
        terms.push({ type: 'str', value: m[1] });
      } else if (m[2] !== undefined) {
        terms.push({ type: 'chr', value: parseInt(m[2], 10) });
      }
    }
    if (terms.length >= 2) {
      return foldStringTerms(terms);
    }
    return match;
  });

  // 3. Optimize PRINT statements with constant display attributes
  // Split mainCode into statements by ':' outside strings
  const statements = [];
  let stmtStart = 0;
  inStr = false;
  for (let i = 0; i < mainCode.length; i++) {
    if (mainCode[i] === '"') {
      inStr = !inStr;
    } else if (!inStr && mainCode[i] === ':') {
      statements.push(mainCode.slice(stmtStart, i));
      stmtStart = i + 1;
    }
  }
  statements.push(mainCode.slice(stmtStart));

  const optimizedStmts = statements.map((stmt) => {
    // Only process statements containing PRINT or LPRINT
    if (!/\b(?:PRINT|LPRINT)\b/i.test(stmt)) {
      return stmt;
    }

    let s = stmt;

    // Iteratively absorb constant attributes followed by strings
    let prev;
    do {
      prev = s;
      // AT y, x (absorbed for maximum speed/RAM optimization, skipping row 13 or col 13 to avoid 0x0D / ENTER in ROM)
      s = s.replace(/\bAT\s+(\d+)\s*,\s*(\d+)\s*;?\s*\"([^\"]*)\"/gi, (match, y, x, txt) => {
        const row = parseInt(y, 10);
        const col = parseInt(x, 10);
        if (row === 13 || col === 13) {
          return match;
        }
        return `\"{AT ${y},${x}}${txt}\"`;
      });
      // INK c
      s = s.replace(/\bINK\s+(\d+)\s*;?\s*\"([^\"]*)\"/gi, (_, c, txt) => {
        return `\"{INK ${c}}${txt}\"`;
      });
      // PAPER c
      s = s.replace(/\bPAPER\s+(\d+)\s*;?\s*\"([^\"]*)\"/gi, (_, c, txt) => {
        return `\"{PAPER ${c}}${txt}\"`;
      });
      // FLASH f
      s = s.replace(/\bFLASH\s+(\d+)\s*;?\s*\"([^\"]*)\"/gi, (_, f, txt) => {
        return `\"{FLASH ${f}}${txt}\"`;
      });
      // BRIGHT b
      s = s.replace(/\bBRIGHT\s+(\d+)\s*;?\s*\"([^\"]*)\"/gi, (_, b, txt) => {
        return `\"{BRIGHT ${b}}${txt}\"`;
      });
      // INVERSE v
      s = s.replace(/\bINVERSE\s+(\d+)\s*;?\s*\"([^\"]*)\"/gi, (_, v, txt) => {
        return `\"{INVERSE ${v}}${txt}\"`;
      });
      // OVER o
      s = s.replace(/\bOVER\s+(\d+)\s*;?\s*\"([^\"]*)\"/gi, (_, o, txt) => {
        return `\"{OVER ${o}}${txt}\"`;
      });
      // Adjacent string literals separated by ';'
      s = s.replace(/\"([^\"]*)\"\s*;\s*\"([^\"]*)\"/g, (_, s1, s2) => {
        return `\"${s1}${s2}\"`;
      });
    } while (s !== prev);

    return s;
  });

  return optimizedStmts.join(':') + remPart;
}

/**
 * Formats a label name (e.g. 'game_over', 'bucle_principal', 'actualizarMarcadorYDificultad')
 * into a human-readable Title Case string for subroutine REM comments
 * (e.g. 'Game Over', 'Bucle Principal', 'Actualizar Marcador Y Dificultad').
 * @param {string} label 
 * @returns {string}
 */
function formatLabelToTitle(label) {
  if (!label) return '';
  const words = label
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9]+)/g, '$1 $2')
    .replace(/([0-9]+)([a-zA-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/);

  return words
    .filter(Boolean)
    .map(w => {
      if (w.length > 1 && w === w.toUpperCase()) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      }
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/**
 * Compiles a .jbas string into a numbered Sinclair .bas string.
 * 
 * @param {string} sourceText 
 * @param {Object} [options]
 * @param {number} [options.start=10]
 * @param {number} [options.step=10]
 * @param {boolean} [options.keepComments=false]
 * @param {boolean} [options.includeLabelComments=false]
 * @param {boolean} [options.compactWhitespace=false]
 * @param {boolean} [options.optimizeAttributes]
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
  const keepComments = !!options.keepComments;
  const includeLabelComments = !!options.includeLabelComments;
  const compactWhitespace = !!options.compactWhitespace;
  const optimizeAttributes = options.optimizePrintAttributes !== undefined
    ? !!options.optimizePrintAttributes
    : (options.optimizeAttributes !== undefined ? !!options.optimizeAttributes : compactWhitespace);

  const rawLines = sourceText.split(/\r?\n/);
  const isCrlf = sourceText.includes('\r\n');
  const eol = isCrlf ? '\r\n' : '\n';

  const errors = [];
  const warnings = [];
  const labelMap = new Map();

  // PASS 1: Strip or convert comments, collect labels, identify statements
  const statements = [];
  let pendingLabels = [];
  const seenLabels = new Map(); // labelName -> origLineNum

  for (let idx = 0; idx < rawLines.length; idx++) {
    const origLineNum = idx + 1;
    let line = keepComments
      ? convertCommentsToRem(rawLines[idx]).trim()
      : stripComments(rawLines[idx]).trim();

    if (!line) {
      // Empty line (or comment-only line when comments are stripped) -> skip
      continue;
    }

    // Extract any leading label definitions: @name:
    while (true) {
      const labelMatch = line.match(/^@([a-zA-Z0-9_]+):\s*(.*)$/);
      if (labelMatch) {
        const labelName = labelMatch[1];
        if (seenLabels.has(labelName)) {
          const prevLine = seenLabels.get(labelName);
          errors.push(`Line ${origLineNum}: Duplicate label definition '@${labelName}' (previously defined on line ${prevLine})`);
        } else {
          seenLabels.set(labelName, origLineNum);
        }
        pendingLabels.push(labelName);
        line = labelMatch[2].trim();
        if (line.startsWith(':')) {
          line = line.slice(1).trim();
        }
      } else {
        break;
      }
    }

    // If code remains after label extraction, it's a statement
    if (line) {
      if (includeLabelComments && pendingLabels.length > 0) {
        for (const lbl of pendingLabels) {
          statements.push({
            origLineNum: seenLabels.get(lbl) || origLineNum,
            code: `REM SUB ${formatLabelToTitle(lbl)}`,
            labels: [lbl]
          });
        }
        pendingLabels = [];
      }
      statements.push({
        origLineNum,
        code: line,
        labels: pendingLabels
      });
      pendingLabels = [];
    }
  }

  // If there are trailing labels with no statement, emit label comments if enabled
  if (includeLabelComments && pendingLabels.length > 0) {
    for (const lbl of pendingLabels) {
      statements.push({
        origLineNum: seenLabels.get(lbl) || rawLines.length,
        code: `REM SUB ${formatLabelToTitle(lbl)}`,
        labels: [lbl]
      });
    }
    pendingLabels = [];
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
  const basicToSource = new Map();
  const sourceToBasic = new Map();

  for (const stmt of statements) {
    stmt.lineNum = currentNum;
    basicToSource.set(currentNum, stmt.origLineNum);
    sourceToBasic.set(stmt.origLineNum, currentNum);

    for (const lbl of stmt.labels) {
      labelMap.set(lbl, currentNum);
      const labelOrigLine = seenLabels.get(lbl);
      if (labelOrigLine) {
        sourceToBasic.set(labelOrigLine, currentNum);
      }
    }
    currentNum += step;
  }

  // If there are trailing labels with no statement, map them to currentNum (or warn)
  if (pendingLabels.length > 0) {
    for (const lbl of pendingLabels) {
      labelMap.set(lbl, currentNum);
      const labelOrigLine = seenLabels.get(lbl);
      if (labelOrigLine) {
        sourceToBasic.set(labelOrigLine, currentNum);
      }
      warnings.push(`Label '@${lbl}' defined at the very end of file (maps to line ${currentNum})`);
    }
  }

  // PASS 2: Replace label references with line numbers
  const outputLines = [];
  for (const stmt of statements) {
    let resolvedCode = replaceLabelsOutsideStrings(stmt.code, labelMap, errors, stmt.origLineNum);
    if (optimizeAttributes) {
      resolvedCode = optimizeAttributesAndStrings(resolvedCode);
    }
    if (compactWhitespace) {
      resolvedCode = compactWhitespaceOutsideStrings(resolvedCode);
    }
    outputLines.push(`${stmt.lineNum} ${resolvedCode}`);
  }

  const resultText = outputLines.join(eol) + eol;

  return {
    success: errors.length === 0,
    text: resultText,
    labels: labelMap,
    basicToSource,
    sourceToBasic,
    lineMap: {
      basicToSource: Object.fromEntries(basicToSource),
      sourceToBasic: Object.fromEntries(sourceToBasic)
    },
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

/**
 * Transpiles .jbas source into 3 standard Sinclair BASIC versions:
 * 1) compact: lines 1 by 1, without comments (<name>.bas - most optimal for TAP)
 * 2) step10: lines 10 by 10, without comments (<name>-step10.bas)
 * 3) comments: lines 10 by 10, with comments (<name>-comments.bas)
 * 
 * @param {string} sourceText 
 * @returns {{
 *   compact: ReturnType<typeof compileJBas>,
 *   step10: ReturnType<typeof compileJBas>,
 *   comments: ReturnType<typeof compileJBas>,
 *   success: boolean,
 *   errors: string[]
 * }}
 */
function transpileJBasAllVersions(sourceText, options = {}) {
  const optimizePrintAttributes = options.optimizePrintAttributes !== undefined
    ? !!options.optimizePrintAttributes
    : (options.optimizeAttributes !== undefined ? !!options.optimizeAttributes : true);

  const compact = compileJBas(sourceText, {
    start: 1,
    step: 1,
    keepComments: false,
    compactWhitespace: true,
    optimizePrintAttributes
  });
  const step10 = compileJBas(sourceText, {
    start: 10,
    step: 10,
    keepComments: false,
    compactWhitespace: false,
    optimizePrintAttributes
  });
  const comments = compileJBas(sourceText, {
    start: 10,
    step: 10,
    keepComments: true,
    includeLabelComments: true,
    compactWhitespace: false,
    optimizePrintAttributes: false
  });

  const sinclair = {
    ...step10,
    text: translateWildcardsToChr(step10.text)
  };

  const errors = [...new Set([...compact.errors, ...step10.errors, ...comments.errors])];
  const success = compact.success && step10.success && comments.success;

  return {
    compact,
    step10,
    comments,
    sinclair,
    success,
    errors
  };
}

module.exports = {
  stripComments,
  convertCommentsToRem,
  formatLabelToTitle,
  replaceLabelsOutsideStrings,
  compactWhitespaceOutsideStrings,
  foldStringTerms,
  optimizeAttributesAndStrings,
  compileJBas,
  compileJBasFile,
  transpileJBasAllVersions,
  translateWildcardsToChr
};

if (require.main === module) {
  runCli();
}

