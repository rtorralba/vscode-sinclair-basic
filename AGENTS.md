# AI Agent Context & Guidelines (AGENTS.md)

Welcome! This document provides complete context for any AI agent working on the **Sinclair BASIC** VS Code Extension (`vscode-sinclair-basic`).

---

## 1. Project Background & Origin

* **Origin**: This extension was extracted and modularized from the `Dino BASIC` project (a Sinclair ZX Spectrum game written in Sinclair BASIC / `.jbas`).
* **Motivation**: Instead of having project-specific scripts (`run_fuse.ps1`, local Python/Node scripts, custom tasks), we created an official-feeling, standalone Visual Studio Code extension to give the entire Sinclair BASIC community a modern development experience (IDE).
* **Target Audience**: Retro programmers creating software and games for the **Sinclair ZX Spectrum** family (16K, 48K, 128K, +2, +3, Next).
* **Identity**: The extension is named **Sinclair BASIC** (`sinclair-basic`) to maximize discoverability while strictly respecting trademark neutrality (clear disclaimer included).

---

## 2. Core Philosophy: Dual-Mode Architecture

1. **Standard Sinclair BASIC (`.bas`) is First-Class**:
   - Standard numbered Sinclair BASIC code is fully supported out of the box.
   - Syntax highlighting for all Sinclair ZX Spectrum BASIC keywords, functions, display attributes, numbers, and `REM` comments.
   - Built-in line renumbering engine with full jump target updates.

2. **Modern Pseudo-Language (`.jbas`) is Optional**:
   - Allows writing Sinclair BASIC without line numbers.
   - Supports labels: `@label:` as jump targets.
   - Supports structured jumps: `GO TO @label`, `GO SUB @label`, `IF ... THEN @label`, `RESTORE @label`, etc.
   - Supports single-quote inline comments (`' comment`), stripping them during compilation while strictly respecting string literals (e.g. `PRINT "DON'T PANIC"`).
   - One-click transpile to standard numbered `.bas`.

---

## 3. Toolchain & User Environment

In the author's local environment, the tools are configured as:
* **bas2tap**: `C:\Users\user\bin\bas2tap.exe` (compiles `.bas` to `.tap` tape image with autostart `-a<line>`).
* **Fuse Emulator**: `C:\Program Files (x86)\Fuse\fuse.exe`.
* The extension allows full configuration via `settings.json` under the `sinclairBasic.*` namespace.

---

## 4. Repository Structure

```text
vscode-sinclair-basic/
|-- .vscode/
|   |-- launch.json                      # F5 Extension Development Host configuration
|   +-- tasks.json                       # npm test task definition
|-- syntaxes/
|   |-- sinclair-basic.tmLanguage.json   # TextMate grammar for standard .bas (line numbers & REM)
|   +-- jbas.tmLanguage.json             # TextMate grammar for .jbas (@labels & ' comments)
|-- language-configuration-bas.json      # Brackets, auto-closing & folding for .bas
|-- language-configuration-jbas.json     # Plegado y comentarios para .jbas
|-- src/
|   |-- extension.js                     # VS Code Desktop Extension entry point
|   |-- webExtension.js                  # VS Code Web Extension entry point (vscode.dev / github.dev)
|   +-- core/
|       |-- renumber.js                  # Core engine: Sinclair BASIC line renumbering & jump target updates
|       |-- jbas2bas.js                  # Core engine: .jbas compiler to standard numbered .bas
|       +-- tapGenerator.js              # Core engine: Native Pure JS ZX Spectrum .tap generator
|-- dist/
|   +-- webExtension.js                  # Bundled single-file web extension (built via esbuild)
|-- test/
|   |-- fixtures/
|   |   +-- sample.bas                   # Test fixture with jump matrix
|   |-- renumber.test.js                 # Unit tests for renumbering engine
|   |-- jbas2bas.test.js                 # Unit tests for jbas transpiler engine
|   +-- tapGenerator.test.js             # Unit tests for pure JS tap generator
|-- AGENTS.md                            # Complete AI instructions (this file)
|-- README.md                            # User-facing documentation & quickstart
|-- LICENSE                              # MIT License
+-- package.json                         # Extension manifest, language definitions & configuration schema
```

---

## 5. Current State & What Was Implemented

