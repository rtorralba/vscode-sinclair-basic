/**
 * Sinclair BASIC Keyword Formatter
 * Pure JavaScript module that formats Sinclair BASIC (.bas) and Pseudo-BASIC (.jbas)
 * code so that all language keywords are converted to UPPERCASE.
 * 
 * Strict invariants:
 * 1. String literals ("...") are strictly preserved verbatim.
 * 2. REM comments are preserved verbatim (only the REM token itself is uppercased).
 * 3. Single-quote comments ('...) in .jbas are strictly preserved verbatim.
 * 4. Jump labels (@label) in .jbas are strictly preserved verbatim.
 * 5. Variable names containing keyword substrings (e.g. score, total, format_name) are never altered.
 */

// Multi-word and special keywords with flexible spacing
const MULTI_WORD_PATTERNS = [
  { regex: /^GO\s+TO(?=[^a-zA-Z0-9_]|$)/i, name: 'GO TO' },
  { regex: /^GO\s+SUB(?=[^a-zA-Z0-9_]|$)/i, name: 'GO SUB' },
  { regex: /^DEF\s+FN(?=[^a-zA-Z0-9_]|$)/i, name: 'DEF FN' },
  { regex: /^OPEN\s*#/i, name: 'OPEN #' },
  { regex: /^CLOSE\s*#/i, name: 'CLOSE #' }
];

// Keywords ending with $
const DOLLAR_KEYWORDS = [
  'SCREEN$',
  'INKEY$',
  'VAL$',
  'STR$',
  'CHR$'
];

// Single-word Sinclair BASIC keywords sorted descending by length
const SINGLE_WORD_KEYWORDS = [
  // Length 9
  'RANDOMIZE',
  // Length 8
  'CONTINUE', 'RESTORE', 'SPECTRUM',
  // Length 7
  'FORMAT', 'BORDER', 'INVERSE', 'BRIGHT', 'CIRCLE', 'RETURN', 'VERIFY',
  // Length 6
  'LPRINT', 'LLIST', 'FLASH', 'PAPER', 'PAUSE', 'PRINT', 'CLEAR', 'MERGE', 'ERASE', 'POINT',
  // Length 5
  'INPUT', 'ATTR', 'CODE', 'PEEK', 'POKE', 'PLOT', 'DRAW', 'DATA', 'READ', 'STEP', 'STOP',
  'LOAD', 'SAVE', 'LIST', 'LINE', 'OVER', 'MOVE', 'BEEP', 'COPY', 'PLAY', 'THEN', 'NEXT', 'GOTO', 'GOSUB',
  // Length 4
  'CAT', 'CLS', 'DIM', 'FOR', 'LET', 'NEW', 'NOT', 'OUT', 'RUN', 'REM', 'RND', 'TAB', 'USR', 'VAL', 'LEN',
  // Length 3
  'INK', 'EXP', 'SIN', 'COS', 'TAN', 'ASN', 'ACS', 'ATN', 'INT', 'SQR', 'SGN', 'ABS', 'BIN', 'AND',
  // Length 2
  'AT', 'FN', 'IF', 'IN', 'LN', 'OR', 'PI', 'TO'
];

/**
 * Checks if the position i in line represents a valid word boundary on the left.
 * A keyword cannot be preceded by an alphanumeric character, underscore, @, or $.
 * Exception: if line starts with line number and directly attaches to keyword (e.g. 10PRINT).
 * @param {string} line 
 * @param {number} i 
 * @returns {boolean}
 */
function isWordBoundaryBefore(line, i) {
  if (i === 0) return true;
  const prevChar = line[i - 1];
  if (/[a-zA-Z0-9_@$]/.test(prevChar)) {
    // If the line up to i consists purely of leading whitespace and line number digits, allow it
    if (/^\s*\d+$/.test(line.slice(0, i))) {
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Formats a single line of Sinclair BASIC or JBAS code.
 * @param {string} line - Line text without line terminator
 * @param {boolean} isJBas - Whether to respect .jbas syntax (' comments and @labels)
 * @returns {string} - Formatted line
 */
function formatLineKeywords(line, isJBas = true) {
  let result = '';
  let i = 0;
  const n = line.length;

  while (i < n) {
    const c = line[i];

    // 1. String literal: preserve everything inside "..." verbatim
    if (c === '"') {
      result += '"';
      i++;
      while (i < n && line[i] !== '"') {
        result += line[i];
        i++;
      }
      if (i < n) {
        result += '"';
        i++;
      }
      continue;
    }

    // 2. Single-quote comment in .jbas: preserve ' and remainder of line verbatim
    if (isJBas && c === "'") {
      result += line.slice(i);
      break;
    }

    // 3. Jump label in .jbas: preserve @label verbatim
    if (isJBas && c === '@') {
      const match = line.slice(i).match(/^@[a-zA-Z0-9_]+/);
      if (match) {
        result += match[0];
        i += match[0].length;
        continue;
      }
    }

    // Check word boundary before attempting any keyword match
    if (isWordBoundaryBefore(line, i)) {
      const sub = line.slice(i);

      // 4. Multi-word patterns (GO TO, GO SUB, DEF FN, OPEN #, CLOSE #)
      let multiMatched = false;
      for (const pattern of MULTI_WORD_PATTERNS) {
        const m = sub.match(pattern.regex);
        if (m) {
          result += m[0].toUpperCase();
          i += m[0].length;
          multiMatched = true;
          break;
        }
      }
      if (multiMatched) continue;

      // 5. Dollar functions (SCREEN$, INKEY$, VAL$, STR$, CHR$)
      let dollarMatched = false;
      for (const dkw of DOLLAR_KEYWORDS) {
        if (sub.slice(0, dkw.length).toUpperCase() === dkw) {
          // Boundary after: must not be followed by $ or alphanumeric/underscore
          const nextChar = line[i + dkw.length];
          if (!nextChar || !/[a-zA-Z0-9_$]/.test(nextChar)) {
            result += dkw;
            i += dkw.length;
            dollarMatched = true;
            break;
          }
        }
      }
      if (dollarMatched) continue;

      // 6. Single-word keywords
      let singleMatched = false;
      for (const kw of SINGLE_WORD_KEYWORDS) {
        if (sub.slice(0, kw.length).toUpperCase() === kw) {
          // Boundary after: must not be followed by alphanumeric or underscore
          const nextChar = line[i + kw.length];
          if (!nextChar || !/[a-zA-Z0-9_]/.test(nextChar)) {
            // Special handling for REM: uppercase REM token, then copy rest of line as raw comment
            if (kw === 'REM') {
              result += 'REM';
              result += line.slice(i + 3);
              i = n; // Skip to end of line
              singleMatched = true;
              break;
            }

            result += kw;
            i += kw.length;
            singleMatched = true;
            break;
          }
        }
      }
      if (singleMatched) continue;
    }

    // Default: copy current character as-is
    result += c;
    i++;
  }

  return result;
}

/**
 * Formats Sinclair BASIC or JBAS source code, converting all keywords to UPPERCASE
 * while safely preserving string literals, REM comments, inline comments, labels,
 * and variable names.
 * 
 * @param {string} code - Full source code or selection
 * @param {Object} [options]
 * @param {boolean} [options.isJBas] - True if formatting .jbas, false for pure .bas (default: true)
 * @returns {string} - Formatted code with preserved line endings
 */
function formatKeywordsToUpper(code, options = {}) {
  if (typeof code !== 'string' || !code) {
    return code;
  }

  const isJBas = options.isJBas !== false;
  const isCrlf = code.includes('\r\n');
  const separator = isCrlf ? '\r\n' : '\n';
  const lines = code.split(/\r?\n/);

  const formattedLines = lines.map(line => formatLineKeywords(line, isJBas));
  return formattedLines.join(separator);
}

module.exports = {
  formatKeywordsToUpper,
  formatLineKeywords,
  isWordBoundaryBefore
};
