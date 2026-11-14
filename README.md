# ⚡ UltraBoard Pro (`dosh`)

<p align="center">
  <b>A modern, ultra-fast interactive whiteboard for diagrams, notes, and brainstorming.</b><br>
  Built with vanilla JavaScript (ES modules) and HTML5 Canvas 2D, with no third-party dependencies.
</p>

<p align="center">
  <a href="https://sudosas.github.io/dosh/">Open the live demo</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/stack-Vanilla%20JS%20%7C%20Canvas%202D-blue" alt="Tech stack">
  <img src="https://img.shields.io/badge/performance-0%25%20CPU%20idle-success" alt="Performance">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

---

## 🚀 Features

- **Efficient rendering:** A two-layer canvas separates static and interactive content, targeting 0% CPU usage while idle.
- **Flexible arrows and lines:** Create and bend connectors with Bézier curves.
- **Animated pulse mode:** Add glowing animated pulses along arrows for presentations.
- **Interactive code blocks and checklists:** macOS-style cards include syntax highlighting and copy controls.
- **Radial menu:** Quickly access tools and actions around the cursor with the right mouse button.
- **Board manager and always-on rooms:** Keep multiple boards in a local profile using IndexedDB and collaborate through persistent rooms.
- **Customization:** Choose from Light, Dark, Paper, Blueprint, and Midnight themes, with custom accents and grid styles.

## 🛠️ Architecture

This project follows a zero-dependency approach using vanilla JavaScript:

- **Geometry and hit testing:** Custom algorithms for segment and Bézier-curve intersections and handle transformations.
- **Rendering engine:** An optimized Canvas 2D context with cached hatch micro-textures for an Excalidraw-inspired look.
- **Storage:** IndexedDB session caching and scene compression with `CompressionStream('gzip')`, stored in the URL hash.

## 📦 Run locally

1. Clone the repository:

   ```bash
   git clone https://github.com/Sudosas/dosh.git
   cd dosh
   ```

2. Start a local static web server and open the project in your browser. For example, with Python:

   ```bash
   python -m http.server 8000
   ```

   Then visit <http://localhost:8000>.

## 🌐 Live demo

[Open UltraBoard Pro on GitHub Pages](https://sudosas.github.io/dosh/)
