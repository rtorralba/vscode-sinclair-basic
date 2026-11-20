const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SPECTRUM_PALETTE,
  parseUdgDataFromLine,
  formatUdgDataLine,
  generateUdgBasicCode,
  buildColorBarHtml,
  resolveEffectiveColors,
  applyColorToRuns,
  shiftColorMapForChange,
  injectColorsIntoSource
} = require('../src/core/colorPreview.js');
const { tokenizeLine } = require('../src/core/tapGenerator.js');

test('applyColorToRuns merges overlapping PAPER and INK independently on character ranges', () => {
  // Paint PAPER 5 on cols 10..15
  let runs = applyColorToRuns([], 10, 15, 'PAPER', 5);
  assert.deepEqual(runs, [{ start: 10, end: 15, paper: 5 }]);

  // Paint INK 2 on cols 12..14 -> keeps PAPER 5 underneath!
  runs = applyColorToRuns(runs, 12, 14, 'INK', 2);
  assert.deepEqual(runs, [
    { start: 10, end: 12, paper: 5 },
    { start: 12, end: 14, paper: 5, ink: 2 },
    { start: 14, end: 15, paper: 5 }
  ]);

  // Clear cols 12..14
  runs = applyColorToRuns(runs, 12, 14, 'CLEAR', 0);
  assert.deepEqual(runs, [
    { start: 10, end: 12, paper: 5 },
    { start: 14, end: 15, paper: 5 }
  ]);
});

test('injectColorsIntoSource translates visual painted runs into exact {PAPER n}{INK n} codes without touching manual codes', () => {
  const source = [
    '10 PRINT "{PAPER 1}{INK 2}MANUAL"',
    '20 PRINT "   #####   "'
  ].join('\n');

  // Paint "#####" on line 1 (cols 13..18) with PAPER 5, INK 2
  const linesMap = {
    '1': [{ start: 13, end: 18, paper: 5, ink: 2 }]
  };

  const injected = injectColorsIntoSource(source, linesMap);
  const outLines = injected.split('\n');

  // Line 0 (manual bas2tap codes) MUST remain 100% untouched
  assert.equal(outLines[0], '10 PRINT "{PAPER 1}{INK 2}MANUAL"');

  // Line 1 gets minimal {PAPER 5}{INK 2} before ##### and resets {PAPER 8}{INK 8} after
  assert.equal(outLines[1], '20 PRINT "   {PAPER 5}{INK 2}#####{PAPER 8}{INK 8}   "');

  // Verify tapGenerator compiles it to the exact same bytes as manual {PAPER 5}{INK 2}
  const tokensInjected = tokenizeLine(outLines[1].slice(3));
  const tokensManual = tokenizeLine('PRINT "   {PAPER 5}{INK 2}#####{PAPER 8}{INK 8}   "');
  assert.deepEqual(tokensInjected, tokensManual);
});

test('shiftColorMapForChange keeps painted map positions synced when inserting/deleting lines and characters', () => {
  const initial = {
    '2': [{ start: 10, end: 15, paper: 4 }]
  };

  // Insert a new line above line 2 (at line 0) -> line 2 shifts to line 3
  const afterNewLine = shiftColorMapForChange(initial, 0, 0, 0, 0, 'REM header\n');
  assert.deepEqual(afterNewLine, {
    '3': [{ start: 10, end: 15, paper: 4 }]
  });

  // Insert 2 spaces before col 10 on line 3 -> cols shift to 12..17
  const afterSpaces = shiftColorMapForChange(afterNewLine, 3, 5, 3, 5, '  ');
  assert.deepEqual(afterSpaces, {
    '3': [{ start: 12, end: 17, paper: 4 }]
  });

  // Delete line 0..1 -> line 3 shifts back to line 2
  const afterDeleteLine = shiftColorMapForChange(afterSpaces, 0, 0, 1, 0, '');
  assert.deepEqual(afterDeleteLine, {
    '2': [{ start: 12, end: 17, paper: 4 }]
  });

  // Delete 9 comment lines above line 146 (e.g. lines 135..144) -> line 146 shifts to 137
  const maze = {
    '146': [{ start: 21, end: 38, paper: 0, ink: 7, udg: 1 }]
  };
  const afterDelete9 = shiftColorMapForChange(maze, 135, 0, 144, 0, '');
  assert.deepEqual(afterDelete9, {
    '137': [{ start: 21, end: 38, paper: 0, ink: 7, udg: 1 }]
  });
});

