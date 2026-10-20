/**
 * Sinclair BASIC Wildcard Translator
 * 
 * Translates bas2tap control code escape sequences ({PAPER n}, {INK n}, {AT y,x}, etc.)
 * inside string literals into standard Sinclair BASIC CHR$ concatenation expressions.
 */

/**
 * Translates a string literal's inner content (without the surrounding quotes)
 * converting any bas2tap escape sequences into standard Sinclair BASIC CHR$ expressions.
 * 
 * @param {string} strContent - String content without surrounding quotes
 * @returns {string} - Replacement expression (either original "str" or CHR$ ... + "str")
 */
function translateStringLiteralToChr(strContent) {
  const parts = [];
  let currentText = '';
  let i = 0;
  const n = strContent.length;
  let hasWildcards = false;

  while (i < n) {
    // 1. Check for {...} wildcard
    if (strContent[i] === '{') {
      const closeIdx = strContent.indexOf('}', i + 1);
      if (closeIdx !== -1) {
        const content = strContent.slice(i + 1, closeIdx).trim();
        const upper = content.toUpperCase();
        let chrs = null;

        // UDG {A}..{U}
        if (content.length === 1 && upper >= 'A' && upper <= 'U') {
          chrs = [144 + upper.charCodeAt(0) - 65];
        } else {
          let m = upper.match(/^INK\s+(\d+)$/);
          if (m) chrs = [16, parseInt(m[1], 10) & 0xFF];
          if (!chrs) {
            m = upper.match(/^PAPER\s+(\d+)$/);
            if (m) chrs = [17, parseInt(m[1], 10) & 0xFF];
          }
          if (!chrs) {
            m = upper.match(/^FLASH\s+(\d+)$/);
            if (m) chrs = [18, parseInt(m[1], 10) & 0xFF];
          }
          if (!chrs) {
            m = upper.match(/^BRIGHT\s+(\d+)$/);
            if (m) chrs = [19, parseInt(m[1], 10) & 0xFF];
          }
          if (!chrs) {
            m = upper.match(/^INVERSE\s+(\d+)$/);
            if (m) chrs = [20, parseInt(m[1], 10) & 0xFF];
          }
          if (!chrs) {
            m = upper.match(/^OVER\s+(\d+)$/);
            if (m) chrs = [21, parseInt(m[1], 10) & 0xFF];
          }
          if (!chrs) {
            m = upper.match(/^AT\s+(\d+)\s*,\s*(\d+)$/);
            if (m) chrs = [22, parseInt(m[1], 10) & 0xFF, parseInt(m[2], 10) & 0xFF];
          }
          if (!chrs) {
            m = upper.match(/^TAB\s+(\d+)(?:\s*,\s*(\d+))?$/);
            if (m) {
              chrs = m[2] !== undefined
                ? [23, parseInt(m[1], 10) & 0xFF, parseInt(m[2], 10) & 0xFF]
                : [23, parseInt(m[1], 10) & 0xFF];
            }
          }
          if (!chrs) {
            m = upper.match(/^CODE\s+(\d+)$/);
            if (m) chrs = [parseInt(m[1], 10) & 0xFF];
          }
          if (!chrs) {
            m = upper.match(/^#([0-9A-F]{1,2})$/);
            if (m) chrs = [parseInt(m[1], 16) & 0xFF];
          }
          if (!chrs) {
            m = upper.match(/^\\X([0-9A-F]{1,2})$/);
            if (m) chrs = [parseInt(m[1], 16) & 0xFF];
          }
        }

        if (chrs) {
          hasWildcards = true;
          if (currentText.length > 0) {
            parts.push({ type: 'text', value: currentText });
            currentText = '';
          }
          parts.push({ type: 'chr', values: chrs });
          i = closeIdx + 1;
          continue;
        }
      }
    }

    // 2. Check for backslash escapes (\A..\U, \xHH)
    if (strContent[i] === '\\' && i + 1 < n) {
      const nextChar = strContent[i + 1].toUpperCase();
      if (nextChar >= 'A' && nextChar <= 'U') {
        hasWildcards = true;
        if (currentText.length > 0) {
          parts.push({ type: 'text', value: currentText });
          currentText = '';
        }
        parts.push({ type: 'chr', values: [144 + nextChar.charCodeAt(0) - 65] });
        i += 2;
        continue;
      }
      const hexMatch = strContent.slice(i).match(/^\\x([0-9a-fA-F]{2})/i);
      if (hexMatch) {
        hasWildcards = true;
        if (currentText.length > 0) {
          parts.push({ type: 'text', value: currentText });
          currentText = '';
        }
        parts.push({ type: 'chr', values: [parseInt(hexMatch[1], 16)] });
        i += 4;
        continue;
      }
    }

    currentText += strContent[i];
    i++;
  }

  if (!hasWildcards) {
    return `"${strContent}"`;
  }

  if (currentText.length > 0) {
    parts.push({ type: 'text', value: currentText });
  }

  const terms = [];
  for (const p of parts) {
    if (p.type === 'text') {
      terms.push(`"${p.value}"`);
    } else if (p.type === 'chr') {
      for (const val of p.values) {
        terms.push(`CHR$ ${val}`);
      }
    }
  }

  return terms.join(' + ');
}

/**
 * Translates a single line of Sinclair BASIC or JBAS, replacing any bas2tap
 * wildcards inside string literals with standard Sinclair BASIC CHR$ expressions.
 * 
 * @param {string} line 
 * @param {boolean} [isJBas=true] 
 * @returns {string}
 */
function translateLineWildcards(line, isJBas = true) {
  let result = '';
  let i = 0;
  const n = line.length;

  while (i < n) {
    const c = line[i];

    // String literal: parse and translate any control codes
    if (c === '"') {
      const start = i + 1;
      let closeIdx = -1;
      let k = start;
      while (k < n) {
        if (line[k] === '"') {
          closeIdx = k;
          break;
        }
        k++;
      }

      if (closeIdx === -1) {
        // Unclosed quote: process rest of line as string content
        const inner = line.slice(start);
        result += translateStringLiteralToChr(inner);
        break;
      } else {
        const inner = line.slice(start, closeIdx);
        result += translateStringLiteralToChr(inner);
        i = closeIdx + 1;
        continue;
      }
    }

    // JBAS single-quote comment: preserve verbatim to end of line
    if (isJBas && c === "'") {
      result += line.slice(i);
      break;
    }

    // REM comment outside strings: preserve verbatim to end of line
    if (line.slice(i, i + 3).toUpperCase() === 'REM') {
      const prevChar = i > 0 ? line[i - 1] : ' ';
      const nextChar = i + 3 < n ? line[i + 3] : ' ';
      if (!/[a-zA-Z0-9_]/.test(prevChar) && !/[a-zA-Z0-9_]/.test(nextChar)) {
        result += line.slice(i);
        break;
      }
    }

    result += c;
    i++;
  }

  return result;
}

/**
 * Translates all bas2tap wildcards inside string literals across the given program
 * into standard Sinclair BASIC CHR$ expressions.
 * 
 * @param {string} code - Full BASIC program text
 * @param {Object} [options]
 * @param {boolean} [options.isJBas=true] - Whether to respect .jbas single-quote comments
 * @returns {string} - Program code in pure standard Sinclair BASIC syntax
 */
function translateWildcardsToChr(code, options = {}) {
  if (typeof code !== 'string' || !code) {
    return code;
  }

  const isJBas = options.isJBas !== false;
  const isCrlf = code.includes('\r\n');
  const separator = isCrlf ? '\r\n' : '\n';
  const lines = code.split(/\r?\n/);

  const translatedLines = lines.map(line => translateLineWildcards(line, isJBas));
  return translatedLines.join(separator);
}

module.exports = {
  translateStringLiteralToChr,
  translateLineWildcards,
  translateWildcardsToChr
};
