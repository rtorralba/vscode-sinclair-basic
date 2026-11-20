const test = require('node:test');
const assert = require('node:assert');
const {
  findBasJumpTargetAtPosition,
  findBasLineIndex,
  getBasDefinition,
  findJBasLabelAtPosition,
  findJBasLabelDefinition,
  getJBasDefinition
} = require('../src/core/definitions');

test('findBasJumpTargetAtPosition detects GO SUB and GOSUB target lines', () => {
  const line1 = '10 GO SUB 500';
  // '500' starts at index 10 and ends at index 13
  const target1 = findBasJumpTargetAtPosition(line1, 10);
  assert.ok(target1);
  assert.strictEqual(target1.targetLineNumber, 500);
  assert.strictEqual(target1.startCol, 10);
  assert.strictEqual(target1.endCol, 13);
  assert.strictEqual(target1.keyword.toUpperCase(), 'GO SUB');

  // Test middle of number
  const target1Mid = findBasJumpTargetAtPosition(line1, 11);
  assert.ok(target1Mid);
  assert.strictEqual(target1Mid.targetLineNumber, 500);

  // Test end of number
  const target1End = findBasJumpTargetAtPosition(line1, 13);
  assert.ok(target1End);
  assert.strictEqual(target1End.targetLineNumber, 500);

  // Test GOSUB without space
  const line2 = '20 GOSUB 600';
  // '600' starts at 9
  const target2 = findBasJumpTargetAtPosition(line2, 9);
  assert.ok(target2);
  assert.strictEqual(target2.targetLineNumber, 600);
});

test('findBasJumpTargetAtPosition detects GO TO and GOTO target lines', () => {
  const line = '30 GO TO 100: GOTO 200';
  const target1 = findBasJumpTargetAtPosition(line, 9);
  assert.ok(target1);
  assert.strictEqual(target1.targetLineNumber, 100);

  const target2 = findBasJumpTargetAtPosition(line, 19);
  assert.ok(target2);
  assert.strictEqual(target2.targetLineNumber, 200);
});

test('findBasJumpTargetAtPosition detects multi-target jumps like ON x GO SUB', () => {
  const line = '40 ON x GO SUB 100, 200, 300';
  const t1 = findBasJumpTargetAtPosition(line, 15);
  assert.ok(t1);
  assert.strictEqual(t1.targetLineNumber, 100);

  const t2 = findBasJumpTargetAtPosition(line, 20);
  assert.ok(t2);
  assert.strictEqual(t2.targetLineNumber, 200);

  const t3 = findBasJumpTargetAtPosition(line, 25);
  assert.ok(t3);
  assert.strictEqual(t3.targetLineNumber, 300);
});

test('findBasJumpTargetAtPosition returns null when not on a jump target', () => {
  // Line number at start of line
  assert.strictEqual(findBasJumpTargetAtPosition('100 GO SUB 500', 1), null);

  // Normal variable assignment
  assert.strictEqual(findBasJumpTargetAtPosition('10 LET a = 500', 11), null);

  // Coordinates in PRINT AT
  assert.strictEqual(findBasJumpTargetAtPosition('20 PRINT AT 10, 20; "HI"', 12), null);

  // Cursor on keyword itself
  assert.strictEqual(findBasJumpTargetAtPosition('10 GO SUB 500', 4), null);
});

test('findBasJumpTargetAtPosition strictly protects string literals and REM comments', () => {
  // Inside string literal
  const strLine = '10 PRINT "GO SUB 500"';
  assert.strictEqual(findBasJumpTargetAtPosition(strLine, 17), null);

  // Inside REM comment
  const remLine = '20 REM GO SUB 500';
  assert.strictEqual(findBasJumpTargetAtPosition(remLine, 14), null);
});

test('findBasLineIndex finds target line index and column', () => {
  const doc = [
    '10 PRINT "START"',
    '20 GO SUB 500',
    '30 STOP',
    '500 PRINT "SUBROUTINE"',
    '510 RETURN'
  ];

  const res500 = findBasLineIndex(doc, 500);
  assert.ok(res500);
  assert.strictEqual(res500.lineIndex, 3);
  assert.strictEqual(res500.col, 0);

  const resNonExistent = findBasLineIndex(doc, 9999);
  assert.strictEqual(resNonExistent, null);

  // Test with mock vscode.TextDocument
  const mockDoc = {
    lineCount: doc.length,
    lineAt: (i) => ({ text: doc[i] })
  };
  const resMock = findBasLineIndex(mockDoc, 500);
  assert.ok(resMock);
  assert.strictEqual(resMock.lineIndex, 3);
  assert.strictEqual(resMock.col, 0);
});

