const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  ROM48_STMT_ADDR,
  decodeSinclairFloat,
  readSpectrumVariables,
  findDocumentLine,
  findStatementRange
} = require('../src/core/debugger.js');

describe('Sinclair BASIC Debugger Engine', () => {

  it('exports correct ROM48 statement address', () => {
    assert.strictEqual(ROM48_STMT_ADDR, 0x1B3D);
  });

  describe('decodeSinclairFloat', () => {
    it('decodes small integers (short form: 00 sign val_low val_high 00)', () => {
      // 0 = 00 00 00 00 00
      assert.strictEqual(decodeSinclairFloat(0, 0, 0, 0, 0), 0);
      // 42 = 00 00 2A 00 00
      assert.strictEqual(decodeSinclairFloat(0, 0, 42, 0, 0), 42);
      // -100 = 00 FF 64 00 00
      assert.strictEqual(decodeSinclairFloat(0, 0xFF, 100, 0, 0), -100);
      // 1000 = 00 00 E8 03 00
      assert.strictEqual(decodeSinclairFloat(0, 0, 0xE8, 0x03, 0), 1000);
    });

    it('decodes floating-point numbers', () => {
      // 0.5: exp = 127 (0x7F - 128 = -1), mantissa 0 -> 1.0 * 2^(-1) = 0.5
      const half = decodeSinclairFloat(0x7F, 0x00, 0x00, 0x00, 0x00);
      assert.strictEqual(half, 0.5);

      // 1.0: exp = 128 (0x80 - 128 = 0) -> 1.0 * 2^0 = 1.0
      const one = decodeSinclairFloat(0x80, 0x00, 0x00, 0x00, 0x00);
      assert.strictEqual(one, 1.0);

      // 2.0: exp = 129 (0x81 - 128 = 1) -> 1.0 * 2^1 = 2.0
      const two = decodeSinclairFloat(0x81, 0x00, 0x00, 0x00, 0x00);
      assert.strictEqual(two, 2.0);

      // Negative number: bit 7 of byte 1 is set
      const negOne = decodeSinclairFloat(0x80, 0x80, 0x00, 0x00, 0x00);
      assert.strictEqual(negOne, -1.0);
    });
  });

  describe('readSpectrumVariables', () => {
    it('reads numeric and string variables from Spectrum RAM', () => {
      const memory = new Uint8Array(65536);
      memory[0x5C4B] = 0x00;
      memory[0x5C4C] = 0x60; // VARS at 0x6000

      let idx = 0x6000;
      // Single-letter numeric variable 'j' = 7
      // 'j' = letter 10 -> type 3: (3 << 5) | 10 = 0x6A
      memory[idx++] = 0x6A;
      memory[idx++] = 0x00; // int form
      memory[idx++] = 0x00; // positive
      memory[idx++] = 0x07; // 7
      memory[idx++] = 0x00;
      memory[idx++] = 0x00;

      // Multi-letter variable 'score' = 1500
      // 's' = letter 19 -> type 5: (5 << 5) | 19 = 0xB3
      memory[idx++] = 0xB3; // 's'
      memory[idx++] = 99;   // 'c'
      memory[idx++] = 111;  // 'o'
      memory[idx++] = 114;  // 'r'
      memory[idx++] = 101 | 0x80; // 'e' | 0x80 (terminal)
      memory[idx++] = 0x00;
      memory[idx++] = 0x00;
      memory[idx++] = 1500 & 0xFF;
      memory[idx++] = (1500 >> 8) & 0xFF;
      memory[idx++] = 0x00;

      // String variable 'msg$' = "OK"
      // 'm' = letter 13 -> type 2: (2 << 5) | 13 = 0x4D
      memory[idx++] = 0x4D;
      memory[idx++] = 2; // length low
      memory[idx++] = 0; // length high
      memory[idx++] = 79; // 'O'
      memory[idx++] = 75; // 'K'

      // End of variables marker
      memory[idx++] = 0x80;

      const vars = readSpectrumVariables((addr) => memory[addr]);
      assert.strictEqual(vars.length, 3);
      assert.deepStrictEqual(vars[0], { name: 'j', type: 'number', value: 7 });
      assert.deepStrictEqual(vars[1], { name: 'score', type: 'number', value: 1500 });
      assert.deepStrictEqual(vars[2], { name: 'm$', type: 'string', value: 'OK', length: 2 });
    });

    it('returns empty array when VARS is empty (starts with 0x80)', () => {
      const memory = new Uint8Array(65536);
      memory[0x5C4B] = 0x00;
      memory[0x5C4C] = 0x60;
      memory[0x6000] = 0x80;

      const vars = readSpectrumVariables((addr) => memory[addr]);
      assert.deepStrictEqual(vars, []);
    });
  });

  describe('findDocumentLine', () => {
    const sampleDoc = [
      '1 GO TO 74',
      '2 IF PEEK 23560 THEN POKE 23560,0',
      '74 LET py=0: LET oldpy=0',
      '75 LET y$="ABC"',
      '100 STOP'
    ].join('\n');

    it('finds existing line numbers in document', () => {
      assert.strictEqual(findDocumentLine(sampleDoc, 1), 0);
      assert.strictEqual(findDocumentLine(sampleDoc, 2), 1);
      assert.strictEqual(findDocumentLine(sampleDoc, 74), 2);
      assert.strictEqual(findDocumentLine(sampleDoc, 75), 3);
      assert.strictEqual(findDocumentLine(sampleDoc, 100), 4);
    });

    it('returns -1 for non-existent line numbers', () => {
      assert.strictEqual(findDocumentLine(sampleDoc, 50), -1);
      assert.strictEqual(findDocumentLine(sampleDoc, 999), -1);
    });
  });

  describe('findStatementRange', () => {
    it('finds statement ranges on multi-statement lines', () => {
      const line = '74 LET py=0: LET oldpy=0: LET sc=0';
      const s1 = findStatementRange(line, 1);
      assert.strictEqual(line.slice(s1.startCol, s1.endCol), 'LET py=0');

      const s2 = findStatementRange(line, 2);
      assert.strictEqual(line.slice(s2.startCol, s2.endCol), 'LET oldpy=0');

      const s3 = findStatementRange(line, 3);
      assert.strictEqual(line.slice(s3.startCol, s3.endCol), 'LET sc=0');
    });

    it('ignores colons inside string literals and REM comments', () => {
      const line = '10 PRINT "A:B:C": REM this:is:ignored';
      const s1 = findStatementRange(line, 1);
      assert.strictEqual(line.slice(s1.startCol, s1.endCol), 'PRINT "A:B:C"');

      const s2 = findStatementRange(line, 2);
      assert.strictEqual(line.slice(s2.startCol, s2.endCol), 'REM this:is:ignored');
    });
  });

});
