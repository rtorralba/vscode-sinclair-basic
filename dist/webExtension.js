var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// src/core/renumber.js
var require_renumber = __commonJS({
  "src/core/renumber.js"(exports2, module2) {
    var fs;
    try {
      fs = require("fs");
    } catch {
      fs = null;
    }
    var path;
    try {
      path = require("path");
    } catch {
      path = null;
    }
    function isAlphanumeric(char) {
      if (!char) return false;
      const code = char.charCodeAt(0);
      return code >= 48 && code <= 57 || // 0-9
      code >= 65 && code <= 90 || // A-Z
      code >= 97 && code <= 122;
    }
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
        leadingWs: "",
        lineNum: null,
        code: rawLine,
        rawLine
      };
    }
    function splitStringsAndRem(lineCode) {
      const chunks = [];
      let i = 0;
      const n = lineCode.length;
      let currentCode = [];
      while (i < n) {
        const c = lineCode[i];
        if (c === '"') {
          if (currentCode.length > 0) {
            chunks.push({ text: currentCode.join(""), type: "code" });
            currentCode = [];
          }
          const start = i;
          i++;
          while (i < n && lineCode[i] !== '"') {
            i++;
          }
          if (i < n) {
            i++;
          }
          chunks.push({ text: lineCode.slice(start, i), type: "string" });
          continue;
        }
        const isRem = lineCode.slice(i, i + 3).toUpperCase() === "REM";
        const prevChar = i > 0 ? lineCode[i - 1] : null;
        const nextChar = i + 3 < n ? lineCode[i + 3] : null;
        if (isRem && !isAlphanumeric(prevChar) && !isAlphanumeric(nextChar)) {
          if (currentCode.length > 0) {
            chunks.push({ text: currentCode.join(""), type: "code" });
            currentCode = [];
          }
          chunks.push({ text: lineCode.slice(i), type: "rem" });
          break;
        }
        currentCode.push(c);
        i++;
      }
      if (currentCode.length > 0) {
        chunks.push({ text: currentCode.join(""), type: "code" });
      }
      return chunks;
    }
    function updateReferencesInCode(codeStr, mapping, warnings) {
      const pattern = /\b(GO\s*TO|GOTO|GO\s*SUB|GOSUB|RUN|RESTORE|LINE|THEN)\s+(\d+(?:\s*,\s*\d+)*)/gi;
      return codeStr.replace(pattern, (fullMatch, keyword, targetsStr) => {
        const parts = targetsStr.split(/(\s*,\s*)/);
        const updatedParts = [];
        for (const part of parts) {
          const trimmed = part.trim();
          if (/^\d+$/.test(trimmed)) {
            const targetNum = parseInt(trimmed, 10);
            if (mapping.has(targetNum)) {
              const newTarget = String(mapping.get(targetNum));
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
        return `${keyword} ${updatedParts.join("")}`;
      });
    }
    function renumberProgram2(sourceText, options = {}) {
      const start = typeof options.start === "number" ? options.start : 10;
      const step = typeof options.step === "number" ? options.step : 10;
      const isCrlf = sourceText.includes("\r\n");
      const eol = isCrlf ? "\r\n" : "\n";
      const rawLines = sourceText.split(/\r?\n/);
      const hasTrailingNewline = sourceText.endsWith("\n");
      if (hasTrailingNewline && rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
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
          warnings: ["No line numbers found in program."],
          mapping: /* @__PURE__ */ new Map(),
          linesCount: 0
        };
      }
      const mapping = /* @__PURE__ */ new Map();
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
        const chunks = splitStringsAndRem(code);
        const updatedCodeParts = [];
        for (const chunk of chunks) {
          if (chunk.type === "code") {
            updatedCodeParts.push(updateReferencesInCode(chunk.text, mapping, warnings));
          } else {
            updatedCodeParts.push(chunk.text);
          }
        }
        const updatedCode = updatedCodeParts.join("");
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
    function renumberFile(inputFile, options = {}) {
      const start = typeof options.start === "number" ? options.start : 10;
      const step = typeof options.step === "number" ? options.step : 10;
      const makeBackup = options.makeBackup !== false;
      const outputFile = options.outputFile || inputFile;
      if (!fs.existsSync(inputFile)) {
        console.error(`Error: File not found: ${inputFile}`);
        return false;
      }
      const content = fs.readFileSync(inputFile, "utf-8");
      const result = renumberProgram2(content, { start, step });
      if (!result.success) {
        console.log(`No line numbers found in ${inputFile}.`);
        return false;
      }
      console.log(`Renumbering ${result.linesCount} lines (start=${start}, step=${step})...`);
      if (makeBackup && fs.existsSync(outputFile) && path.resolve(outputFile) === path.resolve(inputFile)) {
        const bakFile = inputFile + ".bak";
        fs.writeFileSync(bakFile, content, "utf-8");
        console.log(`Backup created: ${bakFile}`);
      }
      fs.writeFileSync(outputFile, result.text, "utf-8");
      console.log(`Successfully renumbered to: ${outputFile}`);
      if (result.warnings.length > 0) {
        console.log("\nWarnings:");
        for (const w of result.warnings) {
          console.log(`  - ${w}`);
        }
      }
      return true;
    }
    function runCli() {
      const args = process.argv.slice(2);
      if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
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
        if (arg === "--start" && i + 1 < args.length) {
          start = parseInt(args[++i], 10);
        } else if (arg === "--step" && i + 1 < args.length) {
          step = parseInt(args[++i], 10);
        } else if (arg === "--out" && i + 1 < args.length) {
          outputFile = args[++i];
        } else if (arg === "--no-backup") {
          makeBackup = false;
        } else if (!arg.startsWith("-")) {
          fileArgs.push(arg);
        }
      }
      if (fileArgs.length === 0) {
        console.error("Error: No input file specified.");
        process.exit(1);
      }
      inputFile = fileArgs.join(" ");
      const ok = renumberFile(inputFile, { outputFile, start, step, makeBackup });
      process.exit(ok ? 0 : 1);
    }
    module2.exports = {
      parseLine,
      splitStringsAndRem,
      updateReferencesInCode,
      renumberProgram: renumberProgram2,
      renumberFile
    };
    if (require.main === module2) {
      runCli();
    }
  }
});