test('getBasDefinition returns full navigation info for Ctrl+Click', () => {
  const doc = [
    '10 PRINT "START"',
    '20 GO SUB 500',
    '30 STOP',
    '500 PRINT "SUBROUTINE"',
    '510 RETURN'
  ];

  // Cursor on line 1 ('20 GO SUB 500'), col 11 (on 500)
  const def = getBasDefinition(doc, 1, 11);
  assert.ok(def);
  assert.strictEqual(def.targetLineNumber, 500);
  assert.strictEqual(def.origin.startCol, 10);
  assert.strictEqual(def.origin.endCol, 13);
  assert.strictEqual(def.target.lineIndex, 3);
  assert.strictEqual(def.target.col, 0);

  // Cursor on non-existent jump
  const docWithMissing = [
    '10 GO SUB 9999'
  ];
  const defMissing = getBasDefinition(docWithMissing, 0, 10);
  assert.strictEqual(defMissing, null);
});

test('findJBasLabelAtPosition detects @label at any character including @ and protects strings/comments', () => {
  const line = '  IF a=1 THEN GO SUB @draw_player \' @ignored';
  // '@draw_player' starts at index 21, ends at 33
  const atSign = findJBasLabelAtPosition(line, 21);
  assert.ok(atSign);
  assert.strictEqual(atSign.labelName, 'draw_player');
  assert.strictEqual(atSign.startCol, 21);
  assert.strictEqual(atSign.endCol, 33);

  const mid = findJBasLabelAtPosition(line, 26);
  assert.ok(mid);
  assert.strictEqual(mid.labelName, 'draw_player');

  // Inside single-quote comment -> null
  assert.strictEqual(findJBasLabelAtPosition(line, 37), null);

  // Inside string literal -> null
  const strLine = 'PRINT "EMAIL: a@b_c"';
  assert.strictEqual(findJBasLabelAtPosition(strLine, 16), null);

  // Inside REM comment -> null
  const remLine = 'REM jump to @draw_player';
  assert.strictEqual(findJBasLabelAtPosition(remLine, 14), null);
});

test('findJBasLabelDefinition finds leading, indented, chained, and case-insensitive @label definitions', () => {
  const doc = [
    'GO SUB @init',
    'GO TO @SecondLabel',
    '@init:',
    '  PRINT "OK"',
    '  @first: @secondlabel: PRINT "CHAINED"',
    '\' @fake_label:'
  ];

  const initDef = findJBasLabelDefinition(doc, 'init');
  assert.ok(initDef);
  assert.strictEqual(initDef.lineIndex, 2);
  assert.strictEqual(initDef.startCol, 0);
  assert.strictEqual(initDef.endCol, 5);

  const chainedDef = findJBasLabelDefinition(doc, 'SecondLabel');
  assert.ok(chainedDef);
  assert.strictEqual(chainedDef.lineIndex, 4);
  assert.strictEqual(chainedDef.startCol, 10);
  assert.strictEqual(chainedDef.endCol, 22);

  // Commented label must not match
  assert.strictEqual(findJBasLabelDefinition(doc, 'fake_label'), null);
});

test('getJBasDefinition returns full navigation info for Ctrl+Click in .jbas', () => {
  const doc = [
    'GO SUB @game_over',
    'STOP',
    '@game_over:',
    '  PRINT "GAME OVER"',
    '  RETURN'
  ];

  // Cursor on '@game_over' (col 7..17)
  const def = getJBasDefinition(doc, 0, 10);
  assert.ok(def);
  assert.strictEqual(def.labelName, 'game_over');
  assert.strictEqual(def.origin.startCol, 7);
  assert.strictEqual(def.origin.endCol, 17);
  assert.strictEqual(def.target.lineIndex, 2);
  assert.strictEqual(def.target.startCol, 0);
  assert.strictEqual(def.target.endCol, 10);
});
