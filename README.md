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

## 📦 Building for Production

To package the application for your local platform (leveraging electron-builder):
```bash
npm run build
```
