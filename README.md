# Sinclair BASIC for Visual Studio Code (Unofficial)

> **Disclaimer**: This is an independent, unofficial community extension providing development tools for the **Sinclair BASIC** programming language on ZX Spectrum and compatible retro computers. It is not affiliated with, sponsored by, or endorsed by Sinclair Research, Amstrad, Sky, or any of their successors.

---

A comprehensive VS Code extension for developing Sinclair ZX Spectrum BASIC applications, supporting both **Standard Sinclair BASIC (`.bas`)** and an **optional modern pseudo-language (`.jbas`)** with labels, line comments, line-number renumbering, automatic `.tap` compilation, and emulator launching.

---

## Features

### 1. Dual Language Support
* **Standard Sinclair BASIC (`.bas`)**:
  * Accurate syntax highlighting for Sinclair BASIC keywords (`PRINT`, `LET`, `DIM`, `POKE`, `PEEK`, etc.).
  * Display attributes highlighting (`INK`, `PAPER`, `FLASH`, `BRIGHT`, `BORDER`, `OVER`, `INVERSE`).
  * ZX Spectrum functions (`CODE`, `CHR$`, `ATTR`, `POINT`, `SCREEN$`, `BIN`, etc.).
  * Standard `REM` comments.
  * Line number awareness and folding for loops and subroutines.

* **Modern Sinclair BASIC Pseudo-Language (`.jbas`) (Optional)**:
  * Develop without managing line numbers manually.
  * Define structured jump targets with labels: `@label:`.
  * Jump cleanly using `GO TO @label`, `GO SUB @label`, `THEN @label`, etc.
  * Single-quote inline comments: `' this is a comment` (preserving single quotes inside string literals like `PRINT "DON'T"`).
  * Transpiles to clean, standard numbered `.bas` with a single click or shortcut.

### 2. Intelligent Line Renumbering (`.bas`)
* Renumbers program lines starting at line 10 with step 10 (or user-configured values).
* Automatically updates all jump and line references:
  * `GO TO` / `GOTO`
  * `GO SUB` / `GOSUB`
  * `RESTORE`
  * `RUN`
  * `LINE`
  * `THEN <line>`
  * Multi-target computed jumps: `ON x GO TO 10, 20, 30`
* **Zero false positives**: Strings (`PRINT "GOTO 10"`) and `REM` comments are completely untouched.

### 3. Integrated Toolchain & Emulation
* **Build TAP File**: Direct integration with `bas2tap`. Automatically detects the first line for the autostart flag (`-a<line>`).
* **Run in Emulator**: One-click build and launch in your favorite ZX Spectrum emulator (e.g. Fuse, CSpect, Retro Virtual Machine).

---

## Commands

All commands are accessible from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and context menus:

| Command | Identifier | Description |
|---|---|---|
| **Sinclair BASIC: Renumber Lines** | `sinclairBasic.renumber` | Renumbers lines in the active `.bas` document and updates all jump references. |
| **Sinclair BASIC: Compile .jbas to Standard BASIC** | `sinclairBasic.compileJBas` | Compiles the active `.jbas` file into a numbered `.bas` file in the output directory. |
| **Sinclair BASIC: Build TAP File (bas2tap)** | `sinclairBasic.buildTap` | Compiles active `.bas` or `.jbas` to a ZX Spectrum `.tap` tape image. |
| **Sinclair BASIC: Run in Emulator (Fuse)** | `sinclairBasic.runEmulator` | Builds the TAP file and opens it in the configured emulator. |

---

## Configuration Settings

You can customize the extension via VS Code Settings (`settings.json`):

```json
{
  "sinclairBasic.bas2tapPath": "C:\\Users\\rault\\bin\\bas2tap.exe",
  "sinclairBasic.emulatorPath": "C:\\Program Files (x86)\\Fuse\\fuse.exe",
  "sinclairBasic.emulatorArgs": [],
  "sinclairBasic.outputDirectory": "dist",
  "sinclairBasic.renumberStart": 10,
  "sinclairBasic.renumberStep": 10,
  "sinclairBasic.autoStartLine": 0
}
```

* `sinclairBasic.autoStartLine`: When set to `0`, the extension automatically detects the first line number in the BASIC file.

---

## Development & Debugging

1. Open this repository in Visual Studio Code:
   ```bash
   code C:\Users\rault\dev\basic\vscode-sinclair-basic
   ```
2. Press **`F5`** (or go to *Run and Debug* -> *Run Sinclair BASIC Extension*).
3. A new Extension Development Host window will open.
4. Open any `.bas` or `.jbas` file (such as in your game project) and test syntax highlighting, commands, and shortcuts!

### Running Automated Tests
Run the standalone Node test runner (zero external dependencies required):
```bash
npm test
```

---

## License
MIT License.
