const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getCodeOutsideStringsAndRem,
  getBasFoldingRanges
} = require('../src/core/folding.js');

test('getCodeOutsideStringsAndRem strips strings and comments safely', () => {
  const line1 = '10 PRINT "GO SUB 500": GO SUB 600: REM GO SUB 700';
  const code1 = getCodeOutsideStringsAndRem(line1);
  assert.ok(!code1.includes('500'));
  assert.ok(code1.includes('600'));
  assert.ok(!code1.includes('700'));

  const line2 = '500 PRINT "PRESS RETURN": RETURN: REM RETURN AGAIN';
  const code2 = getCodeOutsideStringsAndRem(line2);
  assert.ok(!code2.includes('PRESS'));
  assert.ok(code2.includes('RETURN'));
  assert.ok(!code2.includes('AGAIN'));
});

test('getBasFoldingRanges detects subroutines from GO SUB and folds to RETURN', () => {
  const code = [
    '10 REM Main program',             // 0
    '20 BORDER 0: PAPER 0: INK 7: CLS', // 1
    '30 GO SUB 500',                    // 2
    '40 PRINT "Returned from 500"',     // 3
    '50 GOSUB 600',                     // 4
    '60 STOP',                          // 5
    '500 REM Subroutine 1: Init player',// 6
    '510 LET px = 10: LET py = 10',     // 7
    '520 RETURN',                       // 8
    '600 REM Subroutine 2: Draw sprite',// 9
    '610 PLOT px, py',                  // 10
    '620 DRAW 5, 5',                    // 11
    '630 RETURN'                        // 12
  ];

  const ranges = getBasFoldingRanges(code);
  assert.equal(ranges.length, 2);

  // Subroutine 1: line 500 (index 6) to line 520 (index 8)
  assert.equal(ranges[0].start, 6);
  assert.equal(ranges[0].end, 8);

  // Subroutine 2: line 600 (index 9) to line 630 (index 12)
  assert.equal(ranges[1].start, 9);
  assert.equal(ranges[1].end, 12);
});

test('getBasFoldingRanges handles multiple RETURNs within a subroutine', () => {
  const code = [
    '10 GO SUB 500',
    '20 STOP',
    '500 REM Subroutine with multiple returns',
    '510 IF dead THEN RETURN',
    '520 PLOT 10, 10',
    '530 RETURN'
  ];

  const ranges = getBasFoldingRanges(code);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start, 2); // line 500
  assert.equal(ranges[0].end, 5);   // line 530 (last return)
});

test('getBasFoldingRanges handles multi-target jumps like ON x GOSUB', () => {
  const code = [
    '10 ON x GOSUB 100, 200',
    '20 STOP',
    '100 REM Sub 1',
    '110 BEEP 1, 0',
    '120 RETURN',
    '200 REM Sub 2',
    '210 BEEP 2, 5',
    '220 RETURN'
  ];

  const ranges = getBasFoldingRanges(code);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].start, 2);
  assert.equal(ranges[0].end, 4);
  assert.equal(ranges[1].start, 5);
  assert.equal(ranges[1].end, 7);
});

test('getBasFoldingRanges protects against false positives in strings, REM, and variables', () => {
  const code = [
    '10 PRINT "GO SUB 500"',
    '20 REM GO SUB 600',
    '30 LET returnCode = 0',
    '40 STOP',
    '500 REM Never called',
    '510 RETURN',
    '600 REM Also never called',
    '610 RETURN'
  ];

  const ranges = getBasFoldingRanges(code);
  assert.equal(ranges.length, 0);
});

test('getBasFoldingRanges detects routines with REM SUB headers and loops', () => {
  const code = [
    '10 GO TO 100',
    '20 REM SUB Main Loop',        // 1
    '30 LET x = x + 1',            // 2
    '40 GO TO 20',                 // 3
    '100 REM SUB Init Game',       // 4
    '110 FOR i = 1 TO 10',         // 5
    '120 PRINT i',                 // 6
    '130 NEXT i',                  // 7
    '140 RETURN'                   // 8
  ];

  const ranges = getBasFoldingRanges(code);
  // Expect 3 ranges:
  // 1) Main loop: index 1 to 3
  // 2) Init Game: index 4 to 8
  // 3) FOR loop: index 5 to 7
  assert.equal(ranges.length, 3);

  const mainLoop = ranges.find(r => r.start === 1);
  assert.ok(mainLoop);
  assert.equal(mainLoop.end, 3);

  const initGame = ranges.find(r => r.start === 4);
  assert.ok(initGame);
  assert.equal(initGame.end, 8);

  const forLoop = ranges.find(r => r.start === 5);
  assert.ok(forLoop);
  assert.equal(forLoop.end, 7);
});

test('getBasFoldingRanges correctly detects all subroutines in dino-basic.bas', () => {
  const fs = require('fs');
  const path = require('path');
  const dinoPath = 'C:/Users/rault/dev/basic/Dino/dino-basic.bas';

  if (!fs.existsSync(dinoPath)) {
    return; // Skip if external path doesn't exist in environment
  }

  const content = fs.readFileSync(dinoPath, 'utf8');
  const ranges = getBasFoldingRanges(content);

  // Must detect routines and loop in Dino
  assert.ok(ranges.length >= 14);

  // Line 20: REM SUB Bucle Principal (line index 1)
  const buclePrincipal = ranges.find(r => r.start === 1);
  assert.ok(buclePrincipal, 'Bucle Principal should fold');
  assert.equal(buclePrincipal.end, 23); // line 240: GO TO 20

  // Line 250: REM SUB Point (line index 24)
  const subPoint = ranges.find(r => r.start === 24);
  assert.ok(subPoint, 'Point subroutine should fold');
  assert.equal(subPoint.end, 26); // line 270: RETURN

  // Line 1130: REM SUB Menu (line index 112)
  const subMenu = ranges.find(r => r.start === 112);
  assert.ok(subMenu, 'Menu subroutine should fold');
  assert.equal(subMenu.end, 120); // line 1210: RETURN
});