// src/core/wildcards.js
var require_wildcards = __commonJS({
  "src/core/wildcards.js"(exports2, module2) {
    function translateStringLiteralToChr(strContent) {
      const parts = [];
      let currentText = "";
      let i = 0;
      const n = strContent.length;
      let hasWildcards = false;
      while (i < n) {
        if (strContent[i] === "{") {
          const closeIdx = strContent.indexOf("}", i + 1);
          if (closeIdx !== -1) {
            const content = strContent.slice(i + 1, closeIdx).trim();
            const upper = content.toUpperCase();
            let chrs = null;
            if (content.length === 1 && upper >= "A" && upper <= "U") {
              chrs = [144 + upper.charCodeAt(0) - 65];
            } else {
              let m = upper.match(/^INK\s+(\d+)$/);
              if (m) chrs = [16, parseInt(m[1], 10) & 255];
              if (!chrs) {
                m = upper.match(/^PAPER\s+(\d+)$/);
                if (m) chrs = [17, parseInt(m[1], 10) & 255];
              }
              if (!chrs) {
                m = upper.match(/^FLASH\s+(\d+)$/);
                if (m) chrs = [18, parseInt(m[1], 10) & 255];
              }
              if (!chrs) {
                m = upper.match(/^BRIGHT\s+(\d+)$/);
                if (m) chrs = [19, parseInt(m[1], 10) & 255];
              }
              if (!chrs) {
                m = upper.match(/^INVERSE\s+(\d+)$/);
                if (m) chrs = [20, parseInt(m[1], 10) & 255];
              }
              if (!chrs) {
                m = upper.match(/^OVER\s+(\d+)$/);
                if (m) chrs = [21, parseInt(m[1], 10) & 255];
              }
              if (!chrs) {
                m = upper.match(/^AT\s+(\d+)\s*,\s*(\d+)$/);
                if (m) chrs = [22, parseInt(m[1], 10) & 255, parseInt(m[2], 10) & 255];
              }
              if (!chrs) {
                m = upper.match(/^TAB\s+(\d+)(?:\s*,\s*(\d+))?$/);
                if (m) {
                  chrs = m[2] !== void 0 ? [23, parseInt(m[1], 10) & 255, parseInt(m[2], 10) & 255] : [23, parseInt(m[1], 10) & 255];
                }
              }
              if (!chrs) {
                m = upper.match(/^CODE\s+(\d+)$/);
                if (m) chrs = [parseInt(m[1], 10) & 255];
              }
              if (!chrs) {
                m = upper.match(/^#([0-9A-F]{1,2})$/);
                if (m) chrs = [parseInt(m[1], 16) & 255];
              }
              if (!chrs) {
                m = upper.match(/^\\X([0-9A-F]{1,2})$/);
                if (m) chrs = [parseInt(m[1], 16) & 255];
              }
            }
            if (chrs) {
              hasWildcards = true;
              if (currentText.length > 0) {
                parts.push({ type: "text", value: currentText });
                currentText = "";
              }
              parts.push({ type: "chr", values: chrs });
              i = closeIdx + 1;
              continue;
            }
          }
        }
        if (strContent[i] === "\\" && i + 1 < n) {
          const nextChar = strContent[i + 1].toUpperCase();
          if (nextChar >= "A" && nextChar <= "U") {
            hasWildcards = true;
            if (currentText.length > 0) {
              parts.push({ type: "text", value: currentText });
              currentText = "";
            }
            parts.push({ type: "chr", values: [144 + nextChar.charCodeAt(0) - 65] });
            i += 2;
            continue;
          }
          const hexMatch = strContent.slice(i).match(/^\\x([0-9a-fA-F]{2})/i);
          if (hexMatch) {
            hasWildcards = true;
            if (currentText.length > 0) {
              parts.push({ type: "text", value: currentText });
              currentText = "";
            }
            parts.push({ type: "chr", values: [parseInt(hexMatch[1], 16)] });
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
        parts.push({ type: "text", value: currentText });
      }
      const terms = [];
      for (const p of parts) {
        if (p.type === "text") {
          terms.push(`"${p.value}"`);
        } else if (p.type === "chr") {
          for (const val of p.values) {
            terms.push(`CHR$ ${val}`);
          }
        }
      }
      return terms.join(" + ");
    }
    function translateLineWildcards(line, isJBas = true) {
      let result = "";
      let i = 0;
      const n = line.length;
      while (i < n) {
        const c = line[i];
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
        if (isJBas && c === "'") {
          result += line.slice(i);
          break;
        }
        if (line.slice(i, i + 3).toUpperCase() === "REM") {
          const prevChar = i > 0 ? line[i - 1] : " ";
          const nextChar = i + 3 < n ? line[i + 3] : " ";
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
    function translateWildcardsToChr2(code, options = {}) {
      if (typeof code !== "string" || !code) {
        return code;
      }
      const isJBas = options.isJBas !== false;
      const isCrlf = code.includes("\r\n");
      const separator = isCrlf ? "\r\n" : "\n";
      const lines = code.split(/\r?\n/);
      const translatedLines = lines.map((line) => translateLineWildcards(line, isJBas));
      return translatedLines.join(separator);
    }
    module2.exports = {
      translateStringLiteralToChr,
      translateLineWildcards,
      translateWildcardsToChr: translateWildcardsToChr2
    };
  }
});

// src/core/jbas2bas.js
var require_jbas2bas = __commonJS({
  "src/core/jbas2bas.js"(exports2, module2) {
    var fs;
    try {
      fs = require("fs");
    } catch {
      fs = null;
    }
    var path;
    try {
      path = require("path");
    } catch {
      path = null;
    }
    var { translateWildcardsToChr: translateWildcardsToChr2 } = require_wildcards();
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
          const remSpacing = commentText.startsWith(" ") || commentText.length === 0 ? "" : " ";
          if (!before) {
            return `REM${remSpacing}${commentText}`;
          }
          if (before.endsWith(":")) {
            return `${before} REM${remSpacing}${commentText}`;
          }
          return `${before}: REM${remSpacing}${commentText}`;
        }
        i++;
      }
      return line;
    }
    function replaceLabelsOutsideStrings(code, labelMap, errors, sourceLineIndex) {
      let result = "";
      let i = 0;
      const n = code.length;
      while (i < n) {
        const c = code[i];
        if (c === '"') {
          const start = i;
          i++;
          while (i < n && code[i] !== '"') {
            i++;
          }
          if (i < n) i++;
          result += code.slice(start, i);
          continue;
        }
        const isRem = code.slice(i, i + 3).toUpperCase() === "REM";
        const prevChar = i > 0 ? code[i - 1] : " ";
        const nextChar = i + 3 < n ? code[i + 3] : " ";
        const isWordBoundary = !/[a-zA-Z0-9_]/.test(prevChar) && !/[a-zA-Z0-9_]/.test(nextChar);
        if (isRem && isWordBoundary) {
          result += code.slice(i);
          break;
        }
        if (c === "@") {
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
    function compactWhitespaceOutsideStrings(code) {
      let result = "";
      let inString = false;
      let i = 0;
      const n = code.length;
      while (i < n) {
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
        const sub = code.slice(i);
        const isRem = sub.toUpperCase().startsWith("REM");
        const prevChar = i > 0 ? code[i - 1] : " ";
        const nextChar = i + 3 < n ? code[i + 3] : " ";
        if (isRem && !/[a-zA-Z0-9_]/.test(prevChar) && !/[a-zA-Z0-9_]/.test(nextChar)) {
          result += code.slice(i);
          break;
        }
        const segStart = i;
        while (i < n && code[i] !== '"') {
          const sub2 = code.slice(i);
          if (sub2.toUpperCase().startsWith("REM")) {
            const p = i > 0 ? code[i - 1] : " ";
            const nx = i + 3 < n ? code[i + 3] : " ";
            if (!/[a-zA-Z0-9_]/.test(p) && !/[a-zA-Z0-9_]/.test(nx)) {
              break;
            }
          }
          i++;
        }
        let seg = code.slice(segStart, i);
        seg = seg.replace(/ *(<=|>=|<>|<|>|=|\*|\/|\^|:|;|,|\(|\)) */g, "$1");
        seg = seg.replace(/(?<=[^+]) *\+ *(?=[^+])/g, "+");
        seg = seg.replace(/(?<=[^-]) *- *(?=[^-])/g, "-");
        seg = seg.replace(/ {2,}/g, " ");
        if (/[=+\-*\/^<>(),;:]\s*$/.test(seg)) {
          seg = seg.replace(/\s+$/, "");
        }
        if (/^\s*[=+\-*\/^<>(),;:]/.test(seg) && result.endsWith('"')) {
          seg = seg.replace(/^\s+/, "");
        }
        result += seg;
      }
      return result.trim();
    }
    function foldStringTerms(terms) {
      let folded = "";
      let k = 0;
      while (k < terms.length) {
        const t = terms[k];
        if (t.type === "str") {
          folded += t.value;
          k++;
          continue;
        }
        if (t.type === "chr") {
          const code = t.value;
          const next = terms[k + 1];
          if (code === 16 && next && next.type === "chr" && next.value >= 0 && next.value <= 9) {
            folded += `{INK ${next.value}}`;
            k += 2;
            continue;
          }
          if (code === 17 && next && next.type === "chr" && next.value >= 0 && next.value <= 9) {
            folded += `{PAPER ${next.value}}`;
            k += 2;
            continue;
          }
          if (code === 18 && next && next.type === "chr" && (next.value === 0 || next.value === 1 || next.value === 8)) {
            folded += `{FLASH ${next.value}}`;
            k += 2;
            continue;
          }
          if (code === 19 && next && next.type === "chr" && (next.value === 0 || next.value === 1 || next.value === 8)) {
            folded += `{BRIGHT ${next.value}}`;
            k += 2;
            continue;
          }
          if (code === 20 && next && next.type === "chr" && (next.value === 0 || next.value === 1)) {
            folded += `{INVERSE ${next.value}}`;
            k += 2;
            continue;
          }
          if (code === 21 && next && next.type === "chr" && (next.value === 0 || next.value === 1)) {
            folded += `{OVER ${next.value}}`;
            k += 2;
            continue;
          }
          const next2 = terms[k + 2];
          if (code === 22 && next && next.type === "chr" && next.value >= 0 && next.value <= 21 && next.value !== 13 && next2 && next2.type === "chr" && next2.value >= 0 && next2.value <= 31 && next2.value !== 13) {
            folded += `{AT ${next.value},${next2.value}}`;
            k += 3;
            continue;
          }
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
    function optimizeAttributesAndStrings(code) {
      let remIndex = -1;
      let inStr = false;
      for (let i = 0; i < code.length; i++) {
        if (code[i] === '"') {
          inStr = !inStr;
        } else if (!inStr) {
          if (code.slice(i, i + 3).toUpperCase() === "REM") {
            const prev = i > 0 ? code[i - 1] : " ";
            const next = i + 3 < code.length ? code[i + 3] : " ";
            if (!/[a-zA-Z0-9_]/.test(prev) && !/[a-zA-Z0-9_]/.test(next)) {
              remIndex = i;
              break;
            }
          }
        }
      }
      let mainCode = remIndex !== -1 ? code.slice(0, remIndex) : code;
      const remPart = remIndex !== -1 ? code.slice(remIndex) : "";
      const chainRegex = /(?:\"[^\"]*\"|CHR\$\s*\(?\s*\d+\s*\)?)(?:\s*\+\s*(?:\"[^\"]*\"|CHR\$\s*\(?\s*\d+\s*\)?))+/gi;
      mainCode = mainCode.replace(chainRegex, (match) => {
        const terms = [];
        const termRegex = /\"([^\"]*)\"|CHR\$\s*\(?\s*(\d+)\s*\)?/gi;
        let m;
        while ((m = termRegex.exec(match)) !== null) {
          if (m[1] !== void 0) {
            terms.push({ type: "str", value: m[1] });
          } else if (m[2] !== void 0) {
            terms.push({ type: "chr", value: parseInt(m[2], 10) });
          }
        }
        if (terms.length >= 2) {
          return foldStringTerms(terms);
        }
        return match;
      });
      const statements = [];
      let stmtStart = 0;
      inStr = false;
      for (let i = 0; i < mainCode.length; i++) {
        if (mainCode[i] === '"') {
          inStr = !inStr;
        } else if (!inStr && mainCode[i] === ":") {
          statements.push(mainCode.slice(stmtStart, i));
          stmtStart = i + 1;
        }
      }
      statements.push(mainCode.slice(stmtStart));
      const optimizedStmts = statements.map((stmt) => {
        if (!/\b(?:PRINT|LPRINT)\b/i.test(stmt)) {
          return stmt;
        }
        let s = stmt;
        let prev;
        do {
          prev = s;
          s = s.replace(/\bAT\s+(\d+)\s*,\s*(\d+)\s*;?\s*\"([^\"]*)\"/gi, (match, y, x, txt) => {
            const row = parseInt(y, 10);
            const col = parseInt(x, 10);
            if (row === 13 || col === 13) {
              return match;
            }
            return `"{AT ${y},${x}}${txt}"`;
          });
          s = s.replace(/\bINK\s+(\d+)\s*;?\s*\"([^\"]*)\"/gi, (_, c, txt) => {
            return `"{INK ${c}}${txt}"`;
          });
          s = s.replace(/\bPAPER\s+(\d+)\s*;?\s*\"([^\"]*)\"/gi, (_, c, txt) => {
            return `"{PAPER ${c}}${txt}"`;
          });
          s = s.replace(/\bFLASH\s+(\d+)\s*;?\s*\"([^\"]*)\"/gi, (_, f, txt) => {
            return `"{FLASH ${f}}${txt}"`;
          });
          s = s.replace(/\bBRIGHT\s+(\d+)\s*;?\s*\"([^\"]*)\"/gi, (_, b, txt) => {
            return `"{BRIGHT ${b}}${txt}"`;
          });
          s = s.replace(/\bINVERSE\s+(\d+)\s*;?\s*\"([^\"]*)\"/gi, (_, v, txt) => {
            return `"{INVERSE ${v}}${txt}"`;
          });
          s = s.replace(/\bOVER\s+(\d+)\s*;?\s*\"([^\"]*)\"/gi, (_, o, txt) => {
            return `"{OVER ${o}}${txt}"`;
          });
          s = s.replace(/\"([^\"]*)\"\s*;\s*\"([^\"]*)\"/g, (_, s1, s2) => {
            return `"${s1}${s2}"`;
          });
        } while (s !== prev);
        return s;
      });
      return optimizedStmts.join(":") + remPart;
    }
    function formatLabelToTitle(label) {
      if (!label) return "";
      const words = label.replace(/[-_]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").replace(/([a-zA-Z])([0-9]+)/g, "$1 $2").replace(/([0-9]+)([a-zA-Z])/g, "$1 $2").trim().split(/\s+/);
      return words.filter(Boolean).map((w) => {
        if (w.length > 1 && w === w.toUpperCase()) {
          return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        }
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(" ");
    }
    function compileJBas2(sourceText, options = {}) {
      const start = typeof options.start === "number" ? options.start : 10;
      const step = typeof options.step === "number" ? options.step : 10;
      const keepComments = !!options.keepComments;
      const includeLabelComments = !!options.includeLabelComments;
      const compactWhitespace = !!options.compactWhitespace;
      const optimizeAttributes = options.optimizePrintAttributes !== void 0 ? !!options.optimizePrintAttributes : options.optimizeAttributes !== void 0 ? !!options.optimizeAttributes : compactWhitespace;
      const rawLines = sourceText.split(/\r?\n/);
      const isCrlf = sourceText.includes("\r\n");
      const eol = isCrlf ? "\r\n" : "\n";
      const errors = [];
      const warnings = [];
      const labelMap = /* @__PURE__ */ new Map();
      const statements = [];
      let pendingLabels = [];
      const seenLabels = /* @__PURE__ */ new Map();
      for (let idx = 0; idx < rawLines.length; idx++) {
        const origLineNum = idx + 1;
        let line = keepComments ? convertCommentsToRem(rawLines[idx]).trim() : stripComments(rawLines[idx]).trim();
        if (!line) {
          continue;
        }
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
            if (line.startsWith(":")) {
              line = line.slice(1).trim();
            }
          } else {
            break;
          }
        }
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
          text: "",
          labels: labelMap,
          errors: ["Source contains no BASIC statements."],
          warnings,
          linesCount: 0
        };
      }
      let currentNum = start;
      const basicToSource = /* @__PURE__ */ new Map();
      const sourceToBasic = /* @__PURE__ */ new Map();
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
      const content = fs.readFileSync(inputFile, "utf-8");
      const res = compileJBas2(content, options);
      if (res.warnings.length > 0) {
        console.log("Warnings:");
        res.warnings.forEach((w) => console.log(`  - ${w}`));
      }
      if (!res.success) {
        console.error("Errors during compilation:");
        res.errors.forEach((e) => console.error(`  - ${e}`));
        return false;
      }
      fs.writeFileSync(outputFile, res.text, "utf-8");
      console.log(`Compiled ${res.linesCount} lines to ${outputFile} (labels: ${res.labels.size})`);
      return true;
    }
    function runCli() {
      const args = process.argv.slice(2);
      if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
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
        if (arg === "--start" && i + 1 < args.length) {
          start = parseInt(args[++i], 10);
        } else if (arg === "--step" && i + 1 < args.length) {
          step = parseInt(args[++i], 10);
        } else if (!arg.startsWith("-")) {
          positional.push(arg);
        }
      }
      if (positional.length === 0) {
        console.error("Error: No input file specified.");
        process.exit(1);
      }
      inputFile = positional[0];
      if (positional.length > 1) {
        outputFile = positional[1];
      }
      const ok = compileJBasFile(inputFile, outputFile, { start, step });
      process.exit(ok ? 0 : 1);
    }
    function transpileJBasAllVersions2(sourceText, options = {}) {
      const optimizePrintAttributes = options.optimizePrintAttributes !== void 0 ? !!options.optimizePrintAttributes : options.optimizeAttributes !== void 0 ? !!options.optimizeAttributes : true;
      const compact = compileJBas2(sourceText, {
        start: 1,
        step: 1,
        keepComments: false,
        compactWhitespace: true,
        optimizePrintAttributes
      });
      const step10 = compileJBas2(sourceText, {
        start: 10,
        step: 10,
        keepComments: false,
        compactWhitespace: false,
        optimizePrintAttributes
      });
      const comments = compileJBas2(sourceText, {
        start: 10,
        step: 10,
        keepComments: true,
        includeLabelComments: true,
        compactWhitespace: false,
        optimizePrintAttributes: false
      });
      const sinclair = {
        ...step10,
        text: translateWildcardsToChr2(step10.text)
      };
      const errors = [.../* @__PURE__ */ new Set([...compact.errors, ...step10.errors, ...comments.errors])];
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
    module2.exports = {
      stripComments,
      convertCommentsToRem,
      formatLabelToTitle,
      replaceLabelsOutsideStrings,
      compactWhitespaceOutsideStrings,
      foldStringTerms,
      optimizeAttributesAndStrings,
      compileJBas: compileJBas2,
      compileJBasFile,
      transpileJBasAllVersions: transpileJBasAllVersions2,
      translateWildcardsToChr: translateWildcardsToChr2
    };
    if (require.main === module2) {
      runCli();
    }
  }
});

// src/core/tapGenerator.js
var require_tapGenerator = __commonJS({
  "src/core/tapGenerator.js"(exports2, module2) {
    var fs;
    try {
      fs = require("fs");
    } catch {
      fs = null;
    }
    var path;
    try {
      path = require("path");
    } catch {
      path = null;
    }
    var KEYWORDS = {
      "RND": 165,
      "INKEY$": 166,
      "PI": 167,
      "FN": 168,
      "POINT": 169,
      "SCREEN$": 170,
      "ATTR": 171,
      "AT": 172,
      "TAB": 173,
      "VAL$": 174,
      "CODE": 175,
      "VAL": 176,
      "LEN": 177,
      "SIN": 178,
      "COS": 179,
      "TAN": 180,
      "ASN": 181,
      "ACS": 182,
      "ATN": 183,
      "LN": 184,
      "EXP": 185,
      "INT": 186,
      "SQR": 187,
      "SGN": 188,
      "ABS": 189,
      "PEEK": 190,
      "IN": 191,
      "USR": 192,
      "STR$": 193,
      "CHR$": 194,
      "NOT": 195,
      "BIN": 196,
      "OR": 197,
      "AND": 198,
      "<=": 199,
      ">=": 200,
      "<>": 201,
      "LINE": 202,
      "THEN": 203,
      "TO": 204,
      "STEP": 205,
      "DEF FN": 206,
      "CAT": 207,
      "FORMAT": 208,
      "MOVE": 209,
      "ERASE": 210,
      "OPEN #": 211,
      "CLOSE #": 212,
      "MERGE": 213,
      "VERIFY": 214,
      "BEEP": 215,
      "CIRCLE": 216,
      "INK": 217,
      "PAPER": 218,
      "FLASH": 219,
      "BRIGHT": 220,
      "INVERSE": 221,
      "OVER": 222,
      "OUT": 223,
      "LPRINT": 224,
      "LLIST": 225,
      "STOP": 226,
      "READ": 227,
      "DATA": 228,
      "RESTORE": 229,
      "NEW": 230,
      "BORDER": 231,
      "CONTINUE": 232,
      "DIM": 233,
      "REM": 234,
      "FOR": 235,
      "GO TO": 236,
      "GOTO": 236,
      "GO SUB": 237,
      "GOSUB": 237,
      "INPUT": 238,
      "LOAD": 239,
      "LIST": 240,
      "LET": 241,
      "PAUSE": 242,
      "NEXT": 243,
      "POKE": 244,
      "PRINT": 245,
      "PLOT": 246,
      "RUN": 247,
      "SAVE": 248,
      "RANDOMIZE": 249,
      "IF": 250,
      "CLS": 251,
      "DRAW": 252,
      "CLEAR": 253,
      "RETURN": 254,
      "COPY": 255
    };
    function calculateXORChecksum(data) {
      return data.reduce((checksum, item) => checksum ^ item, 0);
    }
    function createTapBlock(flag, data) {
      const checksum = calculateXORChecksum(new Uint8Array([flag, ...data]));
      const blockLen = data.length + 2;
      const buffer = new Uint8Array(2 + blockLen);
      buffer[0] = blockLen & 255;
      buffer[1] = blockLen >> 8 & 255;
      buffer[2] = flag;
      buffer.set(data, 3);
      buffer[buffer.length - 1] = checksum;
      return buffer;
    }
    function encodeNumber(val) {
      if (val === 0) {
        return [14, 0, 0, 0, 0, 0];
      }
      if (Number.isInteger(val) && val >= -65535 && val <= 65535) {
        const sign2 = val < 0 ? 255 : 0;
        const unsigned = val < 0 ? 65536 + val : val;
        return [14, 0, sign2, unsigned & 255, unsigned >> 8 & 255, 0];
      }
      let sign = 0;
      let absVal = val;
      if (absVal < 0) {
        sign = 128;
        absVal = -absVal;
      }
      const exp = Math.floor(Math.log2(absVal)) + 1;
      const mantissa = absVal / Math.pow(2, exp);
      const expByte = exp + 128;
      if (expByte < 0 || expByte > 255) {
        return [14, 0, 0, 0, 0, 0];
      }
      let m = Math.round(mantissa * 4294967296);
      if (m >= 4294967296) {
        m = 4294967295;
      }
      const b1 = m >>> 24 & 127 | sign;
      const b2 = m >>> 16 & 255;
      const b3 = m >>> 8 & 255;
      const b4 = m & 255;
      return [14, expByte, b1, b2, b3, b4];
    }
    function tokenizeLine(line) {
      const res = [];
      let i = 0;
      let afterBin = false;
      const keys = Object.keys(KEYWORDS).sort((a, b) => b.length - a.length);
      while (i < line.length) {
        if (line[i] === '"') {
          afterBin = false;
          res.push(line.charCodeAt(i));
          i++;
          while (i < line.length && line[i] !== '"') {
            if (line[i] === "{") {
              const closeIdx = line.indexOf("}", i + 1);
              const nextQuote = line.indexOf('"', i + 1);
              if (closeIdx !== -1 && (nextQuote === -1 || closeIdx < nextQuote)) {
                const content = line.slice(i + 1, closeIdx).trim();
                const upper = content.toUpperCase();
                if (content.length === 1 && upper >= "A" && upper <= "U") {
                  res.push(144 + upper.charCodeAt(0) - 65);
                  i = closeIdx + 1;
                  continue;
                }
                let m = upper.match(/^INK\s+(\d+)$/);
                if (m) {
                  res.push(16, parseInt(m[1], 10) & 255);
                  i = closeIdx + 1;
                  continue;
                }
                m = upper.match(/^PAPER\s+(\d+)$/);
                if (m) {
                  res.push(17, parseInt(m[1], 10) & 255);
                  i = closeIdx + 1;
                  continue;
                }
                m = upper.match(/^FLASH\s+(\d+)$/);
                if (m) {
                  res.push(18, parseInt(m[1], 10) & 255);
                  i = closeIdx + 1;
                  continue;
                }
                m = upper.match(/^BRIGHT\s+(\d+)$/);
                if (m) {
                  res.push(19, parseInt(m[1], 10) & 255);
                  i = closeIdx + 1;
                  continue;
                }
                m = upper.match(/^INVERSE\s+(\d+)$/);
                if (m) {
                  res.push(20, parseInt(m[1], 10) & 255);
                  i = closeIdx + 1;
                  continue;
                }
                m = upper.match(/^OVER\s+(\d+)$/);
                if (m) {
                  res.push(21, parseInt(m[1], 10) & 255);
                  i = closeIdx + 1;
                  continue;
                }
                m = upper.match(/^AT\s+(\d+)\s*,\s*(\d+)$/);
                if (m) {
                  res.push(22, parseInt(m[1], 10) & 255, parseInt(m[2], 10) & 255);
                  i = closeIdx + 1;
                  continue;
                }
                m = upper.match(/^TAB\s+(\d+)(?:\s*,\s*(\d+))?$/);
                if (m) {
                  if (m[2] !== void 0) {
                    res.push(23, parseInt(m[1], 10) & 255, parseInt(m[2], 10) & 255);
                  } else {
                    const tabVal = parseInt(m[1], 10);
                    res.push(23, tabVal & 255, tabVal >> 8 & 255);
                  }
                  i = closeIdx + 1;
                  continue;
                }
                m = upper.match(/^CODE\s+(\d+)$/);
                if (m) {
                  res.push(parseInt(m[1], 10) & 255);
                  i = closeIdx + 1;
                  continue;
                }
                m = upper.match(/^#([0-9A-F]{1,2})$/);
                if (m) {
                  res.push(parseInt(m[1], 16) & 255);
                  i = closeIdx + 1;
                  continue;
                }
                m = upper.match(/^\\X([0-9A-F]{1,2})$/);
                if (m) {
                  res.push(parseInt(m[1], 16) & 255);
                  i = closeIdx + 1;
                  continue;
                }
              }
            }
            if (line[i] === "\\") {
              if (i + 1 < line.length) {
                const udg = line[i + 1].toUpperCase();
                const code = udg.charCodeAt(0);
                if (code >= 65 && code <= 85) {
                  res.push(144 + code - 65);
                  i += 2;
                  continue;
                }
              }
              const hexMatch = line.slice(i).match(/^\\x([0-9a-fA-F]{2})/i);
              if (hexMatch) {
                res.push(parseInt(hexMatch[1], 16) & 255);
                i += 4;
                continue;
              }
              if (i + 1 < line.length && (line[i + 1] === "\\" || line[i + 1] === '"')) {
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
            while (i < line.length && line[i] === " ") {
              i++;
            }
          }
          continue;
        }
        if (line[i] === ":") {
          afterBin = false;
          res.push(58);
          i++;
          while (i < line.length && line[i] === " ") {
            i++;
          }
          continue;
        }
        if (line[i] === "{") {
          const closeIdx = line.indexOf("}", i + 1);
          if (closeIdx !== -1) {
            const content = line.slice(i + 1, closeIdx).trim();
            const upper = content.toUpperCase();
            let m = upper.match(/^CODE\s+(\d+)$/);
            if (m) {
              res.push(parseInt(m[1], 10) & 255);
              i = closeIdx + 1;
              continue;
            }
            m = upper.match(/^#([0-9A-F]{1,2})$/);
            if (m) {
              res.push(parseInt(m[1], 16) & 255);
              i = closeIdx + 1;
              continue;
            }
            m = upper.match(/^\\X([0-9A-F]{1,2})$/);
            if (m) {
              res.push(parseInt(m[1], 16) & 255);
              i = closeIdx + 1;
              continue;
            }
            if (content.length === 1 && upper >= "A" && upper <= "U") {
              res.push(144 + upper.charCodeAt(0) - 65);
              i = closeIdx + 1;
              continue;
            }
            if (content === "(c)" || content === "(C)") {
              res.push(127);
              i = closeIdx + 1;
              continue;
            }
          }
        }
        const sub = line.substr(i);
        const matchNum = sub.match(/^(\d+(?:\.\d+)?|\.\d+)/);
        if (matchNum) {
          const prev = i > 0 ? line[i - 1] : " ";
          if (!/[A-Za-z0-9_]/.test(prev)) {
            const str = matchNum[1];
            const val = afterBin ? parseInt(str, 2) : parseFloat(str);
            afterBin = false;
            for (let k = 0; k < str.length; k++) {
              res.push(str.charCodeAt(k));
            }
            const hidden = encodeNumber(val);
            hidden.forEach((b) => res.push(b));
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
            if (startsWithAlpha) {
              const prevChar = i > 0 ? line[i - 1] : " ";
              if (/[A-Za-z0-9_]/.test(prevChar)) continue;
            }
            if (endsWithAlpha) {
              const endChar = line[i + k.length];
              if (endChar && /[A-Za-z0-9_]/.test(endChar)) continue;
            }
            const token = KEYWORDS[k];
            res.push(token);
            if (token === 234) {
              i += k.length;
              while (i < line.length && line[i] === " ") {
                i++;
              }
              while (i < line.length) {
                res.push(line.charCodeAt(i));
                i++;
              }
              found = true;
              break;
            }
            afterBin = token === 196;
            i += k.length;
            while (i < line.length && line[i] === " ") {
              i++;
            }
            found = true;
            break;
          }
        }
        if (found) continue;
        if (line[i] !== " ") afterBin = false;
        res.push(line.charCodeAt(i));
        i++;
      }
      res.push(13);
      return res;
    }
    function normalizeFileName(fname) {
      const base = path.basename(fname);
      const clean = base.replace(/\.[^.]+$/, "").toLowerCase();
      return clean.slice(0, 10);
    }
    function parseControlCodes(basicCode) {
      return basicCode.replace(/\{(\(c\))\}/gi, "\x7F");
    }
    function bas2tap2(basicCode, filename = "program", autostart = 0) {
      const code = parseControlCodes(basicCode);
      const lines = code.split(/\r?\n(?=(?:[^"]*"[^"]*")*[^"]*$)/).filter((l) => l.trim().length > 0);
      const plainData = [];
      let detectedFirstLine = 10;
      let hasDetectedFirstLine = false;
      lines.forEach((line) => {
        const l = line.replace(/^\s+/, "");
        const match = l.match(/^(\d+)\s*(.*)$/s);
        if (!match) return;
        const lineNum = parseInt(match[1], 10);
        const content = match[2];
        if (!hasDetectedFirstLine) {
          detectedFirstLine = lineNum;
          hasDetectedFirstLine = true;
        }
        const tokens = tokenizeLine(content);
        plainData.push(lineNum >> 8 & 255);
        plainData.push(lineNum & 255);
        const len2 = tokens.length;
        plainData.push(len2 & 255);
        plainData.push(len2 >> 8 & 255);
        tokens.forEach((t) => plainData.push(t));
      });
      const dataUint = new Uint8Array(plainData);
      const headerData = new Uint8Array(17);
      headerData[0] = 0;
      const fname = (normalizeFileName(filename) + "          ").slice(0, 10);
      for (let i = 0; i < 10; i++) {
        headerData[i + 1] = fname.charCodeAt(i);
      }
      const len = dataUint.length;
      headerData[11] = len & 255;
      headerData[12] = len >> 8 & 255;
      const autoLine = typeof autostart === "number" && autostart > 0 ? autostart : detectedFirstLine;
      headerData[13] = autoLine & 255;
      headerData[14] = autoLine >> 8 & 255;
      headerData[15] = len & 255;
      headerData[16] = len >> 8 & 255;
      const headerBlock = createTapBlock(0, headerData);
      const dataBlock = createTapBlock(255, dataUint);
      return [headerBlock, dataBlock];
    }
    function tap2buffer2(blocks) {
      let totalLen = 0;
      blocks.forEach((b) => {
        totalLen += b.length;
      });
      const tapData = new Uint8Array(totalLen);
      let offset = 0;
      blocks.forEach((b) => {
        tapData.set(b, offset);
        offset += b.length;
      });
      return typeof Buffer !== "undefined" ? Buffer.from(tapData.buffer) : tapData;
    }
    function generateTapFile(basicCode, targetTapPath, options = {}) {
      const baseName = options.filename || (path ? path.basename(targetTapPath, ".tap") : "program");
      const autostart = options.autostart || 0;
      const blocks = bas2tap2(basicCode, baseName, autostart);
      const buffer = tap2buffer2(blocks);
      if (fs && path) {
        const dir = path.dirname(targetTapPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(targetTapPath, buffer);
      }
      const autoStartLine = blocks[0][3 + 13] | blocks[0][3 + 14] << 8;
      return {
        tapPath: targetTapPath,
        autoStartLine,
        bytesCount: buffer.length,
        data: buffer
      };
    }
    module2.exports = {
      KEYWORDS,
      tokenizeLine,
      createTapBlock,
      encodeNumber,
      bas2tap: bas2tap2,
      tap2buffer: tap2buffer2,
      generateTapFile
    };
  }
});

// src/core/formatter.js
var require_formatter = __commonJS({
  "src/core/formatter.js"(exports2, module2) {
    var MULTI_WORD_PATTERNS = [
      { regex: /^GO\s+TO(?=[^a-zA-Z0-9_]|$)/i, name: "GO TO" },
      { regex: /^GO\s+SUB(?=[^a-zA-Z0-9_]|$)/i, name: "GO SUB" },
      { regex: /^DEF\s+FN(?=[^a-zA-Z0-9_]|$)/i, name: "DEF FN" },
      { regex: /^OPEN\s*#/i, name: "OPEN #" },
      { regex: /^CLOSE\s*#/i, name: "CLOSE #" }
    ];
    var DOLLAR_KEYWORDS = [
      "SCREEN$",
      "INKEY$",
      "VAL$",
      "STR$",
      "CHR$"
    ];
    var SINGLE_WORD_KEYWORDS = [
      // Length 9
      "RANDOMIZE",
      // Length 8
      "CONTINUE",
      "RESTORE",
      "SPECTRUM",
      // Length 7
      "FORMAT",
      "BORDER",
      "INVERSE",
      "BRIGHT",
      "CIRCLE",
      "RETURN",
      "VERIFY",
      // Length 6
      "LPRINT",
      "LLIST",
      "FLASH",
      "PAPER",
      "PAUSE",
      "PRINT",
      "CLEAR",
      "MERGE",
      "ERASE",
      "POINT",
      // Length 5
      "INPUT",
      "ATTR",
      "CODE",
      "PEEK",
      "POKE",
      "PLOT",
      "DRAW",
      "DATA",
      "READ",
      "STEP",
      "STOP",
      "LOAD",
      "SAVE",
      "LIST",
      "LINE",
      "OVER",
      "MOVE",
      "BEEP",
      "COPY",
      "PLAY",
      "THEN",
      "NEXT",
      "GOTO",
      "GOSUB",
      // Length 4
      "CAT",
      "CLS",
      "DIM",
      "FOR",
      "LET",
      "NEW",
      "NOT",
      "OUT",
      "RUN",
      "REM",
      "RND",
      "TAB",
      "USR",
      "VAL",
      "LEN",
      // Length 3
      "INK",
      "EXP",
      "SIN",
      "COS",
      "TAN",
      "ASN",
      "ACS",
      "ATN",
      "INT",
      "SQR",
      "SGN",
      "ABS",
      "BIN",
      "AND",
      // Length 2
      "AT",
      "FN",
      "IF",
      "IN",
      "LN",
      "OR",
      "PI",
      "TO"
    ];
    function isWordBoundaryBefore(line, i) {
      if (i === 0) return true;
      const prevChar = line[i - 1];
      if (/[a-zA-Z0-9_@$]/.test(prevChar)) {
        if (/^\s*\d+$/.test(line.slice(0, i))) {
          return true;
        }
        return false;
      }
      return true;
    }
    function formatLineKeywords(line, isJBas = true) {
      let result = "";
      let i = 0;
      const n = line.length;
      while (i < n) {
        const c = line[i];
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
        if (isJBas && c === "'") {
          result += line.slice(i);
          break;
        }
        if (isJBas && c === "@") {
          const match = line.slice(i).match(/^@[a-zA-Z0-9_]+/);
          if (match) {
            result += match[0];
            i += match[0].length;
            continue;
          }
        }
        if (isWordBoundaryBefore(line, i)) {
          const sub = line.slice(i);
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
          let dollarMatched = false;
          for (const dkw of DOLLAR_KEYWORDS) {
            if (sub.slice(0, dkw.length).toUpperCase() === dkw) {
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
          let singleMatched = false;
          for (const kw of SINGLE_WORD_KEYWORDS) {
            if (sub.slice(0, kw.length).toUpperCase() === kw) {
              const nextChar = line[i + kw.length];
              if (!nextChar || !/[a-zA-Z0-9_]/.test(nextChar)) {
                if (kw === "REM") {
                  result += "REM";
                  result += line.slice(i + 3);
                  i = n;
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
        result += c;
        i++;
      }
      return result;
    }
    function formatKeywordsToUpper2(code, options = {}) {
      if (typeof code !== "string" || !code) {
        return code;
      }
      const isJBas = options.isJBas !== false;
      const isCrlf = code.includes("\r\n");
      const separator = isCrlf ? "\r\n" : "\n";
      const lines = code.split(/\r?\n/);
      const formattedLines = lines.map((line) => formatLineKeywords(line, isJBas));
      return formattedLines.join(separator);
    }
    module2.exports = {
      formatKeywordsToUpper: formatKeywordsToUpper2,
      formatLineKeywords,
      isWordBoundaryBefore
    };
  }
});

// src/core/keywords.js
var require_keywords = __commonJS({
  "src/core/keywords.js"(exports2, module2) {
    var KEYWORDS_LIST = [
      // Statements & Control Flow
      {
        name: "PRINT",
        kind: "statement",
        syntax: "PRINT [AT row, col;] [expression...]",
        description: "Prints text, numbers, screen attributes, or graphics characters to the screen.",
        snippet: "PRINT $0"
      },
      {
        name: "LET",
        kind: "statement",
        syntax: "LET variable = expression",
        description: "Assigns the result of an expression to a variable.",
        snippet: "LET ${1:var} = ${2:0}"
      },
      {
        name: "IF",
        kind: "statement",
        syntax: "IF condition THEN statement",
        description: "Tests condition; executes following statement if true (non-zero).",
        snippet: "IF ${1:condition} THEN ${2:statement}"
      },
      {
        name: "THEN",
        kind: "statement",
        syntax: "THEN statement",
        description: "Specifies statement or line to execute when IF condition evaluates to true.",
        snippet: "THEN $0"
      },
      {
        name: "FOR",
        kind: "statement",
        syntax: "FOR var = start TO limit [STEP step]",
        description: "Initializes a loop with counter variable from start to limit.",
        snippet: "FOR ${1:i} = ${2:1} TO ${3:10}\n	$0\nNEXT ${1:i}"
      },
      {
        name: "TO",
        kind: "statement",
        syntax: "TO limit",
        description: "Defines target upper/lower limit in FOR loop or string/array slicing.",
        snippet: "TO ${1:10}"
      },
      {
        name: "STEP",
        kind: "statement",
        syntax: "STEP increment",
        description: "Defines step increment (positive or negative) in FOR loop.",
        snippet: "STEP ${1:1}"
      },
      {
        name: "NEXT",
        kind: "statement",
        syntax: "NEXT var",
        description: "Closes a FOR loop and advances counter variable.",
        snippet: "NEXT ${1:i}"
      },
      {
        name: "GO TO",
        kind: "statement",
        syntax: "GO TO line",
        description: "Unconditional jump to specified line number or label.",
        snippet: "GO TO ${1:line}"
      },
      {
        name: "GOTO",
        kind: "statement",
        syntax: "GOTO line",
        description: "Alias for GO TO. Unconditional jump to line number or label.",
        snippet: "GOTO ${1:line}"
      },
      {
        name: "GO SUB",
        kind: "statement",
        syntax: "GO SUB line",
        description: "Calls a subroutine at specified line number or label.",
        snippet: "GO SUB ${1:line}"
      },
      {
        name: "GOSUB",
        kind: "statement",
        syntax: "GOSUB line",
        description: "Alias for GO SUB. Calls a subroutine at line number or label.",
        snippet: "GOSUB ${1:line}"
      },
      {
        name: "RETURN",
        kind: "statement",
        syntax: "RETURN",
        description: "Returns program execution from a subroutine called by GO SUB.",
        snippet: "RETURN"
      },
      {
        name: "INPUT",
        kind: "statement",
        syntax: "INPUT [prompt;] variable",
        description: "Halts program execution and awaits user input from the keyboard.",
        snippet: 'INPUT "${1:Prompt: }"; ${2:var}'
      },
      {
        name: "POKE",
        kind: "statement",
        syntax: "POKE address, byte",
        description: "Writes an 8-bit byte (0-255) directly into memory address (0-65535).",
        snippet: "POKE ${1:address}, ${2:byte}"
      },
      {
        name: "DIM",
        kind: "statement",
        syntax: "DIM array(dim1 [, dim2...])",
        description: "Allocates memory and dimension boundaries for a numeric or string array.",
        snippet: "DIM ${1:a}(${2:10})"
      },
      {
        name: "DATA",
        kind: "statement",
        syntax: "DATA item1, item2, ...",
        description: "Stores sequential constant items to be read by READ statements.",
        snippet: "DATA ${1:items}"
      },
      {
        name: "READ",
        kind: "statement",
        syntax: "READ var1 [, var2...]",
        description: "Reads data values sequentially from DATA statements into variables.",
        snippet: "READ ${1:var}"
      },
      {
        name: "RESTORE",
        kind: "statement",
        syntax: "RESTORE [line]",
        description: "Resets the DATA pointer to the first DATA statement or specified line.",
        snippet: "RESTORE ${1:10}"
      },
      {
        name: "DEF FN",
        kind: "statement",
        syntax: "DEF FN name(param) = expression",
        description: "Defines a user function with parameters returning a numeric or string value.",
        snippet: "DEF FN ${1:f}(${2:x}) = ${3:x * 2}"
      },
      {
        name: "REM",
        kind: "statement",
        syntax: "REM comment",
        description: "Comment / remark line ignored by the Sinclair BASIC interpreter.",
        snippet: "REM $0"
      },
      {
        name: "PAUSE",
        kind: "statement",
        syntax: "PAUSE frames",
        description: "Pauses execution for specified 50Hz frames (PAUSE 0 waits for a keypress).",
        snippet: "PAUSE ${1:50}"
      },
      {
        name: "RANDOMIZE",
        kind: "statement",
        syntax: "RANDOMIZE [seed]",
        description: "Seeds the pseudo-random number generator (seed 0 reads system timer).",
        snippet: "RANDOMIZE ${1:0}"
      },
      {
        name: "STOP",
        kind: "statement",
        syntax: "STOP",
        description: 'Halts program execution and displays "9 STOP statement".',
        snippet: "STOP"
      },
      {
        name: "RUN",
        kind: "statement",
        syntax: "RUN [line]",
        description: "Clears variables and starts program execution at specified line (default: start).",
        snippet: "RUN"
      },
      {
        name: "CONTINUE",
        kind: "statement",
        syntax: "CONTINUE",
        description: "Resumes program execution after a STOP statement or Break key interrupt.",
        snippet: "CONTINUE"
      },
      {
        name: "CLEAR",
        kind: "statement",
        syntax: "CLEAR [address]",
        description: "Clears variables, display buffers, and optionally lowers RAMTOP ceiling.",
        snippet: "CLEAR ${1:65367}"
      },
      {
        name: "NEW",
        kind: "statement",
        syntax: "NEW",
        description: "Clears program code and variables and resets system to initial state.",
        snippet: "NEW"
      },
      // Display & Screen Attributes
      {
        name: "CLS",
        kind: "attribute",
        syntax: "CLS",
        description: "Clears the screen display area and resets cursor to top-left.",
        snippet: "CLS"
      },
      {
        name: "BORDER",
        kind: "attribute",
        syntax: "BORDER color",
        description: "Sets border color (0=Black, 1=Blue, 2=Red, 3=Magenta, 4=Green, 5=Cyan, 6=Yellow, 7=White).",
        snippet: "BORDER ${1:0}"
      },
      {
        name: "PAPER",
        kind: "attribute",
        syntax: "PAPER color",
        description: "Sets background paper color (0-7, or 8 for transparent).",
        snippet: "PAPER ${1:7}"
      },
      {
        name: "INK",
        kind: "attribute",
        syntax: "INK color",
        description: "Sets foreground ink / text color (0-7, or 8 for transparent).",
        snippet: "INK ${1:0}"
      },
      {
        name: "FLASH",
        kind: "attribute",
        syntax: "FLASH mode",
        description: "Toggles character flashing (0=off, 1=on, 8=no change).",
        snippet: "FLASH ${1:0}"
      },
      {
        name: "BRIGHT",
        kind: "attribute",
        syntax: "BRIGHT mode",
        description: "Toggles high intensity bright attribute (0=normal, 1=bright, 8=no change).",
        snippet: "BRIGHT ${1:0}"
      },
      {
        name: "INVERSE",
        kind: "attribute",
        syntax: "INVERSE mode",
        description: "Toggles inverse video color attribute (0=normal, 1=inverse).",
        snippet: "INVERSE ${1:0}"
      },
      {
        name: "OVER",
        kind: "attribute",
        syntax: "OVER mode",
        description: "Toggles overprinting mode (0=overwrite, 1=XOR bitwise blend).",
        snippet: "OVER ${1:0}"
      },
      {
        name: "AT",
        kind: "attribute",
        syntax: "AT row, col",
        description: "Positions print cursor at row (0-21) and column (0-31).",
        snippet: "AT ${1:row}, ${2:col}"
      },
      {
        name: "TAB",
        kind: "attribute",
        syntax: "TAB col",
        description: "Advances print cursor horizontally to specified column (0-31).",
        snippet: "TAB ${1:col}"
      },
      // Graphics & Sound
      {
        name: "PLOT",
        kind: "statement",
        syntax: "PLOT [attribute;] x, y",
        description: "Plots a single graphic pixel at coordinates x (0-255), y (0-175).",
        snippet: "PLOT ${1:x}, ${2:y}"
      },
      {
        name: "DRAW",
        kind: "statement",
        syntax: "DRAW [attribute;] dx, dy [, angle]",
        description: "Draws a straight line or arc from current position by offset (dx, dy).",
        snippet: "DRAW ${1:dx}, ${2:dy}"
      },
      {
        name: "CIRCLE",
        kind: "statement",
        syntax: "CIRCLE [attribute;] x, y, radius",
        description: "Draws a circle with center (x, y) and specified radius in pixels.",
        snippet: "CIRCLE ${1:x}, ${2:y}, ${3:radius}"
      },
      {
        name: "BEEP",
        kind: "statement",
        syntax: "BEEP duration, pitch",
        description: "Generates a sound tone with duration in seconds and pitch in semitones relative to middle C.",
        snippet: "BEEP ${1:duration}, ${2:pitch}"
      },
      // Functions (Memory & System)
      {
        name: "PEEK",
        kind: "function",
        syntax: "PEEK address",
        description: "Reads an 8-bit byte value (0-255) from memory address (0-65535).",
        snippet: "PEEK ${1:address}"
      },
      {
        name: "USR",
        kind: "function",
        syntax: "USR address",
        description: 'Calls a Z80 machine code subroutine at address, or returns UDG graphics memory start when given string USR "a".',
        snippet: "USR ${1:address}"
      },
      {
        name: "IN",
        kind: "function",
        syntax: "IN port",
        description: "Reads an 8-bit byte from Z80 hardware I/O port.",
        snippet: "IN ${1:port}"
      },
      {
        name: "OUT",
        kind: "statement",
        syntax: "OUT port, byte",
        description: "Outputs an 8-bit byte to Z80 hardware I/O port.",
        snippet: "OUT ${1:port}, ${2:byte}"
      },
      {
        name: "FN",
        kind: "function",
        syntax: "FN name(args)",
        description: "Evaluates user-defined function previously created with DEF FN.",
        snippet: "FN ${1:name}(${2:args})"
      },
      // Functions (Strings & Characters)
      {
        name: "CHR$",
        kind: "function",
        syntax: "CHR$ code",
        description: "Returns the single-character string corresponding to the given ASCII/ZX character code (0-255).",
        snippet: "CHR$ ${1:code}"
      },
      {
        name: "CODE",
        kind: "function",
        syntax: "CODE string",
        description: "Returns the numeric ASCII/ZX character code of the first character in string.",
        snippet: 'CODE "${1:A}"'
      },
      {
        name: "STR$",
        kind: "function",
        syntax: "STR$ number",
        description: "Converts a numeric value to its decimal string representation.",
        snippet: "STR$ ${1:num}"
      },
      {
        name: "VAL",
        kind: "function",
        syntax: "VAL string",
        description: "Evaluates a string containing a numeric BASIC expression and returns its number.",
        snippet: "VAL(${1:str})"
      },
      {
        name: "VAL$",
        kind: "function",
        syntax: "VAL$ string",
        description: "Evaluates a string expression stored in a string.",
        snippet: "VAL$(${1:str})"
      },
      {
        name: "LEN",
        kind: "function",
        syntax: "LEN string",
        description: "Returns length (number of characters) of string.",
        snippet: "LEN ${1:str}"
      },
      {
        name: "INKEY$",
        kind: "function",
        syntax: "INKEY$",
        description: 'Reads keyboard without halting. Returns character pressed or empty string "" if none.',
        snippet: "INKEY$"
      },
      {
        name: "SCREEN$",
        kind: "function",
        syntax: "SCREEN$(row, col)",
        description: "Returns character currently displayed at screen row (0-21) and col (0-31).",
        snippet: "SCREEN$(${1:row}, ${2:col})"
      },
      {
        name: "ATTR",
        kind: "function",
        syntax: "ATTR(row, col)",
        description: "Returns display attribute byte (Flash*128 + Bright*64 + Paper*8 + Ink) at (row, col).",
        snippet: "ATTR(${1:row}, ${2:col})"
      },
      {
        name: "POINT",
        kind: "function",
        syntax: "POINT(x, y)",
        description: "Tests pixel at (x, y). Returns 1 if plotted, 0 otherwise.",
        snippet: "POINT(${1:x}, ${2:y})"
      },
      // Functions (Math)
      {
        name: "RND",
        kind: "function",
        syntax: "RND",
        description: "Returns pseudo-random floating point number in range [0, 1).",
        snippet: "RND"
      },
      {
        name: "PI",
        kind: "function",
        syntax: "PI",
        description: "The mathematical constant \u03C0 (approx 3.1415926535).",
        snippet: "PI"
      },
      {
        name: "INT",
        kind: "function",
        syntax: "INT number",
        description: "Returns largest integer less than or equal to number (floor).",
        snippet: "INT ${1:x}"
      },
      {
        name: "ABS",
        kind: "function",
        syntax: "ABS number",
        description: "Returns absolute positive value of number.",
        snippet: "ABS ${1:x}"
      },
      {
        name: "SGN",
        kind: "function",
        syntax: "SGN number",
        description: "Returns sign: -1 if x < 0, 0 if x = 0, 1 if x > 0.",
        snippet: "SGN ${1:x}"
      },
      {
        name: "SQR",
        kind: "function",
        syntax: "SQR number",
        description: "Returns square root of non-negative number.",
        snippet: "SQR ${1:x}"
      },
      {
        name: "EXP",
        kind: "function",
        syntax: "EXP number",
        description: "Returns exponential e raised to power x.",
        snippet: "EXP ${1:x}"
      },
      {
        name: "LN",
        kind: "function",
        syntax: "LN number",
        description: "Returns natural logarithm (base e) of positive number.",
        snippet: "LN ${1:x}"
      },
      {
        name: "SIN",
        kind: "function",
        syntax: "SIN radians",
        description: "Returns trigonometric sine of angle in radians.",
        snippet: "SIN ${1:x}"
      },
      {
        name: "COS",
        kind: "function",
        syntax: "COS radians",
        description: "Returns trigonometric cosine of angle in radians.",
        snippet: "COS ${1:x}"
      },
      {
        name: "TAN",
        kind: "function",
        syntax: "TAN radians",
        description: "Returns trigonometric tangent of angle in radians.",
        snippet: "TAN ${1:x}"
      },
      {
        name: "ASN",
        kind: "function",
        syntax: "ASN x",
        description: "Returns arcsine of x in radians [-\u03C0/2, \u03C0/2].",
        snippet: "ASN ${1:x}"
      },
      {
        name: "ACS",
        kind: "function",
        syntax: "ACS x",
        description: "Returns arccosine of x in radians [0, \u03C0].",
        snippet: "ACS ${1:x}"
      },
      {
        name: "ATN",
        kind: "function",
        syntax: "ATN x",
        description: "Returns arctangent of x in radians [-\u03C0/2, \u03C0/2].",
        snippet: "ATN ${1:x}"
      },
      {
        name: "BIN",
        kind: "function",
        syntax: "BIN digits",
        description: "Interprets following binary digits (0 and 1) as a number.",
        snippet: "BIN ${1:00000000}"
      },
      // Logical Operators
      {
        name: "AND",
        kind: "operator",
        syntax: "a AND b",
        description: "Logical AND operator: returns non-zero if both operands are true.",
        snippet: "AND $0"
      },
      {
        name: "OR",
        kind: "operator",
        syntax: "a OR b",
        description: "Logical OR operator: returns true if either operand is true.",
        snippet: "OR $0"
      },
      {
        name: "NOT",
        kind: "operator",
        syntax: "NOT a",
        description: "Logical NOT operator: returns 1 if operand is 0, otherwise 0.",
        snippet: "NOT $0"
      },
      // Storage, Devices & Printer
      {
        name: "LOAD",
        kind: "storage",
        syntax: 'LOAD "name" [CODE/DATA/SCREEN$]',
        description: "Loads program code or data blocks from cassette tape.",
        snippet: 'LOAD "${1:name}"'
      },
      {
        name: "SAVE",
        kind: "storage",
        syntax: 'SAVE "name" [LINE/CODE/DATA/SCREEN$]',
        description: "Saves program code or data blocks to cassette tape.",
        snippet: 'SAVE "${1:name}"'
      },
      {
        name: "VERIFY",
        kind: "storage",
        syntax: 'VERIFY "name"',
        description: "Verifies tape recording against current computer memory.",
        snippet: 'VERIFY "${1:name}"'
      },
      {
        name: "MERGE",
        kind: "storage",
        syntax: 'MERGE "name"',
        description: "Merges BASIC program lines from tape into memory without erasing existing lines.",
        snippet: 'MERGE "${1:name}"'
      },
      {
        name: "LINE",
        kind: "statement",
        syntax: "LINE [number]",
        description: 'Specifies autostart line for SAVE "..." LINE num, or reads full string in INPUT LINE a$.',
        snippet: "LINE ${1:10}"
      },
      {
        name: "OPEN #",
        kind: "storage",
        syntax: "OPEN #channel, device",
        description: "Opens a communication stream / channel to a peripheral device.",
        snippet: 'OPEN #${1:1}, "${2:device}"'
      },
      {
        name: "CLOSE #",
        kind: "storage",
        syntax: "CLOSE #channel",
        description: "Closes a communication stream / channel.",
        snippet: "CLOSE #${1:1}"
      },
      {
        name: "CAT",
        kind: "storage",
        syntax: "CAT [drive]",
        description: "Displays catalog of files on storage media (Microdrive or disk).",
        snippet: "CAT"
      },
      {
        name: "FORMAT",
        kind: "storage",
        syntax: "FORMAT spec",
        description: "Formats storage media (Microdrive or disk).",
        snippet: "FORMAT ${1:spec}"
      },
      {
        name: "MOVE",
        kind: "storage",
        syntax: "MOVE src, dest",
        description: "Copies data streams between peripheral channels.",
        snippet: "MOVE ${1:src}, ${2:dest}"
      },
      {
        name: "ERASE",
        kind: "storage",
        syntax: "ERASE spec",
        description: "Erases a file from storage media.",
        snippet: 'ERASE "${1:name}"'
      },
      {
        name: "LIST",
        kind: "statement",
        syntax: "LIST [line]",
        description: "Lists BASIC program code to the screen starting at specified line.",
        snippet: "LIST ${1:10}"
      },
      {
        name: "LLIST",
        kind: "statement",
        syntax: "LLIST [line]",
        description: "Lists BASIC program code to attached ZX Printer.",
        snippet: "LLIST"
      },
      {
        name: "LPRINT",
        kind: "statement",
        syntax: "LPRINT [expression...]",
        description: "Prints text or data directly to attached ZX Printer.",
        snippet: "LPRINT $0"
      },
      {
        name: "COPY",
        kind: "statement",
        syntax: "COPY",
        description: "Copies current screen pixel display to attached ZX Printer.",
        snippet: "COPY"
      },
      // 128K Sinclair BASIC additions
      {
        name: "PLAY",
        kind: "statement",
        syntax: 'PLAY "melody"',
        description: "(128K) Plays multi-channel music on AY-3-8912 sound chip.",
        snippet: 'PLAY "${1:melody}"'
      },
      {
        name: "SPECTRUM",
        kind: "statement",
        syntax: "SPECTRUM",
        description: "(128K) Switches to 48K Sinclair BASIC compatibility mode.",
        snippet: "SPECTRUM"
      }
    ];
    var CONTROL_CODES_LIST = [
      { name: "INK", syntax: "{INK n}", description: "Embeds foreground color code (0-7, 8=transparent, 9=contrast)." },
      { name: "PAPER", syntax: "{PAPER n}", description: "Embeds background color code (0-7, 8=transparent, 9=contrast)." },
      { name: "FLASH", syntax: "{FLASH n}", description: "Embeds flashing attribute code (0=off, 1=on, 8=no change)." },
      { name: "BRIGHT", syntax: "{BRIGHT n}", description: "Embeds bright attribute code (0=normal, 1=bright, 8=no change)." },
      { name: "INVERSE", syntax: "{INVERSE n}", description: "Embeds inverse video attribute code (0=normal, 1=inverse)." },
      { name: "OVER", syntax: "{OVER n}", description: "Embeds overprinting mode (0=off, 1=on)." },
      { name: "AT", syntax: "{AT row, col}", description: "Embeds cursor positioning control code (row 0-21, col 0-31)." },
      { name: "TAB", syntax: "{TAB col}", description: "Embeds tab jump control code (col 0-31)." },
      { name: "CODE", syntax: "{CODE n}", description: "Embeds arbitrary byte code (0-255)." }
    ];
    module2.exports = {
      KEYWORDS_LIST,
      CONTROL_CODES_LIST
    };
  }
});

// src/core/completions.js
var require_completions = __commonJS({
  "src/core/completions.js"(exports2, module2) {
    var { KEYWORDS_LIST, CONTROL_CODES_LIST } = require_keywords();
    function createSinclairCompletionProvider2(vscode2) {
      const keywordCompletionItems = KEYWORDS_LIST.map((kw) => {
        let kind = vscode2.CompletionItemKind.Keyword;
        if (kw.kind === "function") kind = vscode2.CompletionItemKind.Function;
        else if (kw.kind === "operator") kind = vscode2.CompletionItemKind.Operator;
        else if (kw.kind === "attribute") kind = vscode2.CompletionItemKind.Color;
        const item = new vscode2.CompletionItem(kw.name, kind);
        item.detail = kw.syntax;
        const doc = new vscode2.MarkdownString();
        doc.appendCodeblock(kw.syntax, "sinclair-basic");
        doc.appendMarkdown(kw.description);
        item.documentation = doc;
        item.insertText = kw.name;
        return item;
      });
      const snippetItems = KEYWORDS_LIST.filter((kw) => kw.snippet && kw.snippet !== kw.name).map((kw) => {
        const item = new vscode2.CompletionItem(kw.name + " (Snippet)", vscode2.CompletionItemKind.Snippet);
        item.detail = kw.syntax;
        const doc = new vscode2.MarkdownString();
        doc.appendCodeblock(kw.snippet, "sinclair-basic");
        doc.appendMarkdown(`*${kw.description}*`);
        item.documentation = doc;
        item.insertText = new vscode2.SnippetString(kw.snippet);
        return item;
      });
      const controlCodeItems = CONTROL_CODES_LIST.map((cc) => {
        const item = new vscode2.CompletionItem(cc.name, vscode2.CompletionItemKind.Property);
        item.detail = cc.syntax;
        item.documentation = new vscode2.MarkdownString(
          `Control code for bas2tap / tapGenerator:

\`${cc.syntax}\`

${cc.description}`
        );
        item.insertText = cc.name + " ";
        return item;
      });
      return {
        provideCompletionItems(document, position) {
          const lineText = document.lineAt(position.line).text;
          const prefix = lineText.slice(0, position.character);
          let inString = false;
          for (let i = 0; i < prefix.length; i++) {
            if (prefix[i] === '"') inString = !inString;
          }
          const isJBas = document.languageId === "jbas" || document.fileName.endsWith(".jbas");
          if (!inString) {
            if (/\bREM\b/i.test(prefix)) {
              return null;
            }
            if (isJBas && prefix.includes("'")) {
              return null;
            }
          }
          if (inString) {
            const lastOpen = prefix.lastIndexOf("{");
            const lastClose = prefix.lastIndexOf("}");
            if (lastOpen > lastClose) {
              return controlCodeItems;
            }
            return null;
          }
          if (isJBas && /@[a-zA-Z0-9_]*$/.test(prefix)) {
            const labelItems = [];
            const labelRegex = /^\s*@([a-zA-Z0-9_]+)\s*:/;
            for (let i = 0; i < document.lineCount; i++) {
              const m = document.lineAt(i).text.match(labelRegex);
              if (m) {
                const labelName = m[1];
                const item = new vscode2.CompletionItem("@" + labelName, vscode2.CompletionItemKind.Reference);
                item.detail = `Jump target defined on line ${i + 1}`;
                item.documentation = new vscode2.MarkdownString(`Label target: \`@${labelName}:\`

Defined on line ${i + 1}`);
                item.filterText = "@" + labelName;
                labelItems.push(item);
              }
            }
            return labelItems;
          }
          return [...keywordCompletionItems, ...snippetItems];
        }
      };
    }
    module2.exports = {
      createSinclairCompletionProvider: createSinclairCompletionProvider2
    };
  }
});

// src/core/folding.js
var require_folding = __commonJS({
  "src/core/folding.js"(exports2, module2) {
    function getCodeOutsideStringsAndRem(line) {
      let result = "";
      let inString = false;
      let i = 0;
      const n = line.length;
      while (i < n) {
        const c = line[i];
        if (c === '"') {
          inString = !inString;
          result += " ";
          i++;
          continue;
        }
        if (!inString) {
          if (line.slice(i, i + 3).toUpperCase() === "REM") {
            const prev = i > 0 ? line[i - 1] : " ";
            const next = i + 3 < n ? line[i + 3] : " ";
            if (!/[a-zA-Z0-9_]/.test(prev) && !/[a-zA-Z0-9_]/.test(next)) {
              break;
            }
          }
          result += c;
        } else {
          result += " ";
        }
        i++;
      }
      return result;
    }
    function getBasFoldingRanges2(input) {
      const lines = Array.isArray(input) ? input : input.split(/\r?\n/);
      const lineCount = lines.length;
      const lineNumToIndex = /* @__PURE__ */ new Map();
      const subHeaderIndices = /* @__PURE__ */ new Set();
      const subHeaderRegex = /^\s*(\d+)\s+REM\s+(?:SUB|FUNCTION|PROCEDURE|ROUTINE)\b/i;
      for (let i = 0; i < lineCount; i++) {
        const m = lines[i].match(/^\s*(\d+)/);
        if (m) {
          const num = parseInt(m[1], 10);
          lineNumToIndex.set(num, i);
          if (subHeaderRegex.test(lines[i])) {
            subHeaderIndices.add(i);
          }
        }
      }
      const gosubTargets = /* @__PURE__ */ new Set();
      const gosubRegex = /\b(?:GO\s*SUB|GOSUB)\s+(\d+(?:\s*,\s*\d+)*)/gi;
      for (let i = 0; i < lineCount; i++) {
        const code = getCodeOutsideStringsAndRem(lines[i]);
        let match;
        while ((match = gosubRegex.exec(code)) !== null) {
          const targetsStr = match[1];
          const targets = targetsStr.split(",").map((s) => parseInt(s.trim(), 10));
          for (const t of targets) {
            if (!isNaN(t) && lineNumToIndex.has(t)) {
              let idx = lineNumToIndex.get(t);
              if (idx > 0 && subHeaderIndices.has(idx - 1)) {
                idx = idx - 1;
              }
              gosubTargets.add(idx);
            }
          }
        }
      }
      const allRoutineStarts = /* @__PURE__ */ new Set([...subHeaderIndices, ...gosubTargets]);
      const sortedStarts = Array.from(allRoutineStarts).sort((a, b) => a - b);
      const ranges = [];
      const seenRanges = /* @__PURE__ */ new Set();
      function addRange(start, end, kind = "region") {
        if (end > start) {
          const key = `${start}:${end}`;
          if (!seenRanges.has(key)) {
            seenRanges.add(key);
            ranges.push({ start, end, kind });
          }
        }
      }
      for (let t = 0; t < sortedStarts.length; t++) {
        const startLineIndex = sortedStarts[t];
        const nextSubLineIndex = t + 1 < sortedStarts.length ? sortedStarts[t + 1] : lineCount;
        let lastReturnLineIndex = -1;
        for (let k = startLineIndex; k < nextSubLineIndex; k++) {
          const lineCode = getCodeOutsideStringsAndRem(lines[k]);
          if (/\bRETURN\b/i.test(lineCode)) {
            lastReturnLineIndex = k;
          }
        }
        if (lastReturnLineIndex > startLineIndex) {
          addRange(startLineIndex, lastReturnLineIndex);
        } else if (subHeaderIndices.has(startLineIndex)) {
          let lastCodeLine = nextSubLineIndex - 1;
          while (lastCodeLine > startLineIndex && !lines[lastCodeLine].trim()) {
            lastCodeLine--;
          }
          if (lastCodeLine > startLineIndex) {
            addRange(startLineIndex, lastCodeLine);
          }
        }
      }
      const forStack = [];
      for (let i = 0; i < lineCount; i++) {
        const lineCode = getCodeOutsideStringsAndRem(lines[i]);
        const forMatches = lineCode.match(/\bFOR\b/gi);
        if (forMatches) {
          for (let f = 0; f < forMatches.length; f++) {
            forStack.push(i);
          }
        }
        const nextMatches = lineCode.match(/\bNEXT\b/gi);
        if (nextMatches) {
          for (let n = 0; n < nextMatches.length; n++) {
            if (forStack.length > 0) {
              const forStart = forStack.pop();
              if (i > forStart) {
                addRange(forStart, i);
              }
            }
          }
        }
      }
      return ranges.sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return b.end - a.end;
      });
    }
    module2.exports = {
      getCodeOutsideStringsAndRem,
      getBasFoldingRanges: getBasFoldingRanges2
    };
  }
});

// src/core/definitions.js
var require_definitions = __commonJS({
  "src/core/definitions.js"(exports2, module2) {
    var { getCodeOutsideStringsAndRem } = require_folding();
    function findBasJumpTargetAtPosition2(lineText, charIndex) {
      if (typeof lineText !== "string" || charIndex < 0 || charIndex > lineText.length) {
        return null;
      }
      const masked = getCodeOutsideStringsAndRem(lineText);
      if (masked.length < lineText.length && charIndex >= masked.length) {
        return null;
      }
      if (charIndex < lineText.length) {
        if (lineText[charIndex] === '"' || masked[charIndex] === " " && lineText[charIndex] !== " ") {
          return null;
        }
      }
      const jumpRegex = /\b(GO\s*SUB|GOSUB|GO\s*TO|GOTO|RUN|RESTORE|LINE|THEN)\s+(\d+(?:\s*,\s*\d+)*)/gi;
      let match;
      while ((match = jumpRegex.exec(masked)) !== null) {
        const fullMatch = match[0];
        const keyword = match[1];
        const targetsStr = match[2];
        const targetsStart = match.index + fullMatch.length - targetsStr.length;
        const numRegex = /\b(\d+)\b/g;
        let numMatch;
        while ((numMatch = numRegex.exec(targetsStr)) !== null) {
          const numStr = numMatch[1];
          const startCol = targetsStart + numMatch.index;
          const endCol = startCol + numStr.length;
          if (charIndex >= startCol && charIndex <= endCol) {
            return {
              targetLineNumber: parseInt(numStr, 10),
              startCol,
              endCol,
              keyword
            };
          }
        }
      }
      return null;
    }
    function findBasLineIndex2(documentTextOrLines, targetLineNumber) {
      const targetNum = typeof targetLineNumber === "number" ? targetLineNumber : parseInt(targetLineNumber, 10);
      if (isNaN(targetNum)) return null;
      if (documentTextOrLines && typeof documentTextOrLines.lineCount === "number" && typeof documentTextOrLines.lineAt === "function") {
        const count = documentTextOrLines.lineCount;
        for (let i = 0; i < count; i++) {
          const line = documentTextOrLines.lineAt(i).text;
          const match = line.match(/^(\s*)(\d+)\b/);
          if (match) {
            const lineNum = parseInt(match[2], 10);
            if (lineNum === targetNum) {
              return {
                lineIndex: i,
                col: match[1].length,
                text: line
              };
            }
          }
        }
        return null;
      }
      const lines = Array.isArray(documentTextOrLines) ? documentTextOrLines : typeof documentTextOrLines === "string" ? documentTextOrLines.split(/\r?\n/) : [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(\s*)(\d+)\b/);
        if (match) {
          const lineNum = parseInt(match[2], 10);
          if (lineNum === targetNum) {
            return {
              lineIndex: i,
              col: match[1].length,
              text: line
            };
          }
        }
      }
      return null;
    }
    function getBasDefinition(documentTextOrLines, lineIndex, charIndex) {
      const lines = Array.isArray(documentTextOrLines) ? documentTextOrLines : documentTextOrLines.split(/\r?\n/);
      if (lineIndex < 0 || lineIndex >= lines.length) return null;
      const lineText = lines[lineIndex];
      const jumpTarget = findBasJumpTargetAtPosition2(lineText, charIndex);
      if (!jumpTarget) return null;
      const targetLocation = findBasLineIndex2(lines, jumpTarget.targetLineNumber);
      if (!targetLocation) return null;
      return {
        targetLineNumber: jumpTarget.targetLineNumber,
        origin: {
          startCol: jumpTarget.startCol,
          endCol: jumpTarget.endCol,
          keyword: jumpTarget.keyword
        },
        target: targetLocation
      };
    }
    module2.exports = {
      findBasJumpTargetAtPosition: findBasJumpTargetAtPosition2,
      findBasLineIndex: findBasLineIndex2,
      getBasDefinition
    };
  }
});

// src/core/share.js
var require_share = __commonJS({
  "src/core/share.js"(exports2, module2) {
    var CATBOX_API_URL = "https://catbox.moe/user/api.php";
    var LITTERBOX_API_URL = "https://litterbox.catbox.moe/resources/internals/api.php";
    function toUint8Array(bytes) {
      if (bytes instanceof Uint8Array) {
        return bytes;
      }
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(bytes)) {
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      }
      return new Uint8Array(bytes);
    }
    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async function verifyRemoteFileSize(url, fetchFn) {
      try {
        const res = await fetchFn(url, { method: "HEAD" });
        if (!res.ok) {
          const getRes = await fetchFn(url, {
            method: "GET",
            headers: { "Range": "bytes=0-0" }
          });
          if (!getRes.ok) return { ok: false, size: 0 };
          return { ok: true, size: 1 };
        }
        const lenHeader = res.headers && typeof res.headers.get === "function" ? res.headers.get("content-length") : res.headers && res.headers["content-length"];
        if (lenHeader !== null && lenHeader !== void 0) {
          const len = parseInt(lenHeader, 10);
          if (!isNaN(len) && len === 0) {
            return { ok: false, size: 0 };
          }
          return { ok: true, size: isNaN(len) ? -1 : len };
        }
        return { ok: true, size: -1 };
      } catch (err) {
        return { ok: true, size: -1 };
      }
    }
    async function uploadToCatbox(bytes, safeFilename, fetchFn) {
      const form = new FormData();
      form.append("reqtype", "fileupload");
      const file = new File([bytes], safeFilename, {
        type: "application/octet-stream"
      });
      form.append("fileToUpload", file);
      const res = await fetchFn(CATBOX_API_URL, {
        method: "POST",
        body: form,
        headers: {
          "User-Agent": "VSCode-Sinclair-BASIC/1.0.3"
        }
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const rawUrl = (await res.text()).trim();
      if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
        throw new Error(`Respuesta vac\xEDa o inesperada de Catbox: ${rawUrl}`);
      }
      return rawUrl;
    }
    async function uploadToLitterbox(bytes, safeFilename, fetchFn) {
      const form = new FormData();
      form.append("reqtype", "fileupload");
      form.append("time", "72h");
      const file = new File([bytes], safeFilename, {
        type: "application/octet-stream"
      });
      form.append("fileToUpload", file);
      const res = await fetchFn(LITTERBOX_API_URL, {
        method: "POST",
        body: form,
        headers: {
          "User-Agent": "VSCode-Sinclair-BASIC/1.0.3"
        }
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const rawUrl = (await res.text()).trim();
      if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
        throw new Error(`Respuesta vac\xEDa o inesperada de Litterbox: ${rawUrl}`);
      }
      return rawUrl;
    }
    async function uploadTapToHost2(tapBytes, filename = "program.tap", fetchFn = fetch, options = {}) {
      if (!tapBytes || tapBytes.length === 0) {
        throw new Error("El archivo TAP est\xE1 vac\xEDo o no se gener\xF3 correctamente.");
      }
      const safeFilename = filename.toLowerCase().endsWith(".tap") ? filename : `${filename}.tap`;
      const maxRetries = options.maxRetries !== void 0 ? options.maxRetries : 3;
      const retryDelay = options.retryDelay !== void 0 ? options.retryDelay : 600;
      const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {
      };
      let currentBytes = toUint8Array(tapBytes);
      let lastError = null;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 1) {
            onProgress(`Reintentando subida a Catbox (intento ${attempt}/${maxRetries})...`);
          }
          const rawUrl = await uploadToCatbox(currentBytes, safeFilename, fetchFn);
          if (options.verifyIntegrity !== false) {
            onProgress("Verificando integridad de la cinta en el servidor...");
            const check = await verifyRemoteFileSize(rawUrl, fetchFn);
            if (!check.ok && check.size === 0) {
              const padded = new Uint8Array(currentBytes.length + 1);
              padded.set(currentBytes);
              padded[currentBytes.length] = 0;
              currentBytes = padded;
              if (attempt < maxRetries) {
                onProgress("Cach\xE9 de 0 bytes detectada en el servidor. Reintentando con evasi\xF3n de hash...");
                await sleep(retryDelay);
                continue;
              }
            }
          }
          return rawUrl;
        } catch (err) {
          lastError = err;
          if (attempt < maxRetries) {
            await sleep(retryDelay);
          }
        }
      }
      if (options.useFallback !== false) {
        try {
          onProgress("Catbox temporalmente no disponible. Conmutando a Litterbox (72h)...");
          const litterUrl = await uploadToLitterbox(currentBytes, safeFilename, fetchFn);
          return litterUrl;
        } catch (fallbackErr) {
          lastError = new Error(`Catbox (${lastError.message}) y Litterbox (${fallbackErr.message})`);
        }
      }
      throw new Error(`Error en el servidor de alojamiento: ${lastError.message}`);
    }
    function buildTurbo80ShareUrl2(tapPublicUrl, options = {}) {
      if (!tapPublicUrl) {
        throw new Error("Se requiere la URL p\xFAblica del archivo TAP.");
      }
      const model = options.model || "48k";
      const encodedUrl = encodeURIComponent(tapPublicUrl.trim());
      let shareUrl = `https://turbo80.com/?load=${encodedUrl}&model=${model}`;
      if (options.crt === false) {
        shareUrl += "&crt=0";
      }
      return shareUrl;
    }
    module2.exports = {
      uploadTapToHost: uploadTapToHost2,
      buildTurbo80ShareUrl: buildTurbo80ShareUrl2
    };
  }
});

// src/core/debugger.js
var require_debugger = __commonJS({
  "src/core/debugger.js"(exports2, module2) {
    var ROM48_STMT_ADDR = 6973;
    var ROM48_LOOP_ADDR = 6953;
    function decodeSinclairFloat(b0, b1, b2, b3, b4) {
      if (b0 === 0) {
        const sign = b1 === 255 ? -1 : 1;
        const val2 = b2 & 255 | (b3 & 255) << 8;
        return sign * val2;
      }
      const exp = b0 - 128;
      const mant = (b1 & 127 | 128) * 16777216 + (b2 & 255) * 65536 + (b3 & 255) * 256 + (b4 & 255);
      let val = mant * Math.pow(2, exp - 31);
      if (b1 & 128) val = -val;
      return Math.round(val * 1e6) / 1e6;
    }
    function decodeSpectrumString(bytes) {
      if (!bytes || bytes.length === 0) return "";
      let res = "";
      let i = 0;
      const len = bytes.length;
      while (i < len) {
        const b = bytes[i];
        if (b === 16 && i + 1 < len && bytes[i + 1] <= 9) {
          res += `{INK ${bytes[i + 1]}}`;
          i += 2;
          continue;
        }
        if (b === 17 && i + 1 < len && bytes[i + 1] <= 9) {
          res += `{PAPER ${bytes[i + 1]}}`;
          i += 2;
          continue;
        }
        if (b === 18 && i + 1 < len && (bytes[i + 1] === 0 || bytes[i + 1] === 1 || bytes[i + 1] === 8)) {
          res += `{FLASH ${bytes[i + 1]}}`;
          i += 2;
          continue;
        }
        if (b === 19 && i + 1 < len && (bytes[i + 1] === 0 || bytes[i + 1] === 1 || bytes[i + 1] === 8)) {
          res += `{BRIGHT ${bytes[i + 1]}}`;
          i += 2;
          continue;
        }
        if (b === 20 && i + 1 < len && (bytes[i + 1] === 0 || bytes[i + 1] === 1)) {
          res += `{INVERSE ${bytes[i + 1]}}`;
          i += 2;
          continue;
        }
        if (b === 21 && i + 1 < len && (bytes[i + 1] === 0 || bytes[i + 1] === 1)) {
          res += `{OVER ${bytes[i + 1]}}`;
          i += 2;
          continue;
        }
        if (b === 22 && i + 2 < len && bytes[i + 1] <= 21 && bytes[i + 2] <= 31) {
          res += `{AT ${bytes[i + 1]},${bytes[i + 2]}}`;
          i += 3;
          continue;
        }
        if (b === 23 && i + 2 < len) {
          const tabCol = bytes[i + 1] | bytes[i + 2] << 8;
          res += `{TAB ${tabCol}}`;
          i += 3;
          continue;
        }
        if (b >= 144 && b <= 164) {
          const udgLetter = String.fromCharCode(65 + (b - 144));
          res += `{${udgLetter}}`;
          i++;
          continue;
        }
        if (b >= 32 && b <= 126) {
          if (b === 34) {
            res += '\\"';
          } else {
            res += String.fromCharCode(b);
          }
          i++;
          continue;
        }
        res += `{CODE ${b}}`;
        i++;
      }
      return res;
    }
    function readSpectrumVariables(readByte) {
      const varsStart = readByte(23627) & 255 | (readByte(23628) & 255) << 8;
      const vars = [];
      let p = varsStart;
      const maxAddr = 65280;
      while (p < maxAddr) {
        const b = readByte(p);
        if (b === 128 || b === 255 || b === 0) break;
        const type = b >> 5 & 7;
        const letterCode = b & 31;
        if (type === 3) {
          const name = String.fromCharCode(96 + letterCode);
          const val = decodeSinclairFloat(
            readByte(p + 1),
            readByte(p + 2),
            readByte(p + 3),
            readByte(p + 4),
            readByte(p + 5)
          );
          vars.push({ name, type: "number", value: val });
          p += 6;
        } else if (type === 5) {
          let name = String.fromCharCode(96 + letterCode);
          p++;
          while (p < maxAddr) {
            const c = readByte(p);
            name += String.fromCharCode(c & 127);
            p++;
            if (c & 128) break;
          }
          const val = decodeSinclairFloat(
            readByte(p),
            readByte(p + 1),
            readByte(p + 2),
            readByte(p + 3),
            readByte(p + 4)
          );
          vars.push({ name, type: "number", value: val });
          p += 5;
        } else if (type === 2) {
          const name = String.fromCharCode(96 + letterCode) + "$";
          const len = readByte(p + 1) & 255 | (readByte(p + 2) & 255) << 8;
          const rawBytes = [];
          for (let i = 0; i < len; i++) {
            rawBytes.push(readByte(p + 3 + i));
          }
          const str = decodeSpectrumString(rawBytes);
          vars.push({ name, type: "string", value: str, length: len, rawBytes });
          p += 3 + len;
        } else if (type === 7) {
          const name = String.fromCharCode(96 + letterCode);
          const val = decodeSinclairFloat(
            readByte(p + 1),
            readByte(p + 2),
            readByte(p + 3),
            readByte(p + 4),
            readByte(p + 5)
          );
          const limit = decodeSinclairFloat(
            readByte(p + 6),
            readByte(p + 7),
            readByte(p + 8),
            readByte(p + 9),
            readByte(p + 10)
          );
          const step = decodeSinclairFloat(
            readByte(p + 11),
            readByte(p + 12),
            readByte(p + 13),
            readByte(p + 14),
            readByte(p + 15)
          );
          const loopLine = readByte(p + 16) & 255 | (readByte(p + 17) & 255) << 8;
          const loopStmt = readByte(p + 18) & 255;
          vars.push({ name, type: "for", value: val, limit, step, loopLine, loopStmt });
          p += 19;
        } else if (type === 4 || type === 6) {
          const isString = type === 6;
          const name = String.fromCharCode(96 + letterCode) + (isString ? "$" : "");
          const len = readByte(p + 1) & 255 | (readByte(p + 2) & 255) << 8;
          vars.push({ name, type: isString ? "string-array" : "number-array", length: len });
          p += 3 + len;
        } else {
          break;
        }
      }
      return vars;
    }
    function findDocumentLine2(documentText, targetBasicLine) {
      if (typeof documentText !== "string" || typeof targetBasicLine !== "number") return -1;
      const lines = documentText.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^\s*(\d+)/);
        if (match && parseInt(match[1], 10) === targetBasicLine) {
          return i;
        }
      }
      return -1;
    }
    function mapSourceLineToBasic2(sourceLine, sourceToBasic) {
      if (!sourceToBasic) return sourceLine;
      const getBasic = (l) => {
        if (sourceToBasic instanceof Map) return sourceToBasic.get(l);
        return sourceToBasic[l];
      };
      const exact = getBasic(sourceLine);
      if (exact !== void 0) return exact;
      for (let l = sourceLine + 1; l <= sourceLine + 500; l++) {
        const next = getBasic(l);
        if (next !== void 0) return next;
      }
      return null;
    }
    function mapBasicToSourceLine2(basicLine, basicToSource) {
      if (!basicToSource) return basicLine;
      let res;
      if (basicToSource instanceof Map) {
        res = basicToSource.get(basicLine);
      } else {
        res = basicToSource[basicLine];
      }
      return res !== void 0 ? res : basicLine;
    }
    function getStatementRanges2(lineText) {
      if (typeof lineText !== "string") return [];
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
          if (lineText.slice(i, i + 3).toUpperCase() === "REM" && (i === codeStart || /\s|:/.test(lineText[i - 1]))) {
            inRem = true;
          } else if (ch === ":") {
            segments.push({ stmtIndex: segments.length + 1, startCol: segStart, endCol: i });
            segStart = i + 1;
            if (lineText[segStart] === " ") segStart++;
          }
        }
      }
      segments.push({ stmtIndex: segments.length + 1, startCol: segStart, endCol: lineText.length });
      return segments;
    }
    function findStatementRange2(lineText, stmtIndex) {
      const segments = getStatementRanges2(lineText);
      const idx = Math.max(1, stmtIndex) - 1;
      if (idx < segments.length) {
        return { startCol: segments[idx].startCol, endCol: segments[idx].endCol };
      }
      const prefixMatch = typeof lineText === "string" ? lineText.match(/^(\s*@[a-zA-Z0-9_]+:\s*|\s*\d+\s*|\s*)/) : null;
      const codeStart = prefixMatch ? prefixMatch[0].length : 0;
      return { startCol: codeStart, endCol: lineText ? lineText.length : 0 };
    }
    function findStatementIndexAtColumn2(lineText, column1) {
      if (!column1 || column1 <= 1) return 1;
      const col0 = column1 - 1;
      const ranges = getStatementRanges2(lineText);
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
    var SinclairBasicDebugAdapterCore2 = class {
      constructor(options = {}) {
        this.sendEvent = options.sendEvent || (() => {
        });
        this.sendResponse = options.sendResponse || (() => {
        });
        this.onAction = options.onAction || (() => {
        });
        this.seq = 1;
        this.currentLine = null;
        this.currentStmt = null;
        this.currentVars = [];
        this.currentDocText = "";
        this.currentFilePath = "";
        this.breakpoints = /* @__PURE__ */ new Map();
        this.sourceMap = null;
      }
      setSourceMap(sourceMap) {
        this.sourceMap = sourceMap || null;
      }
      setDocument(filePath, docText) {
        this.currentFilePath = filePath || "";
        this.currentDocText = docText || "";
      }
      handleMessage(message) {
        if (!message) return;
        if (message.type === "request") {
          this.handleRequest(message);
        }
      }
      _sendSuccess(request, body = {}) {
        this.sendResponse({
          seq: this.seq++,
          type: "response",
          request_seq: request.seq,
          command: request.command,
          success: true,
          body
        });
      }
      _sendError(request, message) {
        this.sendResponse({
          seq: this.seq++,
          type: "response",
          request_seq: request.seq,
          command: request.command,
          success: false,
          message
        });
      }
      handleRequest(request) {
        const { command, arguments: args = {} } = request;
        switch (command) {
          case "initialize": {
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
            this.sendEvent("initialized", {});
            break;
          }
          case "launch": {
            if (args.program) {
              this.currentFilePath = args.program;
            }
            this.onAction("launch", args);
            this._sendSuccess(request, {});
            break;
          }
          case "breakpointLocations": {
            const line = args.line;
            const lines = this.currentDocText ? this.currentDocText.split(/\r?\n/) : [];
            const docLine0 = line - 1;
            const locations = [];
            if (docLine0 >= 0 && docLine0 < lines.length) {
              const lineText = lines[docLine0];
              const ranges = getStatementRanges2(lineText);
              for (const r of ranges) {
                locations.push({
                  line,
                  column: r.startCol + 1
                });
              }
            }
            this._sendSuccess(request, {
              breakpoints: locations.length > 0 ? locations : [{ line, column: 1 }]
            });
            break;
          }
          case "setBreakpoints": {
            const sourcePath = args.source && (args.source.path || args.source.name) || "";
            const clientBreakpoints = Array.isArray(args.breakpoints) ? args.breakpoints : [];
            const targetBreakpoints = [];
            const lines = this.currentDocText ? this.currentDocText.split(/\r?\n/) : [];
            for (const bp of clientBreakpoints) {
              const docLine0 = bp.line - 1;
              const lineText = docLine0 >= 0 && docLine0 < lines.length ? lines[docLine0] : "";
              const stmtIndex = findStatementIndexAtColumn2(lineText, bp.column);
              let basicLine = null;
              if (this.sourceMap && this.sourceMap.sourceToBasic) {
                basicLine = mapSourceLineToBasic2(bp.line, this.sourceMap.sourceToBasic);
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
              if (basicLine !== null && basicLine !== void 0) {
                targetBreakpoints.push({
                  line: basicLine,
                  stmt: stmtIndex
                });
              }
            }
            this.breakpoints.set(sourcePath, targetBreakpoints);
            this.onAction("setBreakpoints", {
              sourcePath,
              breakpoints: targetBreakpoints,
              lines: targetBreakpoints.map((b) => b.line),
              rawBreakpoints: clientBreakpoints
            });
            this._sendSuccess(request, {
              breakpoints: clientBreakpoints.map((bp) => {
                const docLine0 = bp.line - 1;
                const lineText = docLine0 >= 0 && docLine0 < lines.length ? lines[docLine0] : "";
                const stmtIndex = findStatementIndexAtColumn2(lineText, bp.column);
                const ranges = getStatementRanges2(lineText);
                const r = ranges[stmtIndex - 1];
                return {
                  verified: true,
                  line: bp.line,
                  column: r ? r.startCol + 1 : bp.column || 1
                };
              })
            });
            break;
          }
          case "setExceptionBreakpoints": {
            this._sendSuccess(request, {});
            break;
          }
          case "configurationDone": {
            this.onAction("configurationDone", {});
            this._sendSuccess(request, {});
            break;
          }
          case "threads": {
            this._sendSuccess(request, {
              threads: [
                { id: 1, name: "ZX Spectrum 48K (Sinclair BASIC)" }
              ]
            });
            break;
          }
          case "stackTrace": {
            const frames = [];
            if (this.currentLine != null) {
              let docLine0 = -1;
              let docLine1 = 1;
              let frameName = "";
              if (this.sourceMap && this.sourceMap.basicToSource) {
                docLine1 = mapBasicToSourceLine2(this.currentLine, this.sourceMap.basicToSource);
                docLine0 = docLine1 - 1;
                frameName = `L\xEDnea ${docLine1} [BASIC ${this.currentLine}:${this.currentStmt || 1}]`;
              } else {
                docLine0 = findDocumentLine2(this.currentDocText, this.currentLine);
                docLine1 = docLine0 >= 0 ? docLine0 + 1 : 1;
                frameName = `L\xEDnea ${this.currentLine} [Sentencia ${this.currentStmt || 1}]`;
              }
              const lines = this.currentDocText ? this.currentDocText.split(/\r?\n/)[docLine0] : "";
              const lineText = docLine0 >= 0 && this.currentDocText ? this.currentDocText.split(/\r?\n/)[docLine0] : "";
              const stmtRange = findStatementRange2(lineText, this.currentStmt || 1);
              const fileName = this.currentFilePath ? this.currentFilePath.replace(/\\/g, "/").split("/").pop() : "program.bas";
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
          case "scopes": {
            this._sendSuccess(request, {
              scopes: [
                {
                  name: "Variables en RAM (VARS)",
                  presentationHint: "locals",
                  variablesReference: 1e3,
                  expensive: false
                }
              ]
            });
            break;
          }
          case "variables": {
            const varRef = args.variablesReference;
            if (varRef === 1e3) {
              const dapVars = (this.currentVars || []).map((v, idx) => {
                let valStr = "";
                let childRef = 0;
                if (v.type === "string") {
                  valStr = `"${v.value}"`;
                  if (v.rawBytes && v.rawBytes.length > 0) {
                    childRef = 2e3 + idx;
                  }
                } else if (v.type === "for") {
                  valStr = `${v.value} (TO ${v.limit} STEP ${v.step})`;
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
            } else if (varRef >= 2e3) {
              const varIdx = varRef - 2e3;
              const targetVar = this.currentVars && this.currentVars[varIdx];
              const children = [];
              if (targetVar && targetVar.rawBytes) {
                targetVar.rawBytes.forEach((b, i) => {
                  const charDesc = b >= 32 && b <= 126 ? `"${String.fromCharCode(b)}"` : `{CODE ${b}}`;
                  children.push({
                    name: `(${i + 1})`,
                    value: `${b}  ${charDesc}`,
                    type: "CODE",
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
          case "continue": {
            this.onAction("continue", {});
            this._sendSuccess(request, { allThreadsContinued: true });
            this.sendEvent("continued", { threadId: 1, allThreadsContinued: true });
            break;
          }
          case "pause": {
            this.onAction("pause", {});
            this._sendSuccess(request, {});
            break;
          }
          case "next": {
            this.onAction("stepLine", {});
            this._sendSuccess(request, {});
            break;
          }
          case "stepIn": {
            this.onAction("stepStmt", {});
            this._sendSuccess(request, {});
            break;
          }
          case "stepOut": {
            this.onAction("stepLine", {});
            this._sendSuccess(request, {});
            break;
          }
          case "restart": {
            this.onAction("restart", {});
            this._sendSuccess(request, {});
            break;
          }
          case "disconnect":
          case "terminate": {
            this.onAction("stop", {});
            this._sendSuccess(request, {});
            this.sendEvent("terminated", {});
            this.sendEvent("exited", { exitCode: 0 });
            break;
          }
          default: {
            this._sendSuccess(request, {});
            break;
          }
        }
      }
      notifyPaused(line, stmt, vars, reason = "breakpoint") {
        this.currentLine = line;
        this.currentStmt = stmt;
        this.currentVars = Array.isArray(vars) ? vars : [];
        this.sendEvent("stopped", {
          reason,
          threadId: 1,
          allThreadsStopped: true,
          description: `L\xEDnea ${line}, Sentencia ${stmt}`
        });
      }
      notifyResumed() {
        this.sendEvent("continued", {
          threadId: 1,
          allThreadsContinued: true
        });
      }
      notifyTerminated() {
        this.sendEvent("terminated", {});
        this.sendEvent("exited", { exitCode: 0 });
      }
    };
    module2.exports = {
      ROM48_STMT_ADDR,
      ROM48_LOOP_ADDR,
      decodeSinclairFloat,
      readSpectrumVariables,
      findDocumentLine: findDocumentLine2,
      findStatementRange: findStatementRange2,
      getStatementRanges: getStatementRanges2,
      findStatementIndexAtColumn: findStatementIndexAtColumn2,
      SinclairBasicDebugAdapterCore: SinclairBasicDebugAdapterCore2,
      decodeSpectrumString,
      mapSourceLineToBasic: mapSourceLineToBasic2,
      mapBasicToSourceLine: mapBasicToSourceLine2
    };
  }
});

// src/core/turbo80Html.js
var require_turbo80Html = __commonJS({
  "src/core/turbo80Html.js"(exports2, module2) {
    function getTurbo80Html2(webview, extensionUri, vscode2) {
      const turbo80CoreUri = webview && extensionUri && vscode2 ? webview.asWebviewUri(vscode2.Uri.joinPath(extensionUri, "media", "turbo80", "turbo80-core.js")) : "";
      const turbo80Uri = webview && extensionUri && vscode2 ? webview.asWebviewUri(vscode2.Uri.joinPath(extensionUri, "media", "turbo80", "turbo80.js")) : "";
      const cspSource = webview && webview.cspSource ? webview.cspSource : "";
      return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'unsafe-inline' 'unsafe-eval' ${cspSource} https://turbo80.com;
    frame-src https://turbo80.com;
    style-src 'unsafe-inline' ${cspSource};
    img-src https: data: ${cspSource};
    font-src ${cspSource} data:;
    connect-src https://turbo80.com ${cspSource} data: blob:;
  ">
  <title>Turbo80 - ZX Spectrum</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #0c0c11;
      color: #e9e9f2;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    #emulator-wrap {
      flex: 1;
      min-height: 0;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow-y: auto;
      overflow-x: hidden;
    }
    #spectrum {
      width: 100% !important;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    #spectrum iframe {
      border: 0;
      width: 100% !important;
      height: auto !important;
      aspect-ratio: 4 / 3 !important;
      max-width: 100vw;
    }
    #footer {
      height: 34px;
      background: #14141e;
      border-top: 1px solid #28283a;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1.2rem;
      font-size: 12px;
      color: #9b9bb0;
      user-select: none;
      flex-shrink: 0;
    }
    #footer a {
      color: #37d0ff;
      text-decoration: none;
      font-weight: 500;
      transition: color 0.15s ease;
    }
    #footer a:hover {
      color: #57ef9e;
      text-decoration: underline;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
      font-size: 12px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #57ef9e;
      box-shadow: 0 0 8px rgba(87, 239, 158, 0.7);
    }
    .attribution {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
    }
  </style>
</head>
<body>
  <div id="emulator-wrap">
    <div id="spectrum" style="width: 100%;"></div>
  </div>
  <footer id="footer">
    <div class="status-badge">
      <span class="status-dot"></span>
      <span id="game-title">Iniciando ZX Spectrum...</span>
    </div>
    <div class="attribution">
      Emulado con <a href="https://turbo80.com" target="_blank" rel="noopener">Turbo80</a> &bull; Emulador de ZX Spectrum por Jos&eacute; Enrique Garc&iacute;a (Incinerator)
    </div>
  </footer>

  <script src="${turbo80CoreUri}"><\/script>
  <script src="${turbo80Uri}"><\/script>
  <script>
    if (typeof Turbo80 === 'undefined') {
      const s = document.createElement('script');
      s.src = 'https://turbo80.com/turbo80.js';
      document.head.appendChild(s);
    }
  <\/script>
  <script>
    const vscode = acquireVsCodeApi();
    let emulator = null;
    let pendingData = null;

    function adjustEmulatorSizing() {
      const spectrum = document.getElementById('spectrum');
      if (!spectrum) return;
      const shadow = spectrum.shadowRoot;
      if (shadow && !shadow.getElementById('t80-responsive-size')) {
        const style = document.createElement('style');
        style.id = 't80-responsive-size';
        style.textContent = [
          ':host { width: 100% !important; max-width: 100% !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; }',
          '.t80-body { width: 100% !important; max-width: 100% !important; min-height: 0 !important; height: auto !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; background: transparent !important; }',
          'main { width: 100% !important; max-width: 100% !important; min-height: 0 !important; height: auto !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; margin: 0 !important; padding: 0 !important; }',
          '.screen-zone { width: 100% !important; max-width: 100% !important; height: auto !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; gap: 0 !important; }',
          '.bezel { width: 100% !important; max-width: 100% !important; height: auto !important; margin: 0 !important; padding: 0 !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; }',
          '.screen-wrap { width: 100% !important; max-width: 100% !important; height: auto !important; aspect-ratio: 4 / 3 !important; margin: 0 auto !important; }',
          '#screen { width: 100% !important; max-width: 100% !important; height: auto !important; aspect-ratio: 4 / 3 !important; display: block !important; }',
          '#crt-gl { width: 100% !important; height: 100% !important; }'
        ].join('\\n');
        shadow.appendChild(style);
      }
    }

    function focusEmulator() {
      try {
        if (emulator && typeof emulator.focus === 'function') {
          emulator.focus();
        }
      } catch (e) {}
      try {
        const shadow = (document.querySelector('#spectrum') && document.querySelector('#spectrum').shadowRoot) || (emulator && emulator.shadow);
        const screen = shadow ? (shadow.getElementById('screen') || shadow.querySelector('canvas')) : document.querySelector('#spectrum canvas');
        if (screen) {
          if (!screen.hasAttribute('tabindex')) {
            screen.setAttribute('tabindex', '0');
          }
          screen.focus();
        }
      } catch (e) {}
      try {
        const iframe = document.querySelector('#spectrum iframe') || (emulator && emulator.iframe);
        if (iframe) {
          if (!iframe.hasAttribute('tabindex')) {
            iframe.setAttribute('tabindex', '0');
          }
          iframe.focus();
          if (iframe.contentWindow) {
            iframe.contentWindow.focus();
          }
          if (typeof iframe.click === 'function') {
            iframe.click();
          }
        }
      } catch (e) {}
    }

    function attachIframeListeners() {
      try {
        const iframe = document.querySelector('#spectrum iframe') || (emulator && emulator.iframe);
        if (iframe && !iframe._hasLoadedListener) {
          iframe._hasLoadedListener = true;
          iframe.addEventListener('load', () => {
            scheduleFocus();
          });
        }
      } catch (e) {}
    }

    function scheduleFocus() {
      adjustEmulatorSizing();
      focusEmulator();
      attachIframeListeners();
      [50, 150, 300, 500, 800, 1200, 1800].forEach(delay => {
        setTimeout(() => {
          adjustEmulatorSizing();
          focusEmulator();
        }, delay);
      });
    }

    function applyTap(data) {
      try {
        const binaryString = atob(data.base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const currentModel = data.model || '48k';
        document.getElementById('game-title').textContent = (data.filename || 'game.tap') + ' (' + currentModel.toUpperCase() + ')';

        if (typeof Turbo80 === 'undefined') {
          document.getElementById('game-title').textContent = 'Error cargando Turbo80 (comprueba tu conexi\xF3n a internet)';
          return;
        }

        if (!emulator) {
          emulator = Turbo80(document.getElementById('spectrum'), {
            load: bytes,
            name: data.filename || 'game.tap',
            model: currentModel,
            crt: data.crt ? 'on' : 'off',
            width: '100%'
          });
          if (emulator && typeof emulator.on === 'function') {
            emulator.on('ready', () => {
              adjustEmulatorSizing();
              scheduleFocus();
            });
            emulator.on('loaded', () => {
              adjustEmulatorSizing();
              scheduleFocus();
            });
          }
          attachIframeListeners();
        } else {
          const doLoad = () => emulator.load(bytes, data.filename || 'game.tap');
          if (emulator.setModel) {
            Promise.resolve(emulator.setModel(currentModel))
              .then(() => {
                if (emulator.reset) emulator.reset();
                return doLoad();
              })
              .then(() => {
                adjustEmulatorSizing();
                scheduleFocus();
              })
              .catch(() => {
                doLoad();
                adjustEmulatorSizing();
                scheduleFocus();
              });
          } else {
            doLoad();
            adjustEmulatorSizing();
            scheduleFocus();
          }
        }
        adjustEmulatorSizing();
        scheduleFocus();
      } catch (err) {
        console.error('Error loading TAP into Turbo80:', err);
        document.getElementById('game-title').textContent = 'Error al cargar TAP: ' + err.message;
      }
    }

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

    function decodeSpectrumString(bytes) {
      if (!bytes || bytes.length === 0) return '';
      let res = '';
      let i = 0;
      const len = bytes.length;

      while (i < len) {
        const b = bytes[i];

        if (b === 16 && i + 1 < len && bytes[i + 1] <= 9) {
          res += '{INK ' + bytes[i + 1] + '}';
          i += 2;
          continue;
        }
        if (b === 17 && i + 1 < len && bytes[i + 1] <= 9) {
          res += '{PAPER ' + bytes[i + 1] + '}';
          i += 2;
          continue;
        }
        if (b === 18 && i + 1 < len && (bytes[i + 1] === 0 || bytes[i + 1] === 1 || bytes[i + 1] === 8)) {
          res += '{FLASH ' + bytes[i + 1] + '}';
          i += 2;
          continue;
        }
        if (b === 19 && i + 1 < len && (bytes[i + 1] === 0 || bytes[i + 1] === 1 || bytes[i + 1] === 8)) {
          res += '{BRIGHT ' + bytes[i + 1] + '}';
          i += 2;
          continue;
        }
        if (b === 20 && i + 1 < len && (bytes[i + 1] === 0 || bytes[i + 1] === 1)) {
          res += '{INVERSE ' + bytes[i + 1] + '}';
          i += 2;
          continue;
        }
        if (b === 21 && i + 1 < len && (bytes[i + 1] === 0 || bytes[i + 1] === 1)) {
          res += '{OVER ' + bytes[i + 1] + '}';
          i += 2;
          continue;
        }
        if (b === 22 && i + 2 < len && bytes[i + 1] <= 21 && bytes[i + 2] <= 31) {
          res += '{AT ' + bytes[i + 1] + ',' + bytes[i + 2] + '}';
          i += 3;
          continue;
        }
        if (b === 23 && i + 2 < len) {
          const tabCol = bytes[i + 1] | (bytes[i + 2] << 8);
          res += '{TAB ' + tabCol + '}';
          i += 3;
          continue;
        }
        if (b >= 144 && b <= 164) {
          res += '{' + String.fromCharCode(65 + (b - 144)) + '}';
          i++;
          continue;
        }
        if (b >= 32 && b <= 126) {
          if (b === 34) {
            res += '\\"';
          } else {
            res += String.fromCharCode(b);
          }
          i++;
          continue;
        }
        res += '{CODE ' + b + '}';
        i++;
      }
      return res;
    }

    function readSpectrumVariables(readByte) {
      const varsStart = (readByte(0x5C4B) & 0xFF) | ((readByte(0x5C4C) & 0xFF) << 8);
      const vars = [];
      let p = varsStart;
      const maxAddr = 0xFF00;

      while (p < maxAddr) {
        const b = readByte(p);
        if (b === 0x80 || b === 0xFF || b === 0) break;

        const type = (b >> 5) & 7;
        const letterCode = b & 0x1F;

        if (type === 3) {
          const name = String.fromCharCode(96 + letterCode);
          const val = decodeSinclairFloat(
            readByte(p + 1), readByte(p + 2), readByte(p + 3), readByte(p + 4), readByte(p + 5)
          );
          vars.push({ name, type: 'number', value: val });
          p += 6;
        } else if (type === 5) {
          let name = String.fromCharCode(96 + letterCode);
          p++;
          while (p < maxAddr) {
            const c = readByte(p);
            name += String.fromCharCode(c & 0x7F);
            p++;
            if (c & 0x80) break;
          }
          const val = decodeSinclairFloat(
            readByte(p), readByte(p + 1), readByte(p + 2), readByte(p + 3), readByte(p + 4)
          );
          vars.push({ name, type: 'number', value: val });
          p += 5;
        } else if (type === 2) {
          const name = String.fromCharCode(96 + letterCode) + '$';
          const len = (readByte(p + 1) & 0xFF) | ((readByte(p + 2) & 0xFF) << 8);
          const rawBytes = [];
          for (let i = 0; i < len; i++) {
            rawBytes.push(readByte(p + 3 + i));
          }
          const str = decodeSpectrumString(rawBytes);
          vars.push({ name, type: 'string', value: str, length: len, rawBytes: rawBytes });
          p += 3 + len;
        } else if (type === 7) {
          const name = String.fromCharCode(96 + letterCode);
          const val = decodeSinclairFloat(
            readByte(p + 1), readByte(p + 2), readByte(p + 3), readByte(p + 4), readByte(p + 5)
          );
          vars.push({ name, type: 'for', value: val });
          p += 19;
        } else if (type === 4 || type === 6) {
          const isString = (type === 6);
          const name = String.fromCharCode(96 + letterCode) + (isString ? '$' : '');
          const len = (readByte(p + 1) & 0xFF) | ((readByte(p + 2) & 0xFF) << 8);
          vars.push({ name, type: isString ? 'string-array' : 'number-array', length: len });
          p += 3 + len;
        } else {
          break;
        }
      }
      return vars;
    }

    const basicDebugger = {
      enabled: false,
      attached: false,
      breakpoints: new Map(),
      stepMode: null,
      pauseRequested: false,
      lastLine: null,
      lastStmt: null,
      lastPausedLine: null,
      lastPausedStmt: null,
      vars: [],

      setBreakpoints(bps) {
        this.breakpoints = new Map();
        if (Array.isArray(bps)) {
          for (const bp of bps) {
            let line, stmt;
            if (typeof bp === 'number') {
              line = bp;
              stmt = 1;
            } else if (bp && typeof bp === 'object') {
              line = bp.line;
              stmt = (typeof bp.stmt === 'number') ? bp.stmt : 1;
            }
            if (typeof line === 'number') {
              if (!this.breakpoints.has(line)) {
                this.breakpoints.set(line, new Set());
              }
              this.breakpoints.get(line).add(stmt);
            }
          }
        }
      },

      attach(sp) {
        if (!sp || this.attached) return;
        this.attached = true;
        if (!sp.breakpoints) sp.breakpoints = new Set();
        sp.breakpoints.add(0x1B3D);
        if (!sp.bpConds) sp.bpConds = new Map();

        sp.bpConds.set(0x1B3D, (cpu, spectrum) => {
          if (!this.enabled) return false;

          const line = spectrum.memory.read(0x5C45) | (spectrum.memory.read(0x5C46) << 8);
          const stmt = spectrum.memory.read(0x5C47);

          if (line >= 0x8000) return false;

          if (this.stepMode === 'stmt') {
            if (line !== this.lastLine || stmt !== this.lastStmt) {
              this.stepMode = null;
              this.onBreakHit(line, stmt, spectrum);
              return true;
            }
            return false;
          }

          if (this.stepMode === 'line') {
            if (line !== this.lastLine) {
              this.stepMode = null;
              this.onBreakHit(line, stmt, spectrum);
              return true;
            }
            return false;
          }

          if (this.pauseRequested) {
            this.pauseRequested = false;
            this.onBreakHit(line, stmt, spectrum);
            return true;
          }

          const stmtSet = this.breakpoints.get(line);
          if (stmtSet) {
            if (stmtSet.has(stmt) || stmtSet.has(0)) {
              if (line === this.lastPausedLine && stmt === this.lastPausedStmt) {
                return false;
              }
              this.onBreakHit(line, stmt, spectrum);
              return true;
            }
          }

          return false;
        });
      },

      onBreakHit(line, stmt, spectrum) {
        this.lastPausedLine = line;
        this.lastPausedStmt = stmt;
        this.vars = readSpectrumVariables(a => spectrum.memory.read(a));

        updateFooterStatus('paused', line, stmt);
        vscode.postMessage({
          command: 'basicPaused',
          line: line,
          stmt: stmt,
          vars: this.vars
        });
      }
    };

    function updateFooterStatus(status, line, stmt) {
      const title = document.getElementById('game-title');
      const dot = document.querySelector('.status-dot');
      if (!title) return;

      if (!basicDebugger.enabled) {
        if (dot) {
          dot.style.background = '#57ef9e';
          dot.style.boxShadow = '0 0 8px rgba(87, 239, 158, 0.7)';
        }
        return;
      }

      if (status === 'paused') {
        if (dot) {
          dot.style.background = '#ffcc00';
          dot.style.boxShadow = '0 0 8px rgba(255, 204, 0, 0.8)';
        }
        title.textContent = (pendingData && pendingData.filename ? pendingData.filename + ' \u2014 ' : '') + 'Pausado (L\xEDnea ' + line + ', Sent. ' + stmt + ')';
      } else {
        if (dot) {
          dot.style.background = '#57ef9e';
          dot.style.boxShadow = '0 0 8px rgba(87, 239, 158, 0.7)';
        }
        title.textContent = (pendingData && pendingData.filename) ? pendingData.filename : 'ZX Spectrum';
      }
    }

    function doContinue() {
      if (emulator) {
        basicDebugger.stepMode = null;
        basicDebugger.pauseRequested = false;
        updateFooterStatus('running');
        vscode.postMessage({ command: 'basicResumed' });
        emulator.resume();
      }
    }

    function doPause() {
      basicDebugger.pauseRequested = true;
    }

    function doStepLine() {
      if (emulator) {
        basicDebugger.stepMode = 'line';
        basicDebugger.lastLine = basicDebugger.lastPausedLine;
        updateFooterStatus('running');
        vscode.postMessage({ command: 'basicResumed' });
        emulator.resume();
      }
    }

    function doStepStmt() {
      if (emulator) {
        basicDebugger.stepMode = 'stmt';
        basicDebugger.lastLine = basicDebugger.lastPausedLine;
        basicDebugger.lastStmt = basicDebugger.lastPausedStmt;
        updateFooterStatus('running');
        vscode.postMessage({ command: 'basicResumed' });
        emulator.resume();
      }
    }

    function doRestart() {
      if (pendingData) {
        basicDebugger.pauseRequested = true;
        applyTap(pendingData);
      }
    }

    function doStop() {
      basicDebugger.enabled = false;
      updateFooterStatus('running');
      vscode.postMessage({ command: 'debugStopped' });
      if (emulator) emulator.resume();
    }

    window.addEventListener('keydown', function (e) {
      if (!basicDebugger.enabled) return;
      if (e.key === 'F5') { e.preventDefault(); doContinue(); }
      else if (e.key === 'F6') { e.preventDefault(); doPause(); }
      else if (e.key === 'F10') { e.preventDefault(); doStepLine(); }
      else if (e.key === 'F11') { e.preventDefault(); doStepStmt(); }
    });

    function checkAttach() {
      try {
        const sp = emulator && emulator.main && emulator.main.spectrum;
        if (sp) {
          basicDebugger.attach(sp);
        }
      } catch (e) {}
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'loadTap') {
        pendingData = msg;
        if (msg.debug) {
          basicDebugger.enabled = true;
          basicDebugger.setBreakpoints(msg.breakpoints);
          if (msg.stopOnEntry || basicDebugger.breakpoints.size === 0) {
            basicDebugger.pauseRequested = true;
          }
          updateFooterStatus(basicDebugger.pauseRequested ? 'paused' : 'running', 1, 1);
        } else {
          basicDebugger.enabled = false;
          updateFooterStatus('running');
        }
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
          applyTap(msg);
          checkAttach();
          [50, 150, 300, 600, 1200, 2000].forEach(d => setTimeout(checkAttach, d));
        }
      } else if (msg.command === 'setBreakpoints') {
        const bps = Array.isArray(msg.breakpoints) ? msg.breakpoints : (Array.isArray(msg.lines) ? msg.lines : []);
        basicDebugger.setBreakpoints(bps);
      } else if (msg.command === 'debugContinue') {
        doContinue();
      } else if (msg.command === 'debugPause') {
        doPause();
      } else if (msg.command === 'debugStepLine') {
        doStepLine();
      } else if (msg.command === 'debugStepStmt') {
        doStepStmt();
      } else if (msg.command === 'debugRestart') {
        doRestart();
      } else if (msg.command === 'debugStop') {
        doStop();
      }
    });

    window.addEventListener('DOMContentLoaded', () => {
      adjustEmulatorSizing();
      if (pendingData) {
        applyTap(pendingData);
        checkAttach();
        [50, 150, 300, 600, 1200, 2000].forEach(d => setTimeout(checkAttach, d));
        pendingData = null;
      }
      vscode.postMessage({ command: 'ready' });
    });

    window.addEventListener('resize', adjustEmulatorSizing);
    setInterval(adjustEmulatorSizing, 250);

    window.addEventListener('focus', focusEmulator);
    window.addEventListener('pointerdown', focusEmulator);
    window.addEventListener('click', focusEmulator);
    window.addEventListener('keydown', focusEmulator);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        scheduleFocus();
      }
    });
  <\/script>
</body>
</html>`;
    }
    module2.exports = {
      getTurbo80Html: getTurbo80Html2
    };
  }
});

// src/core/bas2jbas.js
var require_bas2jbas = __commonJS({
  "src/core/bas2jbas.js"(exports2, module2) {
    var path;
    try {
      path = require("path");
    } catch {
      path = null;
    }
    var { splitStringsAndRem } = require_renumber();
    function slugifyTitle(text) {
      let clean = text.replace(/^SUB\s+/i, "").replace(/[*#=_\-]+/g, " ").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      if (!clean) return "";
      if (/^[0-9]/.test(clean)) {
        clean = "label_" + clean;
      }
      return clean;
    }
    function parseBasLines(basText) {
      const rawLines = basText.split(/\r?\n/);
      const parsed = [];
      for (let i = 0; i < rawLines.length; i++) {
        const raw = rawLines[i];
        const match = raw.match(/^\s*(\d+)\s*(.*)$/);
        if (!match) continue;
        const lineNum = parseInt(match[1], 10);
        const code = match[2];
        let remTitle = "";
        const remMatch = code.match(/^\s*REM\s+(?:SUB\s+)?([A-Za-z0-9\s_\-]+)$/i);
        if (remMatch) {
          remTitle = slugifyTitle(remMatch[1]);
        }
        parsed.push({ lineNum, code, raw, remTitle });
      }
      return parsed;
    }
    function findJumpTargets(lines) {
      const targets = /* @__PURE__ */ new Map();
      const jumpPattern = /\b(GO\s*TO|GOTO|GO\s*SUB|GOSUB|RUN|RESTORE|LINE|THEN)\s+(\d+(?:\s*,\s*\d+)*)/gi;
      for (const line of lines) {
        const chunks = splitStringsAndRem(line.code);
        for (const chunk of chunks) {
          if (chunk.type !== "code") continue;
          let match;
          jumpPattern.lastIndex = 0;
          while ((match = jumpPattern.exec(chunk.text)) !== null) {
            const matchEnd = match.index + match[0].length;
            const rest = chunk.text.slice(matchEnd);
            if (/^\s*[*\/+\-^<>=.(a-zA-Z_]/.test(rest)) {
              continue;
            }
            const keyword = match[1].toUpperCase().replace(/\s+/g, "");
            const targetList = match[2];
            const isSub = keyword === "GOSUB";
            const numbers = targetList.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
            for (const num of numbers) {
              const existing = targets.get(num) || { isSub: false, count: 0 };
              existing.count++;
              if (isSub) existing.isSub = true;
              targets.set(num, existing);
            }
          }
        }
      }
      return targets;
    }
    function generateLabels(lines, targets) {
      const lineMap = /* @__PURE__ */ new Map();
      lines.forEach((l) => lineMap.set(l.lineNum, l));
      const labelMap = /* @__PURE__ */ new Map();
      const usedNames = /* @__PURE__ */ new Set();
      function assignUnique(lineNum, baseName) {
        let name = baseName || `line_${lineNum}`;
        let candidate = name;
        let counter = 2;
        while (usedNames.has(candidate)) {
          candidate = `${name}_${counter}`;
          counter++;
        }
        usedNames.add(candidate);
        labelMap.set(lineNum, candidate);
      }
      for (const [lineNum, info] of targets.entries()) {
        const line = lineMap.get(lineNum);
        if (line && line.remTitle) {
          assignUnique(lineNum, line.remTitle);
        }
      }
      for (const [lineNum, info] of targets.entries()) {
        if (labelMap.has(lineNum)) continue;
        if (info.isSub) {
          assignUnique(lineNum, `sub_${lineNum}`);
        } else {
          assignUnique(lineNum, `line_${lineNum}`);
        }
      }
      return labelMap;
    }
    function updateJumpsToLabels(code, labelMap) {
      const chunks = splitStringsAndRem(code);
      const jumpPattern = /\b(GO\s*TO|GOTO|GO\s*SUB|GOSUB|RUN|RESTORE|LINE|THEN)\s+(\d+(?:\s*,\s*\d+)*)/gi;
      const newChunks = chunks.map((chunk) => {
        if (chunk.type !== "code") return chunk.text;
        return chunk.text.replace(jumpPattern, (fullMatch, keyword, targetsStr, offset, string) => {
          const matchEnd = offset + fullMatch.length;
          const rest = string.slice(matchEnd);
          if (/^\s*[*\/+\-^<>=.(a-zA-Z_]/.test(rest)) {
            return fullMatch;
          }
          const parts = targetsStr.split(/(\s*,\s*)/);
          const updatedParts = [];
          for (const part of parts) {
            const trimmed = part.trim();
            if (/^\d+$/.test(trimmed)) {
              const targetNum = parseInt(trimmed, 10);
              if (labelMap.has(targetNum)) {
                const labelName = labelMap.get(targetNum);
                const leading = part.slice(0, part.length - part.trimStart().length);
                const trailing = part.slice(part.trimEnd().length);
                updatedParts.push(`${leading}@${labelName}${trailing}`);
                continue;
              }
            }
            updatedParts.push(part);
          }
          return `${keyword} ${updatedParts.join("")}`;
        });
      });
      return newChunks.join("");
    }
    function convertRemToSingleQuote(lineCode) {
      const chunks = splitStringsAndRem(lineCode);
      let res = "";
      for (let idx = 0; idx < chunks.length; idx++) {
        const chunk = chunks[idx];
        if (chunk.type === "rem") {
          const remText = chunk.text.replace(/^REM\s*/i, "");
          if (res.trim().length === 0) {
            res = `' ${remText}`.trimEnd();
          } else {
            res = res.replace(/:\s*$/, "").trimEnd();
            res += ` ' ${remText}`.trimEnd();
          }
          break;
        } else {
          res += chunk.text;
        }
      }
      return res;
    }
    function basToJBas2(basText, options = {}) {
      const convertComments = options.convertComments !== false;
      const indentSpaces = typeof options.indent === "number" ? " ".repeat(options.indent) : "  ";
      const isCRLF = basText.includes("\r\n");
      const eol = isCRLF ? "\r\n" : "\n";
      const lines = parseBasLines(basText);
      if (lines.length === 0) return "";
      const jumpTargets = findJumpTargets(lines);
      const labelMap = generateLabels(lines, jumpTargets);
      const outputLines = [];
      let inLabelBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let code = line.code;
        code = updateJumpsToLabels(code, labelMap);
        if (convertComments) {
          code = convertRemToSingleQuote(code);
        }
        if (labelMap.has(line.lineNum)) {
          const labelName = labelMap.get(line.lineNum);
          if (outputLines.length > 0 && outputLines[outputLines.length - 1] !== "") {
            outputLines.push("");
          }
          outputLines.push(`@${labelName}:`);
          inLabelBlock = true;
          if (line.remTitle && line.code.match(/^\s*REM\s+(?:SUB\s+)?([A-Za-z0-9\s_\-]+)$/i)) {
            continue;
          }
          if (code.trim().length > 0) {
            outputLines.push(`${indentSpaces}${code.trim()}`);
          }
        } else {
          if (code.trim().length === 0) continue;
          if (inLabelBlock) {
            outputLines.push(`${indentSpaces}${code.trim()}`);
          } else {
            outputLines.push(code.trim());
          }
        }
      }
      return outputLines.join(eol) + eol;
    }
    module2.exports = {
      slugifyTitle,
      parseBasLines,
      findJumpTargets,
      generateLabels,
      updateJumpsToLabels,
      convertRemToSingleQuote,
      basToJBas: basToJBas2
    };
  }
});

// src/core/tapDecoder.js
var require_tapDecoder = __commonJS({
  "src/core/tapDecoder.js"(exports2, module2) {
    var { KEYWORDS } = require_tapGenerator();
    var { decodeSinclairFloat } = require_debugger();
    var { basToJBas: basToJBas2 } = require_bas2jbas();
    var TOKEN_TO_KEYWORD = {
      165: "RND",
      166: "INKEY$",
      167: "PI",
      168: "FN",
      169: "POINT",
      170: "SCREEN$",
      171: "ATTR",
      172: "AT",
      173: "TAB",
      174: "VAL$",
      175: "CODE",
      176: "VAL",
      177: "LEN",
      178: "SIN",
      179: "COS",
      180: "TAN",
      181: "ASN",
      182: "ACS",
      183: "ATN",
      184: "LN",
      185: "EXP",
      186: "INT",
      187: "SQR",
      188: "SGN",
      189: "ABS",
      190: "PEEK",
      191: "IN",
      192: "USR",
      193: "STR$",
      194: "CHR$",
      195: "NOT",
      196: "BIN",
      197: "OR",
      198: "AND",
      199: "<=",
      200: ">=",
      201: "<>",
      202: "LINE",
      203: "THEN",
      204: "TO",
      205: "STEP",
      206: "DEF FN",
      207: "CAT",
      208: "FORMAT",
      209: "MOVE",
      210: "ERASE",
      211: "OPEN #",
      212: "CLOSE #",
      213: "MERGE",
      214: "VERIFY",
      215: "BEEP",
      216: "CIRCLE",
      217: "INK",
      218: "PAPER",
      219: "FLASH",
      220: "BRIGHT",
      221: "INVERSE",
      222: "OVER",
      223: "OUT",
      224: "LPRINT",
      225: "LLIST",
      226: "STOP",
      227: "READ",
      228: "DATA",
      229: "RESTORE",
      230: "NEW",
      231: "BORDER",
      232: "CONTINUE",
      233: "DIM",
      234: "REM",
      235: "FOR",
      236: "GO TO",
      237: "GO SUB",
      238: "INPUT",
      239: "LOAD",
      240: "LIST",
      241: "LET",
      242: "PAUSE",
      243: "NEXT",
      244: "POKE",
      245: "PRINT",
      246: "PLOT",
      247: "RUN",
      248: "SAVE",
      249: "RANDOMIZE",
      250: "IF",
      251: "CLS",
      252: "DRAW",
      253: "CLEAR",
      254: "RETURN",
      255: "COPY"
    };
    var NO_ARG_STATEMENTS = /* @__PURE__ */ new Set(["CLS", "STOP", "RETURN", "COPY", "CONTINUE", "NEW"]);
    var NO_ARG_FUNCTIONS = /* @__PURE__ */ new Set(["RND", "PI", "INKEY$"]);
    function parseTapBlocks(tapData) {
      const bytes = tapData instanceof Uint8Array ? tapData : new Uint8Array(tapData);
      const blocks = [];
      let offset = 0;
      while (offset + 2 <= bytes.length) {
        const blockLen = bytes[offset] | bytes[offset + 1] << 8;
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
    function detokenizeLine(lineBytes) {
      const bytes = lineBytes instanceof Uint8Array ? lineBytes : new Uint8Array(lineBytes);
      const len = bytes.length;
      let res = "";
      let i = 0;
      let inString = false;
      let inRem = false;
      while (i < len) {
        const b = bytes[i];
        if (b === 13) {
          break;
        }
        if (b === 14 && i + 5 < len) {
          const hasPrecedingDigits = /(?:\d|\.\d+)$/.test(res);
          if (!hasPrecedingDigits) {
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
        if (b === 34) {
          if (!inRem) {
            if (!inString) {
              if (res.length > 0 && /[a-zA-Z0-9)]$/.test(res)) {
                res += " ";
              }
              inString = true;
              res += '"';
              i++;
              continue;
            } else {
              if (i + 1 < len && bytes[i + 1] === 34) {
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
        if (inString) {
          if (b === 16 && i + 1 < len) {
            res += `{INK ${bytes[i + 1]}}`;
            i += 2;
            continue;
          }
          if (b === 17 && i + 1 < len) {
            res += `{PAPER ${bytes[i + 1]}}`;
            i += 2;
            continue;
          }
          if (b === 18 && i + 1 < len) {
            res += `{FLASH ${bytes[i + 1]}}`;
            i += 2;
            continue;
          }
          if (b === 19 && i + 1 < len) {
            res += `{BRIGHT ${bytes[i + 1]}}`;
            i += 2;
            continue;
          }
          if (b === 20 && i + 1 < len) {
            res += `{INVERSE ${bytes[i + 1]}}`;
            i += 2;
            continue;
          }
          if (b === 21 && i + 1 < len) {
            res += `{OVER ${bytes[i + 1]}}`;
            i += 2;
            continue;
          }
          if (b === 22 && i + 2 < len) {
            res += `{AT ${bytes[i + 1]},${bytes[i + 2]}}`;
            i += 3;
            continue;
          }
          if (b === 23 && i + 2 < len) {
            const tabVal = bytes[i + 1] | bytes[i + 2] << 8;
            res += `{TAB ${tabVal}}`;
            i += 3;
            continue;
          }
          if (b >= 144 && b <= 164) {
            const udg = String.fromCharCode(65 + (b - 144));
            res += `{${udg}}`;
            i++;
            continue;
          }
          if (b === 127) {
            res += "{(c)}";
            i++;
            continue;
          }
          if (b === 96) {
            res += "\xA3";
            i++;
            continue;
          }
          if (b >= 32 && b <= 126) {
            res += String.fromCharCode(b);
            i++;
            continue;
          }
          res += `{CODE ${b}}`;
          i++;
          continue;
        }
        if (b === 234 && !inRem) {
          inRem = true;
          if (res.length > 0 && !res.endsWith(" ") && !res.endsWith(":")) {
            res += " ";
          }
          res += "REM";
          i++;
          if (i < len && bytes[i] === 32) {
            res += " ";
            i++;
          } else if (i < len && bytes[i] !== 13) {
            res += " ";
          }
          continue;
        }
        if (inRem) {
          if (b >= 32 && b <= 126) {
            res += String.fromCharCode(b);
          } else if (b >= 144 && b <= 164) {
            res += `{${String.fromCharCode(65 + (b - 144))}}`;
          } else if (b === 127) {
            res += "{(c)}";
          } else if (b >= 165 && b <= 255) {
            res += TOKEN_TO_KEYWORD[b] || `{CODE ${b}}`;
          } else {
            res += `{CODE ${b}}`;
          }
          i++;
          continue;
        }
        if (b >= 16 && b <= 21 && i + 1 < len) {
          const kw = b === 16 ? "INK" : b === 17 ? "PAPER" : b === 18 ? "FLASH" : b === 19 ? "BRIGHT" : b === 20 ? "INVERSE" : "OVER";
          const val = bytes[i + 1];
          if (res.length > 0 && !res.endsWith(": ") && !res.endsWith(" ")) {
            res += ": ";
          }
          res += `${kw} ${val}`;
          i += 2;
          const nextByte = i < len ? bytes[i] : 13;
          if (nextByte !== 13 && nextByte !== 58) {
            res += ": ";
          }
          continue;
        }
        if (b === 22 && i + 2 < len) {
          const row = bytes[i + 1];
          const col = bytes[i + 2];
          if (res.length > 0 && !res.endsWith(": ") && !res.endsWith(" ")) {
            res += ": ";
          }
          res += `PRINT AT ${row},${col};`;
          i += 3;
          const nextByte = i < len ? bytes[i] : 13;
          if (nextByte !== 13 && nextByte !== 58) {
            res += " ";
          }
          continue;
        }
        if (b === 23 && i + 2 < len) {
          const tabVal = bytes[i + 1] | bytes[i + 2] << 8;
          if (res.length > 0 && !res.endsWith(": ") && !res.endsWith(" ")) {
            res += ": ";
          }
          res += `PRINT TAB ${tabVal};`;
          i += 3;
          const nextByte = i < len ? bytes[i] : 13;
          if (nextByte !== 13 && nextByte !== 58) {
            res += " ";
          }
          continue;
        }
        if (b === 58) {
          res = res.trimEnd() + ": ";
          i++;
          while (i < len && bytes[i] === 32) {
            i++;
          }
          continue;
        }
        if (b >= 165 && b <= 255) {
          const kw = TOKEN_TO_KEYWORD[b];
          if (kw) {
            if (res.length > 0 && !res.endsWith(" ") && !res.endsWith(":") && !res.endsWith("(")) {
              res += " ";
            }
            res += kw;
            const nextByte = i + 1 < len ? bytes[i + 1] : 13;
            if (kw === "AND" || kw === "OR") {
              res += " ";
            } else if (kw === "<=" || kw === ">=" || kw === "<>") {
            } else if (NO_ARG_STATEMENTS.has(kw) || NO_ARG_FUNCTIONS.has(kw)) {
            } else if (kw === "DEF FN") {
              res += " ";
            } else {
              if (nextByte !== 13 && nextByte !== 58 && nextByte !== 32) {
                if (nextByte === 40) {
                } else {
                  res += " ";
                }
              }
            }
            i++;
            while (i < len && bytes[i] === 32) {
              i++;
            }
            continue;
          }
        }
        if (b === 32) {
          if (!res.endsWith(" ")) {
            res += " ";
          }
          i++;
          continue;
        }
        if (b === 127) {
          res += "{(c)}";
          i++;
          continue;
        }
        if (b === 96) {
          res += "\xA3";
          i++;
          continue;
        }
        if (b >= 32 && b <= 126) {
          res += String.fromCharCode(b);
          i++;
          continue;
        }
        if (b >= 144 && b <= 164) {
          res += `{${String.fromCharCode(65 + (b - 144))}}`;
          i++;
          continue;
        }
        res += `{CODE ${b}}`;
        i++;
      }
      return res.trimEnd();
    }
    function decodeBasicProgram(payload, varOffset = 0) {
      const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
      const maxLen = varOffset > 0 && varOffset <= bytes.length ? varOffset : bytes.length;
      const lines = [];
      let offset = 0;
      while (offset + 4 <= maxLen) {
        const lineNum = bytes[offset] << 8 | bytes[offset + 1];
        const lineLen = bytes[offset + 2] | bytes[offset + 3] << 8;
        offset += 4;
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
      const basText = lines.map((l) => l.fullLine).join("\n") + (lines.length > 0 ? "\n" : "");
      return { lines, basText };
    }
    function extractProgramsFromTap2(tapBuffer) {
      const blocks = parseTapBlocks(tapBuffer);
      const programs = [];
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.flag === 0 && b.payload.length >= 17 && b.payload[0] === 0) {
          let name = "";
          for (let c = 1; c <= 10; c++) {
            name += String.fromCharCode(b.payload[c]);
          }
          name = name.trim() || "program";
          const autostart = b.payload[13] | b.payload[14] << 8;
          const varOffset = b.payload[15] | b.payload[16] << 8;
          let dataBlock = null;
          if (i + 1 < blocks.length && blocks[i + 1].flag === 255) {
            dataBlock = blocks[i + 1];
            i++;
          }
          if (dataBlock) {
            const decoded = decodeBasicProgram(dataBlock.payload, varOffset);
            if (decoded.lines.length > 0) {
              const jbasText = basToJBas2(decoded.basText);
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
      if (programs.length === 0) {
        for (const b of blocks) {
          if (b.flag === 255 && b.payload.length > 4) {
            const decoded = decodeBasicProgram(b.payload);
            if (decoded.lines.length > 0) {
              const jbasText = basToJBas2(decoded.basText);
              programs.push({
                name: "program",
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
    function tapToBas2(tapBuffer) {
      const programs = extractProgramsFromTap2(tapBuffer);
      return programs.length > 0 ? programs[0] : null;
    }
    module2.exports = {
      TOKEN_TO_KEYWORD,
      parseTapBlocks,
      detokenizeLine,
      decodeBasicProgram,
      extractProgramsFromTap: extractProgramsFromTap2,
      tapToBas: tapToBas2,
      tapToJBas: (tapBuffer) => {
        const res = tapToBas2(tapBuffer);
        return res ? res.jbasText : null;
      }
    };
  }
});

// src/core/retroMode.js
var require_retroMode = __commonJS({
  "src/core/retroMode.js"(exports2, module2) {
    var path = require("path");
    var fs = require("fs");
    var spawn = null;
    var execFileSync = null;
    try {
      const cp = require("child_process");
      spawn = cp.spawn;
      execFileSync = cp.execFileSync;
    } catch {
    }
    var { formatLineKeywords } = require_formatter();
    function ensureFontInstalled(extensionPath) {
      if (process.platform !== "win32" || !execFileSync || !extensionPath) return;
      try {
        const fontSrc = path.join(extensionPath, "media", "fonts", "ZXSpectrum.ttf");
        const localAppData = process.env.LOCALAPPDATA;
        if (!localAppData || !fs.existsSync(fontSrc)) return;
        const fontDir = path.join(localAppData, "Microsoft", "Windows", "Fonts");
        const fontDest = path.join(fontDir, "ZXSpectrum.ttf");
        if (!fs.existsSync(fontDir)) {
          fs.mkdirSync(fontDir, { recursive: true });
        }
        if (!fs.existsSync(fontDest)) {
          fs.copyFileSync(fontSrc, fontDest);
        }
        execFileSync("reg.exe", [
          "add",
          "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
          "/v",
          "ZX Spectrum Unicode (TrueType)",
          "/t",
          "REG_SZ",
          "/d",
          fontDest,
          "/f"
        ], { stdio: "ignore" });
      } catch {
      }
    }
    function detectCursorMode(lineText, columnIndex, isJBas = false) {
      if (!lineText || columnIndex <= 0) {
        return "K";
      }
      const prefix = lineText.slice(0, columnIndex);
      let insideString = false;
      let lastStatementStart = 0;
      for (let i = 0; i < prefix.length; i++) {
        const ch = prefix[i];
        if (ch === '"') {
          insideString = !insideString;
        } else if (!insideString && ch === ":") {
          lastStatementStart = i + 1;
        }
      }
      if (insideString) {
        return "L";
      }
      const stmt = prefix.slice(lastStatementStart);
      let stmtContent = stmt;
      if (lastStatementStart === 0) {
        stmtContent = stmtContent.replace(/^\s*\d+\s*/, "");
        if (isJBas) {
          stmtContent = stmtContent.replace(/^\s*@[a-zA-Z0-9_]+:\s*/, "");
        }
      }
      stmtContent = stmtContent.trimStart();
      return stmtContent.length === 0 ? "K" : "L";
    }
    var BASIC_STATEMENTS = /* @__PURE__ */ new Set([
      "PRINT",
      "LET",
      "IF",
      "FOR",
      "NEXT",
      "GO TO",
      "GOTO",
      "GO SUB",
      "GOSUB",
      "RETURN",
      "PAUSE",
      "BORDER",
      "PAPER",
      "INK",
      "FLASH",
      "BRIGHT",
      "INVERSE",
      "OVER",
      "CLS",
      "PLOT",
      "DRAW",
      "CIRCLE",
      "BEEP",
      "READ",
      "DATA",
      "RESTORE",
      "DIM",
      "REM",
      "RANDOMIZE",
      "CLEAR",
      "CONTINUE",
      "STOP",
      "NEW",
      "LOAD",
      "SAVE",
      "VERIFY",
      "MERGE",
      "INPUT",
      "POKE",
      "OUT",
      "OPEN #",
      "CLOSE #",
      "CAT",
      "FORMAT",
      "MOVE",
      "ERASE",
      "LLIST",
      "LPRINT",
      "COPY",
      "DEF FN",
      "RUN",
      "LINE"
    ]);
    function validateBasicLine(lineText, isJBas = false) {
      if (!lineText || lineText.trim().length === 0) {
        return { valid: true };
      }
      const trimmed = lineText.trim();
      let content = trimmed;
      if (!isJBas) {
        const lineNumMatch = content.match(/^(\d+)\s*(.*)$/);
        if (!lineNumMatch) {
          return { valid: false, reason: "Missing line number" };
        }
        const lineNum = parseInt(lineNumMatch[1], 10);
        if (lineNum < 1 || lineNum > 9999) {
          return { valid: false, reason: "Line number out of range (1-9999)" };
        }
        content = lineNumMatch[2].trim();
        if (content.length === 0) {
          return { valid: true };
        }
      } else {
        const labelMatch = content.match(/^@([a-zA-Z0-9_]+):\s*(.*)$/);
        if (labelMatch) {
          content = labelMatch[2].trim();
          if (content.length === 0) {
            return { valid: true };
          }
        }
      }
      const upperTrimmed = content.toUpperCase();
      if (upperTrimmed.startsWith("REM") || isJBas && content.startsWith("'")) {
        return { valid: true };
      }
      let insideString = false;
      let parenDepth = 0;
      const statements = [];
      let currentStmt = "";
      for (let i = 0; i < content.length; i++) {
        const ch = content[i];
        if (ch === '"') {
          insideString = !insideString;
          currentStmt += ch;
          continue;
        }
        if (insideString) {
          currentStmt += ch;
          continue;
        }
        if (isJBas && ch === "'") {
          break;
        }
        const remaining = content.slice(i);
        if (/^REM(\s|$)/i.test(remaining)) {
          currentStmt += remaining;
          break;
        }
        if (ch === "(") {
          parenDepth++;
        } else if (ch === ")") {
          parenDepth--;
          if (parenDepth < 0) {
            return { valid: false, reason: "Unmatched closing parenthesis" };
          }
        }
        if (ch === ":") {
          statements.push(currentStmt);
          currentStmt = "";
        } else {
          currentStmt += ch;
        }
      }
      if (insideString) {
        return { valid: false, reason: "Unclosed string literal" };
      }
      if (parenDepth !== 0) {
        return { valid: false, reason: "Unbalanced parentheses" };
      }
      statements.push(currentStmt);
      for (let s = 0; s < statements.length; s++) {
        const stmt = statements[s].trim();
        if (stmt.length === 0) {
          return { valid: false, reason: "Empty statement" };
        }
        const stmtUpper = stmt.toUpperCase();
        if (stmtUpper.startsWith("REM") || isJBas && stmt.startsWith("'")) {
          break;
        }
        let sContent = stmt;
        if (isJBas) {
          sContent = sContent.replace(/^@[a-zA-Z0-9_]+:\s*/, "").trim();
          if (sContent.length === 0) continue;
        }
        const sUpper = sContent.toUpperCase();
        if (/^FOR\b/i.test(sUpper) && !/\bTO\b/i.test(sUpper)) {
          return { valid: false, reason: "FOR statement missing TO" };
        }
        if (/^IF\b/i.test(sUpper) && !/\bTHEN\b/i.test(sUpper)) {
          return { valid: false, reason: "IF statement missing THEN" };
        }
        if (/^(GO\s*TO|GO\s*SUB|RESTORE|RUN|LINE)\s*$/i.test(sUpper)) {
          return { valid: false, reason: "Missing jump target" };
        }
        const firstWordMatch = sUpper.match(/^([A-Z$#]+(?:\s+[A-Z$#]+)?)/);
        if (!firstWordMatch) {
          if (!/^[a-zA-Z_][a-zA-Z0-9_$]*\s*=/i.test(sContent)) {
            return { valid: false, reason: "Invalid statement syntax" };
          }
        } else {
          const w1 = firstWordMatch[1];
          const singleWord = w1.split(/\s+/)[0];
          const isKnown = BASIC_STATEMENTS.has(w1) || BASIC_STATEMENTS.has(singleWord) || /^[a-zA-Z_][a-zA-Z0-9_$]*\s*=/i.test(sContent);
          if (!isKnown) {
            return { valid: false, reason: `Unrecognized keyword: ${singleWord}` };
          }
        }
      }
      return { valid: true };
    }
    var SpectrumBeeper = class {
      constructor(soundDir = null) {
        if (!soundDir) {
          try {
            const candidate = path.join(__dirname, "..", "..", "media", "sound");
            if (fs.existsSync(candidate)) {
              soundDir = candidate;
            }
          } catch {
          }
        }
        this.soundDir = soundDir;
        this.clickSound = soundDir ? path.join(soundDir, "zx_click.wav") : null;
        this.errorSound = soundDir ? path.join(soundDir, "zx_error.wav") : null;
        this.cursorSound = soundDir ? path.join(soundDir, "zx_cursor.wav") : null;
        this.process = null;
        this.platform = process.platform;
        this.isDisposed = false;
        this.isSpawning = false;
      }
      _initProcess() {
        if (this.isDisposed || this.process || this.isSpawning || !spawn) return;
        try {
          if (this.platform === "win32") {
            this.isSpawning = true;
            this.process = spawn("powershell", ["-NoProfile", "-Command", "-"], {
              stdio: ["pipe", "ignore", "ignore"],
              windowsHide: true
            });
            this.process.on("error", () => {
              this.process = null;
              this.isSpawning = false;
            });
            this.process.on("exit", () => {
              this.process = null;
              this.isSpawning = false;
            });
            if (this.process.stdin) {
              this.process.stdin.on("error", () => {
              });
            }
            if (this.clickSound && fs.existsSync(this.clickSound)) {
              const esc = this.clickSound.replace(/'/g, "''");
              this._write(`$click = New-Object System.Media.SoundPlayer('${esc}'); $click.Load()
`);
            }
            if (this.errorSound && fs.existsSync(this.errorSound)) {
              const esc = this.errorSound.replace(/'/g, "''");
              this._write(`$err = New-Object System.Media.SoundPlayer('${esc}'); $err.Load()
`);
            }
            if (this.cursorSound && fs.existsSync(this.cursorSound)) {
              const esc = this.cursorSound.replace(/'/g, "''");
              this._write(`$cursor = New-Object System.Media.SoundPlayer('${esc}'); $cursor.Load()
`);
            }
            this.isSpawning = false;
          }
        } catch {
          this.process = null;
          this.isSpawning = false;
        }
      }
      _write(cmd) {
        if (this.isDisposed || !this.process) return;
        try {
          if (this.process.stdin && this.process.stdin.writable) {
            this.process.stdin.write(cmd);
          }
        } catch {
        }
      }
      click() {
        if (this.isDisposed) return;
        try {
          if (this.platform === "win32") {
            if (!this.process) this._initProcess();
            if (this.clickSound && fs.existsSync(this.clickSound)) {
              this._write("$click.Play()\n");
            } else {
              this._write("[console]::beep(987, 25)\n");
            }
          } else if (this.platform === "darwin") {
            if (this.clickSound && fs.existsSync(this.clickSound)) {
              if (spawn) spawn("afplay", [this.clickSound], { stdio: "ignore" });
            } else if (spawn) {
              spawn("osascript", ["-e", "beep 1"], { stdio: "ignore" });
            }
          } else {
            if (this.clickSound && fs.existsSync(this.clickSound)) {
              if (spawn) spawn("paplay", [this.clickSound], { stdio: "ignore" });
            } else if (process.stdout && process.stdout.isTTY) {
              process.stdout.write("\x07");
            }
          }
        } catch {
        }
      }
      // Alias for backward compatibility
      beep() {
        this.click();
      }
      error() {
        if (this.isDisposed) return;
        try {
          if (this.platform === "win32") {
            if (!this.process) this._initProcess();
            if (this.errorSound && fs.existsSync(this.errorSound)) {
              this._write("$err.Play()\n");
            } else {
              this._write("[console]::beep(64, 160)\n");
            }
          } else if (this.platform === "darwin") {
            if (this.errorSound && fs.existsSync(this.errorSound)) {
              if (spawn) spawn("afplay", [this.errorSound], { stdio: "ignore" });
            } else if (spawn) {
              spawn("osascript", ["-e", "beep 1"], { stdio: "ignore" });
            }
          } else {
            if (this.errorSound && fs.existsSync(this.errorSound)) {
              if (spawn) spawn("paplay", [this.errorSound], { stdio: "ignore" });
            } else if (process.stdout && process.stdout.isTTY) {
              process.stdout.write("\x07");
            }
          }
        } catch {
        }
      }
      cursor() {
        if (this.isDisposed) return;
        try {
          if (this.platform === "win32") {
            if (!this.process) this._initProcess();
            if (this.cursorSound && fs.existsSync(this.cursorSound)) {
              this._write("$cursor.Play()\n");
            } else {
              this._write("[console]::beep(1200, 10)\n");
            }
          } else if (this.platform === "darwin") {
            if (this.cursorSound && fs.existsSync(this.cursorSound)) {
              if (spawn) spawn("afplay", [this.cursorSound], { stdio: "ignore" });
            }
          } else {
            if (this.cursorSound && fs.existsSync(this.cursorSound)) {
              if (spawn) spawn("paplay", [this.cursorSound], { stdio: "ignore" });
            }
          }
        } catch {
        }
      }
      dispose() {
        this.isDisposed = true;
        if (this.process) {
          try {
            if (this.process.stdin) {
              this.process.stdin.removeAllListeners("error");
              this.process.stdin.on("error", () => {
              });
              this.process.stdin.end();
            }
            this.process.kill();
          } catch {
          }
          this.process = null;
        }
      }
    };
    var RETRO_COLOR_KEYS = [
      "editor.background",
      "editor.foreground",
      "editorLineNumber.foreground",
      "editorLineNumber.activeForeground",
      "editorCursor.foreground",
      "editor.selectionBackground",
      "editor.selectionHighlightBackground",
      "editor.selectionHighlightBorder",
      "editor.wordHighlightBackground",
      "editor.wordHighlightStrongBackground",
      "editor.findMatchHighlightBackground",
      "editor.findMatchBackground",
      "editor.lineHighlightBackground"
    ];
    var RETRO_COLORS = {
      "editor.background": "#FFFFFF",
      "editor.foreground": "#000000",
      "editorLineNumber.foreground": "#888888",
      "editorLineNumber.activeForeground": "#000000",
      "editorCursor.foreground": "#000000",
      // Soft, clear Sinclair cyan selection - 100% readable text without dark grey wash
      "editor.selectionBackground": "#00D7D744",
      "editor.selectionHighlightBackground": "#00D7D718",
      "editor.selectionHighlightBorder": "#00D7D766",
      "editor.wordHighlightBackground": "#00D7D718",
      "editor.wordHighlightStrongBackground": "#00D7D730",
      "editor.findMatchHighlightBackground": "#FFE06688",
      "editor.findMatchBackground": "#FFCC00AA",
      "editor.lineHighlightBackground": "#F8F8F8"
    };
    var RETRO_FONT_FAMILY = "'ZX Spectrum Unicode', 'ZXSpectrum', 'Courier New', monospace";
    var RetroModeController2 = class {
      constructor(vscode2, context = null) {
        this.vscode = vscode2;
        this.context = context;
        const soundDir = context && context.extensionPath ? path.join(context.extensionPath, "media", "sound") : null;
        this.beeper = new SpectrumBeeper(soundDir);
        this.statusBarItem = null;
        this.isAutoFormatting = false;
        this.isTyping = false;
        this.typingTimeout = null;
        this.lastCursorLine = -1;
        this.lastCursorCol = -1;
        this.lastSelectionChangeTime = 0;
        this.disposables = [];
      }
      async init() {
        try {
          const workbenchConfig = this.vscode.workspace.getConfiguration("workbench");
          const currentTheme = workbenchConfig.get("colorTheme");
          if (currentTheme && currentTheme.includes("Sinclair ZX Spectrum")) {
            await workbenchConfig.update("colorTheme", void 0, this.vscode.ConfigurationTarget.Global);
          }
        } catch {
        }
        if (this.context && this.context.extensionPath) {
          ensureFontInstalled(this.context.extensionPath);
        }
        this.statusBarItem = this.vscode.window.createStatusBarItem(this.vscode.StatusBarAlignment.Right, 95);
        this.statusBarItem.command = "sinclairBasic.toggleRetroMode";
        this.disposables.push(this.statusBarItem);
        this.disposables.push(
          this.vscode.commands.registerCommand("sinclairBasic.toggleRetroMode", () => this.toggleRetroMode())
        );
        this.disposables.push(
          this.vscode.workspace.onDidChangeTextDocument((e) => this.handleTextDocumentChange(e))
        );
        this.disposables.push(
          this.vscode.window.onDidChangeTextEditorSelection((e) => this.handleSelectionChange(e))
        );
        this.disposables.push(
          this.vscode.window.onDidChangeActiveTextEditor(() => this.updateUi())
        );
        this.disposables.push(
          this.vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("sinclairBasic.retroMode")) {
              this.updateUi();
            }
          })
        );
        const isEnabled = this.isRetroEnabled();
        await this.applyRetroStyles(isEnabled);
        this.updateUi();
      }
      isRetroEnabled() {
        return this.vscode.workspace.getConfiguration("sinclairBasic").get("retroMode.enabled", false);
      }
      isBasicEditor(editor) {
        if (!editor || !editor.document) return false;
        const lang = editor.document.languageId;
        return lang === "sinclair-basic" || lang === "jbas";
      }
      async toggleRetroMode() {
        const config = this.vscode.workspace.getConfiguration("sinclairBasic");
        const current = config.get("retroMode.enabled", false);
        const next = !current;
        await config.update("retroMode.enabled", next, this.vscode.ConfigurationTarget.Global);
        await this.applyRetroStyles(next);
        if (next) {
          this.beeper.beep();
          this.vscode.window.showInformationMessage("\u{1F579}\uFE0F Modo Retro Sinclair BASIC: ACTIVADO (Pantalla blanca y fuente 8x8)");
        } else {
          this.vscode.window.showInformationMessage("Modo Retro Sinclair BASIC: Desactivado (Editor normal)");
        }
        this.updateUi();
      }
      async applyRetroStyles(enabled) {
        try {
          const workbenchConfig = this.vscode.workspace.getConfiguration("workbench");
          const colors = { ...workbenchConfig.get("colorCustomizations", {}) };
          if (enabled) {
            Object.assign(colors, RETRO_COLORS);
            await workbenchConfig.update("colorCustomizations", colors, this.vscode.ConfigurationTarget.Global);
            try {
              await this.vscode.commands.executeCommand("workbench.action.closeSidebar");
            } catch {
            }
            try {
              await this.vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
            } catch {
            }
            try {
              await this.vscode.commands.executeCommand("workbench.action.closePanel");
            } catch {
            }
            for (const langId of ["sinclair-basic", "jbas"]) {
              const langConfig = this.vscode.workspace.getConfiguration("", { languageId: langId });
              await langConfig.update("editor.fontFamily", RETRO_FONT_FAMILY, this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.fontSize", 19, this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.fontWeight", "bold", this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.lineHeight", 24, this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.lineNumbers", "off", this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.minimap.enabled", false, this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.glyphMargin", false, this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.folding", false, this.vscode.ConfigurationTarget.Global, true);
            }
          } else {
            for (const k of RETRO_COLOR_KEYS) {
              delete colors[k];
            }
            const newColors = Object.keys(colors).length > 0 ? colors : void 0;
            await workbenchConfig.update("colorCustomizations", newColors, this.vscode.ConfigurationTarget.Global);
            for (const langId of ["sinclair-basic", "jbas"]) {
              const langConfig = this.vscode.workspace.getConfiguration("", { languageId: langId });
              await langConfig.update("editor.fontFamily", void 0, this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.fontSize", void 0, this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.fontWeight", void 0, this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.lineHeight", void 0, this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.lineNumbers", void 0, this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.minimap.enabled", void 0, this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.glyphMargin", void 0, this.vscode.ConfigurationTarget.Global, true);
              await langConfig.update("editor.folding", void 0, this.vscode.ConfigurationTarget.Global, true);
            }
            try {
              await this.vscode.commands.executeCommand("workbench.view.explorer");
            } catch {
            }
            const currentTheme = workbenchConfig.get("colorTheme");
            if (currentTheme && currentTheme.includes("Sinclair ZX Spectrum")) {
              await workbenchConfig.update("colorTheme", void 0, this.vscode.ConfigurationTarget.Global);
            }
          }
        } catch (err) {
          console.error("Error applying retro styles:", err);
        }
      }
      updateUi() {
        const editor = this.vscode.window.activeTextEditor;
        if (this.isBasicEditor(editor)) {
          const enabled = this.isRetroEnabled();
          this.statusBarItem.text = enabled ? "$(sparkle) ZX Retro: ON" : "$(sparkle) ZX Retro: OFF";
          this.statusBarItem.tooltip = enabled ? "Modo Retro ZX Spectrum activo. Clic para desactivar." : "Clic para activar el Modo Retro ZX Spectrum.";
          this.statusBarItem.show();
        } else {
          this.statusBarItem.hide();
        }
      }
      handleSelectionChange(e) {
        if (this.isAutoFormatting || this.isTyping || !this.isRetroEnabled()) return;
        const editor = this.vscode.window.activeTextEditor;
        if (!this.isBasicEditor(editor) || e.textEditor !== editor) return;
        const config = this.vscode.workspace.getConfiguration("sinclairBasic");
        const beepOnCursor = config.get("retroMode.beepOnCursor", true);
        if (!beepOnCursor) return;
        if (!editor.selection) return;
        const pos = editor.selection.active;
        if (pos.line === this.lastCursorLine && pos.character === this.lastCursorCol) {
          return;
        }
        this.lastCursorLine = pos.line;
        this.lastCursorCol = pos.character;
        const now = Date.now();
        if (now - this.lastSelectionChangeTime < 55) {
          return;
        }
        this.lastSelectionChangeTime = now;
        this.beeper.cursor();
      }
      async handleTextDocumentChange(e) {
        if (this.isAutoFormatting || !this.isRetroEnabled()) return;
        const lang = e.document.languageId;
        if (lang !== "sinclair-basic" && lang !== "jbas") return;
        if (!e.contentChanges || e.contentChanges.length === 0) return;
        const change = e.contentChanges[0];
        this.isTyping = true;
        if (this.typingTimeout) clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
          this.isTyping = false;
        }, 60);
        const isEnter = (change.text === "\n" || change.text === "\r\n") && change.rangeLength === 0;
        if (!isEnter) return;
        const config = this.vscode.workspace.getConfiguration("sinclairBasic");
        const beepOnEnter = config.get("retroMode.beepOnEnter", true);
        const beepOnError = config.get("retroMode.beepOnError", true);
        const formatOnEnter = config.get("retroMode.formatOnEnter", true);
        const lineIndex = change.range.start.line;
        if (lineIndex >= 0 && lineIndex < e.document.lineCount) {
          const line = e.document.lineAt(lineIndex);
          const originalText = line.text;
          const validation = validateBasicLine(originalText, lang === "jbas");
          if (!validation.valid) {
            if (beepOnError) {
              this.beeper.error();
            }
            return;
          }
          if (beepOnEnter) {
            this.beeper.click();
          }
          if (formatOnEnter) {
            const formattedText = formatLineKeywords(originalText, lang === "jbas");
            if (formattedText !== originalText) {
              this.isAutoFormatting = true;
              try {
                const edit = new this.vscode.WorkspaceEdit();
                edit.replace(e.document.uri, line.range, formattedText);
                await this.vscode.workspace.applyEdit(edit);
              } finally {
                this.isAutoFormatting = false;
              }
            }
          }
        }
      }
      dispose() {
        if (this.typingTimeout) {
          clearTimeout(this.typingTimeout);
        }
        if (this.beeper) {
          this.beeper.dispose();
        }
        this.disposables.forEach((d) => {
          try {
            d.dispose();
          } catch {
          }
        });
        this.disposables = [];
      }
    };
    module2.exports = {
      detectCursorMode,
      validateBasicLine,
      SpectrumBeeper,
      formatLineKeywords,
      RetroModeController: RetroModeController2,
      ensureFontInstalled
    };
  }
});

// src/webExtension.js
var vscode = require("vscode");
var { renumberProgram } = require_renumber();
var { compileJBas, transpileJBasAllVersions } = require_jbas2bas();
var { bas2tap, tap2buffer } = require_tapGenerator();
var { formatKeywordsToUpper } = require_formatter();
var { createSinclairCompletionProvider } = require_completions();
var { translateWildcardsToChr } = require_wildcards();
var { getBasFoldingRanges } = require_folding();
var { findBasJumpTargetAtPosition, findBasLineIndex } = require_definitions();
var { uploadTapToHost, buildTurbo80ShareUrl } = require_share();
var {
  findDocumentLine,
  findStatementRange,
  getStatementRanges,
  findStatementIndexAtColumn,
  SinclairBasicDebugAdapterCore,
  mapSourceLineToBasic,
  mapBasicToSourceLine
} = require_debugger();
var { getTurbo80Html } = require_turbo80Html();
var { extractProgramsFromTap, tapToBas, tapToJBas } = require_tapDecoder();
var { basToJBas } = require_bas2jbas();
var { RetroModeController } = require_retroMode();
var retroModeController = null;
function getBaseName(uri, extToRemove = "") {
  const segments = uri.path.split("/");
  const last = segments[segments.length - 1] || "program";
  if (extToRemove && last.endsWith(extToRemove)) {
    return last.slice(0, -extToRemove.length);
  }
  return last;
}
function getDistUri(docUri, outDirName = "dist") {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(docUri);
  const rootUri = workspaceFolder ? workspaceFolder.uri : vscode.Uri.joinPath(docUri, "..");
  return vscode.Uri.joinPath(rootUri, outDirName);
}
function uint8ArrayToBase64(bytes) {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa !== "undefined" ? btoa(binary) : Buffer.from(bytes).toString("base64");
}
async function getTargetDocument(uri) {
  if (uri) {
    try {
      return await vscode.workspace.openTextDocument(uri);
    } catch {
    }
  }
  if (vscode.window.activeTextEditor) {
    return vscode.window.activeTextEditor.document;
  }
  return null;
}
async function buildTapFromDocument(doc) {
  const config = vscode.workspace.getConfiguration("sinclairBasic");
  const configuredAutoStart = config.get("autoStartLine", 0);
  const outDirName = config.get("outputDirectory", "dist");
  const distUri = getDistUri(doc.uri, outDirName);
  await vscode.workspace.fs.createDirectory(distUri);
  let basicCode = doc.getText();
  let baseName = "";
  let sourceMap = null;
  if (doc.fileName.endsWith(".jbas")) {
    baseName = getBaseName(doc.uri, ".jbas");
    const all = transpileJBasAllVersions(basicCode);
    sourceMap = all.compact;
    if (!all.success) {
      throw new Error("Compilation failed:\n" + all.errors.join("\n"));
    }
    const compactUri = vscode.Uri.joinPath(distUri, `${baseName}.bas`);
    const step10Uri = vscode.Uri.joinPath(distUri, `${baseName}-step10.bas`);
    const commentsUri = vscode.Uri.joinPath(distUri, `${baseName}-comments.bas`);
    const sinclairUri = vscode.Uri.joinPath(distUri, `${baseName}.sinclair.bas`);
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(compactUri, encoder.encode(all.compact.text));
    await vscode.workspace.fs.writeFile(step10Uri, encoder.encode(all.step10.text));
    await vscode.workspace.fs.writeFile(commentsUri, encoder.encode(all.comments.text));
    await vscode.workspace.fs.writeFile(sinclairUri, encoder.encode(all.sinclair.text));
    basicCode = all.compact.text;
  } else {
    baseName = getBaseName(doc.uri, ".bas");
    if (!baseName.endsWith(".sinclair")) {
      const sinclairUri = vscode.Uri.joinPath(distUri, `${baseName}.sinclair.bas`);
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(sinclairUri, encoder.encode(translateWildcardsToChr(basicCode)));
    }
  }
  let autoStartLine = configuredAutoStart;
  if (autoStartLine <= 0) {
    const match = basicCode.match(/^\s*(\d+)/m);
    autoStartLine = match ? parseInt(match[1], 10) : 10;
  }
  const blocks = bas2tap(basicCode, baseName, autoStartLine);
  const tapBytes = tap2buffer(blocks);
  const targetTapUri = vscode.Uri.joinPath(distUri, `${baseName}.tap`);
  await vscode.workspace.fs.writeFile(targetTapUri, tapBytes);
  return {
    tapUri: targetTapUri,
    autoStartLine,
    tapBytes,
    filename: `${baseName}.tap`,
    sourceMap
  };
}
function activate(context) {
  let currentTurbo80Panel = null;
  let activeDebugDoc = null;
  let activeDebugLine = null;
  let activeDebugStmt = null;
  let activeDebugVars = [];
  let isDebuggingActive = false;
  let activeDebugAdapter = null;
  let activeDebugSourceMap = null;
  class SinclairBasicDebugAdapter {
    constructor(session) {
      this._sendMessage = new vscode.EventEmitter();
      this.onDidSendMessage = this._sendMessage.event;
      this.session = session;
      this.core = new SinclairBasicDebugAdapterCore({
        sendEvent: (event, body) => {
          this._sendMessage.fire({
            type: "event",
            event,
            body
          });
        },
        sendResponse: (response) => {
          this._sendMessage.fire(response);
        },
        onAction: (action, data) => {
          if (action === "continue") {
            handleDebugContinue();
          } else if (action === "pause") {
            handleDebugPause();
          } else if (action === "stepLine") {
            handleDebugStepLine();
          } else if (action === "stepStmt") {
            handleDebugStepStmt();
          } else if (action === "restart") {
            handleDebugRestart();
          } else if (action === "stop") {
            handleDebugStop();
          } else if (action === "setBreakpoints") {
            if (currentTurbo80Panel) {
              currentTurbo80Panel.webview.postMessage({
                command: "setBreakpoints",
                breakpoints: data.breakpoints || data.lines
              });
            }
          }
        }
      });
      if (activeDebugSourceMap) {
        this.core.setSourceMap(activeDebugSourceMap);
      }
      if (activeDebugDoc) {
        this.core.setDocument(activeDebugDoc.fileName, activeDebugDoc.getText());
      }
    }
    handleMessage(message) {
      if (activeDebugSourceMap && !this.core.sourceMap) {
        this.core.setSourceMap(activeDebugSourceMap);
      }
      if (activeDebugDoc && !this.core.currentDocText) {
        this.core.setDocument(activeDebugDoc.fileName, activeDebugDoc.getText());
      }
      this.core.handleMessage(message);
    }
    dispose() {
      this._sendMessage.dispose();
      if (activeDebugAdapter === this) {
        activeDebugAdapter = null;
      }
    }
  }
  const debugLineDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(255, 215, 0, 0.22)",
    overviewRulerColor: "rgba(255, 215, 0, 0.85)",
    overviewRulerLane: vscode.OverviewRulerLane.Full
  });
  const debugStmtDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(255, 204, 0, 0.45)",
    borderRadius: "3px",
    border: "1px solid rgba(255, 204, 0, 0.9)"
  });
  const debugStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  function getBreakpointsForDocument(document) {
    if (!document) return [];
    const uriStr = document.uri.toString();
    const bps = vscode.debug.breakpoints.filter(
      (b) => b instanceof vscode.SourceBreakpoint && b.location.uri.toString() === uriStr && b.enabled !== false
    );
    const targetBreakpoints = [];
    const isJBas = document.fileName.endsWith(".jbas") || document.languageId === "jbas";
    for (const bp of bps) {
      const lineIndex = bp.location.range.start.line;
      if (lineIndex < document.lineCount) {
        const lineText = document.lineAt(lineIndex).text;
        const col1 = (bp.location.range.start.character || 0) + 1;
        const stmtIndex = findStatementIndexAtColumn(lineText, col1);
        let basicLine = null;
        if (isJBas && activeDebugSourceMap && activeDebugSourceMap.sourceToBasic) {
          basicLine = mapSourceLineToBasic(lineIndex + 1, activeDebugSourceMap.sourceToBasic);
        } else {
          const m = lineText.match(/^\s*(\d+)/);
          if (m) {
            basicLine = parseInt(m[1], 10);
          } else {
            basicLine = lineIndex + 1;
          }
        }
        if (basicLine !== null && basicLine !== void 0) {
          targetBreakpoints.push({ line: basicLine, stmt: stmtIndex });
        }
      }
    }
    return targetBreakpoints;
  }
  function clearDebugDecorations() {
    vscode.window.visibleTextEditors.forEach((editor) => {
      editor.setDecorations(debugLineDecoration, []);
      editor.setDecorations(debugStmtDecoration, []);
    });
  }
  function highlightDebugPosition(doc, basicLine, stmt) {
    clearDebugDecorations();
    if (!doc) return;
    let docLine = -1;
    const isJBas = doc.fileName.endsWith(".jbas") || doc.languageId === "jbas";
    if (isJBas && activeDebugSourceMap && activeDebugSourceMap.basicToSource) {
      const sourceLine1 = mapBasicToSourceLine(basicLine, activeDebugSourceMap.basicToSource);
      docLine = sourceLine1 - 1;
    } else {
      docLine = findDocumentLine(doc.getText(), basicLine);
    }
    if (docLine < 0 || docLine >= doc.lineCount) return;
    const lineText = doc.lineAt(docLine).text;
    const lineRange = new vscode.Range(docLine, 0, docLine, lineText.length);
    const stmtRangeObj = findStatementRange(lineText, stmt);
    const stmtRange = new vscode.Range(docLine, stmtRangeObj.startCol, docLine, stmtRangeObj.endCol);
    const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === doc.uri.toString());
    if (editor) {
      editor.setDecorations(debugLineDecoration, [lineRange]);
      editor.setDecorations(debugStmtDecoration, [stmtRange]);
      editor.revealRange(lineRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } else {
      vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: true }).then((ed) => {
        ed.setDecorations(debugLineDecoration, [lineRange]);
        ed.setDecorations(debugStmtDecoration, [stmtRange]);
        ed.revealRange(lineRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }, () => {
      });
    }
  }
  function handleBasicPaused(line, stmt, vars) {
    activeDebugLine = line;
    activeDebugStmt = stmt;
    activeDebugVars = Array.isArray(vars) ? vars : [];
    vscode.commands.executeCommand("setContext", "sinclairBasic.isDebugging", true);
    vscode.commands.executeCommand("setContext", "sinclairBasic.isPaused", true);
    const isJBas = activeDebugDoc && (activeDebugDoc.fileName.endsWith(".jbas") || activeDebugDoc.languageId === "jbas");
    if (isJBas && activeDebugSourceMap && activeDebugSourceMap.basicToSource) {
      const sourceLine1 = mapBasicToSourceLine(line, activeDebugSourceMap.basicToSource);
      debugStatusBarItem.text = `$(debug-pause) JBAS: L${sourceLine1} (BASIC: ${line}, Sent. ${stmt})`;
      debugStatusBarItem.tooltip = `Sinclair BASIC pausado en .jbas l\xEDnea ${sourceLine1} (l\xEDnea compilada ${line}, sentencia ${stmt}).
Haz clic para inspeccionar variables en RAM.`;
    } else {
      debugStatusBarItem.text = `$(debug-pause) BASIC: L\xEDnea ${line} (Sent. ${stmt})`;
      debugStatusBarItem.tooltip = `Sinclair BASIC pausado en l\xEDnea ${line}, sentencia ${stmt}.
Haz clic para inspeccionar variables en RAM.`;
    }
    debugStatusBarItem.command = "sinclairBasic.showDebugVariables";
    debugStatusBarItem.show();
    if (activeDebugDoc) {
      highlightDebugPosition(activeDebugDoc, line, stmt);
    }
    if (activeDebugAdapter) {
      if (activeDebugSourceMap) {
        activeDebugAdapter.core.setSourceMap(activeDebugSourceMap);
      }
      if (activeDebugDoc) {
        activeDebugAdapter.core.setDocument(activeDebugDoc.fileName, activeDebugDoc.getText());
      }
      activeDebugAdapter.core.notifyPaused(line, stmt, activeDebugVars);
    }
  }
  function handleBasicResumed() {
    clearDebugDecorations();
    vscode.commands.executeCommand("setContext", "sinclairBasic.isPaused", false);
    if (isDebuggingActive) {
      debugStatusBarItem.text = "$(play) BASIC: Ejecutando...";
      debugStatusBarItem.tooltip = "Sinclair BASIC en ejecuci\xF3n en Turbo80";
      debugStatusBarItem.show();
    }
    if (activeDebugAdapter) {
      activeDebugAdapter.core.notifyResumed();
    }
  }
  function handleDebugStopped() {
    isDebuggingActive = false;
    activeDebugDoc = null;
    activeDebugSourceMap = null;
    activeDebugLine = null;
    activeDebugStmt = null;
    activeDebugVars = [];
    clearDebugDecorations();
    debugStatusBarItem.hide();
    vscode.commands.executeCommand("setContext", "sinclairBasic.isDebugging", false);
    vscode.commands.executeCommand("setContext", "sinclairBasic.isPaused", false);
    if (activeDebugAdapter) {
      activeDebugAdapter.core.notifyTerminated();
      activeDebugAdapter = null;
    }
    if (vscode.debug.activeDebugSession && vscode.debug.activeDebugSession.type === "sinclair-basic") {
      vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
    }
  }
  function runTurbo80Webview(tapBytes, filename, options = {}) {
    const config = vscode.workspace.getConfiguration("sinclairBasic");
    const model = config.get("turbo80Model", "48k") || "48k";
    const crt = config.get("turbo80Crt", true);
    const base64 = uint8ArrayToBase64(tapBytes);
    const isDebug = !!options.debug;
    const breakpoints = Array.isArray(options.breakpoints) ? options.breakpoints : [];
    const stopOnEntry = options.stopOnEntry !== void 0 ? options.stopOnEntry : breakpoints.length === 0;
    if (isDebug) {
      isDebuggingActive = true;
      activeDebugDoc = options.doc || null;
      vscode.commands.executeCommand("setContext", "sinclairBasic.isDebugging", true);
      debugStatusBarItem.text = "$(play) BASIC: Iniciando depurador...";
      debugStatusBarItem.show();
    }
    const payload = {
      command: "loadTap",
      base64,
      filename,
      model,
      crt,
      debug: isDebug,
      breakpoints,
      stopOnEntry
    };
    if (currentTurbo80Panel) {
      currentTurbo80Panel.reveal(vscode.ViewColumn.Beside, false);
      currentTurbo80Panel.title = `ZX: ${filename}${isDebug ? " (Debug)" : ""}`;
      currentTurbo80Panel.webview.postMessage(payload);
    } else {
      currentTurbo80Panel = vscode.window.createWebviewPanel(
        "sinclairBasicTurbo80",
        `ZX: ${filename}${isDebug ? " (Debug)" : ""}`,
        {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: false
        },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "media")
          ]
        }
      );
      currentTurbo80Panel.webview.html = getTurbo80Html(currentTurbo80Panel.webview, context.extensionUri, vscode);
      currentTurbo80Panel.webview.onDidReceiveMessage((message) => {
        if (message.command === "ready") {
          currentTurbo80Panel.webview.postMessage(payload);
        } else if (message.command === "basicPaused") {
          handleBasicPaused(message.line, message.stmt, message.vars);
        } else if (message.command === "basicResumed") {
          handleBasicResumed();
        } else if (message.command === "debugStopped") {
          handleDebugStopped();
        }
      });
      currentTurbo80Panel.onDidDispose(() => {
        currentTurbo80Panel = null;
        handleDebugStopped();
      });
    }
  }
  async function handleDebugTurbo80(uri) {
    const doc = await getTargetDocument(uri);
    if (!doc) {
      vscode.window.showInformationMessage("No active editor or Sinclair BASIC file selected.");
      return;
    }
    let res = null;
    if (doc.fileName.endsWith(".jbas")) {
      res = await handleCompileJBas(uri);
    } else if (doc.fileName.endsWith(".bas")) {
      res = await handleCompileBas(uri);
    } else {
      vscode.window.showWarningMessage("Please select a .bas or .jbas file to debug.");
      return;
    }
    if (!res) return;
    activeDebugDoc = doc;
    const breakpoints = getBreakpointsForDocument(doc);
    const stopOnEntry = breakpoints.length === 0;
    runTurbo80Webview(res.tapBytes, res.filename, {
      debug: true,
      breakpoints,
      doc,
      stopOnEntry
    });
    await vscode.debug.startDebugging(void 0, {
      type: "sinclair-basic",
      name: `Sinclair BASIC: ${res.filename}`,
      request: "launch",
      program: doc.fileName,
      stopOnEntry
    });
  }
  function handleDebugContinue() {
    if (currentTurbo80Panel) {
      currentTurbo80Panel.webview.postMessage({ command: "debugContinue" });
    }
  }
  function handleDebugPause() {
    if (currentTurbo80Panel) {
      currentTurbo80Panel.webview.postMessage({ command: "debugPause" });
    }
  }
  function handleDebugStepLine() {
    if (currentTurbo80Panel) {
      currentTurbo80Panel.webview.postMessage({ command: "debugStepLine" });
    }
  }
  function handleDebugStepStmt() {
    if (currentTurbo80Panel) {
      currentTurbo80Panel.webview.postMessage({ command: "debugStepStmt" });
    }
  }
  function handleDebugRestart() {
    if (currentTurbo80Panel) {
      currentTurbo80Panel.webview.postMessage({ command: "debugRestart" });
    }
  }
  function handleDebugStop() {
    if (currentTurbo80Panel) {
      currentTurbo80Panel.webview.postMessage({ command: "debugStop" });
    }
    handleDebugStopped();
  }
  function handleToggleBreakpoint() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const uri = editor.document.uri;
    const pos = editor.selection.active;
    const line = pos.line;
    const lineText = editor.document.lineAt(line).text;
    const ranges = getStatementRanges(lineText);
    if (ranges.length > 1) {
      const curStmt = findStatementIndexAtColumn(lineText, pos.character + 1);
      const targetRange = ranges[curStmt - 1];
      const targetCol = targetRange ? targetRange.startCol : 0;
      const existing = vscode.debug.breakpoints.find(
        (b) => b instanceof vscode.SourceBreakpoint && b.location.uri.toString() === uri.toString() && b.location.range.start.line === line && targetRange && b.location.range.start.character >= targetRange.startCol && b.location.range.start.character <= targetRange.endCol
      );
      if (existing) {
        vscode.debug.removeBreakpoints([existing]);
      } else {
        vscode.debug.addBreakpoints([
          new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(line, targetCol)))
        ]);
      }
    } else {
      const existing = vscode.debug.breakpoints.find(
        (b) => b instanceof vscode.SourceBreakpoint && b.location.uri.toString() === uri.toString() && b.location.range.start.line === line
      );
      if (existing) {
        vscode.debug.removeBreakpoints([existing]);
      } else {
        vscode.debug.addBreakpoints([
          new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(line, 0)))
        ]);
      }
    }
  }
  async function handleShowDebugVariables() {
    if (!isDebuggingActive || activeDebugVars.length === 0) {
      vscode.window.showInformationMessage("Sin variables activas en RAM del ZX Spectrum en este momento.");
      return;
    }
    const items = activeDebugVars.map((v) => ({
      label: `${v.name} = ${v.type === "string" ? '"' + v.value + '"' : v.value}`,
      description: `Tipo: ${v.type}${v.length !== void 0 ? ` (longitud: ${v.length})` : ""}`,
      detail: `L\xEDnea actual: ${activeDebugLine}, Sentencia: ${activeDebugStmt}`
    }));
    await vscode.window.showQuickPick(items, {
      title: `Variables ZX Spectrum (L\xEDnea ${activeDebugLine}, Sentencia ${activeDebugStmt})`,
      placeHolder: "Inspecci\xF3n de variables en memoria RAM"
    });
  }
  async function handleRenumber(uri) {
    let editor = vscode.window.activeTextEditor;
    if (uri && (!editor || editor.document.uri.toString() !== uri.toString())) {
      const doc2 = await vscode.workspace.openTextDocument(uri);
      editor = await vscode.window.showTextDocument(doc2);
    }
    if (!editor) {
      vscode.window.showInformationMessage("No active Sinclair BASIC (.bas) editor found.");
      return;
    }
    const doc = editor.document;
    if (doc.fileName.endsWith(".jbas")) {
      vscode.window.showWarningMessage("Cannot renumber a .jbas file. .jbas uses labels (@label) without line numbers.");
      return;
    }
    const config = vscode.workspace.getConfiguration("sinclairBasic");
    const defaultStart = config.get("renumberStart", 10);
    const defaultStep = config.get("renumberStep", 10);
    const startInput = await vscode.window.showInputBox({
      prompt: "Enter starting line number",
      value: String(defaultStart),
      validateInput: (val) => /^\d+$/.test(val) && parseInt(val, 10) > 0 ? null : "Please enter a positive integer."
    });
    if (startInput === void 0) return;
    const stepInput = await vscode.window.showInputBox({
      prompt: "Enter step increment",
      value: String(defaultStep),
      validateInput: (val) => /^\d+$/.test(val) && parseInt(val, 10) > 0 ? null : "Please enter a positive integer."
    });
    if (stepInput === void 0) return;
    const start = parseInt(startInput, 10);
    const step = parseInt(stepInput, 10);
    try {
      const text = doc.getText();
      const renumbered = renumberProgram(text, { start, step });
      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(text.length)
      );
      await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, renumbered);
      });
      vscode.window.showInformationMessage(`Renumbered lines (start: ${start}, step: ${step}).`);
    } catch (err) {
      vscode.window.showErrorMessage(`Renumber error: ${err.message}`);
    }
  }
  async function handleTranspileJBas(uri) {
    const doc = await getTargetDocument(uri);
    if (!doc || !doc.fileName.endsWith(".jbas")) {
      vscode.window.showInformationMessage("Please select a .jbas file to transpile.");
      return;
    }
    const config = vscode.workspace.getConfiguration("sinclairBasic");
    const outDirName = config.get("outputDirectory", "dist");
    const all = transpileJBasAllVersions(doc.getText());
    if (!all.success) {
      vscode.window.showErrorMessage(`Compilation failed:
${all.errors.join("\n")}`);
      return;
    }
    const distUri = getDistUri(doc.uri, outDirName);
    await vscode.workspace.fs.createDirectory(distUri);
    const baseName = getBaseName(doc.uri, ".jbas");
    const compactUri = vscode.Uri.joinPath(distUri, `${baseName}.bas`);
    const step10Uri = vscode.Uri.joinPath(distUri, `${baseName}-step10.bas`);
    const commentsUri = vscode.Uri.joinPath(distUri, `${baseName}-comments.bas`);
    const sinclairUri = vscode.Uri.joinPath(distUri, `${baseName}.sinclair.bas`);
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(compactUri, encoder.encode(all.compact.text));
    await vscode.workspace.fs.writeFile(step10Uri, encoder.encode(all.step10.text));
    await vscode.workspace.fs.writeFile(commentsUri, encoder.encode(all.comments.text));
    await vscode.workspace.fs.writeFile(sinclairUri, encoder.encode(all.sinclair.text));
    const openedDoc = await vscode.workspace.openTextDocument(step10Uri);
    await vscode.window.showTextDocument(openedDoc);
    vscode.window.showInformationMessage(
      `Transpiled versions to dist/: ${baseName}.bas (1x1), ${baseName}-step10.bas, ${baseName}-comments.bas, ${baseName}.sinclair.bas (standard CHR$)`
    );
  }
  async function handleCompileJBas(uri) {
    const doc = await getTargetDocument(uri);
    if (!doc || !doc.fileName.endsWith(".jbas")) {
      vscode.window.showInformationMessage("Please select a .jbas file to compile.");
      return null;
    }
    try {
      const { tapBytes, autoStartLine, filename, sourceMap } = await buildTapFromDocument(doc);
      activeDebugSourceMap = sourceMap;
      vscode.window.showInformationMessage(`Compiled ${filename} (Autostart line ${autoStartLine})`);
      return { tapBytes, filename };
    } catch (err) {
      vscode.window.showErrorMessage(`Compile JBAS error: ${err.message}`);
      return null;
    }
  }
  async function handleCompileBas(uri) {
    const doc = await getTargetDocument(uri);
    if (!doc) {
      vscode.window.showInformationMessage("No active editor or file selected.");
      return null;
    }
    if (doc.fileName.endsWith(".jbas")) {
      return await handleCompileJBas(uri);
    }
    activeDebugSourceMap = null;
    try {
      const { tapBytes, autoStartLine, filename } = await buildTapFromDocument(doc);
      vscode.window.showInformationMessage(`Successfully built TAP: ${filename} (Autostart line ${autoStartLine})`);
      return { tapBytes, filename };
    } catch (err) {
      vscode.window.showErrorMessage(`Compile BAS error: ${err.message}`);
      return null;
    }
  }
  async function handleRunEmulator(uri) {
    const result = await handleCompileBas(uri);
    if (!result) return;
    runTurbo80Webview(result.tapBytes, result.filename);
  }
  async function handleRunTurbo80(uri) {
    const result = await handleCompileBas(uri);
    if (!result) return;
    runTurbo80Webview(result.tapBytes, result.filename);
  }
  async function handleRunExternalEmulator() {
    vscode.window.showInformationMessage("External desktop emulators (e.g. Fuse) require VS Code Desktop. In VS Code Web, the built-in Turbo80 web emulator is used.");
  }
  async function handleShareTurbo80(uri) {
    let tapBytes = null;
    let filename = "";
    if (uri && uri.path && uri.path.toLowerCase().endsWith(".tap")) {
      try {
        tapBytes = await vscode.workspace.fs.readFile(uri);
        filename = getBaseName(uri);
      } catch (err) {
        vscode.window.showErrorMessage(`Error al leer archivo TAP: ${err.message}`);
        return;
      }
    } else {
      const result = await handleCompileBas(uri);
      if (!result) return;
      tapBytes = result.tapBytes;
      filename = result.filename;
    }
    try {
      const config = vscode.workspace.getConfiguration("sinclairBasic");
      const model = config.get("turbo80Model", "48k") || "48k";
      const crt = config.get("turbo80Crt", true);
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Compartiendo ${filename} en Turbo80.com...`,
          cancellable: false
        },
        async (progress) => {
          const publicTapUrl = await uploadTapToHost(tapBytes, filename, fetch, {
            onProgress: (msg) => progress.report({ message: msg })
          });
          progress.report({ message: "Generando enlace web de Turbo80..." });
          const shareUrl = buildTurbo80ShareUrl(publicTapUrl, { model, crt });
          await vscode.env.clipboard.writeText(shareUrl);
          const choice = await vscode.window.showInformationMessage(
            `\xA1Cinta compartida! Enlace de Turbo80 copiado al portapapeles:
${shareUrl}`,
            "Abrir en el Navegador",
            "Copiar Enlace"
          );
          if (choice === "Abrir en el Navegador") {
            await vscode.env.openExternal(vscode.Uri.parse(shareUrl));
          } else if (choice === "Copiar Enlace") {
            await vscode.env.clipboard.writeText(shareUrl);
          }
        }
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Error al compartir en Turbo80: ${err.message}`);
    }
  }
  async function handleImportTap(uri, format = "both") {
    let tapUri = uri;
    if (!tapUri || !tapUri.path || !tapUri.path.toLowerCase().endsWith(".tap")) {
      let defaultUri;
      if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        defaultUri = vscode.workspace.workspaceFolders[0].uri;
      }
      const fileUris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri,
        openLabel: "Import Sinclair BASIC from TAP",
        filters: { "ZX Spectrum TAP files (*.tap)": ["tap"], "All Files (*.*)": ["*"] }
      });
      if (fileUris && fileUris[0]) {
        tapUri = fileUris[0];
      }
    }
    if (!tapUri) return;
    try {
      const tapBytes = await vscode.workspace.fs.readFile(tapUri);
      const programs = extractProgramsFromTap(tapBytes);
      if (!programs || programs.length === 0) {
        vscode.window.showErrorMessage(
          `No Sinclair BASIC program found in '${getBaseName(tapUri)}'. (The tape may only contain machine code or screen blocks).`
        );
        return;
      }
      let targetDir = vscode.Uri.joinPath(tapUri, "..");
      if (getBaseName(targetDir).toLowerCase() === "dist") {
        targetDir = vscode.Uri.joinPath(targetDir, "..");
      }
      const tapBase = getBaseName(tapUri, ".tap");
      let createdBasUri = null;
      let createdJbasUri = null;
      for (let pIdx = 0; pIdx < programs.length; pIdx++) {
        const prog = programs[pIdx];
        const prefix = programs.length === 1 ? tapBase : `${tapBase}_${prog.name}`;
        const basUri = vscode.Uri.joinPath(targetDir, `${prefix}.bas`);
        const jbasUri = vscode.Uri.joinPath(targetDir, `${prefix}.jbas`);
        if (format === "both" || format === "bas") {
          await vscode.workspace.fs.writeFile(basUri, new TextEncoder().encode(prog.basText));
          createdBasUri = basUri;
        }
        if (format === "both" || format === "jbas") {
          await vscode.workspace.fs.writeFile(jbasUri, new TextEncoder().encode(prog.jbasText));
          createdJbasUri = jbasUri;
        }
      }
      const primaryUri = createdJbasUri || createdBasUri;
      if (primaryUri) {
        const doc = await vscode.workspace.openTextDocument(primaryUri);
        await vscode.window.showTextDocument(doc);
      }
      const prog0 = programs[0];
      const items = [];
      if (createdJbasUri) items.push("Open .jbas");
      if (createdBasUri) items.push("Open .bas");
      const msg = format === "bas" ? `Sinclair BASIC imported from ${getBaseName(tapUri)} (${prog0.linesCount} lines): created ${getBaseName(createdBasUri)}` : format === "jbas" ? `Sinclair BASIC imported from ${getBaseName(tapUri)} (${prog0.linesCount} lines): created ${getBaseName(createdJbasUri)}` : `Sinclair BASIC imported from ${getBaseName(tapUri)} (${prog0.linesCount} lines): created ${getBaseName(createdBasUri)} and ${getBaseName(createdJbasUri)}`;
      const choice = await vscode.window.showInformationMessage(msg, ...items);
      if (choice === "Open .jbas" && createdJbasUri) {
        const doc = await vscode.workspace.openTextDocument(createdJbasUri);
        await vscode.window.showTextDocument(doc);
      } else if (choice === "Open .bas" && createdBasUri) {
        const doc = await vscode.workspace.openTextDocument(createdBasUri);
        await vscode.window.showTextDocument(doc);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Error importing Sinclair BASIC from TAP: ${err.message}`);
    }
  }
  const jbasLanguageConfig = vscode.languages.setLanguageConfiguration("jbas", {
    onEnterRules: [
      {
        beforeText: /^\s*@[a-zA-Z0-9_]+:\s*$/,
        action: { indentAction: vscode.IndentAction.Indent }
      }
    ]
  });
  const jbasDiagnostics = vscode.languages.createDiagnosticCollection("jbas");
  function validateJBasDocument(document) {
    if (!document || !document.fileName.endsWith(".jbas")) return;
    const diagnostics = [];
    const seenLabels = /* @__PURE__ */ new Map();
    const lineCount = document.lineCount;
    for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
      const lineText = document.lineAt(lineIdx).text;
      let inString = false;
      let i = 0;
      const n = lineText.length;
      while (i < n) {
        const c = lineText[i];
        if (c === '"') {
          inString = !inString;
          i++;
          continue;
        }
        if (!inString && c === "'") break;
        if (!inString && c === "@") {
          const match = lineText.slice(i).match(/^@([a-zA-Z0-9_]+):/);
          if (match) {
            const labelName = match[1];
            const startCol = i;
            const endCol = i + match[0].length;
            const range = new vscode.Range(lineIdx, startCol, lineIdx, endCol);
            if (seenLabels.has(labelName)) {
              const prev = seenLabels.get(labelName);
              diagnostics.push(new vscode.Diagnostic(
                range,
                `Duplicate label definition: '@${labelName}:' was already defined at line ${prev.line + 1}.`,
                vscode.DiagnosticSeverity.Error
              ));
            } else {
              seenLabels.set(labelName, { line: lineIdx, startCol, endCol });
            }
            i += match[0].length;
            continue;
          }
        }
        i++;
      }
    }
    jbasDiagnostics.set(document.uri, diagnostics);
  }
  const definitionProvider = vscode.languages.registerDefinitionProvider("jbas", {
    provideDefinition(document, position) {
      const range = document.getWordRangeAtPosition(position, /@[a-zA-Z0-9_]+/);
      if (!range) return null;
      const word = document.getText(range);
      const labelName = word.startsWith("@") ? word.slice(1) : word;
      const targetRegex = new RegExp(`^\\s*@${labelName}:`);
      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        if (targetRegex.test(line.text)) {
          const col = line.text.indexOf(`@${labelName}:`);
          return new vscode.Location(document.uri, new vscode.Position(i, col));
        }
      }
      return null;
    }
  });
  const basDefinitionProvider = vscode.languages.registerDefinitionProvider("sinclair-basic", {
    provideDefinition(document, position) {
      const lineText = document.lineAt(position.line).text;
      const jumpTarget = findBasJumpTargetAtPosition(lineText, position.character);
      if (!jumpTarget) return null;
      const targetLoc = findBasLineIndex(document, jumpTarget.targetLineNumber);
      if (!targetLoc) return null;
      const originRange = new vscode.Range(
        position.line,
        jumpTarget.startCol,
        position.line,
        jumpTarget.endCol
      );
      const targetPos = new vscode.Position(targetLoc.lineIndex, targetLoc.col);
      const targetRange = new vscode.Range(targetPos, targetPos);
      return [
        {
          originSelectionRange: originRange,
          targetUri: document.uri,
          targetRange,
          targetSelectionRange: targetRange
        }
      ];
    }
  });
  const referenceProvider = vscode.languages.registerReferenceProvider("jbas", {
    provideReferences(document, position) {
      const range = document.getWordRangeAtPosition(position, /@[a-zA-Z0-9_]+/);
      if (!range) return [];
      const word = document.getText(range);
      const labelName = word.startsWith("@") ? word.slice(1) : word;
      const locations = [];
      for (let lineIdx = 0; lineIdx < document.lineCount; lineIdx++) {
        const lineText = document.lineAt(lineIdx).text;
        let inString = false;
        let i = 0;
        const n = lineText.length;
        while (i < n) {
          const c = lineText[i];
          if (c === '"') {
            inString = !inString;
            i++;
            continue;
          }
          if (!inString && c === "'") break;
          if (!inString && c === "@") {
            const match = lineText.slice(i).match(/^@([a-zA-Z0-9_]+)/);
            if (match && match[1] === labelName) {
              locations.push(new vscode.Location(
                document.uri,
                new vscode.Range(lineIdx, i, lineIdx, i + match[0].length)
              ));
              i += match[0].length;
              continue;
            }
          }
          i++;
        }
      }
      return locations;
    }
  });
  const symbolProvider = vscode.languages.registerDocumentSymbolProvider("jbas", {
    provideDocumentSymbols(document) {
      const symbols = [];
      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const match = line.text.match(/^\s*@([a-zA-Z0-9_]+):/);
        if (match) {
          const labelName = match[1];
          const col = line.text.indexOf(`@${labelName}:`);
          const range = new vscode.Range(i, col, i, col + match[0].length);
          symbols.push(new vscode.DocumentSymbol(
            `@${labelName}`,
            "Jump Label",
            vscode.SymbolKind.Function,
            line.range,
            range
          ));
        }
      }
      return symbols;
    }
  });
  const renameProvider = vscode.languages.registerRenameProvider("jbas", {
    provideRenameEdits(document, position, newName) {
      const range = document.getWordRangeAtPosition(position, /@[a-zA-Z0-9_]+/);
      if (!range) return null;
      const rawOldName = document.getText(range);
      const oldLabel = rawOldName.startsWith("@") ? rawOldName.slice(1) : rawOldName;
      let cleanNewName = newName.trim();
      if (cleanNewName.startsWith("@")) {
        cleanNewName = cleanNewName.slice(1);
      }
      if (!cleanNewName || !/^[a-zA-Z0-9_]+$/.test(cleanNewName)) {
        throw new Error("Invalid label name. Labels must contain only letters, numbers, and underscores.");
      }
      const workspaceEdit = new vscode.WorkspaceEdit();
      for (let lineIdx = 0; lineIdx < document.lineCount; lineIdx++) {
        const lineText = document.lineAt(lineIdx).text;
        let inString = false;
        let i = 0;
        const n = lineText.length;
        while (i < n) {
          const c = lineText[i];
          if (c === '"') {
            inString = !inString;
            i++;
            continue;
          }
          if (!inString && c === "@") {
            const match = lineText.slice(i).match(/^@([a-zA-Z0-9_]+)/);
            if (match && match[1] === oldLabel) {
              const editRange = new vscode.Range(lineIdx, i, lineIdx, i + match[0].length);
              workspaceEdit.replace(document.uri, editRange, "@" + cleanNewName);
              i += match[0].length;
              continue;
            }
          }
          i++;
        }
      }
      return workspaceEdit;
    }
  });
  async function handleFormatKeywords(uri) {
    let editor = vscode.window.activeTextEditor;
    if (uri && (!editor || editor.document.uri.toString() !== uri.toString())) {
      const doc2 = await vscode.workspace.openTextDocument(uri);
      editor = await vscode.window.showTextDocument(doc2);
    }
    if (!editor) {
      vscode.window.showInformationMessage("No active Sinclair BASIC (.bas or .jbas) editor found.");
      return;
    }
    const doc = editor.document;
    const isJBas = doc.languageId === "jbas" || doc.fileName.endsWith(".jbas");
    if (editor.selection && !editor.selection.isEmpty) {
      const sel = editor.selection;
      const fullRange = new vscode.Range(
        new vscode.Position(sel.start.line, 0),
        doc.lineAt(sel.end.line).range.end
      );
      const text = doc.getText(fullRange);
      const formatted = formatKeywordsToUpper(text, { isJBas });
      if (formatted !== text) {
        await editor.edit((editBuilder) => {
          editBuilder.replace(fullRange, formatted);
        });
      }
    } else {
      const fullText = doc.getText();
      const formatted = formatKeywordsToUpper(fullText, { isJBas });
      if (formatted !== fullText) {
        const fullRange = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(fullText.length)
        );
        await editor.edit((editBuilder) => {
          editBuilder.replace(fullRange, formatted);
        });
      }
    }
  }
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    ["sinclair-basic", "jbas"],
    createSinclairCompletionProvider(vscode),
    "@",
    "{"
  );
  const documentFormattingProvider = vscode.languages.registerDocumentFormattingEditProvider(
    ["sinclair-basic", "jbas"],
    {
      provideDocumentFormattingEdits(document) {
        const isJBas = document.languageId === "jbas" || document.fileName.endsWith(".jbas");
        const fullText = document.getText();
        const formatted = formatKeywordsToUpper(fullText, { isJBas });
        if (formatted === fullText) return [];
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(fullText.length)
        );
        return [vscode.TextEdit.replace(fullRange, formatted)];
      }
    }
  );
  const rangeFormattingProvider = vscode.languages.registerDocumentRangeFormattingEditProvider(
    ["sinclair-basic", "jbas"],
    {
      provideDocumentRangeFormattingEdits(document, range) {
        const isJBas = document.languageId === "jbas" || document.fileName.endsWith(".jbas");
        const startLine = range.start.line;
        const endLine = range.end.line;
        const fullRange = new vscode.Range(
          new vscode.Position(startLine, 0),
          document.lineAt(endLine).range.end
        );
        const text = document.getText(fullRange);
        const formatted = formatKeywordsToUpper(text, { isJBas });
        if (formatted === text) return [];
        return [vscode.TextEdit.replace(fullRange, formatted)];
      }
    }
  );
  const basFoldingProvider = vscode.languages.registerFoldingRangeProvider("sinclair-basic", {
    provideFoldingRanges(document) {
      const ranges = getBasFoldingRanges(document.getText());
      return ranges.map((r) => new vscode.FoldingRange(r.start, r.end, vscode.FoldingRangeKind.Region));
    }
  });
  context.subscriptions.push(
    vscode.commands.registerCommand("sinclairBasic.renumber", handleRenumber),
    vscode.commands.registerCommand("sinclairBasic.renumberBas", handleRenumber),
    vscode.commands.registerCommand("sinclairBasic.formatKeywords", handleFormatKeywords),
    vscode.commands.registerCommand("sinclairBasic.transpileJBas", handleTranspileJBas),
    vscode.commands.registerCommand("sinclairBasic.compileJBas", handleCompileJBas),
    vscode.commands.registerCommand("sinclairBasic.compileJBasToTap", handleCompileJBas),
    vscode.commands.registerCommand("sinclairBasic.compileBas", handleCompileBas),
    vscode.commands.registerCommand("sinclairBasic.buildTap", handleCompileBas),
    vscode.commands.registerCommand("sinclairBasic.runEmulator", handleRunEmulator),
    vscode.commands.registerCommand("sinclairBasic.runTurbo80", handleRunTurbo80),
    vscode.commands.registerCommand("sinclairBasic.runExternalEmulator", handleRunExternalEmulator),
    vscode.commands.registerCommand("sinclairBasic.shareTurbo80", handleShareTurbo80),
    // Import from TAP (.bas and .jbas)
    vscode.commands.registerCommand("sinclairBasic.importTap", (uri) => handleImportTap(uri, "both")),
    vscode.commands.registerCommand("sinclairBasic.importTapToBas", (uri) => handleImportTap(uri, "bas")),
    vscode.commands.registerCommand("sinclairBasic.importTapToJBas", (uri) => handleImportTap(uri, "jbas")),
    // Debugger commands for Sinclair BASIC (48K step-by-step & variables)
    vscode.commands.registerCommand("sinclairBasic.debugTurbo80", handleDebugTurbo80),
    vscode.commands.registerCommand("sinclairBasic.debugContinue", handleDebugContinue),
    vscode.commands.registerCommand("sinclairBasic.debugPause", handleDebugPause),
    vscode.commands.registerCommand("sinclairBasic.debugStepLine", handleDebugStepLine),
    vscode.commands.registerCommand("sinclairBasic.debugStepStmt", handleDebugStepStmt),
    vscode.commands.registerCommand("sinclairBasic.debugRestart", handleDebugRestart),
    vscode.commands.registerCommand("sinclairBasic.debugStop", handleDebugStop),
    vscode.commands.registerCommand("sinclairBasic.toggleBreakpoint", handleToggleBreakpoint),
    vscode.commands.registerCommand("sinclairBasic.showDebugVariables", handleShowDebugVariables),
    vscode.debug.registerDebugAdapterDescriptorFactory("sinclair-basic", {
      createDebugAdapterDescriptor(session) {
        activeDebugAdapter = new SinclairBasicDebugAdapter(session);
        return new vscode.DebugAdapterInlineImplementation(activeDebugAdapter);
      }
    }),
    vscode.debug.registerDebugConfigurationProvider("sinclair-basic", {
      provideDebugConfigurations() {
        return [
          {
            type: "sinclair-basic",
            request: "launch",
            name: "Debug Sinclair BASIC (Turbo80)"
          }
        ];
      },
      async resolveDebugConfiguration(folder, config) {
        let program = config.program;
        if (!program) {
          const editor = vscode.window.activeTextEditor;
          if (editor && (editor.document.languageId === "sinclair-basic" || editor.document.languageId === "jbas")) {
            program = editor.document.fileName;
          }
        }
        if (!program) {
          vscode.window.showWarningMessage("Please select a .bas or .jbas file to debug.");
          return void 0;
        }
        config.type = "sinclair-basic";
        config.request = "launch";
        config.name = config.name || `Sinclair BASIC: ${program.split("/").pop().split("\\").pop()}`;
        config.program = program;
        if (!isDebuggingActive) {
          const editor = vscode.window.activeTextEditor;
          const doc = editor && editor.document.fileName === program ? editor.document : await vscode.workspace.openTextDocument(vscode.Uri.parse(program));
          let res = null;
          if (program.endsWith(".jbas")) {
            res = await handleCompileJBas(doc.uri);
          } else {
            res = await handleCompileBas(doc.uri);
          }
          if (!res) return void 0;
          activeDebugDoc = doc;
          const breakpoints = getBreakpointsForDocument(doc);
          config.stopOnEntry = breakpoints.length === 0;
          runTurbo80Webview(res.tapBytes, res.filename, {
            debug: true,
            breakpoints,
            doc,
            stopOnEntry: config.stopOnEntry
          });
        }
        return config;
      }
    }),
    vscode.debug.onDidTerminateDebugSession((session) => {
      if (session.type === "sinclair-basic") {
        handleDebugStop();
      }
    }),
    debugStatusBarItem,
    debugLineDecoration,
    debugStmtDecoration,
    vscode.debug.onDidChangeBreakpoints(() => {
      if (isDebuggingActive && activeDebugDoc && currentTurbo80Panel) {
        const bps = getBreakpointsForDocument(activeDebugDoc);
        currentTurbo80Panel.webview.postMessage({
          command: "setBreakpoints",
          breakpoints: bps
        });
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (isDebuggingActive && activeDebugDoc && editor && editor.document.uri.toString() === activeDebugDoc.uri.toString()) {
        if (activeDebugLine !== null && activeDebugStmt !== null) {
          highlightDebugPosition(activeDebugDoc, activeDebugLine, activeDebugStmt);
        }
      }
    }),
    vscode.commands.registerCommand("sinclairBasic.selectBas2tap", () => vscode.window.showInformationMessage("Executable path selection is only available on desktop.")),
    vscode.commands.registerCommand("sinclairBasic.selectEmulator", () => vscode.window.showInformationMessage("Executable path selection is only available on desktop.")),
    jbasLanguageConfig,
    definitionProvider,
    referenceProvider,
    symbolProvider,
    renameProvider,
    basDefinitionProvider,
    completionProvider,
    documentFormattingProvider,
    rangeFormattingProvider,
    basFoldingProvider,
    jbasDiagnostics,
    vscode.workspace.onDidOpenTextDocument(validateJBasDocument),
    vscode.workspace.onDidChangeTextDocument((e) => validateJBasDocument(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => jbasDiagnostics.delete(doc.uri))
  );
  retroModeController = new RetroModeController(vscode, context);
  retroModeController.init();
  context.subscriptions.push(retroModeController);
  vscode.workspace.textDocuments.forEach(validateJBasDocument);
}
function deactivate() {
  if (retroModeController) {
    retroModeController.dispose();
    retroModeController = null;
  }
}
module.exports = {
  activate,
  deactivate
};
