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
