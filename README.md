# Prompt Palette

A desktop command palette for managing and injecting structured JSON prompts into other applications. Built with [Tauri 2](https://tauri.app/), React, and Rust.

> Upgraded from the [AutoHotkey version](https://github.com/duck-lint/prompt-palette)

<img width="515" height="825" alt="Prompt Palette screenshot" src="https://github.com/user-attachments/assets/75767473-44b0-4cd3-b24b-3e0bf4837ac5" />

## Features

- **Global hotkey** — Press **Ctrl + Alt + Space** to summon the palette from any application (Windows)
- **Search & filter** — Quickly find prompt templates by name
- **Interactive field filling** — Fill in template placeholders with a guided form
- **Live JSON validation** — Real-time feedback as you fill templates
- **Paste to target app** — Automatically paste the rendered prompt back into the window you were working in (Windows)
- **Clipboard copy** — Copy rendered prompts to the clipboard on any platform
- **System tray** — Minimises to the tray; stays ready in the background
- **16 built-in templates** — Includes general-purpose and team-advisor prompt templates

## Tech Stack

| Layer    | Technology                          |
| -------- | ----------------------------------- |
| Frontend | React 19, TypeScript, Vite          |
| Backend  | Rust, Tauri 2                       |
| Platform | Windows API (hotkey, clipboard, paste) |

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Rust](https://www.rust-lang.org/tools/install)
- Platform build tools — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/duck-lint/prompt_palette_Tauri.git
cd prompt_palette_Tauri/prompt_palette

# Install frontend dependencies
npm install

# Run in development mode (starts both Vite dev server and Tauri)
npm run tauri dev

# Build for production
npm run tauri build
```

## Keyboard Shortcuts

### Search mode

| Shortcut       | Action                    |
| -------------- | ------------------------- |
| `Ctrl+Alt+Space` | Show palette (global, Windows) |
| `↑` / `↓`     | Navigate results          |
| `Enter`        | Open selected template    |
| `Escape`       | Hide palette              |

### Fill mode

| Shortcut       | Action                    |
| -------------- | ------------------------- |
| `Enter`        | Next field                |
| `Shift+Enter`  | Newline in current field  |
| `Escape`       | Back to search            |

## Project Structure

```
prompt_palette/
├── src/                     # React frontend
│   ├── App.tsx              # Main UI component
│   ├── promptCatalog.ts     # Template loader & renderer
│   └── prompts/             # JSON prompt templates
├── src-tauri/               # Rust backend
│   ├── src/
│   │   ├── lib.rs           # Tauri commands & app setup
│   │   └── windows_palette.rs # Windows hotkey, clipboard & paste
│   └── tauri.conf.json      # Tauri configuration
├── package.json
└── vite.config.ts
```

## Prompt Templates

Templates live in `src/prompts/` as JSON files. Each template can contain `{{placeholder}}` tokens that the user fills in through the palette UI before the prompt is pasted.

**Included templates:**

| Category | Templates |
| -------- | --------- |
| General  | Code, Discussion, Philosophy, Quick Default, Writing Drafts |
| Team Advisors | Data/Schema, Architecture, Backend, Tooling/Platform, Frontend, QA, Security, Integration Manager, plus handoff templates |

## Platform Notes

| Feature               | Windows | macOS / Linux |
| --------------------- | :-----: | :-----------: |
| Global hotkey         | ✅      | ❌            |
| Paste to target app   | ✅      | ❌            |
| Copy to clipboard     | ✅      | ✅            |
| System tray           | ✅      | ✅            |
| UI & template filling | ✅      | ✅            |
