const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  KEYWORDS,
  tokenizeLine,
  bas2tap,
  tap2buffer,
  generateTapFile
} = require('../src/core/tapGenerator.js');

test('tokenizeLine tokenizes Sinclair BASIC keywords and numbers', () => {
  const line = 'PRINT "HELLO"; AT 10,20; "WORLD"';
  const tokens = tokenizeLine(line);

  // First token should be PRINT (0xF5)
  assert.equal(tokens[0], KEYWORDS['PRINT']);
  // Ends with 0x0D (Enter)
  assert.equal(tokens[tokens.length - 1], 0x0D);
});

test('tokenizeLine is case-insensitive for keywords', () => {
  const line = 'print "hi": goto 10';
  const tokens = tokenizeLine(line);

  assert.equal(tokens[0], KEYWORDS['PRINT']);
  assert.ok(tokens.includes(KEYWORDS['GOTO']));
});

test('tokenizeLine does not tokenize keywords or numbers inside REM comments and trims leading keyword space', () => {
  const line = 'REM PRINT GOTO 999';
  const tokens = tokenizeLine(line);

  assert.equal(tokens[0], KEYWORDS['REM']);
  // Following bytes should be raw ASCII for 'PRINT GOTO 999' without duplicate space
  const restChars = tokens.slice(1, -1).map(c => String.fromCharCode(c)).join('');
  assert.equal(restChars, 'PRINT GOTO 999');
});

test('tokenizeLine consumes whitespace after keywords preventing duplicate spaces on LIST (e.g. LET py=0, CHR$ 18)', () => {
  // Test LET py=0
  const tokensLet = tokenizeLine('LET py=0');
  assert.equal(tokensLet[0], KEYWORDS['LET']);
  assert.equal(String.fromCharCode(tokensLet[1]), 'p', 'First char after LET token must be variable name "p", not space');
  assert.equal(String.fromCharCode(tokensLet[2]), 'y');

  // Test CHR$ 18
  const tokensChr = tokenizeLine('CHR$ 18');
  assert.equal(tokensChr[0], KEYWORDS['CHR$']);
  assert.equal(String.fromCharCode(tokensChr[1]), '1', 'First char after CHR$ token must be digit "1", not space');
  assert.equal(String.fromCharCode(tokensChr[2]), '8');

  // Test statement separator colon :
  const tokensColon = tokenizeLine('LET a=1: LET b=2');
  const colonIndex = tokensColon.indexOf(0x3A);
  assert.ok(colonIndex > 0, 'Must have colon token');
  assert.equal(tokensColon[colonIndex + 1], KEYWORDS['LET'], 'Token immediately following colon must be LET, not space');
});

test('bas2tap generates valid TAP header and data blocks with correct checksums', () => {
  const code = `
10 BORDER 1: PAPER 7: CLS
20 PRINT "HELLO SPECTRUM"
30 GO TO 20
`;
  const blocks = bas2tap(code, 'mygame', 10);
  assert.equal(blocks.length, 2);

  const headerBlock = blocks[0];
  const dataBlock = blocks[1];

  // Header block length: 2 bytes len + 1 flag (0x00) + 17 data + 1 checksum = 21 bytes
  assert.equal(headerBlock.length, 21);
  assert.equal(headerBlock[2], 0x00); // Flag: Header

  // Type: 0x00 Program
  assert.equal(headerBlock[3], 0x00);

  // Filename: "mygame    "
  const nameInHeader = String.fromCharCode(...headerBlock.slice(4, 14));
  assert.equal(nameInHeader, 'mygame    ');

  // Autostart line: 10
  const autoStart = headerBlock[3 + 13] | (headerBlock[3 + 14] << 8);
  assert.equal(autoStart, 10);

  // Verify header checksum: XOR of flag and 17 data bytes
  let headerXOR = 0;
  for (let i = 2; i < headerBlock.length - 1; i++) {
    headerXOR ^= headerBlock[i];
  }
  assert.equal(headerBlock[headerBlock.length - 1], headerXOR);

  // Data block flag: 0xFF
  assert.equal(dataBlock[2], 0xFF);

  // Verify data block checksum
  let dataXOR = 0;
  for (let i = 2; i < dataBlock.length - 1; i++) {
    dataXOR ^= dataBlock[i];
  }
  assert.equal(dataBlock[dataBlock.length - 1], dataXOR);
});

test('tokenizeLine correctly handles <>, <=, and >= operators without spaces', () => {
  const line = 'IF py<>oldpy AND c1<=31 AND sc>=50 THEN GO TO 10';
  const tokens = tokenizeLine(line);

  assert.ok(tokens.includes(KEYWORDS['<>']), 'Should contain <> token 0xC9');
  assert.ok(tokens.includes(KEYWORDS['<=']), 'Should contain <= token 0xC7');
  assert.ok(tokens.includes(KEYWORDS['>=']), 'Should contain >= token 0xC8');
  assert.ok(tokens.includes(KEYWORDS['THEN']), 'Should contain THEN token 0xCB');
  assert.ok(tokens.includes(KEYWORDS['GO TO']), 'Should contain GO TO token 0xEC');
});

