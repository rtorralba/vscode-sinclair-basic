/**
 * Sinclair BASIC Keywords and Metadata
 * Provides complete keyword definitions, documentation, syntax, snippets,
 * and categorization for Sinclair ZX Spectrum BASIC.
 */

/**
 * @typedef {Object} KeywordDef
 * @property {string} name - Keyword name in uppercase (e.g. 'PRINT')
 * @property {'statement'|'function'|'operator'|'attribute'|'storage'} kind - Category
 * @property {string} syntax - Syntax usage example
 * @property {string} description - Brief summary of what the keyword does
 * @property {string} [snippet] - Optional VS Code snippet template
 */

/** @type {KeywordDef[]} */
const KEYWORDS_LIST = [
  // Statements & Control Flow
  {
    name: 'PRINT',
    kind: 'statement',
    syntax: 'PRINT [AT row, col;] [expression...]',
    description: 'Prints text, numbers, screen attributes, or graphics characters to the screen.',
    snippet: 'PRINT $0'
  },
  {
    name: 'LET',
    kind: 'statement',
    syntax: 'LET variable = expression',
    description: 'Assigns the result of an expression to a variable.',
    snippet: 'LET ${1:var} = ${2:0}'
  },
  {
    name: 'IF',
    kind: 'statement',
    syntax: 'IF condition THEN statement',
    description: 'Tests condition; executes following statement if true (non-zero).',
    snippet: 'IF ${1:condition} THEN ${2:statement}'
  },
  {
    name: 'THEN',
    kind: 'statement',
    syntax: 'THEN statement',
    description: 'Specifies statement or line to execute when IF condition evaluates to true.',
    snippet: 'THEN $0'
  },
  {
    name: 'FOR',
    kind: 'statement',
    syntax: 'FOR var = start TO limit [STEP step]',
    description: 'Initializes a loop with counter variable from start to limit.',
    snippet: 'FOR ${1:i} = ${2:1} TO ${3:10}\n\t$0\nNEXT ${1:i}'
  },
  {
    name: 'TO',
    kind: 'statement',
    syntax: 'TO limit',
    description: 'Defines target upper/lower limit in FOR loop or string/array slicing.',
    snippet: 'TO ${1:10}'
  },
  {
    name: 'STEP',
    kind: 'statement',
    syntax: 'STEP increment',
    description: 'Defines step increment (positive or negative) in FOR loop.',
    snippet: 'STEP ${1:1}'
  },
  {
    name: 'NEXT',
    kind: 'statement',
    syntax: 'NEXT var',
    description: 'Closes a FOR loop and advances counter variable.',
    snippet: 'NEXT ${1:i}'
  },
  {
    name: 'GO TO',
    kind: 'statement',
    syntax: 'GO TO line',
    description: 'Unconditional jump to specified line number or label.',
    snippet: 'GO TO ${1:line}'
  },
  {
    name: 'GOTO',
    kind: 'statement',
    syntax: 'GOTO line',
    description: 'Alias for GO TO. Unconditional jump to line number or label.',
    snippet: 'GOTO ${1:line}'
  },
  {
    name: 'GO SUB',
    kind: 'statement',
    syntax: 'GO SUB line',
    description: 'Calls a subroutine at specified line number or label.',
    snippet: 'GO SUB ${1:line}'
  },
  {
    name: 'GOSUB',
    kind: 'statement',
    syntax: 'GOSUB line',
    description: 'Alias for GO SUB. Calls a subroutine at line number or label.',
    snippet: 'GOSUB ${1:line}'
  },
  {
    name: 'RETURN',
    kind: 'statement',
    syntax: 'RETURN',
    description: 'Returns program execution from a subroutine called by GO SUB.',
    snippet: 'RETURN'
  },
  {
    name: 'INPUT',
    kind: 'statement',
    syntax: 'INPUT [prompt;] variable',
    description: 'Halts program execution and awaits user input from the keyboard.',
    snippet: 'INPUT "${1:Prompt: }"; ${2:var}'
  },
  {
    name: 'POKE',
    kind: 'statement',
    syntax: 'POKE address, byte',
    description: 'Writes an 8-bit byte (0-255) directly into memory address (0-65535).',
    snippet: 'POKE ${1:address}, ${2:byte}'
  },
  {
    name: 'DIM',
    kind: 'statement',
    syntax: 'DIM array(dim1 [, dim2...])',
    description: 'Allocates memory and dimension boundaries for a numeric or string array.',
    snippet: 'DIM ${1:a}(${2:10})'
  },
  {
    name: 'DATA',
    kind: 'statement',
    syntax: 'DATA item1, item2, ...',
    description: 'Stores sequential constant items to be read by READ statements.',
    snippet: 'DATA ${1:items}'
  },
  {
    name: 'READ',
    kind: 'statement',
    syntax: 'READ var1 [, var2...]',
    description: 'Reads data values sequentially from DATA statements into variables.',
    snippet: 'READ ${1:var}'
  },
  {
    name: 'RESTORE',
    kind: 'statement',
    syntax: 'RESTORE [line]',
    description: 'Resets the DATA pointer to the first DATA statement or specified line.',
    snippet: 'RESTORE ${1:10}'
  },
  {
    name: 'DEF FN',
    kind: 'statement',
    syntax: 'DEF FN name(param) = expression',
    description: 'Defines a user function with parameters returning a numeric or string value.',
    snippet: 'DEF FN ${1:f}(${2:x}) = ${3:x * 2}'
  },
  {
    name: 'REM',
    kind: 'statement',
    syntax: 'REM comment',
    description: 'Comment / remark line ignored by the Sinclair BASIC interpreter.',
    snippet: 'REM $0'
  },
  {
    name: 'PAUSE',
    kind: 'statement',
    syntax: 'PAUSE frames',
    description: 'Pauses execution for specified 50Hz frames (PAUSE 0 waits for a keypress).',
    snippet: 'PAUSE ${1:50}'
  },
  {
    name: 'RANDOMIZE',
    kind: 'statement',
    syntax: 'RANDOMIZE [seed]',
    description: 'Seeds the pseudo-random number generator (seed 0 reads system timer).',
    snippet: 'RANDOMIZE ${1:0}'
  },
  {
    name: 'STOP',
    kind: 'statement',
    syntax: 'STOP',
    description: 'Halts program execution and displays "9 STOP statement".',
    snippet: 'STOP'
  },
  {
    name: 'RUN',
    kind: 'statement',
    syntax: 'RUN [line]',
    description: 'Clears variables and starts program execution at specified line (default: start).',
    snippet: 'RUN'
  },
  {
    name: 'CONTINUE',
    kind: 'statement',
    syntax: 'CONTINUE',
    description: 'Resumes program execution after a STOP statement or Break key interrupt.',
    snippet: 'CONTINUE'
  },
  {
    name: 'CLEAR',
    kind: 'statement',
    syntax: 'CLEAR [address]',
    description: 'Clears variables, display buffers, and optionally lowers RAMTOP ceiling.',
    snippet: 'CLEAR ${1:65367}'
  },
  {
    name: 'NEW',
    kind: 'statement',
    syntax: 'NEW',
    description: 'Clears program code and variables and resets system to initial state.',
    snippet: 'NEW'
  },

  // Display & Screen Attributes
  {
    name: 'CLS',
    kind: 'attribute',
    syntax: 'CLS',
    description: 'Clears the screen display area and resets cursor to top-left.',
    snippet: 'CLS'
  },
  {
    name: 'BORDER',
    kind: 'attribute',
    syntax: 'BORDER color',
    description: 'Sets border color (0=Black, 1=Blue, 2=Red, 3=Magenta, 4=Green, 5=Cyan, 6=Yellow, 7=White).',
    snippet: 'BORDER ${1:0}'
  },
  {
    name: 'PAPER',
    kind: 'attribute',
    syntax: 'PAPER color',
    description: 'Sets background paper color (0-7, or 8 for transparent).',
    snippet: 'PAPER ${1:7}'
  },
  {
    name: 'INK',
    kind: 'attribute',
    syntax: 'INK color',
    description: 'Sets foreground ink / text color (0-7, or 8 for transparent).',
    snippet: 'INK ${1:0}'
  },
  {
    name: 'FLASH',
    kind: 'attribute',
    syntax: 'FLASH mode',
    description: 'Toggles character flashing (0=off, 1=on, 8=no change).',
    snippet: 'FLASH ${1:0}'
  },
  {
    name: 'BRIGHT',
    kind: 'attribute',
    syntax: 'BRIGHT mode',
    description: 'Toggles high intensity bright attribute (0=normal, 1=bright, 8=no change).',
    snippet: 'BRIGHT ${1:0}'
  },
  {
    name: 'INVERSE',
    kind: 'attribute',
    syntax: 'INVERSE mode',
    description: 'Toggles inverse video color attribute (0=normal, 1=inverse).',
    snippet: 'INVERSE ${1:0}'
  },
  {
    name: 'OVER',
    kind: 'attribute',
    syntax: 'OVER mode',
    description: 'Toggles overprinting mode (0=overwrite, 1=XOR bitwise blend).',
    snippet: 'OVER ${1:0}'
  },
  {
    name: 'AT',
    kind: 'attribute',
    syntax: 'AT row, col',
    description: 'Positions print cursor at row (0-21) and column (0-31).',
    snippet: 'AT ${1:row}, ${2:col}'
  },
  {
    name: 'TAB',
    kind: 'attribute',
    syntax: 'TAB col',
    description: 'Advances print cursor horizontally to specified column (0-31).',
    snippet: 'TAB ${1:col}'
  },

  // Graphics & Sound
  {
    name: 'PLOT',
    kind: 'statement',
    syntax: 'PLOT [attribute;] x, y',
    description: 'Plots a single graphic pixel at coordinates x (0-255), y (0-175).',
    snippet: 'PLOT ${1:x}, ${2:y}'
  },
  {
    name: 'DRAW',
    kind: 'statement',
    syntax: 'DRAW [attribute;] dx, dy [, angle]',
    description: 'Draws a straight line or arc from current position by offset (dx, dy).',
    snippet: 'DRAW ${1:dx}, ${2:dy}'
  },
  {
    name: 'CIRCLE',
    kind: 'statement',
    syntax: 'CIRCLE [attribute;] x, y, radius',
    description: 'Draws a circle with center (x, y) and specified radius in pixels.',
    snippet: 'CIRCLE ${1:x}, ${2:y}, ${3:radius}'
  },
  {
    name: 'BEEP',
    kind: 'statement',
    syntax: 'BEEP duration, pitch',
    description: 'Generates a sound tone with duration in seconds and pitch in semitones relative to middle C.',
    snippet: 'BEEP ${1:duration}, ${2:pitch}'
  },

  // Functions (Memory & System)
  {
    name: 'PEEK',
    kind: 'function',
    syntax: 'PEEK address',
    description: 'Reads an 8-bit byte value (0-255) from memory address (0-65535).',
    snippet: 'PEEK ${1:address}'
  },
  {
    name: 'USR',
    kind: 'function',
    syntax: 'USR address',
    description: 'Calls a Z80 machine code subroutine at address, or returns UDG graphics memory start when given string USR "a".',
    snippet: 'USR ${1:address}'
  },
  {
    name: 'IN',
    kind: 'function',
    syntax: 'IN port',
    description: 'Reads an 8-bit byte from Z80 hardware I/O port.',
    snippet: 'IN ${1:port}'
  },
  {
    name: 'OUT',
    kind: 'statement',
    syntax: 'OUT port, byte',
    description: 'Outputs an 8-bit byte to Z80 hardware I/O port.',
    snippet: 'OUT ${1:port}, ${2:byte}'
  },
  {
    name: 'FN',
    kind: 'function',
    syntax: 'FN name(args)',
    description: 'Evaluates user-defined function previously created with DEF FN.',
    snippet: 'FN ${1:name}(${2:args})'
  },

  // Functions (Strings & Characters)
  {
    name: 'CHR$',
    kind: 'function',
    syntax: 'CHR$ code',
    description: 'Returns the single-character string corresponding to the given ASCII/ZX character code (0-255).',
    snippet: 'CHR$ ${1:code}'
  },
  {
    name: 'CODE',
    kind: 'function',
    syntax: 'CODE string',
    description: 'Returns the numeric ASCII/ZX character code of the first character in string.',
    snippet: 'CODE "${1:A}"'
  },
  {
    name: 'STR$',
    kind: 'function',
    syntax: 'STR$ number',
    description: 'Converts a numeric value to its decimal string representation.',
    snippet: 'STR$ ${1:num}'
  },
  {
    name: 'VAL',
    kind: 'function',
    syntax: 'VAL string',
    description: 'Evaluates a string containing a numeric BASIC expression and returns its number.',
    snippet: 'VAL(${1:str})'
  },
  {
    name: 'VAL$',
    kind: 'function',
    syntax: 'VAL$ string',
    description: 'Evaluates a string expression stored in a string.',
    snippet: 'VAL$(${1:str})'
  },
  {
    name: 'LEN',
    kind: 'function',
    syntax: 'LEN string',
    description: 'Returns length (number of characters) of string.',
    snippet: 'LEN ${1:str}'
  },
  {
    name: 'INKEY$',
    kind: 'function',
    syntax: 'INKEY$',
    description: 'Reads keyboard without halting. Returns character pressed or empty string "" if none.',
    snippet: 'INKEY$'
  },
  {
    name: 'SCREEN$',
    kind: 'function',
    syntax: 'SCREEN$(row, col)',
    description: 'Returns character currently displayed at screen row (0-21) and col (0-31).',
    snippet: 'SCREEN$(${1:row}, ${2:col})'
  },
  {
    name: 'ATTR',
    kind: 'function',
    syntax: 'ATTR(row, col)',
    description: 'Returns display attribute byte (Flash*128 + Bright*64 + Paper*8 + Ink) at (row, col).',
    snippet: 'ATTR(${1:row}, ${2:col})'
  },
  {
    name: 'POINT',
    kind: 'function',
    syntax: 'POINT(x, y)',
    description: 'Tests pixel at (x, y). Returns 1 if plotted, 0 otherwise.',
    snippet: 'POINT(${1:x}, ${2:y})'
  },

  // Functions (Math)
  {
    name: 'RND',
    kind: 'function',
    syntax: 'RND',
    description: 'Returns pseudo-random floating point number in range [0, 1).',
    snippet: 'RND'
  },
  {
    name: 'PI',
    kind: 'function',
    syntax: 'PI',
    description: 'The mathematical constant π (approx 3.1415926535).',
    snippet: 'PI'
  },
  {
    name: 'INT',
    kind: 'function',
    syntax: 'INT number',
    description: 'Returns largest integer less than or equal to number (floor).',
    snippet: 'INT ${1:x}'
  },
  {
    name: 'ABS',
    kind: 'function',
    syntax: 'ABS number',
    description: 'Returns absolute positive value of number.',
    snippet: 'ABS ${1:x}'
  },
  {
    name: 'SGN',
    kind: 'function',
    syntax: 'SGN number',
    description: 'Returns sign: -1 if x < 0, 0 if x = 0, 1 if x > 0.',
    snippet: 'SGN ${1:x}'
  },
  {
    name: 'SQR',
    kind: 'function',
    syntax: 'SQR number',
    description: 'Returns square root of non-negative number.',
    snippet: 'SQR ${1:x}'
  },
  {
    name: 'EXP',
    kind: 'function',
    syntax: 'EXP number',
    description: 'Returns exponential e raised to power x.',
    snippet: 'EXP ${1:x}'
  },
  {
    name: 'LN',
    kind: 'function',
    syntax: 'LN number',
    description: 'Returns natural logarithm (base e) of positive number.',
    snippet: 'LN ${1:x}'
  },
  {
    name: 'SIN',
    kind: 'function',
    syntax: 'SIN radians',
    description: 'Returns trigonometric sine of angle in radians.',
    snippet: 'SIN ${1:x}'
  },
  {
    name: 'COS',
    kind: 'function',
    syntax: 'COS radians',
    description: 'Returns trigonometric cosine of angle in radians.',
    snippet: 'COS ${1:x}'
  },
  {
    name: 'TAN',
    kind: 'function',
    syntax: 'TAN radians',
    description: 'Returns trigonometric tangent of angle in radians.',
    snippet: 'TAN ${1:x}'
  },
  {
    name: 'ASN',
    kind: 'function',
    syntax: 'ASN x',
    description: 'Returns arcsine of x in radians [-π/2, π/2].',
    snippet: 'ASN ${1:x}'
  },
  {
    name: 'ACS',
    kind: 'function',
    syntax: 'ACS x',
    description: 'Returns arccosine of x in radians [0, π].',
    snippet: 'ACS ${1:x}'
  },
  {
    name: 'ATN',
    kind: 'function',
    syntax: 'ATN x',
    description: 'Returns arctangent of x in radians [-π/2, π/2].',
    snippet: 'ATN ${1:x}'
  },
  {
    name: 'BIN',
    kind: 'function',
    syntax: 'BIN digits',
    description: 'Interprets following binary digits (0 and 1) as a number.',
    snippet: 'BIN ${1:00000000}'
  },

  // Logical Operators
  {
    name: 'AND',
    kind: 'operator',
    syntax: 'a AND b',
    description: 'Logical AND operator: returns non-zero if both operands are true.',
    snippet: 'AND $0'
  },
  {
    name: 'OR',
    kind: 'operator',
    syntax: 'a OR b',
    description: 'Logical OR operator: returns true if either operand is true.',
    snippet: 'OR $0'
  },
  {
    name: 'NOT',
    kind: 'operator',
    syntax: 'NOT a',
    description: 'Logical NOT operator: returns 1 if operand is 0, otherwise 0.',
    snippet: 'NOT $0'
  },

  // Storage, Devices & Printer
  {
    name: 'LOAD',
    kind: 'storage',
    syntax: 'LOAD "name" [CODE/DATA/SCREEN$]',
    description: 'Loads program code or data blocks from cassette tape.',
    snippet: 'LOAD "${1:name}"'
  },
  {
    name: 'SAVE',
    kind: 'storage',
    syntax: 'SAVE "name" [LINE/CODE/DATA/SCREEN$]',
    description: 'Saves program code or data blocks to cassette tape.',
    snippet: 'SAVE "${1:name}"'
  },
  {
    name: 'VERIFY',
    kind: 'storage',
    syntax: 'VERIFY "name"',
    description: 'Verifies tape recording against current computer memory.',
    snippet: 'VERIFY "${1:name}"'
  },
  {
    name: 'MERGE',
    kind: 'storage',
    syntax: 'MERGE "name"',
    description: 'Merges BASIC program lines from tape into memory without erasing existing lines.',
    snippet: 'MERGE "${1:name}"'
  },
  {
    name: 'LINE',
    kind: 'statement',
    syntax: 'LINE [number]',
    description: 'Specifies autostart line for SAVE "..." LINE num, or reads full string in INPUT LINE a$.',
    snippet: 'LINE ${1:10}'
  },
  {
    name: 'OPEN #',
    kind: 'storage',
    syntax: 'OPEN #channel, device',
    description: 'Opens a communication stream / channel to a peripheral device.',
    snippet: 'OPEN #${1:1}, "${2:device}"'
  },
  {
    name: 'CLOSE #',
    kind: 'storage',
    syntax: 'CLOSE #channel',
    description: 'Closes a communication stream / channel.',
    snippet: 'CLOSE #${1:1}'
  },
  {
    name: 'CAT',
    kind: 'storage',
    syntax: 'CAT [drive]',
    description: 'Displays catalog of files on storage media (Microdrive or disk).',
    snippet: 'CAT'
  },
  {
    name: 'FORMAT',
    kind: 'storage',
    syntax: 'FORMAT spec',
    description: 'Formats storage media (Microdrive or disk).',
    snippet: 'FORMAT ${1:spec}'
  },
  {
    name: 'MOVE',
    kind: 'storage',
    syntax: 'MOVE src, dest',
    description: 'Copies data streams between peripheral channels.',
    snippet: 'MOVE ${1:src}, ${2:dest}'
  },
  {
    name: 'ERASE',
    kind: 'storage',
    syntax: 'ERASE spec',
    description: 'Erases a file from storage media.',
    snippet: 'ERASE "${1:name}"'
  },
  {
    name: 'LIST',
    kind: 'statement',
    syntax: 'LIST [line]',
    description: 'Lists BASIC program code to the screen starting at specified line.',
    snippet: 'LIST ${1:10}'
  },
  {
    name: 'LLIST',
    kind: 'statement',
    syntax: 'LLIST [line]',
    description: 'Lists BASIC program code to attached ZX Printer.',
    snippet: 'LLIST'
  },
  {
    name: 'LPRINT',
    kind: 'statement',
    syntax: 'LPRINT [expression...]',
    description: 'Prints text or data directly to attached ZX Printer.',
    snippet: 'LPRINT $0'
  },
  {
    name: 'COPY',
    kind: 'statement',
    syntax: 'COPY',
    description: 'Copies current screen pixel display to attached ZX Printer.',
    snippet: 'COPY'
  },

  // 128K Sinclair BASIC additions
  {
    name: 'PLAY',
    kind: 'statement',
    syntax: 'PLAY "melody"',
    description: '(128K) Plays multi-channel music on AY-3-8912 sound chip.',
    snippet: 'PLAY "${1:melody}"'
  },
  {
    name: 'SPECTRUM',
    kind: 'statement',
    syntax: 'SPECTRUM',
    description: '(128K) Switches to 48K Sinclair BASIC compatibility mode.',
    snippet: 'SPECTRUM'
  }
];

