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
    function compileJBas2(sourceText, options = {}) {
      const start = typeof options.start === "number" ? options.start : 10;
      const step = typeof options.step === "number" ? options.step : 10;
      const keepComments = !!options.keepComments;
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
          text: "",
          labels: labelMap,
          errors: ["Source contains no BASIC statements."],
          warnings,
          linesCount: 0
        };
      }
      let currentNum = start;
      for (const stmt of statements) {
        stmt.lineNum = currentNum;
        for (const lbl of stmt.labels) {
          labelMap.set(lbl, currentNum);
        }
        currentNum += step;
      }
      if (pendingLabels.length > 0) {
        for (const lbl of pendingLabels) {
          labelMap.set(lbl, currentNum);
          warnings.push(`Label '@${lbl}' defined at the very end of file (maps to line ${currentNum})`);
        }
      }
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
    function transpileJBasAllVersions2(sourceText) {
      const compact = compileJBas2(sourceText, { start: 1, step: 1, keepComments: false });
      const step10 = compileJBas2(sourceText, { start: 10, step: 10, keepComments: false });
      const comments = compileJBas2(sourceText, { start: 10, step: 10, keepComments: true });
      const errors = [.../* @__PURE__ */ new Set([...compact.errors, ...step10.errors, ...comments.errors])];
      const success = compact.success && step10.success && comments.success;
      return {
        compact,
        step10,
        comments,
        success,
        errors
      };
    }
    module2.exports = {
      stripComments,
      convertCommentsToRem,
      replaceLabelsOutsideStrings,
      compileJBas: compileJBas2,
      compileJBasFile,
      transpileJBasAllVersions: transpileJBasAllVersions2
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
            if (line[i] === "{" && i + 2 < line.length && line[i + 2] === "}") {
              const udg = line[i + 1].toUpperCase();
              const code = udg.charCodeAt(0);
              if (code >= 65 && code <= 85) {
                res.push(144 + code - 65);
                i += 3;
                continue;
              }
            }
            if (line[i] === "\\" && i + 1 < line.length) {
              const udg = line[i + 1].toUpperCase();
              const code = udg.charCodeAt(0);
              if (code >= 65 && code <= 85) {
                res.push(144 + code - 65);
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

// src/webExtension.js
var vscode = require("vscode");
var { renumberProgram } = require_renumber();
var { compileJBas, transpileJBasAllVersions } = require_jbas2bas();
var { bas2tap, tap2buffer } = require_tapGenerator();
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
  if (doc.fileName.endsWith(".jbas")) {
    baseName = getBaseName(doc.uri, ".jbas");
    const all = transpileJBasAllVersions(basicCode);
    if (!all.success) {
      throw new Error("Compilation failed:\n" + all.errors.join("\n"));
    }
    const compactUri = vscode.Uri.joinPath(distUri, `${baseName}.bas`);
    const step10Uri = vscode.Uri.joinPath(distUri, `${baseName}-step10.bas`);
    const commentsUri = vscode.Uri.joinPath(distUri, `${baseName}-comments.bas`);
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(compactUri, encoder.encode(all.compact.text));
    await vscode.workspace.fs.writeFile(step10Uri, encoder.encode(all.step10.text));
    await vscode.workspace.fs.writeFile(commentsUri, encoder.encode(all.comments.text));
    basicCode = all.compact.text;
  } else {
    baseName = getBaseName(doc.uri, ".bas");
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
    filename: `${baseName}.tap`
  };
}
function getTurbo80Html() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'unsafe-inline' https://turbo80.com;
    frame-src https://turbo80.com;
    style-src 'unsafe-inline';
    img-src https: data:;
    connect-src https://turbo80.com;
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
      width: 100%;
      height: calc(100% - 34px);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    #spectrum {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #spectrum iframe {
      border: 0;
      width: 100%;
      height: 100%;
      max-width: 100vw;
      max-height: 100vh;
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
    <div id="spectrum"></div>
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

  <script src="https://turbo80.com/turbo80.js"><\/script>
  <script>
    const vscode = acquireVsCodeApi();
    let emulator = null;
    let pendingData = null;

    function focusEmulator() {
      try {
        if (emulator && typeof emulator.focus === 'function') {
          emulator.focus();
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
      focusEmulator();
      attachIframeListeners();
      [50, 150, 300, 500, 800, 1200, 1800].forEach(delay => {
        setTimeout(focusEmulator, delay);
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
            iframe: true
          });
          if (emulator && typeof emulator.on === 'function') {
            emulator.on('ready', scheduleFocus);
            emulator.on('loaded', scheduleFocus);
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
              .then(() => { scheduleFocus(); })
              .catch(() => {
                doLoad();
                scheduleFocus();
              });
          } else {
            doLoad();
            scheduleFocus();
          }
        }
        scheduleFocus();
      } catch (err) {
        console.error('Error loading TAP into Turbo80:', err);
        document.getElementById('game-title').textContent = 'Error al cargar TAP: ' + err.message;
      }
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'loadTap') {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
          applyTap(msg);
        } else {
          pendingData = msg;
        }
      }
    });

    window.addEventListener('DOMContentLoaded', () => {
      if (pendingData) {
        applyTap(pendingData);
        pendingData = null;
      }
      vscode.postMessage({ command: 'ready' });
    });

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
function activate(context) {
  let currentTurbo80Panel = null;
  function runTurbo80Webview(tapBytes, filename) {
    const config = vscode.workspace.getConfiguration("sinclairBasic");
    const model = config.get("turbo80Model", "48k") || "48k";
    const crt = config.get("turbo80Crt", true);
    const base64 = uint8ArrayToBase64(tapBytes);
    const payload = {
      command: "loadTap",
      base64,
      filename,
      model,
      crt
    };
    if (currentTurbo80Panel) {
      currentTurbo80Panel.reveal(vscode.ViewColumn.Beside, false);
      currentTurbo80Panel.title = `ZX: ${filename}`;
      currentTurbo80Panel.webview.postMessage(payload);
    } else {
      currentTurbo80Panel = vscode.window.createWebviewPanel(
        "sinclairBasicTurbo80",
        `ZX: ${filename}`,
        {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: false
        },
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );
      currentTurbo80Panel.webview.html = getTurbo80Html();
      currentTurbo80Panel.webview.onDidReceiveMessage((message) => {
        if (message.command === "ready") {
          currentTurbo80Panel.webview.postMessage(payload);
        }
      });
      currentTurbo80Panel.onDidDispose(() => {
        currentTurbo80Panel = null;
      });
    }
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
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(compactUri, encoder.encode(all.compact.text));
    await vscode.workspace.fs.writeFile(step10Uri, encoder.encode(all.step10.text));
    await vscode.workspace.fs.writeFile(commentsUri, encoder.encode(all.comments.text));
    const openedDoc = await vscode.workspace.openTextDocument(step10Uri);
    await vscode.window.showTextDocument(openedDoc);
    vscode.window.showInformationMessage(
      `Transpiled 3 versions to dist/: ${baseName}.bas (1x1 optimal), ${baseName}-step10.bas (10x10), ${baseName}-comments.bas (10x10 + REM)`
    );
  }
  async function handleCompileJBas(uri) {
    const doc = await getTargetDocument(uri);
    if (!doc || !doc.fileName.endsWith(".jbas")) {
      vscode.window.showInformationMessage("Please select a .jbas file to compile.");
      return null;
    }
    try {
      const { tapBytes, autoStartLine, filename } = await buildTapFromDocument(doc);
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
  context.subscriptions.push(
    vscode.commands.registerCommand("sinclairBasic.renumber", handleRenumber),
    vscode.commands.registerCommand("sinclairBasic.renumberBas", handleRenumber),
    vscode.commands.registerCommand("sinclairBasic.transpileJBas", handleTranspileJBas),
    vscode.commands.registerCommand("sinclairBasic.compileJBas", handleCompileJBas),
    vscode.commands.registerCommand("sinclairBasic.compileJBasToTap", handleCompileJBas),
    vscode.commands.registerCommand("sinclairBasic.compileBas", handleCompileBas),
    vscode.commands.registerCommand("sinclairBasic.buildTap", handleCompileBas),
    vscode.commands.registerCommand("sinclairBasic.runEmulator", handleRunEmulator),
    vscode.commands.registerCommand("sinclairBasic.runTurbo80", handleRunTurbo80),
    vscode.commands.registerCommand("sinclairBasic.runExternalEmulator", handleRunExternalEmulator),
    vscode.commands.registerCommand("sinclairBasic.selectBas2tap", () => vscode.window.showInformationMessage("Executable path selection is only available on desktop.")),
    vscode.commands.registerCommand("sinclairBasic.selectEmulator", () => vscode.window.showInformationMessage("Executable path selection is only available on desktop.")),
    jbasLanguageConfig,
    definitionProvider,
    referenceProvider,
    symbolProvider,
    renameProvider,
    jbasDiagnostics,
    vscode.workspace.onDidOpenTextDocument(validateJBasDocument),
    vscode.workspace.onDidChangeTextDocument((e) => validateJBasDocument(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => jbasDiagnostics.delete(doc.uri))
  );
  vscode.workspace.textDocuments.forEach(validateJBasDocument);
}
function deactivate() {
}
module.exports = {
  activate,
  deactivate
};
