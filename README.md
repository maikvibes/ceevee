# CeeVee - AI CV Processor

CeeVee is a powerful, locally-run AI CV processing application built with Electron, React, and Vite. It allows you to quickly ingest, parse, and organize candidate CVs using advanced Large Language Models (LLMs) and synchronize that data directly into Notion.

## Features

- **Multi-File Document Ingestion**: Seamlessly drag and drop PDFs, DOCX files, or LinkedIn URLs to process candidate profiles.
- **AI-Powered Parsing**: Extract structured data (skills, job types, locations, summaries) from unstructured resumes using your choice of AI provider (OpenAI, Anthropic, Gemini, OpenRouter).
- **Notion Synchronization**: Push structured candidate profiles directly to a Notion database with a single click.
- **Dynamic Theming Engine**: Fully native Shadcn UI with support for dynamic TweakCN custom CSS themes, allowing for limitless personalization.
- **Custom Taxonomy Management**: Build and manage custom skill tags and job types directly within the application.
- **CSV Exporting**: Easily export your candidate data to CSV files for use in spreadsheets or other ATS software.
- **Offline-First Storage**: Candidate data is securely stored locally using SQLite, ensuring your data is private and fast.

## Technology Stack

- **Framework**: Electron + React + Vite (`electron-vite`)
- **Styling**: Tailwind CSS v4 + Shadcn UI
- **Database**: SQLite (via `better-sqlite3`) + Drizzle ORM
- **Parsing/Extracting**: `pdf-parse` (for PDFs), `mammoth` (for DOCX), `cheerio` (for URLs)
- **AI Integration**: AI SDK with dynamic provider support
- **State Management**: React Hooks + Local Storage

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/en/) (v18 or higher recommended)
- Your choice of AI API Key (OpenRouter, OpenAI, Anthropic, or Gemini)
- (Optional) A Notion API Integration Token for database syncing

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/ceevee.git
   cd ceevee
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the application in development mode:**
   ```bash
   npm run dev
   ```

### Building for Production

To build the application for your operating system:

```bash
npm run build
```

## Setup & Configuration

Once the app is running, navigate to the **Settings** view (the gear icon):

1. **AI Provider Setup:** Select your preferred AI provider and enter your API Key. Be sure to select a model ID.
2. **Notion Setup (Optional):** Enter your Notion Integration Token and your target Notion Database ID. Ensure your Notion integration is invited to the target database.
3. **Appearance:** Select a custom theme or paste your own `tweakcn` CSS string to personalize the interface.

## Usage

1. **Ingress Queue**: Drag and drop CVs into the Home View dropzone. The background processor will automatically extract the text and use the configured AI model to parse the candidate's details.
2. **CV Repository**: Once processing is complete, navigate to the Candidate List to view, sort, filter, and edit candidate profiles.
3. **Notion Sync**: Double-click a candidate or view their profile to sync their data to your connected Notion database.

## Architecture

- `src/main`: Contains the main process code, including database initialization, IPC handlers, and background queue processing.
- `src/renderer`: Contains the React frontend UI built with Shadcn and Tailwind.
- `src/preload`: Exposes safe API endpoints via the Electron `contextBridge` to the renderer.

## License

This project is licensed under the MIT License.
