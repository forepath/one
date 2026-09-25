# Web IDE

Monaco Editor integration for code editing in agent containers. Syntax highlighting, code completion, and file management.

## Overview

The Web IDE provides a full-featured code editor in the browser using Monaco Editor (the same editor that powers VS Code). It enables you to edit files directly in agent containers with syntax highlighting, code completion, and IntelliSense.

## Features

### Syntax Highlighting

Monaco Editor supports syntax highlighting for:

- JavaScript/TypeScript
- Python
- Java
- C/C++
- Go
- Rust
- And many more languages

### Code Completion

- IntelliSense for supported languages
- Auto-completion suggestions
- Parameter hints
- Quick info on hover

### File Management

- Browse file system with multi-select
- Copy / cut / paste files and folders (including recursive folder copy and queued multi-moves)
- Open multiple files (tabs remap when a file or parent folder is moved)
- Save files
- Create new files
- Delete files

### Editor Features

- Line numbers
- Code folding
- Find and replace
- Multi-cursor editing
- Bracket matching
- Auto-indentation

## Usage

### Opening a File

1. Browse the file system in the sidebar
2. Click on a file to open it in the editor
3. The file content is loaded and displayed with syntax highlighting

### Editing a File

1. Make changes in the editor
2. Changes are highlighted (unsaved indicator)
3. Save the file (Ctrl+S or Cmd+S)
4. File is written to the container
5. Success notification is shown

### Creating a File

1. Right-click in the file browser
2. Select "Create File" or "Create Directory"
3. Enter the name
4. File is created in the container
5. File opens in the editor

## Editor Configuration

The editor can be configured with:

- Theme (light/dark)
- Font size
- Tab size
- Word wrap
- Line endings

## Related documentation

- **[File Management](./file-management.md)** File operations
- **[Chat Interface](./chat-interface.md)** Chat with agents

## External resources

- **[Monaco Editor Documentation](https://microsoft.github.io/monaco-editor/)** Editor documentation

_For detailed editor integration, see the feature and deployment docs linked below._