test('resolveEffectiveColors applies authentic Spectrum palette and contrast ink', () => {
  const dark = resolveEffectiveColors({ paper: 1 });
  assert.equal(dark.backgroundColor, SPECTRUM_PALETTE.normal[1]);
  assert.equal(dark.color, SPECTRUM_PALETTE.normal[7]);

  const brightYellow = resolveEffectiveColors({ paper: 6, ink: 2, bright: 1 });
  assert.equal(brightYellow.backgroundColor, SPECTRUM_PALETTE.bright[6]);
  assert.equal(brightYellow.color, SPECTRUM_PALETTE.bright[2]);
});

test('buildColorBarHtml renders INK 4x2, PAPER 4x2, BRILLO, PARPADEO, Limpiar, and UDG A..U controls', () => {
  const html = buildColorBarHtml();
  assert.ok(html.includes('COLOR DE TINTA'));
  assert.ok(html.includes('COLOR DE PAPEL'));
  assert.ok(html.includes('BRILLO'));
  assert.ok(html.includes('PARPADEO'));
  assert.ok(html.includes('data-attr="INK" data-val="7"'));
  assert.ok(html.includes('data-attr="PAPER" data-val="0"'));
  assert.ok(html.includes('data-udg="A"'));
  assert.ok(html.includes('data-udg="U"'));
});

test('injectColorsIntoSource translates udg-tagged A..U characters into {A}..{U} while leaving normal letters intact', () => {
  const source = '10 PRINT "A B"';
  const linesMap = {
    '0': [
      { start: 10, end: 11, paper: 0, ink: 7, udg: 1 },
      { start: 11, end: 12, paper: 1, ink: 7 },
      { start: 12, end: 13, paper: 0, ink: 7 }
    ]
  };
  const injected = injectColorsIntoSource(source, linesMap);
  assert.equal(injected, '10 PRINT "{PAPER 0}{INK 7}{A}{PAPER 1} {PAPER 0}B"');
});

test('parseUdgDataFromLine and formatUdgDataLine parse and update DATA lines in place', () => {
  const bytes = parseUdgDataFromLine('170 DATA 60,126,219,219,255,255,255,219');
  assert.deepEqual(bytes, [60, 126, 219, 219, 255, 255, 255, 219]);

  // Also supports BIN literals
  const binBytes = parseUdgDataFromLine('DATA BIN 00000000,0,0,BIN 00011000,24,0,0,0');
  assert.deepEqual(binBytes, [0, 0, 0, 24, 24, 0, 0, 0]);

  // Replaces DATA in place preserving line number
  const updated = formatUdgDataLine([0, 0, 0, 24, 24, 0, 0, 0], '170 DATA 60,126,219,219,255,255,255,219');
  assert.equal(updated, '170 DATA 0,0,0,24,24,0,0,0');

  // Fresh DATA line when no DATA exists
  assert.equal(formatUdgDataLine([1, 2, 3, 4, 5, 6, 7, 8]), 'DATA 1,2,3,4,5,6,7,8');
});

test('resolveEffectiveColors swaps INK and PAPER during FLASH inverted phase', () => {
  const normal = resolveEffectiveColors({ paper: 1, ink: 2, flash: 1 }, false);
  assert.equal(normal.backgroundColor, SPECTRUM_PALETTE.normal[1]);
  assert.equal(normal.color, SPECTRUM_PALETTE.normal[2]);

  const inverted = resolveEffectiveColors({ paper: 1, ink: 2, flash: 1 }, true);
  assert.equal(inverted.backgroundColor, SPECTRUM_PALETTE.normal[2]);
  assert.equal(inverted.color, SPECTRUM_PALETTE.normal[1]);
});

test('generateUdgBasicCode groups contiguous UDGs into single FOR loop and emits DATA lines', () => {
  const code = generateUdgBasicCode({
    A: [0, 0, 0, 24, 24, 0, 0, 0],
    B: [60, 126, 240, 224, 224, 240, 126, 60],
    F: [60, 126, 219, 219, 255, 255, 255, 219]
  });
  assert.ok(code.includes('FOR i = 0 TO 15: READ b: POKE USR "a" + i, b: NEXT i'));
  assert.ok(code.includes('FOR i = 0 TO 7: READ b: POKE USR "f" + i, b: NEXT i'));
  assert.ok(code.includes('REM UDG A (144)'));
  assert.ok(code.includes('DATA 0,0,0,24,24,0,0,0'));
  assert.ok(code.includes('REM UDG F (149)'));
  assert.ok(code.includes('DATA 60,126,219,219,255,255,255,219'));
});