1. **Renumbering Engine (`src/core/renumber.js`)**:
   - Translated from Python to pure Node.js/JavaScript without external dependencies.
   - Respects string literals and `REM` comments without touching internal numbers.
   - Safely updates `GO TO`, `GOTO`, `GO SUB`, `GOSUB`, `RESTORE`, `RUN`, `LINE`, `THEN <line>`, and multi-target jumps (`ON x GO TO 10, 20, 30`).
   - Supports custom `start` and `step` increments.

2. **jbas Transpiler (`src/core/jbas2bas.js`)**:
   - 2-pass compiler:
     - Pass 1: Strips `'` comments or converts to `: REM`, ignores blank lines, collects `@label:` targets, assigns sequential numbers.
     - Pass 2: Substitutes `@label` references outside strings with mapped line numbers.
   - Detects and reports undefined labels and duplicate definitions.
   - Smart whitespace compaction (`compactWhitespaceOutsideStrings`): For the compact optimal build (`dist/<filename>.bas`), strips redundant spaces around operators (`=`, `+`, `-`, `*`, `/`, `^`, `<`, `>`, `<=`, `>=`, `<>`, `(`, `)`, `,`, `;`, `:`), preserving spaces inside string literals and `REM` comments while keeping `step10` readable.
   - **Attribute & String Constant Optimization (`optimizeAttributesAndStrings`)**: Automatically folds constant `CHR$` chains (e.g. `CHR$ 17 + CHR$ 4 + " "` -> `"{PAPER 4} "`) and absorbs constant display attributes and coordinates in `PRINT` (`PRINT AT 10,1; "TEXT"` -> `PRINT "{AT 10,1}TEXT"`, `PRINT PAPER 2; " "` -> `PRINT "{PAPER 2} "`) for maximum execution speed in ZX Spectrum ROM.
   - **ZX Spectrum ROM `0x0D` (Enter) Safeguard**: Row 13 or Column 13 in `AT row, col` are strictly NEVER absorbed into string literals (e.g. `PRINT AT 13, 7; "{PAPER 7} "`). In the ZX Spectrum ROM, byte `13` (`0x0D`) is the line terminator (`Enter`). If byte 13 appears inside string literals within program lines, the ROM parser thinks the line ended before the closing quote and halts with error `C Nonsense in BASIC`.

3. **Pure JavaScript TAP Generator (`src/core/tapGenerator.js`)**:
   - Native Sinclair BASIC tokenizer and ZX Spectrum `.tap` generator written in pure JS.
   - Encodes Sinclair BASIC token bytes (0x80-0xFF), ZX Spectrum floating-point numbers, UDGs, and line lengths.
   - Full support for `bas2tap` control escape sequences inside string literals: `{PAPER n}`, `{INK n}`, `{FLASH n}`, `{BRIGHT n}`, `{INVERSE n}`, `{OVER n}`, `{AT y, x}`, `{TAB x}`, `{CODE n}`, `{#HH}`, and `\xHH`.
   - Exact whitespace parity with `bas2tap`: Automatically consumes trailing spaces after keywords/tokens, `:` statement separators, and `REM` to prevent double spaces when listed on the ZX Spectrum ROM (e.g. `LET py=0` and `CHR$ 18`).
   - Zero external binary requirements (no `bas2tap.exe` needed by default).

