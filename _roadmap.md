# Markus the Writer - MVP Roadmap

This roadmap outlines the key milestones and tasks for achieving the Minimum Viable Product (MVP) of Markus the Writer, based on the features described in the `README.md`.

## Milestone 1: Core Editing and Rendering

*   **Objective:** Establish the fundamental real-time Markdown editing and rendering capabilities.
    *   [x] Set up Electron and React project structure.
    *   [x] Implement basic text area for Markdown input.
    *   [x] Integrate `Marked` for Markdown parsing.
    *   [x] Display real-time rendered output alongside the editor.
    *   [x] Ensure basic Markdown syntax (headers, bold, italics, lists) renders correctly.
    *   [ ] Implement a clean, distraction-free UI layout.

## Milestone 2: Native File Operations

*   **Objective:** Enable users to open, save, and manage `.md` files directly on their local filesystem.
    *   [ ] Implement "Open File" functionality (dialog to select `.md` file).
    *   [ ] Implement "Save File" functionality (save current content to disk).
    *   [ ] Implement "Save As" functionality.
    *   [ ] Handle file content loading into the editor.
    *   [ ] Implement change detection for external file modifications (warn user).

## Milestone 3: Application Integration & Cross-Platform Support

*   **Objective:** Ensure the application integrates well with the operating system and functions across target platforms.
    *   [ ] Implement logic to open files passed as command-line arguments.
    *   [ ] Research and implement `.md` file association for default application registration (OS-specific).
    *   [ ] Test core functionalities on GNOME/Linux.
    *   [ ] Test core functionalities on macOS.
    *   [ ] Test core functionalities on Windows.
    *   [ ] Configure `electron-builder` for packaging across all target platforms.
