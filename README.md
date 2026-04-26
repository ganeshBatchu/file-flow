# FileFlow

FileFlow is an intelligent file organization and management application built with Electron, React, and TypeScript. It automatically categorizes, clusters, and organizes your files based on content, metadata, and user personas.

## 🚀 Features

- **Automated Organization**: A background daemon watches directories and automatically moves, deduplicates, and organizes files.
- **Intelligent Classification**: Uses TF-IDF, metadata extraction, and sibling inference to accurately classify files into logical categories.
- **Persona-Based Workflows**: Tailored classification rules for various personas, including Software Engineers, Researchers, Designers, Accountants, and more.
- **Safety First**: Built-in quarantine system, path guards, conflict resolution, dry-run mode, and a complete undo journal to protect your data.
- **Modern UI**: A responsive React front-end powered by Vite and Tailwind CSS for exploring files, viewing history, and managing settings.

## 📁 Project Structure

- \`src/\`: Core engine (daemon, intelligent classifiers, organizers, safety features).
- \`gui/\`: React-based frontend application.
- \`electron/\`: Electron main process, preload scripts, IPC handlers, and system tray integration.
- \`resources/\`: macOS entitlements, icons, and native helpers (e.g., vision-helper).

## 🛠️ Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- npm, yarn, or pnpm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/<your-username>/fileflow.git
   cd fileflow
   ```

2. Install dependencies (adjust according to your package manager):
   ```bash
   npm install
   ```

3. Start the application in development mode:
   ```bash
   npm run dev
   ```

## 🧪 Try It With the Sample Corpus

A ready-made test corpus lives at `tests/fixtures/persona-corpus.zip`. It contains 532 files spread across 10 persona folders (job seeker, lawyer, accountant, researcher, data scientist, writer, designer, photographer, software engineer, office worker), each holding a realistic mix of PDFs, docs, images, audio, video, code, and archives.

1. Unzip the corpus somewhere on disk:
   ```bash
   unzip tests/fixtures/persona-corpus.zip -d ~/fileflow-demo
   ```
   You will end up with `~/fileflow-demo/fileflow_sandbox_personaTesting/<persona>/...`.

2. Launch the app:
   ```bash
   npm run dev
   ```

3. In FileFlow, open **Settings** in the sidebar, scroll to the **Watch Directories** section, click **Add Directory**, and pick one of the unzipped persona folders (for example `~/fileflow-demo/fileflow_sandbox_personaTesting/software_engineer`). You can add as many or as few as you want.

4. Trigger organization:
   - From the **Files** page, click **Organize Now** to classify the watched directory in one pass, or
   - From the **Dashboard**, start the daemon to watch the directory continuously.

5. Watch the **Dashboard** activity feed as files get classified, moved into category subfolders, and (where applicable) deduplicated or quarantined. Each persona folder includes one intentionally ambiguous file, so you can see how the engine handles edge cases.

## 📦 Building for Production

To package the application for your local platform (leveraging electron-builder):
```bash
npm run build
```