4. **Integrated Web Emulator: Turbo80 (`src/extension.js`)**:
   - Integrated VS Code Webview panel embedding [Turbo80](https://turbo80.com) (by José Enrique García (Incinerator)).
   - Passes the generated `.tap` file directly via memory/base64 without uploading to external servers.
   - Authentic audio, CRT shader effects, 48K/128K machine models, and on-screen keyboard.
   - Explicit attribution footer in the Webview: `Emulado con Turbo80 — Emulador de ZX Spectrum por José Enrique García (Incinerator)`.
   - Allows falling back to external desktop emulators (Fuse, etc.) if configured.

5. **VS Code Extension Integration (`src/extension.js` & `src/webExtension.js`)**:
   - `sinclairBasic.compileJBas`: Transpila `.jbas` generando las 3 versiones en `dist/` y compila **exclusivamente la versión óptima (1 en 1 sin comentarios y compactada: `dist/<filename>.bas`)** en `dist/<filename>.tap` (`Ctrl+Shift+B`).
   - `sinclairBasic.transpileJBas`: Transpila `.jbas` generando las 3 versiones en `dist/`:
     1. `dist/<filename>.bas`: Líneas 1 a 1, sin comentarios y con espacios de operadores compactados (máxima optimización para cinta y RAM del Spectrum).
     2. `dist/<filename>-step10.bas`: Líneas de 10 en 10, sin comentarios (versión estándar para desarrollo y lectura).
     3. `dist/<filename>-comments.bas`: Líneas de 10 en 10, con comentarios convertidos a `REM` (versión documentada).
     Abre `dist/<filename>-step10.bas` en el editor sin generar TAP (`Ctrl+Shift+T`).
   - `sinclairBasic.compileBas` / `sinclairBasic.buildTap`: Compila `.bas` a `dist/<filename>.tap` nativamente (`Ctrl+Shift+B`).
   - `sinclairBasic.renumber` / `sinclairBasic.renumberBas`: Renumbra líneas directamente en el editor activo con actualización de saltos y soporte de undo/redo (`Ctrl+Alt+R`).
   - `sinclairBasic.runEmulator`: Construye el TAP óptimo y lanza el emulador Turbo80 con foco automático (`Ctrl+F5`).
   - `sinclairBasic.runTurbo80`: Lanza explícitamente el Webview de Turbo80 con foco automático.
   - `sinclairBasic.runExternalEmulator`: Lanza explícitamente el emulador de escritorio configurado (ej. Fuse).
   - Integración completa en barras de herramientas de editor (`editor/title`), menú contextual del editor (`editor/context`), explorador (`explorer/context`) y paleta de comandos.

6. **Automated Tests**:
   - Running with `npm test` (`node -c src/extension.js && node -c src/webExtension.js && npm run build-web && node --test test/*.test.js`). 29 passing tests.

---

## 6. Where We Left Off & Next Steps (Roadmap)

When you open this project in VS Code, here is what is ready to be done:

1. **Manual F5 Smoke Test in Extension Development Host**:
   - Press `F5` in VS Code to launch the Extension Development Host.
   - Open a `.bas` file -> verify highlighting and run `Sinclair BASIC: Renumber Lines`.
   - Open a `.jbas` file -> verify highlighting, run `Sinclair BASIC: Transpile .jbas to .bas` (genera las 3 versiones en `dist/`), `Build TAP`, and `Run in Emulator`.
2. **TypeScript / Type Declarations**:
   - Currently written in modern Node.js CommonJS for zero-build speed.
   - You can add `npm install --save-dev @types/vscode` if you want VS Code API autocomplete in `src/extension.js`.
3. **Future Feature Ideas**:
   - DocumentSymbolProvider / Outline: show `@labels` in the VS Code Outline explorer.
   - Snippets for Sinclair BASIC routines (screen attributes, UDGs, sound effects).
   - Hover provider with Sinclair BASIC token reference.

---

## 7. Strict Rules for AI Agents

1. **Always run tests before finishing any change**:
   ```bash
   npm test
   ```
2. **Zero false positives**:
   - Never alter text inside `"double quotes"` or after `REM` comments.
3. **Keep core pure**:
   - `src/core/renumber.js` and `src/core/jbas2bas.js` must remain pure JavaScript without VS Code API dependencies so they can be run in CLI, web, or automated test runners.
4. **MUY IMPORTANTE: Generación de TAP siempre con la versión más óptima**:
   - Para compilar a imagen de cinta `.tap`, se DEBE usar SIEMPRE la versión más óptima: **líneas de 1 en 1, sin comentarios y con compactación de espacios en operadores** (`dist/<filename>.bas`).
   - Esto minimiza drásticamente los bytes en la cinta, reduce el consumo de memoria RAM en el ZX Spectrum y agiliza la velocidad de ejecución del intérprete de Sinclair BASIC al evitar saltar sobre o procesar líneas de comentarios `REM`.
5. **NUNCA emitir byte 13 (0x0D) dentro de cadenas literales de Sinclair BASIC**:
   - El byte `13` (`0x0D`) es el carácter de salto de línea / `ENTER` en la ROM del Sinclair ZX Spectrum.
   - Si un literal de cadena en una línea contiene el byte 13 (por ejemplo, `{AT 13, col}` o `{CODE 13}`), el analizador de la ROM cree que la línea ha terminado antes de cerrar las comillas y aborta con el error `C Nonsense in BASIC`. Por tanto, `AT 13, col` y `AT row, 13` se deben mantener siempre en sintaxis estándar de Sinclair BASIC fuera de las comillas.