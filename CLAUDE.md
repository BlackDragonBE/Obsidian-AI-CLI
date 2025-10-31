# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian plugin that integrates multiple AI CLI tools (Claude Code, Gemini CLI, OpenAI Codex, and Qwen Code) directly into the Obsidian workspace. Users can execute AI commands through sidebar panels while automatically passing file context and selected text.

## Build Commands

- `npm run dev` - Development build with watch mode
- `npm run build` - Production build (TypeScript check + esbuild)
- `npm run version` - Version bump and update manifest/versions files

## Updating the Plugin

When updating the plugin, make sure to update the version number in the following files:

- `manifest.json`
- `versions.json`
- `package.json`

Also update the `CHANGELOG.md` file.

## Architecture

### Core Plugin Structure
- **Main Plugin Class**: `ObsidianAICliPlugin` - Manages plugin lifecycle, settings, and view registration
- **Unified View System**: Single `ToolView` class handles all AI tool interfaces using a `toolType` parameter
- **Settings Management**: `ObsidianAICliSettings` interface with CLI tool paths for all supported tools

### Key Design Patterns

**Unified Tool Implementation**: All AI tools (Claude Code, Gemini CLI, OpenAI Codex, and Qwen Code) share the same `ToolView` class implementation. The `toolType: 'claude' | 'gemini' | 'codex' | 'qwen'` parameter determines:
- Command construction format in `buildCommand()`
- Timeout of 1 minute to wait for the AI to respond
- Tool-specific CLI arguments and options

**Context Detection Strategy**: The plugin uses multiple fallback methods to detect active files and selections:
1. `app.workspace.getActiveFile()` for file detection
2. `getMostRecentLeaf()` → `getActiveViewOfType(MarkdownView)` → `activeLeaf` for editor access
3. Real-time context updates via workspace event listeners

**Process Management**: Uses Node.js `spawn` for CLI execution with:
- Real-time output streaming to UI
- Cancel functionality with SIGTERM/SIGKILL
- stdin-based prompt delivery for robust handling of complex content
- Comprehensive execution logging with full prompt visibility

### Context Passing Format

The plugin passes context to CLI tools using:
- File references: `@file_path` syntax (e.g., `@document.md`)
- Selected text: Single-line JSON format `Context: {"selectedText":"...", "lineRange": {"start": N, "end": N}}`
- Example: `"Translate to French @document.md Context: {"selectedText":"Hello world", "lineRange": {"start": 5, "end": 7}}"`
- **Delivery Method**: All prompts sent via stdin to avoid shell escaping issues
- **Consistency**: All supported AI tools use identical stdin-based approach

### View System

**Sidebar Panel Management**:
- Views are registered with `CLAUDE_VIEW_TYPE`, `GEMINI_VIEW_TYPE`, `CODEX_VIEW_TYPE`, and `QWEN_VIEW_TYPE` constants
- `activateView()` method handles sidebar creation and focus
- Auto-cleanup on plugin unload via `detachLeavesOfType()` for all view types

**UI Components Per Panel**:
- Prompt textarea with help text
- Run/Cancel button pair
- Real-time output display with scrolling
- Context display with refresh functionality
- Debug information (collapsible)

### Settings Integration

Settings tab provides:
- CLI tool path configuration with test buttons for all four AI tools
- Path validation via version check commands for each tool
- Individual tool enable/disable options

## File Context Management

**File Reference Expansion**: The `expandFileReferences()` method processes `@filename.md` syntax in prompts by reading file contents and replacing references with actual content.

**Event-Driven Updates**: Context automatically refreshes on:
- `active-leaf-change` workspace events
- `file-open` events  
- Prompt input focus
- Manual refresh button clicks

## Development Notes

**TypeScript Configuration**: Uses strict null checks and ES6+ target with DOM libraries. Build process includes TypeScript checking before esbuild compilation.

**Process Execution**: Commands are executed in the vault directory context, not the plugin directory. Working directory is determined by `vault.adapter.basePath`.

**Error Handling**: Comprehensive error handling for missing CLI tools (ENOENT detection), process cancellation, and timeout scenarios with user-friendly notices.

## Command Execution Strategy

**stdin-Based Approach**: The plugin uses stdin for all prompt delivery to both CLI tools:
- Eliminates shell escaping complexity and security vulnerabilities
- Handles complex text with newlines, quotes, and special characters reliably
- Provides consistent behavior between Claude Code and Gemini CLI
- Maintains headless operation through piping (both tools detect piped input automatically)

**Execution Flow**:
1. Build command without prompt content (e.g., `claude --allowedTools ...`, `gemini --yolo`, `codex`, or `qwen`)
2. Spawn process with stdin pipe
3. Write full prompt content to stdin
4. Close stdin to signal completion
5. Stream stdout/stderr to UI in real-time

## PATH Environment Detection (macOS)

**Problem**: macOS GUI applications (including Electron apps like Obsidian) don't inherit the terminal's PATH environment variable. This prevented the plugin from finding Homebrew-installed CLI tools.

**Solution**: The plugin now automatically detects and uses the user's actual shell PATH:

1. **getShellPath()** function tries multiple strategies:
   - Sources shell profile files (~/.zshrc, ~/.zprofile, ~/.bash_profile, ~/.profile)
   - Falls back to login shell (`zsh -l -c "echo $PATH"`)
   - Uses hardcoded Homebrew paths as last resort (`/opt/homebrew/bin:/opt/homebrew/sbin:...`)

2. **getExtendedEnv()** function merges detected PATH with process environment

3. **PATH caching** for performance - detected once and reused

4. **All execution contexts** use extended PATH:
   - Main command execution via `runCommandWithSpawn()`
   - Test button validation via `execAsync()`

**Result**: CLI tools work with simple command names (e.g., `claude` instead of full paths) and have access to system commands (git, npm, etc.) when they execute.

**Console Logging**: The plugin logs PATH detection to browser console for debugging:
```
Detected shell PATH from profile: /opt/homebrew/bin:/usr/local/bin:...
```

## Supported AI Tools

### Claude Code
- **Command**: `claude --allowedTools Read,Edit,Write,Bash,Grep,MultiEdit,WebFetch,TodoRead,TodoWrite,WebSearch`
- **Icon**: Custom Claude logo (orange/brown)
- **Context**: Full file references and selected text support

### Gemini CLI
- **Command**: `gemini --yolo`
- **Icon**: Custom Gemini logo (blue gradient)
- **Context**: Full file references and selected text support
- **Output Filtering**: Automatically filters "Loaded cached credentials" messages

### OpenAI Codex
- **Command**: `codex exec --full-auto --skip-git-repo-check`
- **Icon**: Custom Codex logo (white geometric pattern)
- **Context**: Full file references and selected text support

### Qwen Code
- **Command**: `qwen`
- **Icon**: Custom Qwen logo (purple diamond pattern)
- **Context**: Full file references and selected text support