/**
 * Control codes available inside string literals (bas2tap / tapGenerator format).
 */
const CONTROL_CODES_LIST = [
  { name: 'INK', syntax: '{INK n}', description: 'Embeds foreground color code (0-7, 8=transparent, 9=contrast).' },
  { name: 'PAPER', syntax: '{PAPER n}', description: 'Embeds background color code (0-7, 8=transparent, 9=contrast).' },
  { name: 'FLASH', syntax: '{FLASH n}', description: 'Embeds flashing attribute code (0=off, 1=on, 8=no change).' },
  { name: 'BRIGHT', syntax: '{BRIGHT n}', description: 'Embeds bright attribute code (0=normal, 1=bright, 8=no change).' },
  { name: 'INVERSE', syntax: '{INVERSE n}', description: 'Embeds inverse video attribute code (0=normal, 1=inverse).' },
  { name: 'OVER', syntax: '{OVER n}', description: 'Embeds overprinting mode (0=off, 1=on).' },
  { name: 'AT', syntax: '{AT row, col}', description: 'Embeds cursor positioning control code (row 0-21, col 0-31).' },
  { name: 'TAB', syntax: '{TAB col}', description: 'Embeds tab jump control code (col 0-31).' },
  { name: 'CODE', syntax: '{CODE n}', description: 'Embeds arbitrary byte code (0-255).' }
];

module.exports = {
  KEYWORDS_LIST,
  CONTROL_CODES_LIST
};
