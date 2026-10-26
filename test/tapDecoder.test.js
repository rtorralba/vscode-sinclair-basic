const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTapBlocks,
  detokenizeLine,
  decodeBasicProgram,
  extractProgramsFromTap,
  tapToBas,
  tapToJBas
} = require('../src/core/tapDecoder.js');
const { bas2tap, tap2buffer, tokenizeLine } = require('../src/core/tapGenerator.js');
const { compileJBas } = require('../src/core/jbas2bas.js');

test('detokenizeLine decodes standard keywords, numbers, and strings', () => {
  const line = 'BORDER 1: PAPER 1: CLS';
  const tokens = tokenizeLine(line);
  const detok = detokenizeLine(tokens);
  assert.equal(detok, 'BORDER 1: PAPER 1: CLS');
});

test('detokenizeLine decodes PRINT with attributes and string', () => {
  const line = 'PRINT AT 10,1; PAPER 2; "HOLA"';
  const tokens = tokenizeLine(line);
  const detok = detokenizeLine(tokens);
  assert.equal(detok, 'PRINT AT 10,1; PAPER 2; "HOLA"');
});

test('detokenizeLine decodes bas2tap escape codes inside strings', () => {
  const line = 'PRINT "{PAPER 4}{INK 7}SCORE: 100"';
  const tokens = tokenizeLine(line);
  const detok = detokenizeLine(tokens);
  assert.equal(detok, 'PRINT "{PAPER 4}{INK 7}SCORE: 100"');
});

test('detokenizeLine decodes UDGs and special characters', () => {
  const line = 'PRINT "{A}{B}{C}{(c)}"';
  const tokens = tokenizeLine(line);
  const detok = detokenizeLine(tokens);
  assert.equal(detok, 'PRINT "{A}{B}{C}{(c)}"');
});

test('detokenizeLine preserves REM comments verbatim', () => {
  const line = 'REM Simple Sinclair BASIC comment';
  const tokens = tokenizeLine(line);
  const detok = detokenizeLine(tokens);
  assert.equal(detok, 'REM Simple Sinclair BASIC comment');
});

test('parseTapBlocks parses TAP blocks and validates checksums', () => {
  const source = '10 PRINT "TEST"\n20 STOP\n';
  const blocks = bas2tap(source, 'testprog', 10);
  const buf = tap2buffer(blocks);

  const parsed = parseTapBlocks(buf);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].flag, 0x00); // Header
  assert.equal(parsed[1].flag, 0xFF); // Data
  assert.equal(parsed[0].payload.length, 17);
});

test('tapToBas and tapToJBas roundtrip with complex program', () => {
  const source = `10 REM Game Loader
20 BORDER 0: PAPER 0: INK 7: CLS
30 GO SUB 100
40 GO TO 20
100 REM SUB Draw Player
110 PRINT AT 10, 5; "{PAPER 2}{INK 7}PLAYER"
120 RETURN
`;

  const blocks = bas2tap(source, 'mygame', 20);
  const tapBuf = tap2buffer(blocks);

  // 1. Extract BAS
  const extracted = tapToBas(tapBuf);
  assert.ok(extracted);
  assert.equal(extracted.name, 'mygame');
  assert.equal(extracted.autostart, 20);
  assert.equal(extracted.linesCount, 7);

  const basLines = extracted.basText.trim().split(/\r?\n/);
  assert.equal(basLines[0], '10 REM Game Loader');
  assert.equal(basLines[1], '20 BORDER 0: PAPER 0: INK 7: CLS');
  assert.equal(basLines[2], '30 GO SUB 100');
  assert.equal(basLines[3], '40 GO TO 20');
  assert.equal(basLines[4], '100 REM SUB Draw Player');
  assert.equal(basLines[5], '110 PRINT AT 10, 5; "{PAPER 2}{INK 7}PLAYER"');
  assert.equal(basLines[6], '120 RETURN');

  // 2. Extract JBAS
  const jbasText = tapToJBas(tapBuf);
  assert.ok(jbasText);
  assert.ok(jbasText.includes("' Game Loader"));
  assert.ok(jbasText.includes('@line_20:'));
  assert.ok(jbasText.includes('GO SUB @draw_player'));
  assert.ok(jbasText.includes('GO TO @line_20'));
  assert.ok(jbasText.includes('@draw_player:'));
  assert.ok(jbasText.includes('  PRINT AT 10, 5; "{PAPER 2}{INK 7}PLAYER"'));
  assert.ok(jbasText.includes('  RETURN'));

  // 3. Transpile generated JBAS back to BAS
  const recomp = compileJBas(jbasText, { start: 10, step: 10 });
  assert.equal(recomp.success, true);
  assert.equal(recomp.errors.length, 0);
});

test('decodeBasicProgram decodes hidden numbers without ASCII digits', () => {
  // Line 10: GO TO with hidden line number 100 (no preceding ASCII digits)
  // 0xEC (GO TO), 0x0E (number marker), [0x00, 0x00, 0x64, 0x00, 0x00], 0x0D
  const payload = new Uint8Array([
    0x00, 10,       // Line number 10
    8, 0,           // Length: 8 bytes
    0xEC,           // GO TO
    0x0E,           // Number marker
    0x00, 0x00, 0x64, 0x00, 0x00, // 100 as 16-bit int
    0x0D            // Enter
  ]);

  const decoded = decodeBasicProgram(payload);
  assert.equal(decoded.lines.length, 1);
  assert.equal(decoded.lines[0].lineNum, 10);
  assert.equal(decoded.lines[0].text, 'GO TO 100');
});

test('detokenizeLine decodes control codes outside strings into valid Sinclair BASIC statements', () => {
  // [17, 0, 16, 7, 247, 57, 48, 48, 48, 14, 0, 0, 40, 35, 0, 13]
  // 17=PAPER 0, 16=INK 7, 247=RUN, 9000
  const rawBytes = new Uint8Array([
    17, 0,
    16, 7,
    0xF7,
    57, 48, 48, 48,
    0x0E, 0, 0, 40, 35, 0,
    0x0D
  ]);

  const detok = detokenizeLine(rawBytes);
  assert.equal(detok, 'PAPER 0: INK 7: RUN 9000');
});

