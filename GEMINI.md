# AI Agent Context & Guidelines (AGENTS.md)

Welcome! This document provides complete context for any AI agent working on the **Sinclair BASIC (Unofficial)** VS Code Extension (`vscode-sinclair-basic`).

---

## 1. Project Background & Origin

* **Origin**: This extension was extracted and modularized from the `Dino BASIC` project (a Sinclair ZX Spectrum game written in Sinclair BASIC / `.jbas`).
* **Motivation**: Instead of having project-specific scripts (`run_fuse.ps1`, local Python/Node scripts, custom tasks), we created an official-feeling, standalone Visual Studio Code extension to give the entire Sinclair BASIC community a modern development experience (IDE).
* **Target Audience**: Retro programmers creating software and games for the **Sinclair ZX Spectrum** family (16K, 48K, 128K, +2, +3, Next).
* **Identity**: The extension is named **Sinclair BASIC (Unofficial)** (`sinclair-basic`) to maximize discoverability while strictly respecting trademark neutrality (clear disclaimer included).

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
|   |-- extension.js                     # VS Code Extension entry point & command registrations
|   +-- core/
|       |-- renumber.js                  # Core engine: Sinclair BASIC line renumbering & jump target updates
|       |-- jbas2bas.js                  # Core engine: .jbas compiler to standard numbered .bas
|       +-- tapGenerator.js              # Core engine: Native Pure JS ZX Spectrum .tap generator
|-- test/
|   |-- fixtures/
|   |   +-- sample.bas                   # Test fixture with jump matrix
|   |-- renumber.test.js                 # Unit tests for renumbering engine
|   |-- jbas2bas.test.js                 # Unit tests for jbas transpiler engine
|   +-- tapGenerator.test.js             # Unit tests for pure JS tap generator
|-- AGENTS.md                            # Complete AI instructions (this file)
|-- GEMINI.md                            # Mirrored AI instructions for Gemini / Antigravity
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
     - Pass 1: Strips `'` comments, ignores blank lines, collects `@label:` targets, assigns sequential numbers.
     - Pass 2: Substitutes `@label` references outside strings with mapped line numbers.
   - Detects and reports undefined labels and duplicate definitions.

3. **VS Code Extension Integration (`src/extension.js`)**:
   - `sinclairBasic.compileJBas`: Compiles `.jbas` to compact intermediate `dist/<filename>.bas` (numbered 1 by 1) and builds `dist/<filename>.tap` via `bas2tap` without opening the intermediate `.bas` file (`Ctrl+Shift+B`).
   - `sinclairBasic.transpileJBas`: Transpiles `.jbas` to `dist/<filename>.bas` (numbered 10 by 10) and opens it in editor. Does not generate `.tap` (`Ctrl+Shift+T`).
   - `sinclairBasic.compileBas` / `sinclairBasic.buildTap`: Compiles `.bas` to `dist/<filename>.tap` via `bas2tap` (`Ctrl+Shift+B`).
   - `sinclairBasic.renumber` / `sinclairBasic.renumberBas`: Renumbers lines directly in active editor with jump updates and undo/redo support (`Ctrl+Alt+R`).
   - `sinclairBasic.runEmulator`: Builds TAP and launches configured emulator (`Ctrl+F5`).
   - Full integration with Editor Toolbar (`editor/title`), Editor Context menu (`editor/context`), Explorer File menu (`explorer/context`), and Command Palette.


4. **Automated Tests**:
   - Running with `npm test` (`node --test test/*.test.js`). 17 passing tests.

---

## 6. Where We Left Off & Next Steps (Roadmap)

When you open this project in VS Code, here is what is ready to be done:

1. **Manual F5 Smoke Test in Extension Development Host**:
   - Press `F5` in VS Code to launch the Extension Development Host.
   - Open a `.bas` file -> verify highlighting and run `Sinclair BASIC: Renumber Lines`.
   - Open a `.jbas` file -> verify highlighting, run `Sinclair BASIC: Compile .jbas`, `Build TAP`, and `Run in Emulator`.
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