test('tokenizeLine respects word boundaries for keywords in variable names', () => {
  const line = 'LET color=1: LET TOTAL=5: LET checkpoint=10';
  const tokens = tokenizeLine(line);

  // 'color' should NOT have OR (0xC5) tokenized
  assert.ok(!tokens.includes(KEYWORDS['OR']), 'Variable "color" should not tokenize OR');
  // 'TOTAL' should NOT have TO (0xCC) tokenized
  assert.ok(!tokens.includes(KEYWORDS['TO']), 'Variable "TOTAL" should not tokenize TO');
  // 'checkpoint' should NOT have POINT (0xA9) tokenized
  assert.ok(!tokens.includes(KEYWORDS['POINT']), 'Variable "checkpoint" should not tokenize POINT');
});

test('tokenizeLine does not encode digits inside multi-char variable names as numbers', () => {
  const line = 'LET c1=c1-1: LET c12=10';
  const tokens = tokenizeLine(line);

  // Variable names c1 and c12 should have ASCII digits without 0x0E hidden marker immediately following
  // Number literals -1 and 10 should have 0x0E marker
  const numMarkers = tokens.filter(b => b === 0x0E).length;
  // Exactly 2 number literals: 1 and 10
  assert.equal(numMarkers, 2, 'Only literal numbers 1 and 10 should have 0x0E markers');
});

test('tokenizeLine correctly parses bas2tap control codes {PAPER n}, {INK n}, {AT y,x} inside strings', () => {
  const line = 'LET c$ = "{PAPER 4} {PAPER 1} "';
  const tokens = tokenizeLine(line);

  // String quotes are 0x22
  const firstQuote = tokens.indexOf(0x22);
  const secondQuote = tokens.indexOf(0x22, firstQuote + 1);
  const stringBytes = tokens.slice(firstQuote + 1, secondQuote);

  // Expected bytes inside quotes:
  // {PAPER 4} -> 17, 4
  // ' '        -> 32
  // {PAPER 1} -> 17, 1
  // ' '        -> 32
  assert.deepEqual(Array.from(stringBytes), [17, 4, 32, 17, 1, 32]);

  // Test AT, INK, FLASH
  const line2 = 'PRINT "{AT 10,5}{INK 2}{FLASH 1}HI"';
  const tokens2 = tokenizeLine(line2);
  const q1 = tokens2.indexOf(0x22);
  const q2 = tokens2.indexOf(0x22, q1 + 1);
  const strBytes2 = tokens2.slice(q1 + 1, q2);
  // {AT 10,5} -> 22, 10, 5
  // {INK 2}   -> 16, 2
  // {FLASH 1} -> 18, 1
  // 'HI'      -> 72, 73
  assert.deepEqual(Array.from(strBytes2), [22, 10, 5, 16, 2, 18, 1, 72, 73]);
});

test('generateTapFile writes a valid .tap file to disk', () => {
  const code = '10 PRINT "TEST TAP FILE": STOP';
  const outPath = path.join(__dirname, 'tmp', 'test_output.tap');

  const res = generateTapFile(code, outPath, { filename: 'test', autostart: 10 });
  assert.ok(fs.existsSync(outPath));
  assert.equal(res.autoStartLine, 10);
  assert.ok(res.bytesCount > 0);

  // Clean up
  fs.unlinkSync(outPath);
});

test('end-to-end: transpiling .jbas with CHR$ concatenation folds to control codes and compiles to valid TAP', () => {
  const { transpileJBasAllVersions } = require('../src/core/jbas2bas.js');
  const jbasSource = `
LET c$ = CHR$ 17 + CHR$ 4 + " " + CHR$ 17 + CHR$ 1 + " "
PRINT AT 20, 0; PAPER 2; " "
`;
  const transpiled = transpileJBasAllVersions(jbasSource);
  assert.equal(transpiled.success, true);

  // Compact code should have folded "{PAPER 4} {PAPER 1} " and "{AT 20,0}{PAPER 2} "
  assert.ok(transpiled.compact.text.includes('LET c$="{PAPER 4} {PAPER 1} "'));
  assert.ok(transpiled.compact.text.includes('PRINT "{AT 20,0}{PAPER 2} "'));

  // Compile to TAP blocks
  const blocks = bas2tap(transpiled.compact.text, 'test', 1);
  assert.equal(blocks.length, 2);
  const dataBlock = blocks[1];

  // Find the string bytes inside the data block: 17, 4, 32, 17, 1, 32
  let foundC = false;
  for (let i = 0; i < dataBlock.length - 6; i++) {
    if (dataBlock[i] === 17 && dataBlock[i+1] === 4 && dataBlock[i+2] === 32 &&
        dataBlock[i+3] === 17 && dataBlock[i+4] === 1 && dataBlock[i+5] === 32) {
      foundC = true;
      break;
    }
  }
  assert.ok(foundC, 'TAP binary should contain exact folded control bytes [17, 4, 32, 17, 1, 32]');

  // Find the PAPER control code inside TAP data block: 17, 2, 32
  let foundPaper = false;
  for (let i = 0; i < dataBlock.length - 3; i++) {
    if (dataBlock[i] === 17 && dataBlock[i+1] === 2 && dataBlock[i+2] === 32) {
      foundPaper = true;
      break;
    }
  }
  assert.ok(foundPaper, 'TAP binary should contain exact folded PAPER control bytes [17, 2, 32]');
});

