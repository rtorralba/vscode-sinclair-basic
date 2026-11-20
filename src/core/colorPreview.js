/**
 * Sinclair BASIC Visual Character Color Layer (Overlay + Compile-Time Injection)
 *
 * Allows selecting characters inside string literals ("...") in .bas / .jbas files
 * and applying ZX Spectrum PAPER, INK, BRIGHT, FLASH, and INVERSE attributes visually,
 * WITHOUT cluttering the source code with {PAPER n}/{INK n} tags and WITHOUT touching
 * any manual bas2tap control codes written by the user.
 *
 * Colors are stored cleanly in a sidecar file (<file>.zxcolors.json) + workspaceState,
 * stay synchronized as lines/characters are edited, render live in the editor,
 * and are automatically injected as {PAPER n}{INK n}... when transpiling, compiling,
 * running, or debugging.
 */

let fs;
try {
  fs = require('fs');
} catch {
  fs = null;
}

const SPECTRUM_PALETTE = {
  normal: [
    '#000000', // 0 Black
    '#0000D7', // 1 Blue
    '#D70000', // 2 Red
    '#D700D7', // 3 Magenta
    '#00D700', // 4 Green
    '#00D7D7', // 5 Cyan
    '#D7D700', // 6 Yellow
    '#D7D7D7'  // 7 White
  ],
  bright: [
    '#000000', // 0 Black
    '#0000FF', // 1 Bright Blue
    '#FF0000', // 2 Bright Red
    '#FF00FF', // 3 Bright Magenta
    '#00FF00', // 4 Bright Green
    '#00FFFF', // 5 Bright Cyan
    '#FFFF00', // 6 Bright Yellow
    '#FFFFFF'  // 7 Bright White
  ]
};

const ATTR_KEYS = ['paper', 'ink', 'bright', 'flash', 'inverse', 'udg'];

/**
 * Resolves the effective foreground/background hex colors for a cell's attributes.
 * When `flashInverted` is true and `attrs.flash === 1`, INK and PAPER are swapped
 * (emulating authentic ZX Spectrum FLASH, which swaps INK/PAPER every 16 frames / 320 ms).
 *
 * @param {{ paper?: number|null, ink?: number|null, bright?: number|null, flash?: number|null, inverse?: number|null, udg?: number|null }} attrs
 * @param {boolean} [flashInverted=false]
 * @returns {{ backgroundColor: string|undefined, color: string|undefined, flash: boolean, udg: boolean, styleKey: string } | null}
 */
function resolveEffectiveColors(attrs, flashInverted = false) {
  if (!attrs) return null;
  const hasPaper = typeof attrs.paper === 'number' && attrs.paper >= 0 && attrs.paper <= 7;
  const hasInk = typeof attrs.ink === 'number' && attrs.ink >= 0 && attrs.ink <= 7;
  const hasContrastInk = attrs.ink === 9;
  const isInverse = attrs.inverse === 1;
  const isFlash = attrs.flash === 1;
  const isUdg = attrs.udg === 1;

  if (!hasPaper && !hasInk && !hasContrastInk && !isInverse && !isFlash && !isUdg) {
    return null;
  }

  const pal = attrs.bright === 1 ? SPECTRUM_PALETTE.bright : SPECTRUM_PALETTE.normal;

  let paperIdx = hasPaper ? attrs.paper : null;
  let inkIdx = hasInk ? attrs.ink : null;

  const swapColors = isInverse !== (isFlash && !!flashInverted);

  if (swapColors) {
    const effPaper = paperIdx !== null ? paperIdx : 7;
    const effInk = inkIdx !== null ? inkIdx : (effPaper >= 4 ? 0 : 7);
    paperIdx = effInk;
    inkIdx = effPaper;
  } else if (hasContrastInk || (paperIdx !== null && inkIdx === null)) {
    if (paperIdx !== null) {
      inkIdx = paperIdx >= 4 ? 0 : 7;
    }
  }

  const backgroundColor = paperIdx !== null ? pal[paperIdx] : undefined;
  const color = inkIdx !== null ? pal[inkIdx] : undefined;
  const styleKey = `p:${backgroundColor || ''}|i:${color || ''}|u:${isUdg ? 1 : 0}`;

  return {
    backgroundColor,
    color,
    flash: isFlash,
    udg: isUdg,
    styleKey
  };
}

/**
 * Finds all string literal ranges (exclusive of quotes) on a line, ignoring REM and .jbas ' comments.
 * @param {string} lineText
 * @param {boolean} [isJBas=false]
 * @returns {Array<{ strStart: number, strEnd: number }>}
 */
