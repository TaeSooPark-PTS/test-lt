# Tiro Live Bilingual Caption Workspace (`test-lt`)

Real-time English-to-Korean bilingual caption and presentation workspace built with **Electron**, **React**, and **TypeScript**.

## Features

- **Real-time Bilingual Captions**: Stream English speech/captions and synchronize Korean translations with low latency.
- **Embedded Tiro Integration**: Electron-based integration with Tiro web caption streams and telemetry diagnostics.
- **Slide Stage & Presentation Workspace**: Flexible split-screen layout for presentations, live caption overlays, and monitoring.
- **Configurable Translation Pipeline**: Multi-concurrency translation queue with mock and live provider abstractions.

## Tech Stack

- **Framework**: Electron (v35) + Vite + React 19 + TypeScript
- **Styling**: Modern CSS design system with dark mode presentation styling
- **Packaging**: electron-builder for Windows & Cross-platform deployment

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

```bash
npm install
```

### Development

Run Vite dev server and launch Electron:

```bash
npm run dev
```

### Build & Package

```bash
# Typecheck
npm run typecheck

# Build renderer and electron main process
npm run build

# Package for Windows
npm run pack:win
npm run dist:win
```

## License

MIT