function findStringRangesOnLine(lineText, isJBas = false) {
  const ranges = [];
  if (typeof lineText !== 'string' || !lineText.includes('"')) return ranges;

  const n = lineText.length;
  let i = 0;

  while (i < n) {
    const ch = lineText[i];
    if (isJBas && ch === "'") break;
    if ((ch === 'R' || ch === 'r') && i + 3 <= n && lineText.slice(i, i + 3).toUpperCase() === 'REM') {
      const prev = i > 0 ? lineText[i - 1] : ' ';
      const next = i + 3 < n ? lineText[i + 3] : ' ';
      if (!/[A-Za-z0-9_]/.test(prev) && !/[A-Za-z0-9_]/.test(next)) break;
    }

    if (ch === '"') {
      const strStart = i + 1;
      let j = strStart;
      while (j < n) {
        if (lineText[j] === '\\' && j + 1 < n && (lineText[j + 1] === '"' || lineText[j + 1] === '\\')) {
          j += 2;
          continue;
        }
        if (lineText[j] === '"') {
          if (j + 1 < n && lineText[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      ranges.push({ strStart, strEnd: j });
      i = j < n ? j + 1 : n;
      continue;
    }
    i++;
  }

  return ranges;
}

function attrsEqual(a, b) {
  for (const k of ATTR_KEYS) {
    const va = (a && a[k] !== undefined) ? a[k] : null;
    const vb = (b && b[k] !== undefined) ? b[k] : null;
    if (va !== vb) return false;
  }
  return true;
}

function hasAnyAttr(attrs) {
  if (!attrs) return false;
  for (const k of ATTR_KEYS) {
    if (attrs[k] !== undefined && attrs[k] !== null) return true;
  }
  return false;
}

function cleanAttrs(attrs) {
  const out = {};
  for (const k of ATTR_KEYS) {
    if (attrs[k] !== undefined && attrs[k] !== null) {
      out[k] = attrs[k];
    }
  }
  return out;
}

/**
 * Normalizes a list of per-column attribute cells into minimal sorted contiguous runs.
 * @param {Map<number, Object>} cellMap
 * @returns {Array<{ start: number, end: number, paper?: number, ink?: number, bright?: number, flash?: number, inverse?: number }>}
 */
function cellMapToRuns(cellMap) {
  const cols = Array.from(cellMap.keys()).sort((a, b) => a - b);
  const runs = [];

  for (const col of cols) {
    const attrs = cleanAttrs(cellMap.get(col));
    if (!hasAnyAttr(attrs)) continue;

    const last = runs[runs.length - 1];
    if (last && last.end === col && attrsEqual(last, attrs)) {
      last.end = col + 1;
    } else {
      runs.push({ start: col, end: col + 1, ...attrs });
    }
  }
  return runs;
}

/**
 * Applies an attribute (or CLEAR) to [startCol, endCol) on a line's existing runs,
 * merging overlapping attributes (e.g. setting PAPER 5 while preserving existing INK 2).
 *
 * @param {Array<Object>} existingRuns
 * @param {number} startCol
 * @param {number} endCol
 * @param {'PAPER'|'INK'|'BRIGHT'|'FLASH'|'INVERSE'|'CLEAR'} attrType
 * @param {number} attrValue
 * @returns {Array<Object>}
 */
function applyColorToRuns(existingRuns, startCol, endCol, attrType, attrValue) {
  const cellMap = new Map();
  for (const run of existingRuns || []) {
    const base = cleanAttrs(run);
    for (let c = run.start; c < run.end; c++) {
      cellMap.set(c, { ...base });
    }
  }

  const attrUpper = String(attrType).toUpperCase();
  const attrKey = attrUpper.toLowerCase();

  for (let c = startCol; c < endCol; c++) {
    if (attrUpper === 'CLEAR') {
      cellMap.delete(c);
    } else {
      const cell = cellMap.get(c) || {};
      // Value 8 (transparent) for PAPER/INK/BRIGHT/FLASH clears that specific attribute
      if ((attrKey === 'paper' || attrKey === 'ink' || attrKey === 'bright' || attrKey === 'flash') && attrValue === 8) {
        delete cell[attrKey];
      } else if ((attrKey === 'inverse' || attrKey === 'udg') && attrValue === 0) {
        delete cell[attrKey];
      } else {
        cell[attrKey] = attrValue;
      }

      if (hasAnyAttr(cell)) {
        cellMap.set(c, cell);
      } else {
        cellMap.delete(c);
      }
    }
  }

  return cellMapToRuns(cellMap);
}

/**
 * Updates a file's line-indexed color map when text is inserted/deleted in the editor,
 * keeping all painted character positions synchronized.
 *
 * @param {Record<string, Array<Object>>} linesMap
 * @param {number} startLine
 * @param {number} startCol
 * @param {number} endLine
 * @param {number} endCol
 * @param {string} insertedText
 * @returns {Record<string, Array<Object>>}
 */
function shiftColorMapForChange(linesMap, startLine, startCol, endLine, endCol, insertedText) {
  if (!linesMap || Object.keys(linesMap).length === 0) return {};

  const insertedLines = insertedText.split(/\r?\n/);
  const newLinesAdded = insertedLines.length - 1;
  const oldLinesRemoved = endLine - startLine;
  const lineDelta = newLinesAdded - oldLinesRemoved;
  const lastInsertedLen = insertedLines[insertedLines.length - 1].length;

  const nextMap = {};

  const addRuns = (lineIdx, runs) => {
    if (!runs || runs.length === 0) return;
    const key = String(lineIdx);
    const existing = nextMap[key] || [];
    const cellMap = new Map();
    for (const r of [...existing, ...runs]) {
      const base = cleanAttrs(r);
      for (let c = r.start; c < r.end; c++) {
        if (c >= 0) cellMap.set(c, { ...base });
      }
    }
    const merged = cellMapToRuns(cellMap);
    if (merged.length > 0) {
      nextMap[key] = merged;
    }
  };

  for (const [key, runs] of Object.entries(linesMap)) {
    const lineIdx = parseInt(key, 10);
    if (isNaN(lineIdx) || !Array.isArray(runs) || runs.length === 0) continue;

    // 1. Lines strictly before the edit: unchanged
    if (lineIdx < startLine) {
      addRuns(lineIdx, runs);
      continue;
    }

    // 2. Lines strictly after the edit: shift line index by lineDelta
    if (lineIdx > endLine) {
      addRuns(lineIdx + lineDelta, runs);
      continue;
    }

    // 3. Lines strictly inside a multi-line deletion: removed
    if (lineIdx > startLine && lineIdx < endLine) {
      continue;
    }

    // 4. Single-line edit (startLine === endLine && lineIdx === startLine)
    if (startLine === endLine && lineIdx === startLine) {
      const beforeRuns = [];
      const afterRuns = [];

      for (const r of runs) {
        const base = cleanAttrs(r);
        // Segment strictly before edit start
        if (r.start < startCol) {
          beforeRuns.push({ start: r.start, end: Math.min(r.end, startCol), ...base });
        }
        // Segment strictly after edit end
        if (r.end > endCol) {
          const tailStart = Math.max(r.start, endCol);
          if (newLinesAdded === 0) {
            const colDelta = lastInsertedLen - (endCol - startCol);
            afterRuns.push({ start: tailStart + colDelta, end: r.end + colDelta, ...base });
          } else {
            const offsetFromEnd = tailStart - endCol;
            const len = r.end - tailStart;
            afterRuns.push({ start: lastInsertedLen + offsetFromEnd, end: lastInsertedLen + offsetFromEnd + len, ...base });
          }
        }
      }

      addRuns(startLine, beforeRuns);
      if (newLinesAdded === 0) {
        addRuns(startLine, afterRuns);
      } else {
        addRuns(startLine + newLinesAdded, afterRuns);
      }
      continue;
    }

    // 5. Multi-line edit: first affected line (keep prefix before startCol)
    if (lineIdx === startLine) {
      const beforeRuns = [];
      for (const r of runs) {
        if (r.start < startCol) {
          beforeRuns.push({ start: r.start, end: Math.min(r.end, startCol), ...cleanAttrs(r) });
        }
      }
      addRuns(startLine, beforeRuns);
      continue;
    }

    // 6. Multi-line edit: last affected line (keep suffix after endCol, moved to startLine + newLinesAdded)
    if (lineIdx === endLine) {
      const afterRuns = [];
      const baseCol = newLinesAdded === 0 ? startCol + lastInsertedLen : lastInsertedLen;
      for (const r of runs) {
        if (r.end > endCol) {
          const tailStart = Math.max(r.start, endCol);
          const offsetFromEnd = tailStart - endCol;
          const len = r.end - tailStart;
          afterRuns.push({ start: baseCol + offsetFromEnd, end: baseCol + offsetFromEnd + len, ...cleanAttrs(r) });
        }
      }
      addRuns(startLine + newLinesAdded, afterRuns);
    }
  }

  return nextMap;
}

/**
 * Injects {PAPER n}{INK n}{BRIGHT n}{FLASH n}{INVERSE n} bas2tap control codes into
 * the source text for all visually colored character runs, leaving any manual bas2tap
 * codes and uncolored lines 100% untouched.
 *
 * @param {string} sourceText
 * @param {Record<string, Array<Object>>} linesMap
 * @param {{ isJBas?: boolean }} [options]
 * @returns {string}
 */
function injectColorsIntoSource(sourceText, linesMap, options = {}) {
  if (!linesMap || Object.keys(linesMap).length === 0) {
    return sourceText;
  }

  const isJBas = !!options.isJBas;
  const eol = sourceText.includes('\r\n') ? '\r\n' : '\n';
  const lines = sourceText.split(/\r?\n/);

  for (const [key, runs] of Object.entries(linesMap)) {
    const lineIdx = parseInt(key, 10);
    if (isNaN(lineIdx) || lineIdx < 0 || lineIdx >= lines.length || !Array.isArray(runs) || runs.length === 0) {
      continue;
    }

    const lineText = lines[lineIdx];
    const stringRanges = findStringRangesOnLine(lineText, isJBas);
    if (stringRanges.length === 0) continue;

    // Build per-column lookup for this line
    const cellLookup = new Map();
    for (const r of runs) {
      const base = cleanAttrs(r);
      if (!hasAnyAttr(base)) continue;
      for (let c = r.start; c < r.end; c++) {
        cellLookup.set(c, base);
      }
    }
    if (cellLookup.size === 0) continue;

    let out = '';
    let cursor = 0;

    for (const { strStart, strEnd } of stringRanges) {
      // Append everything before string content (including opening quote)
      out += lineText.slice(cursor, strStart);

      const active = { paper: null, ink: null, bright: null, flash: null, inverse: null };

      for (let c = strStart; c < strEnd; c++) {
        const cell = cellLookup.get(c) || {};
        const target = {
          paper: cell.paper !== undefined ? cell.paper : null,
          ink: cell.ink !== undefined ? cell.ink : null,
          bright: cell.bright !== undefined ? cell.bright : null,
          flash: cell.flash !== undefined ? cell.flash : null,
          inverse: cell.inverse !== undefined ? cell.inverse : null
        };

        // Emit minimal delta control codes
        if (target.paper !== active.paper) {
          out += `{PAPER ${target.paper !== null ? target.paper : 8}}`;
          active.paper = target.paper;
        }
        if (target.ink !== active.ink) {
          out += `{INK ${target.ink !== null ? target.ink : 8}}`;
          active.ink = target.ink;
        }
        if (target.bright !== active.bright) {
          out += `{BRIGHT ${target.bright !== null ? target.bright : 8}}`;
          active.bright = target.bright;
        }
        if (target.flash !== active.flash) {
          out += `{FLASH ${target.flash !== null ? target.flash : 8}}`;
          active.flash = target.flash;
        }
        if (target.inverse !== active.inverse) {
          out += `{INVERSE ${target.inverse !== null ? target.inverse : 0}}`;
          active.inverse = target.inverse;
        }

        if (cell.udg === 1 && /^[A-Ua-u]$/.test(lineText[c])) {
          out += `{${lineText[c].toUpperCase()}}`;
        } else {
          out += lineText[c];
        }
      }

      cursor = strEnd;
    }

    out += lineText.slice(cursor);
    lines[lineIdx] = out;
  }

  return lines.join(eol);
}

const SPECTRUM_COLOR_ITEMS = [
  { label: '⬛ PAPER 0 — Black', attr: 'PAPER', value: 0, description: 'Alt+P 0' },
  { label: '🟦 PAPER 1 — Blue', attr: 'PAPER', value: 1, description: 'Alt+P 1' },
  { label: '🟥 PAPER 2 — Red', attr: 'PAPER', value: 2, description: 'Alt+P 2' },
  { label: '🟪 PAPER 3 — Magenta', attr: 'PAPER', value: 3, description: 'Alt+P 3' },
  { label: '🟩 PAPER 4 — Green', attr: 'PAPER', value: 4, description: 'Alt+P 4' },
  { label: '🩵 PAPER 5 — Cyan', attr: 'PAPER', value: 5, description: 'Alt+P 5' },
  { label: '🟨 PAPER 6 — Yellow', attr: 'PAPER', value: 6, description: 'Alt+P 6' },
  { label: '⬜ PAPER 7 — White', attr: 'PAPER', value: 7, description: 'Alt+P 7' },
  { label: '🔲 PAPER 8 — Clear PAPER', attr: 'PAPER', value: 8, description: 'Alt+P 8' },
  { label: '⬛ INK 0 — Black', attr: 'INK', value: 0, description: 'Alt+I 0' },
  { label: '🟦 INK 1 — Blue', attr: 'INK', value: 1, description: 'Alt+I 1' },
  { label: '🟥 INK 2 — Red', attr: 'INK', value: 2, description: 'Alt+I 2' },
  { label: '🟪 INK 3 — Magenta', attr: 'INK', value: 3, description: 'Alt+I 3' },
  { label: '🟩 INK 4 — Green', attr: 'INK', value: 4, description: 'Alt+I 4' },
  { label: '🩵 INK 5 — Cyan', attr: 'INK', value: 5, description: 'Alt+I 5' },
  { label: '🟨 INK 6 — Yellow', attr: 'INK', value: 6, description: 'Alt+I 6' },
  { label: '⬜ INK 7 — White', attr: 'INK', value: 7, description: 'Alt+I 7' },
  { label: '🔲 INK 8 — Clear INK', attr: 'INK', value: 8, description: 'Alt+I 8' },
  { label: '🌗 INK 9 — Contrast', attr: 'INK', value: 9, description: 'Alt+I 9' },
  { label: '✨ BRIGHT 1 — On', attr: 'BRIGHT', value: 1, description: 'Alt+B 1' },
  { label: '🌑 BRIGHT 0 — Off', attr: 'BRIGHT', value: 0, description: 'Alt+B 0' },
  { label: '⚡ FLASH 1 — On', attr: 'FLASH', value: 1, description: 'Alt+F 1' },
  { label: '⏹️ FLASH 0 — Off', attr: 'FLASH', value: 0, description: 'Alt+F 0' },
  { label: '🔄 INVERSE 1 — On', attr: 'INVERSE', value: 1, description: 'Alt+V 1' },
  { label: '⏹️ INVERSE 0 — Off', attr: 'INVERSE', value: 0, description: 'Alt+V 0' },
  { label: '🧹 Clear Visual Colors on Selection', attr: 'CLEAR', value: 0, description: 'Remove visual color overlay' }
];

/**
 * Extracts 8 UDG bytes (0..255) from a BASIC/JBAS line containing `DATA b0,b1,...,b7`.
 * Supports decimal and BIN literals. Returns null if fewer than 8 valid bytes are found.
 * @param {string} lineText
 * @returns {number[] | null}
 */
function parseUdgDataFromLine(lineText) {
  if (typeof lineText !== 'string') return null;
  const match = lineText.match(/\bDATA\s+([^:']+)/i);
  if (!match) return null;

  const rawItems = match[1].split(',').map(s => s.trim()).filter(Boolean);
  if (rawItems.length < 8) return null;

  const bytes = [];
  for (let i = 0; i < 8; i++) {
    const item = rawItems[i];
    let val = NaN;
    const binMatch = item.match(/^BIN\s+([01]+)$/i);
    if (binMatch) {
      val = parseInt(binMatch[1], 2);
    } else if (/^\d+$/.test(item)) {
      val = parseInt(item, 10);
    }
    if (isNaN(val) || val < 0 || val > 255) return null;
    bytes.push(val);
  }
  return bytes;
}

/**
 * Formats 8 UDG bytes as a `DATA b0,...,b7` statement.
 * If `existingLineText` already contains a `DATA ...` statement, replaces its byte list in-place
 * preserving indentation and line numbers.
 * @param {number[]} bytes
 * @param {string} [existingLineText]
 * @returns {string}
 */
function formatUdgDataLine(bytes, existingLineText = '') {
  const safeBytes = Array.from({ length: 8 }, (_, i) => {
    const v = Number(bytes && bytes[i]);
    return Number.isFinite(v) ? (Math.max(0, Math.min(255, Math.round(v)))) : 0;
  });
  const dataStmt = `DATA ${safeBytes.join(',')}`;

  if (typeof existingLineText === 'string' && /\bDATA\s+[^:']+/i.test(existingLineText)) {
    return existingLineText.replace(/\bDATA\s+[^:']+/i, dataStmt);
  }
  return dataStmt;
}

/**
 * Generates compact ZX Spectrum BASIC loader FOR/READ/POKE USR loop(s) and DATA lines
 * for all defined UDGs in a UDG map (`{ A: [b0..b7], B: [...], ... }`).
 * Groups consecutive UDG letters into single contiguous FOR loops (e.g. A..F -> FOR i = 0 TO 47).
 *
 * @param {Record<string, number[]>} udgMap
 * @returns {string}
 */
function generateUdgBasicCode(udgMap) {
  if (!udgMap || typeof udgMap !== 'object') return '';

  const letters = Object.keys(udgMap)
    .map(k => k.toUpperCase())
    .filter(k => /^[A-U]$/.test(k) && Array.isArray(udgMap[k]) && udgMap[k].length === 8)
    .sort();

  if (letters.length === 0) return '';

  // Group into contiguous alphabet ranges (e.g. A..F, H..J)
  const groups = [];
  for (const letter of letters) {
    const code = letter.charCodeAt(0);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup[lastGroup.length - 1].charCodeAt(0) + 1 === code) {
      lastGroup.push(letter);
    } else {
      groups.push([letter]);
    }
  }

  const loaderLines = [];
  for (const grp of groups) {
    const first = grp[0].toLowerCase();
    const maxIdx = grp.length * 8 - 1;
    loaderLines.push(`FOR i = 0 TO ${maxIdx}: READ b: POKE USR "${first}" + i, b: NEXT i`);
  }

  const dataLines = [];
  for (const letter of letters) {
    const chrCode = 144 + (letter.charCodeAt(0) - 65);
    dataLines.push(`REM UDG ${letter} (${chrCode})`);
    dataLines.push(formatUdgDataLine(udgMap[letter]));
  }

  return [...loaderLines, '', ...dataLines].join('\n');
}

/**
 * Builds the HTML for the ZX Spectrum Color Bar WebviewView (INK 4x2, PAPER 4x2, BRILLO, PARPADEO, Limpiar, UDG A..U + 8x8 UDG Pixel Editor).
 * @returns {string}
 */
function buildColorBarHtml() {
  const colorNames = ['Negro (0)', 'Azul (1)', 'Rojo (2)', 'Magenta (3)', 'Verde (4)', 'Cian (5)', 'Amarillo (6)', 'Blanco (7)'];
  const swatchesHtml = (group) =>
    SPECTRUM_PALETTE.normal
      .map(
        (hex, idx) =>
          `<button class="swatch" data-attr="${group}" data-val="${idx}" title="${group} ${idx} — ${colorNames[idx]}" style="background:${hex}"></button>`
      )
      .join('');

  const udgButtonsHtml = Array.from({ length: 21 }, (_, idx) => {
    const letter = String.fromCharCode(65 + idx);
    return `<button class="udg-btn" data-udg="${letter}" title="Insertar UDG ${letter} (CHR$ ${144 + idx})">${letter}</button>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 8px 12px;
      background: var(--vscode-panel-background, #1e1e1e);
      color: var(--vscode-foreground, #cccccc);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: 11px;
      user-select: none;
    }
    .toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      min-height: 38px;
    }
    .section {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .label {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.35px;
      color: var(--vscode-descriptionForeground, #b8b8b8);
      white-space: nowrap;
    }
    .divider {
      width: 1px;
      height: 28px;
      background: var(--vscode-panel-border, rgba(255, 255, 255, 0.14));
      flex-shrink: 0;
    }
    .swatch-grid {
      display: grid;
      grid-template-columns: repeat(4, 17px);
      grid-template-rows: repeat(2, 17px);
      gap: 4px;
    }
    .swatch {
      width: 17px;
      height: 17px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 3px;
      padding: 0;
      cursor: pointer;
      position: relative;
      transition: transform 0.08s ease, box-shadow 0.08s ease;
    }
    .swatch:hover {
      transform: scale(1.12);
      border-color: rgba(255, 255, 255, 0.85);
      z-index: 1;
    }
    .swatch.active {
      border: 1.5px solid #ffffff;
      box-shadow: 0 0 6px rgba(255, 255, 255, 0.85);
      z-index: 3;
    }
    select.zx-select {
      background: var(--vscode-dropdown-background, #252526);
      color: var(--vscode-dropdown-foreground, #f0f0f0);
      border: 1px solid var(--vscode-dropdown-border, #454545);
      border-radius: 4px;
      padding: 3px 22px 3px 8px;
      font-size: 11.5px;
      cursor: pointer;
      outline: none;
      min-width: 62px;
    }
    select.zx-select:focus {
      border-color: var(--vscode-focusBorder, #007fd4);
    }
    .btn-clear {
      background: transparent;
      color: var(--vscode-foreground, #cccccc);
      border: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.2));
      border-radius: 4px;
      padding: 4px 9px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-clear:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
      border-color: rgba(255, 255, 255, 0.4);
    }
    .udg-grid {
      display: grid;
      grid-template-columns: repeat(11, 20px);
      gap: 2px;
    }
    .udg-btn {
      width: 20px;
      height: 18px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 3px;
      background: var(--vscode-dropdown-background, #252526);
      color: var(--vscode-foreground, #e0e0e0);
      font-size: 12px;
      line-height: 16px;
      text-align: center;
      cursor: pointer;
    }
    .udg-btn:hover {
      background: var(--vscode-button-background, #0e639c);
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.5);
    }
    .btn-toggle-editor {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 4px;
      padding: 4px 9px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-toggle-editor:hover, .btn-toggle-editor.active {
      background: var(--vscode-button-background, #0e639c);
      color: #ffffff;
    }
    .udg-editor {
      display: none;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.14));
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
    }
    .udg-editor.open {
      display: flex;
    }
    .pixel-grid {
      display: grid;
      grid-template-columns: repeat(8, 18px);
      grid-template-rows: repeat(8, 18px);
      gap: 1px;
      background: #444;
      border: 1px solid #666;
      padding: 1px;
      cursor: crosshair;
    }
    .pixel {
      width: 18px;
      height: 18px;
      background: #111;
    }
    .pixel.on {
      background: #ffffff;
    }
    .udg-controls {
      display: flex;
      flex-direction: column;
      gap: 7px;
      min-width: 240px;
    }
    .udg-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .udg-preview-box {
      display: inline-grid;
      grid-template-columns: repeat(8, 3px);
      grid-template-rows: repeat(8, 3px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      padding: 2px;
      background: #000;
    }
    .udg-preview-px {
      width: 3px;
      height: 3px;
    }
    .udg-data-code {
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 11.5px;
      padding: 4px 7px;
      border-radius: 3px;
      background: var(--vscode-editor-background, #141414);
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: #9cdcfe;
      user-select: text;
    }
    .btn-primary {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="section">
      <span class="label">COLOR DE TINTA</span>
      <div class="swatch-grid" id="inkGrid">${swatchesHtml('INK')}</div>
    </div>
    <div class="divider"></div>
    <div class="section">
      <span class="label">COLOR DE PAPEL</span>
      <div class="swatch-grid" id="paperGrid">${swatchesHtml('PAPER')}</div>
    </div>
    <div class="divider"></div>
    <div class="section">
      <span class="label">BRILLO</span>
      <select class="zx-select" id="brightSelect" title="BRIGHT">
        <option value="0">Off</option>
        <option value="1">On</option>
      </select>
    </div>
    <div class="section">
      <span class="label">PARPADEO</span>
      <select class="zx-select" id="flashSelect" title="FLASH">
        <option value="0">Off</option>
        <option value="1">On</option>
      </select>
    </div>
    <div class="divider"></div>
    <button class="btn-clear" id="clearBtn" title="Quitar formato visual de la selección">Limpiar</button>
    <div class="divider"></div>
    <div class="section">
      <span class="label">UDG</span>
      <div class="udg-grid" id="udgGrid">${udgButtonsHtml}</div>
    </div>
    <button class="btn-toggle-editor" id="toggleUdgEditorBtn" title="Abrir/cerrar el editor visual de píxeles UDG 8×8">Editor 8×8</button>
  </div>

  <div class="udg-editor" id="udgEditor">
    <div class="pixel-grid" id="pixelGrid"></div>
    <div class="udg-controls">
      <div class="udg-row">
        <span class="label">UDG</span>
        <select class="zx-select" id="udgLetterSelect" style="min-width:54px;">
          ${Array.from({ length: 21 }, (_, i) => {
            const ch = String.fromCharCode(65 + i);
            return `<option value="${ch}">${ch} (${144 + i})</option>`;
          }).join('')}
        </select>
        <div class="udg-preview-box" id="udgPreviewBox" title="Vista previa 8×8"></div>
        <button class="btn-clear" id="loadFromLineBtn" title="Cargar los 8 bytes DATA de la línea actual del editor">Cargar línea</button>
      </div>
      <div class="udg-row">
        <button class="btn-clear" id="udgClearBtn">Limpiar</button>
        <button class="btn-clear" id="udgInvertBtn">Invertir</button>
        <button class="btn-clear" id="udgFlipHBtn" title="Espejo horizontal">↔</button>
        <button class="btn-clear" id="udgFlipVBtn" title="Espejo vertical">↕</button>
        <button class="btn-clear" id="udgRotateBtn" title="Rotar 90°">↻</button>
      </div>
      <div class="udg-data-code" id="udgDataOutput">DATA 0,0,0,0,0,0,0,0</div>
      <div class="udg-row">
        <button class="btn-primary" id="generateAllUdgBtn" title="Genera el bucle FOR/POKE USR y todos los DATA de los UDGs guardados en .zxudgs.json">Generar FOR + DATA</button>
        <button class="btn-clear" id="insertUdgDataBtn" title="Insertar DATA o actualizar el DATA de la línea actual">Insertar DATA</button>
        <button class="btn-clear" id="deleteUdgBtn" title="Eliminar este UDG del fichero .zxudgs.json">Borrar UDG</button>
      </div>
      <div class="label" id="udgSavedList" style="font-size:10.5px; opacity:0.85;">UDGs guardados: ninguno</div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const NORMAL = ${JSON.stringify(SPECTRUM_PALETTE.normal)};
    const BRIGHT = ${JSON.stringify(SPECTRUM_PALETTE.bright)};

    const brightSelect = document.getElementById('brightSelect');
    const flashSelect = document.getElementById('flashSelect');
    const clearBtn = document.getElementById('clearBtn');

    function updatePaletteColors(isBright) {
      const pal = isBright ? BRIGHT : NORMAL;
      document.querySelectorAll('.swatch').forEach(btn => {
        const idx = parseInt(btn.dataset.val, 10);
        btn.style.background = pal[idx];
      });
    }

    function applyVisualState(state) {
      const s = state || {};
      document.querySelectorAll('.swatch[data-attr="INK"]').forEach(btn => {
        btn.classList.toggle('active', String(s.ink) === btn.dataset.val);
      });
      document.querySelectorAll('.swatch[data-attr="PAPER"]').forEach(btn => {
        btn.classList.toggle('active', String(s.paper) === btn.dataset.val);
      });
      const isBright = s.bright === 1;
      brightSelect.value = isBright ? '1' : '0';
      flashSelect.value = s.flash === 1 ? '1' : '0';
      updatePaletteColors(isBright);
    }

    document.querySelectorAll('.swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        const attr = btn.dataset.attr;
        const value = parseInt(btn.dataset.val, 10);
        // Immediately highlight the clicked swatch with the thick white border
        document.querySelectorAll('.swatch[data-attr="' + attr + '"]').forEach(b => {
          b.classList.toggle('active', b === btn);
        });
        vscode.postMessage({ command: 'applyAttr', attr, value });
      });
    });

    brightSelect.addEventListener('change', () => {
      const value = parseInt(brightSelect.value, 10);
      updatePaletteColors(value === 1);
      vscode.postMessage({ command: 'applyAttr', attr: 'BRIGHT', value });
    });

    flashSelect.addEventListener('change', () => {
      const value = parseInt(flashSelect.value, 10);
      vscode.postMessage({ command: 'applyAttr', attr: 'FLASH', value });
    });

    clearBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'applyAttr', attr: 'CLEAR', value: 0 });
    });

    document.querySelectorAll('.udg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ command: 'insertUdg', letter: btn.dataset.udg });
      });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg && msg.command === 'syncState') {
        applyVisualState(msg.state);
      } else if (msg && msg.command === 'loadUdgBytes' && Array.isArray(msg.bytes) && msg.bytes.length === 8) {
        for (let r = 0; r < 8; r++) {
          udgRows[r] = msg.bytes[r] & 0xFF;
        }
        renderUdgGrid();
        saveCurrentUdg();
      } else if (msg && msg.command === 'syncUdgMap' && msg.udgMap && typeof msg.udgMap === 'object') {
        savedUdgMap = msg.udgMap;
        loadLetterIntoGrid(udgLetterSelect.value);
        renderSavedUdgSummary();
      }
    });

    // --- 8x8 UDG Pixel Editor ---
    const toggleUdgEditorBtn = document.getElementById('toggleUdgEditorBtn');
    const udgEditorEl = document.getElementById('udgEditor');
    const pixelGridEl = document.getElementById('pixelGrid');
    const udgPreviewBox = document.getElementById('udgPreviewBox');
    const udgDataOutput = document.getElementById('udgDataOutput');
    const udgLetterSelect = document.getElementById('udgLetterSelect');
    const udgSavedList = document.getElementById('udgSavedList');

    let savedUdgMap = {};
    let udgRows = [0, 0, 0, 0, 0, 0, 0, 0];
    let isDragging = false;
    let dragPaintValue = 1;

    function renderSavedUdgSummary() {
      const keys = Object.keys(savedUdgMap).sort();
      udgSavedList.textContent = keys.length > 0
        ? 'UDGs en fichero (.zxudgs.json): ' + keys.join(', ') + ' (' + (keys.length * 8) + ' bytes)'
        : 'UDGs en fichero (.zxudgs.json): ninguno (pinta para guardar)';
    }

    function loadLetterIntoGrid(letter) {
      const existing = savedUdgMap[letter];
      udgRows = Array.isArray(existing) && existing.length === 8
        ? existing.map(b => b & 0xFF)
        : [0, 0, 0, 0, 0, 0, 0, 0];
      renderUdgGrid();
    }

    function saveCurrentUdg() {
      const letter = udgLetterSelect.value;
      savedUdgMap[letter] = udgRows.slice();
      renderSavedUdgSummary();
      vscode.postMessage({ command: 'saveUdgEntry', letter, bytes: udgRows.slice() });
    }

    // Build 64 grid pixels & 64 preview pixels
    const gridCells = [];
    const previewCells = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const px = document.createElement('div');
        px.className = 'pixel';
        px.dataset.r = r;
        px.dataset.c = c;
        px.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const bit = 1 << (7 - c);
          dragPaintValue = (udgRows[r] & bit) ? 0 : 1;
          isDragging = true;
          setPixel(r, c, dragPaintValue);
        });
        px.addEventListener('mouseenter', () => {
          if (isDragging) {
            setPixel(r, c, dragPaintValue);
          }
        });
        pixelGridEl.appendChild(px);
        gridCells.push(px);

        const ppx = document.createElement('div');
        ppx.className = 'udg-preview-px';
        udgPreviewBox.appendChild(ppx);
        previewCells.push(ppx);
      }
    }
    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        saveCurrentUdg();
      }
    });

    function setPixel(r, c, val) {
      const bit = 1 << (7 - c);
      if (val) {
        udgRows[r] |= bit;
      } else {
        udgRows[r] &= (~bit & 0xFF);
      }
      renderUdgGrid();
    }

    function renderUdgGrid() {
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const on = !!(udgRows[r] & (1 << (7 - c)));
          const idx = r * 8 + c;
          gridCells[idx].classList.toggle('on', on);
          previewCells[idx].style.background = on ? '#ffffff' : '#000000';
        }
      }
      udgDataOutput.textContent = 'DATA ' + udgRows.join(',');
    }

    udgLetterSelect.addEventListener('change', () => {
      loadLetterIntoGrid(udgLetterSelect.value);
    });

    toggleUdgEditorBtn.addEventListener('click', () => {
      const isOpen = udgEditorEl.classList.toggle('open');
      toggleUdgEditorBtn.classList.toggle('active', isOpen);
      if (isOpen) {
        vscode.postMessage({ command: 'requestSyncUdgMap' });
      }
    });

    document.getElementById('loadFromLineBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'requestLoadUdgFromLine', notifyIfMissing: true });
    });

    document.getElementById('udgClearBtn').addEventListener('click', () => {
      udgRows = [0, 0, 0, 0, 0, 0, 0, 0];
      renderUdgGrid();
      saveCurrentUdg();
    });

    document.getElementById('udgInvertBtn').addEventListener('click', () => {
      udgRows = udgRows.map(b => (~b) & 0xFF);
      renderUdgGrid();
      saveCurrentUdg();
    });

    document.getElementById('udgFlipHBtn').addEventListener('click', () => {
      udgRows = udgRows.map(b => {
        let rev = 0;
        for (let i = 0; i < 8; i++) {
          if (b & (1 << i)) rev |= (1 << (7 - i));
        }
        return rev;
      });
      renderUdgGrid();
      saveCurrentUdg();
    });

    document.getElementById('udgFlipVBtn').addEventListener('click', () => {
      udgRows = udgRows.slice().reverse();
      renderUdgGrid();
      saveCurrentUdg();
    });

    document.getElementById('udgRotateBtn').addEventListener('click', () => {
      const next = [0, 0, 0, 0, 0, 0, 0, 0];
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (udgRows[r] & (1 << (7 - c))) {
            next[c] |= (1 << r);
          }
        }
      }
      udgRows = next;
      renderUdgGrid();
      saveCurrentUdg();
    });

    document.getElementById('generateAllUdgBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'generateAllUdgsCode' });
    });

    document.getElementById('insertUdgDataBtn').addEventListener('click', () => {
      vscode.postMessage({
        command: 'insertUdgData',
        letter: udgLetterSelect.value,
        bytes: udgRows.slice(),
        withLoader: false
      });
    });

    document.getElementById('deleteUdgBtn').addEventListener('click', () => {
      const letter = udgLetterSelect.value;
      delete savedUdgMap[letter];
      udgRows = [0, 0, 0, 0, 0, 0, 0, 0];
      renderUdgGrid();
      renderSavedUdgSummary();
      vscode.postMessage({ command: 'deleteUdgEntry', letter });
    });

    renderUdgGrid();
    renderSavedUdgSummary();
  </script>
</body>
</html>`;
}

/**
 * VS Code Controller for Visual Character Color Layer.
 * Renders only user-applied visual colors (never touches manual bas2tap {PAPER n} codes)
 * and injects them into compiled output at build/run/transpile time.
 */
class ColorPreviewController {
  constructor(vscode, context) {
    this.vscode = vscode;
    this.context = context;
    this.disposables = [];
    this.colorDecorationTypes = new Map(); // styleKey -> TextEditorDecorationType
    this.fileColorMaps = new Map(); // doc.uri.toString() -> Record<string, Array<Object>>
    this.fileSidecarMtimes = new Map(); // doc.uri.toString() -> number
    this.fileUdgMaps = new Map(); // doc.uri.toString() -> Record<string, number[]>
    this.statusBarItem = null;
    this.colorBarView = null;
    this.lastActiveEditor = null;
    this.flashPhase = false;
    this.flashTimer = null;
  }

  init() {
    this.statusBarItem = this.vscode.window.createStatusBarItem(
      this.vscode.StatusBarAlignment.Right,
      98
    );
    this.statusBarItem.command = 'sinclairBasic.openColorBar';
    this.statusBarItem.text = '$(symbol-color) ZX Colors';
    this.statusBarItem.tooltip = 'Open ZX Spectrum Color Bar (INK, PAPER, BRIGHT, FLASH) for painting strings';
    this.disposables.push(this.statusBarItem);

    // Register WebviewViewProvider for the sleek ZX Spectrum Color Bar
    if (typeof this.vscode.window.registerWebviewViewProvider === 'function') {
      this.disposables.push(
        this.vscode.window.registerWebviewViewProvider('sinclairBasic.colorBarView', {
          resolveWebviewView: (webviewView) => {
            this.colorBarView = webviewView;
            webviewView.webview.options = { enableScripts: true };
            webviewView.webview.html = buildColorBarHtml();

            webviewView.webview.onDidReceiveMessage(msg => {
              if (msg && msg.command === 'applyAttr') {
                this.applyAttributeCommand({ attr: msg.attr, value: msg.value });
              } else if (msg && msg.command === 'insertUdg' && typeof msg.letter === 'string') {
                this.insertUdgCommand(msg.letter);
              } else if (msg && msg.command === 'insertText' && typeof msg.text === 'string') {
                this.insertTextCommand(msg.text);
              } else if (msg && msg.command === 'requestLoadUdgFromLine') {
                this.loadUdgFromActiveLine(!!msg.notifyIfMissing);
              } else if (msg && msg.command === 'requestSyncUdgMap') {
                this.syncUdgMapToBar(this.getTargetEditor());
              } else if (msg && msg.command === 'saveUdgEntry' && typeof msg.letter === 'string' && Array.isArray(msg.bytes)) {
                this.saveUdgEntryCommand(msg.letter, msg.bytes);
              } else if (msg && msg.command === 'deleteUdgEntry' && typeof msg.letter === 'string') {
                this.deleteUdgEntryCommand(msg.letter);
              } else if (msg && msg.command === 'generateAllUdgsCode') {
                this.generateAllUdgsCodeCommand();
              } else if (msg && msg.command === 'insertUdgData' && Array.isArray(msg.bytes)) {
                this.insertUdgDataCommand(msg.letter, msg.bytes, !!msg.withLoader);
              }
            });

            webviewView.onDidDispose(() => {
              if (this.colorBarView === webviewView) {
                this.colorBarView = null;
              }
            });

            const targetEd = this.getTargetEditor();
            this.syncColorBarToEditor(targetEd);
            this.syncUdgMapToBar(targetEd);
          }
        })
      );
    }

    this.disposables.push(
      this.vscode.commands.registerCommand('sinclairBasic.toggleColorPreview', () => this.toggleEnabled()),
      this.vscode.commands.registerCommand('sinclairBasic.openColorBar', () => {
        this.vscode.commands.executeCommand('sinclairBasic.colorBarView.focus');
      }),
      this.vscode.commands.registerCommand('sinclairBasic.applySpectrumColor', () => this.promptAndApplyColor()),
      this.vscode.commands.registerCommand('sinclairBasic.applySpectrumAttribute', (args) => this.applyAttributeCommand(args)),
      this.vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && this.isSinclairDoc(editor.document)) {
          this.lastActiveEditor = editor;
          this.updateEditor(editor);
          this.syncColorBarToEditor(editor);
          this.syncUdgMapToBar(editor);
        }
        this.updateStatusBar(editor);
      }),
      this.vscode.window.onDidChangeTextEditorSelection(e => {
        if (this.isSinclairDoc(e.textEditor.document)) {
          this.lastActiveEditor = e.textEditor;
          this.syncColorBarToEditor(e.textEditor);
        }
      }),
      this.vscode.workspace.onDidOpenTextDocument(doc => {
        if (this.isSinclairDoc(doc)) {
          this.loadColorMapForDoc(doc);
        }
      }),
      this.vscode.workspace.onDidChangeTextDocument(e => {
        if (!this.isSinclairDoc(e.document)) return;
        if (!e.contentChanges || e.contentChanges.length === 0) return;
        const uriKey = e.document.uri.toString();
        let linesMap = this.loadColorMapForDoc(e.document);
        if (linesMap && Object.keys(linesMap).length > 0) {
          // Sort simultaneous VS Code contentChanges bottom-to-top so earlier edits
          // do not invalidate line/column offsets of later edits in the same event.
          const sortedChanges = [...e.contentChanges].sort((a, b) => {
            if (b.range.start.line !== a.range.start.line) {
              return b.range.start.line - a.range.start.line;
            }
            return b.range.start.character - a.range.start.character;
          });
          for (const change of sortedChanges) {
            linesMap = shiftColorMapForChange(
              linesMap,
              change.range.start.line,
              change.range.start.character,
              change.range.end.line,
              change.range.end.character,
              change.text
            );
          }
          this.fileColorMaps.set(uriKey, linesMap);
          this.saveColorMapForDoc(e.document, linesMap);
          const visibleEditors = this.vscode.window.visibleTextEditors || [];
          for (const ed of visibleEditors) {
            if (ed.document === e.document) {
              this.updateEditor(ed);
            }
          }
        }
      }),
      this.vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('sinclairBasic.colorPreview')) {
          this.refreshAllVisibleEditors();
        }
      })
    );

    this.refreshAllVisibleEditors();
  }

  isSinclairDoc(doc) {
    if (!doc) return false;
    return (
      doc.languageId === 'sinclair-basic' ||
      doc.languageId === 'jbas' ||
      doc.fileName.endsWith('.bas') ||
      doc.fileName.endsWith('.jbas')
    );
  }

  isEnabled() {
    const config = this.vscode.workspace.getConfiguration('sinclairBasic');
    return config.get('colorPreview.enabled', true);
  }

  async toggleEnabled() {
    const config = this.vscode.workspace.getConfiguration('sinclairBasic');
    const next = !this.isEnabled();
    try {
      await config.update('colorPreview.enabled', next, this.vscode.ConfigurationTarget.Global);
    } catch {
      // Ignore during hot-install
    }
    this.refreshAllVisibleEditors();
    this.vscode.window.showInformationMessage(
      `Sinclair BASIC Visual Color Overlay: ${next ? 'ON' : 'OFF'}`
    );
  }

  getSidecarPath(doc) {
    if (!doc || !doc.uri || doc.uri.scheme !== 'file' || !doc.fileName) return null;
    return `${doc.fileName}.zxcolors.json`;
  }

  getStateKey(doc) {
    return `zxcolors:${doc.uri.toString()}`;
  }

  loadColorMapForDoc(doc) {
    if (!doc) return {};
    const uriKey = doc.uri.toString();
    const sidecarPath = this.getSidecarPath(doc);

    // Check if sidecar file on disk was created or modified externally
    if (fs && sidecarPath) {
      let diskMtime = null;
      try {
        if (fs.existsSync(sidecarPath)) {
          diskMtime = fs.statSync(sidecarPath).mtimeMs;
        }
      } catch {
        diskMtime = null;
      }

      if (this.fileColorMaps.has(uriKey) && this.fileSidecarMtimes.get(uriKey) === diskMtime) {
        return this.fileColorMaps.get(uriKey);
      }

      let linesMap = {};
      if (diskMtime !== null) {
        try {
          const parsed = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
          if (parsed && parsed.lines && typeof parsed.lines === 'object') {
            linesMap = parsed.lines;
          }
        } catch {
          linesMap = {};
        }
      }
      this.fileColorMaps.set(uriKey, linesMap);
      this.fileSidecarMtimes.set(uriKey, diskMtime);
      return linesMap;
    }

    if (this.fileColorMaps.has(uriKey)) {
      return this.fileColorMaps.get(uriKey);
    }

    let linesMap = {};
    if (this.context && this.context.workspaceState) {
      const saved = this.context.workspaceState.get(this.getStateKey(doc));
      if (saved && typeof saved === 'object') {
        linesMap = saved;
      }
    }

    this.fileColorMaps.set(uriKey, linesMap);
    return linesMap;
  }

  saveColorMapForDoc(doc, linesMap) {
    if (!doc) return;
    const uriKey = doc.uri.toString();
    const isEmpty = !linesMap || Object.keys(linesMap).length === 0;
    const sidecarPath = this.getSidecarPath(doc);

    if (fs && sidecarPath) {
      try {
        if (isEmpty) {
          if (fs.existsSync(sidecarPath)) {
            fs.unlinkSync(sidecarPath);
          }
          this.fileSidecarMtimes.set(uriKey, null);
        } else {
          fs.writeFileSync(sidecarPath, JSON.stringify({ version: 1, lines: linesMap }, null, 2), 'utf-8');
          this.fileSidecarMtimes.set(uriKey, fs.statSync(sidecarPath).mtimeMs);
        }
      } catch {
        // Ignore filesystem errors
      }
    }

    if (this.context && this.context.workspaceState) {
      this.context.workspaceState.update(this.getStateKey(doc), isEmpty ? undefined : linesMap);
    }
  }

  /**
   * Returns the document's source text with any visually painted character colors
   * automatically translated to {PAPER n}{INK n}... bas2tap control codes.
   * If no visual colors exist for this document, returns doc.getText() unchanged.
   *
   * @param {import('vscode').TextDocument} doc
   * @returns {string}
   */
  resolveSourceWithColors(doc) {
    if (!doc) return '';
    const sourceText = doc.getText();
    const linesMap = this.loadColorMapForDoc(doc);
    if (!linesMap || Object.keys(linesMap).length === 0) {
      return sourceText;
    }
    const isJBas = doc.languageId === 'jbas' || doc.fileName.endsWith('.jbas');
    return injectColorsIntoSource(sourceText, linesMap, { isJBas });
  }

  async promptAndApplyColor() {
    const editor = this.vscode.window.activeTextEditor;
    if (!editor || !this.isSinclairDoc(editor.document)) {
      this.vscode.window.showInformationMessage('Open a Sinclair BASIC (.bas or .jbas) file first.');
      return;
    }

    const picked = await this.vscode.window.showQuickPick(SPECTRUM_COLOR_ITEMS, {
      placeHolder: 'Select ZX Spectrum PAPER, INK, BRIGHT, FLASH, or INVERSE color to paint on selection'
    });
    if (!picked) return;

    await this.applyAttributeCommand({ attr: picked.attr, value: picked.value });
  }

  getTargetEditor() {
    const active = this.vscode.window.activeTextEditor;
    if (active && this.isSinclairDoc(active.document)) {
      this.lastActiveEditor = active;
      return active;
    }
    if (this.lastActiveEditor && !this.lastActiveEditor.document.isClosed) {
      return this.lastActiveEditor;
    }
    return null;
  }

  syncColorBarToEditor(editor) {
    if (!this.colorBarView || !editor || !this.isSinclairDoc(editor.document)) return;
    const sel = editor.selection;
    if (!sel) return;

    const linesMap = this.loadColorMapForDoc(editor.document);
    const startLine = Math.min(sel.start.line, sel.end.line);
    const runs = linesMap[String(startLine)] || [];
    const sCol = sel.start.line === sel.end.line
      ? Math.min(sel.start.character, sel.end.character)
      : sel.start.character;
    const eCol = sel.start.line === sel.end.line
      ? Math.max(sel.start.character, sel.end.character)
      : sCol + 1;

    let match = null;
    if (eCol > sCol) {
      match = runs.find(r => r.end > sCol && r.start < eCol) || null;
    } else {
      match = runs.find(r => sCol >= r.start && sCol < r.end) ||
        runs.find(r => sCol > 0 && sCol - 1 >= r.start && sCol - 1 < r.end) ||
        null;
    }

    this.colorBarView.webview.postMessage({
      command: 'syncState',
      state: match ? cleanAttrs(match) : {}
    });
  }

  async applyAttributeCommand(args) {
    const editor = this.getTargetEditor();
    if (!editor || !this.isSinclairDoc(editor.document)) return;
    if (!args || !args.attr) return;

    const doc = editor.document;
    const isJBas = doc.languageId === 'jbas' || doc.fileName.endsWith('.jbas');
    const uriKey = doc.uri.toString();
    const linesMap = { ...this.loadColorMapForDoc(doc) };
    const selections = editor.selections && editor.selections.length > 0
      ? editor.selections
      : [editor.selection];

    let appliedCount = 0;

    for (const sel of selections) {
      const startLine = Math.min(sel.start.line, sel.end.line);
      const endLine = Math.max(sel.start.line, sel.end.line);

      for (let lineIdx = startLine; lineIdx <= endLine; lineIdx++) {
        const lineText = doc.lineAt(lineIdx).text;
        const stringRanges = findStringRangesOnLine(lineText, isJBas);
        if (stringRanges.length === 0) continue;

        let colStart = lineIdx === startLine ? sel.start.character : 0;
        let colEnd = lineIdx === endLine ? sel.end.character : lineText.length;

        // If cursor has empty selection, paint the single character under the cursor
        if (startLine === endLine && colStart === colEnd) {
          colEnd = colStart + 1;
        }

        // Apply only to the portion of selection inside string literals
        const lineKey = String(lineIdx);
        let runs = linesMap[lineKey] || [];

        for (const { strStart, strEnd } of stringRanges) {
          const s = Math.max(colStart, strStart);
          const e = Math.min(colEnd, strEnd);
          if (e > s) {
            runs = applyColorToRuns(runs, s, e, args.attr, args.value);
            appliedCount++;
          }
        }

        if (runs.length > 0) {
          linesMap[lineKey] = runs;
        } else {
          delete linesMap[lineKey];
        }
      }
    }

    if (appliedCount === 0) {
      this.vscode.window.showWarningMessage(
        'Select one or more characters inside a string literal ("...") to paint with ZX Spectrum colors.'
      );
      return;
    }

    this.fileColorMaps.set(uriKey, linesMap);
    this.saveColorMapForDoc(doc, linesMap);
    this.updateEditor(editor);
    this.syncColorBarToEditor(editor);
  }

  async insertUdgCommand(letter) {
    const editor = this.getTargetEditor();
    if (!editor || !this.isSinclairDoc(editor.document)) return;

    const cleanLetter = String(letter || '').toUpperCase();
    if (!/^[A-U]$/.test(cleanLetter)) return;

    const doc = editor.document;
    const selections = editor.selections && editor.selections.length > 0
      ? editor.selections
      : [editor.selection];

    // Record target start positions and inherited color attributes before editing
    const preMap = this.loadColorMapForDoc(doc);
    const targets = selections.map(sel => {
      const line = Math.min(sel.start.line, sel.end.line);
      const col = sel.start.line <= sel.end.line ? sel.start.character : sel.end.character;
      const preRuns = preMap[String(line)] || [];
      // Inherit PAPER/INK/BRIGHT/FLASH/INVERSE from replaced char or preceding char
      const inheritedRun =
        preRuns.find(r => col >= r.start && col < r.end) ||
        preRuns.find(r => col - 1 >= r.start && col - 1 < r.end) ||
        null;
      return { line, col, inherited: inheritedRun ? cleanAttrs(inheritedRun) : null };
    });

    await editor.edit(editBuilder => {
      for (const sel of selections) {
        if (sel.isEmpty) {
          editBuilder.insert(sel.active, cleanLetter);
        } else {
          editBuilder.replace(sel, cleanLetter);
        }
      }
    });

    // Tag inserted UDG letter(s) with inherited colors + udg: 1 in color map
    const uriKey = doc.uri.toString();
    const linesMap = { ...this.loadColorMapForDoc(doc) };
    for (const t of targets) {
      const lineKey = String(t.line);
      let runs = linesMap[lineKey] || [];
      if (t.inherited) {
        for (const k of ['paper', 'ink', 'bright', 'flash', 'inverse']) {
          if (t.inherited[k] !== undefined) {
            runs = applyColorToRuns(runs, t.col, t.col + 1, k.toUpperCase(), t.inherited[k]);
          }
        }
      }
      runs = applyColorToRuns(runs, t.col, t.col + 1, 'UDG', 1);
      linesMap[lineKey] = runs;
    }
    this.fileColorMaps.set(uriKey, linesMap);
    this.saveColorMapForDoc(doc, linesMap);
    this.updateEditor(editor);
    this.syncColorBarToEditor(editor);
  }

  async insertTextCommand(text) {
    const editor = this.getTargetEditor();
    if (!editor || !this.isSinclairDoc(editor.document)) return;

    const selections = editor.selections && editor.selections.length > 0
      ? editor.selections
      : [editor.selection];

    await editor.edit(editBuilder => {
      for (const sel of selections) {
        if (sel.isEmpty) {
          editBuilder.insert(sel.active, text);
        } else {
          editBuilder.replace(sel, text);
        }
      }
    });
  }

  getUdgSidecarPath(doc) {
    if (!doc || !doc.uri || doc.uri.scheme !== 'file' || !doc.fileName) return null;
    return `${doc.fileName}.zxudgs.json`;
  }

  loadUdgMapForDoc(doc) {
    if (!doc) return {};
    const uriKey = doc.uri.toString();
    const udgPath = this.getUdgSidecarPath(doc);
    let udgMap = {};

    if (fs && udgPath && fs.existsSync(udgPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(udgPath, 'utf-8'));
        if (parsed && parsed.udgs && typeof parsed.udgs === 'object') {
          udgMap = parsed.udgs;
        }
      } catch {
        udgMap = {};
      }
    } else if (this.fileUdgMaps.has(uriKey)) {
      udgMap = this.fileUdgMaps.get(uriKey);
    } else if (this.context && this.context.workspaceState) {
      const saved = this.context.workspaceState.get(`zxudgs:${uriKey}`);
      if (saved && typeof saved === 'object') {
        udgMap = saved;
      }
    }

    this.fileUdgMaps.set(uriKey, udgMap);
    return udgMap;
  }

  saveUdgMapForDoc(doc, udgMap) {
    if (!doc) return;
    const uriKey = doc.uri.toString();
    const isEmpty = !udgMap || Object.keys(udgMap).length === 0;
    const udgPath = this.getUdgSidecarPath(doc);

    this.fileUdgMaps.set(uriKey, isEmpty ? {} : udgMap);
    if (fs && udgPath) {
      try {
        if (isEmpty) {
          if (fs.existsSync(udgPath)) fs.unlinkSync(udgPath);
        } else {
          fs.writeFileSync(udgPath, JSON.stringify({ version: 1, udgs: udgMap }, null, 2), 'utf-8');
        }
      } catch {
        // Ignore
      }
    }
    if (this.context && this.context.workspaceState) {
      this.context.workspaceState.update(`zxudgs:${uriKey}`, isEmpty ? undefined : udgMap);
    }
  }

  syncUdgMapToBar(editor) {
    if (!this.colorBarView || !editor || !this.isSinclairDoc(editor.document)) return;
    const udgMap = this.loadUdgMapForDoc(editor.document);
    this.colorBarView.webview.postMessage({ command: 'syncUdgMap', udgMap });
  }

  saveUdgEntryCommand(letter, bytes) {
    const editor = this.getTargetEditor();
    if (!editor || !this.isSinclairDoc(editor.document)) return;
    const cleanLetter = String(letter || '').toUpperCase();
    if (!/^[A-U]$/.test(cleanLetter) || bytes.length !== 8) return;

    const udgMap = { ...this.loadUdgMapForDoc(editor.document) };
    udgMap[cleanLetter] = bytes.map(b => b & 0xFF);
    this.saveUdgMapForDoc(editor.document, udgMap);
  }

  deleteUdgEntryCommand(letter) {
    const editor = this.getTargetEditor();
    if (!editor || !this.isSinclairDoc(editor.document)) return;
    const cleanLetter = String(letter || '').toUpperCase();
    const udgMap = { ...this.loadUdgMapForDoc(editor.document) };
    delete udgMap[cleanLetter];
    this.saveUdgMapForDoc(editor.document, udgMap);
  }

  async generateAllUdgsCodeCommand() {
    const editor = this.getTargetEditor();
    if (!editor || !this.isSinclairDoc(editor.document)) return;

    const udgMap = this.loadUdgMapForDoc(editor.document);
    const code = generateUdgBasicCode(udgMap);
    if (!code) {
      this.vscode.window.showInformationMessage('No hay UDGs guardados en el fichero .zxudgs.json todavía. Dibuja al menos un UDG en la rejilla 8×8.');
      return;
    }

    await editor.edit(editBuilder => {
      if (editor.selection.isEmpty) {
        editBuilder.insert(editor.selection.active, code);
      } else {
        editBuilder.replace(editor.selection, code);
      }
    });
  }

  loadUdgFromActiveLine(notifyIfMissing = false) {
    const editor = this.getTargetEditor();
    if (!editor || !this.colorBarView) return;
    const lineText = editor.document.lineAt(editor.selection.active.line).text;
    const bytes = parseUdgDataFromLine(lineText);
    if (bytes) {
      this.colorBarView.webview.postMessage({ command: 'loadUdgBytes', bytes });
    } else if (notifyIfMissing) {
      this.vscode.window.showInformationMessage('Coloca el cursor sobre una línea DATA con 8 bytes (0..255) para cargarla en el editor 8×8.');
    }
  }

  async insertUdgDataCommand(letter, bytes, withLoader = false) {
    const editor = this.getTargetEditor();
    if (!editor || !this.isSinclairDoc(editor.document)) return;

    const cleanLetter = String(letter || 'A').toUpperCase();
    const doc = editor.document;
    const activeLine = editor.selection.active.line;
    const lineObj = doc.lineAt(activeLine);
    const lineText = lineObj.text;

    if (!withLoader && /\bDATA\s+[^:']+/i.test(lineText)) {
      const updated = formatUdgDataLine(bytes, lineText);
      await editor.edit(editBuilder => {
        editBuilder.replace(lineObj.range, updated);
      });
      return;
    }

    const indent = (lineText.match(/^(\s*)/) || ['', ''])[1];
    const dataLine = formatUdgDataLine(bytes);
    const snippet = withLoader
      ? `FOR i = 0 TO 7: READ b: POKE USR "${cleanLetter.toLowerCase()}" + i, b: NEXT i\n${indent}${dataLine}`
      : dataLine;

    await editor.edit(editBuilder => {
      if (editor.selection.isEmpty) {
        editBuilder.insert(editor.selection.active, snippet);
      } else {
        editBuilder.replace(editor.selection, snippet);
      }
    });
  }

  updateStatusBar(editor) {
    if (!this.statusBarItem) return;
    const active = editor || this.vscode.window.activeTextEditor;
    if (!active || !this.isSinclairDoc(active.document)) {
      this.statusBarItem.hide();
      return;
    }
    this.statusBarItem.show();
  }

  refreshAllVisibleEditors() {
    const editors = this.vscode.window.visibleTextEditors || [];
    for (const editor of editors) {
      if (this.isSinclairDoc(editor.document)) {
        this.updateEditor(editor);
      }
    }
    this.updateStatusBar(this.vscode.window.activeTextEditor);
  }

  getOrCreateColorDecorationType(resolved) {
    let dec = this.colorDecorationTypes.get(resolved.styleKey);
    if (!dec) {
      const opts = {
        rangeBehavior: this.vscode.DecorationRangeBehavior.ClosedClosed
      };
      if (resolved.backgroundColor) {
        opts.backgroundColor = resolved.backgroundColor;
      }
      if (resolved.color) {
        opts.color = resolved.color;
      }
      if (resolved.udg) {
        opts.fontWeight = 'bold';
        opts.textDecoration = 'underline dotted';
      }
      dec = this.vscode.window.createTextEditorDecorationType(opts);
      this.colorDecorationTypes.set(resolved.styleKey, dec);
    }
    return dec;
  }

  updateFlashTimer(hasFlashSpans) {
    if (hasFlashSpans) {
      if (!this.flashTimer) {
        // Authentic ZX Spectrum PAL FLASH rate: swaps INK/PAPER every 16 frames (320 ms)
        this.flashTimer = setInterval(() => {
          this.flashPhase = !this.flashPhase;
          const editors = this.vscode.window.visibleTextEditors || [];
          for (const ed of editors) {
            if (this.isSinclairDoc(ed.document)) {
              this.updateEditor(ed);
            }
          }
        }, 320);
      }
    } else if (this.flashTimer) {
      clearInterval(this.flashTimer);
      this.flashTimer = null;
      this.flashPhase = false;
    }
  }

  clearEditorDecorations(editor) {
    if (!editor) return;
    for (const dec of this.colorDecorationTypes.values()) {
      editor.setDecorations(dec, []);
    }
  }

  updateEditor(editor) {
    if (!editor || !this.isSinclairDoc(editor.document)) return;

    if (!this.isEnabled()) {
      this.clearEditorDecorations(editor);
      return;
    }

    const doc = editor.document;
    const linesMap = this.loadColorMapForDoc(doc);
    const colorRangesByKey = new Map(); // styleKey -> { resolved, ranges: Range[] }
    let hasFlashSpans = false;

    for (const [key, runs] of Object.entries(linesMap)) {
      const lineIdx = parseInt(key, 10);
      if (isNaN(lineIdx) || lineIdx < 0 || lineIdx >= doc.lineCount) continue;
      const lineLen = doc.lineAt(lineIdx).text.length;

      for (const run of runs) {
        const s = Math.max(0, Math.min(run.start, lineLen));
        const e = Math.max(s, Math.min(run.end, lineLen));
        if (e <= s) continue;

        if (run.flash === 1) hasFlashSpans = true;
        const resolved = resolveEffectiveColors(run, this.flashPhase);
        if (!resolved) continue;

        let bucket = colorRangesByKey.get(resolved.styleKey);
        if (!bucket) {
          bucket = { resolved, ranges: [] };
          colorRangesByKey.set(resolved.styleKey, bucket);
        }
        bucket.ranges.push(new this.vscode.Range(lineIdx, s, lineIdx, e));
      }
    }

    this.updateFlashTimer(hasFlashSpans);

    for (const [styleKey, dec] of this.colorDecorationTypes.entries()) {
      if (!colorRangesByKey.has(styleKey)) {
        editor.setDecorations(dec, []);
      }
    }

    for (const [, bucket] of colorRangesByKey.entries()) {
      const dec = this.getOrCreateColorDecorationType(bucket.resolved);
      editor.setDecorations(dec, bucket.ranges);
    }
  }

  dispose() {
    if (this.flashTimer) {
      clearInterval(this.flashTimer);
      this.flashTimer = null;
    }
    for (const dec of this.colorDecorationTypes.values()) {
      dec.dispose();
    }
    this.colorDecorationTypes.clear();
    this.fileColorMaps.clear();
    this.fileUdgMaps.clear();
    while (this.disposables.length > 0) {
      const d = this.disposables.pop();
      if (d && typeof d.dispose === 'function') {
        d.dispose();
      }
    }
  }
}

module.exports = {
  SPECTRUM_PALETTE,
  SPECTRUM_COLOR_ITEMS,
  parseUdgDataFromLine,
  formatUdgDataLine,
  generateUdgBasicCode,
  buildColorBarHtml,
  resolveEffectiveColors,
  findStringRangesOnLine,
  applyColorToRuns,
  shiftColorMapForChange,
  injectColorsIntoSource,
  ColorPreviewController
};
