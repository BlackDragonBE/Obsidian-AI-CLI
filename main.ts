import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, TFile, addIcon, MarkdownRenderer, Component, Modal } from 'obsidian';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);

// Cache for the user's shell PATH
let cachedShellPath: string | null = null;

/**
 * Get the user's actual shell PATH environment variable.
 * This is necessary on macOS because GUI apps don't inherit the terminal's PATH.
 * Caches the result for performance.
 */
async function getShellPath(): Promise<string> {
	if (cachedShellPath) {
		return cachedShellPath;
	}

	try {
		// Try to get PATH from the user's shell by sourcing their profile
		// This works more reliably from GUI apps on macOS
		const shellCommands = [
			'source ~/.zshrc 2>/dev/null && echo $PATH',
			'source ~/.zprofile 2>/dev/null && echo $PATH',
			'source ~/.bash_profile 2>/dev/null && echo $PATH',
			'source ~/.profile 2>/dev/null && echo $PATH'
		];

		for (const cmd of shellCommands) {
			try {
				const { stdout } = await execAsync(`zsh -c '${cmd}'`);
				const path = stdout.trim();
				if (path && path.includes('/opt/homebrew/bin')) {
					cachedShellPath = path;
					console.log('Detected shell PATH from profile:', cachedShellPath);
					return cachedShellPath;
				}
			} catch (e) {
				// Try next command
				continue;
			}
		}

		// If profile sourcing didn't work, try login shell
		const { stdout } = await execAsync('zsh -l -c "echo $PATH"');
		cachedShellPath = stdout.trim();
		console.log('Detected shell PATH from login shell:', cachedShellPath);
		return cachedShellPath;
	} catch (error) {
		console.error('Failed to detect shell PATH, using fallback:', error);
		// Fallback to common paths on macOS (prioritize Homebrew)
		cachedShellPath = '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
		console.log('Using fallback PATH:', cachedShellPath);
		return cachedShellPath;
	}
}

/**
 * Get environment variables with extended PATH for spawning processes.
 * Merges the user's actual shell PATH with the current process environment.
 */
async function getExtendedEnv(): Promise<NodeJS.ProcessEnv> {
	const shellPath = await getShellPath();
	return {
		...process.env,
		PATH: shellPath
	};
}

interface ObsidianAICliSettings {
	claudeCodePath: string;
	geminiCliPath: string;
	codexPath: string;
	qwenPath: string;
	claudeParams: string;
	geminiParams: string;
	codexParams: string;
	qwenParams: string;
	promptStorageFile: string;
}

const DEFAULT_SETTINGS: ObsidianAICliSettings = {
	claudeCodePath: 'claude',
	geminiCliPath: 'gemini',
	codexPath: 'codex',
	qwenPath: 'qwen',
	claudeParams: '--allowedTools Read,Edit,Write,Bash,Grep,MultiEdit,WebFetch,TodoRead,TodoWrite,WebSearch',
	geminiParams: '--yolo',
	codexParams: 'exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check',
	qwenParams: '--yolo',
	promptStorageFile: 'ai-prompts.md'
}

const CLAUDE_VIEW_TYPE = 'claude-code-view';
const GEMINI_VIEW_TYPE = 'gemini-cli-view';
const CODEX_VIEW_TYPE = 'codex-view';
const QWEN_VIEW_TYPE = 'qwen-view';

export default class ObsidianAICliPlugin extends Plugin {
	settings: ObsidianAICliSettings;

	async onload() {
		await this.loadSettings();

		// Register custom icons
		console.log('Registering Claude and Gemini icons...');
		addIcon('claude-icon', `<svg xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" image-rendering="optimizeQuality" fill-rule="evenodd" clip-rule="evenodd" viewBox="0 0 512 509.64"><path fill="#D77655" d="M115.612 0h280.775C459.974 0 512 52.026 512 115.612v278.415c0 63.587-52.026 115.612-115.613 115.612H115.612C52.026 509.639 0 457.614 0 394.027V115.612C0 52.026 52.026 0 115.612 0z"/><path fill="#FCF2EE" fill-rule="nonzero" d="M142.27 316.619l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474-.101.102.024.101z"/></svg>`);
		console.log('Claude icon registered');

		addIcon('gemini-icon', `<svg fill="none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M16 8.016A8.522 8.522 0 008.016 16h-.032A8.521 8.521 0 000 8.016v-.032A8.521 8.521 0 007.984 0h.032A8.522 8.522 0 0016 7.984v.032z" fill="url(#prefix__paint0_radial_980_20147)"/><defs><radialGradient id="prefix__paint0_radial_980_20147" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="matrix(16.1326 5.4553 -43.70045 129.2322 1.588 6.503)"><stop offset=".067" stop-color="#9168C0"/><stop offset=".343" stop-color="#5684D1"/><stop offset=".672" stop-color="#1BA1E3"/></radialGradient></defs></svg>`);
		console.log('Gemini icon registered');

		addIcon('codex-icon', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 158.7128 157.296"><path fill="white" d="M60.8734,57.2556v-14.9432c0-1.2586.4722-2.2029,1.5728-2.8314l30.0443-17.3023c4.0899-2.3593,8.9662-3.4599,13.9988-3.4599,18.8759,0,30.8307,14.6289,30.8307,30.2006,0,1.1007,0,2.3593-.158,3.6178l-31.1446-18.2467c-1.8872-1.1006-3.7754-1.1006-5.6629,0l-39.4812,22.9651ZM131.0276,115.4561v-35.7074c0-2.2028-.9446-3.7756-2.8318-4.8763l-39.481-22.9651,12.8982-7.3934c1.1007-.6285,2.0453-.6285,3.1458,0l30.0441,17.3024c8.6523,5.0341,14.4708,15.7296,14.4708,26.1107,0,11.9539-7.0769,22.965-18.2461,27.527v.0021ZM51.593,83.9964l-12.8982-7.5497c-1.1007-.6285-1.5728-1.5728-1.5728-2.8314v-34.6048c0-16.8303,12.8982-29.5722,30.3585-29.5722,6.607,0,12.7403,2.2029,17.9324,6.1349l-30.987,17.9324c-1.8871,1.1007-2.8314,2.6735-2.8314,4.8764v45.6159l-.0014-.0015ZM79.3562,100.0403l-18.4829-10.3811v-22.0209l18.4829-10.3811,18.4812,10.3811v22.0209l-18.4812,10.3811ZM91.2319,147.8591c-6.607,0-12.7403-2.2031-17.9324-6.1344l30.9866-17.9333c1.8872-1.1005,2.8318-2.6728,2.8318-4.8759v-45.616l13.0564,7.5498c1.1005.6285,1.5723,1.5728,1.5723,2.8314v34.6051c0,16.8297-13.0564,29.5723-30.5147,29.5723v.001ZM53.9522,112.7822l-30.0443-17.3024c-8.652-5.0343-14.471-15.7296-14.471-26.1107,0-12.1119,7.2356-22.9652,18.403-27.5272v35.8634c0,2.2028.9443,3.7756,2.8314,4.8763l39.3248,22.8068-12.8982,7.3938c-1.1007.6287-2.045.6287-3.1456,0ZM52.2229,138.5791c-17.7745,0-30.8306-13.3713-30.8306-29.8871,0-1.2585.1578-2.5169.3143-3.7754l30.987,17.9323c1.8871,1.1005,3.7757,1.1005,5.6628,0l39.4811-22.807v14.9435c0,1.2585-.4721,2.2021-1.5728,2.8308l-30.0443,17.3025c-4.0898,2.359-8.9662,3.4605-13.9989,3.4605h.0014ZM91.2319,157.296c19.0327,0,34.9188-13.5272,38.5383-31.4594,17.6164-4.562,28.9425-21.0779,28.9425-37.908,0-11.0112-4.719-21.7066-13.2133-29.4143.7867-3.3035,1.2595-6.607,1.2595-9.909,0-22.4929-18.2471-39.3247-39.3251-39.3247-4.2461,0-8.3363.6285-12.4262,2.045-7.0792-6.9213-16.8318-11.3254-27.5271-11.3254-19.0331,0-34.9191,13.5268-38.5384,31.4591C11.3255,36.0212,0,52.5373,0,69.3675c0,11.0112,4.7184,21.7065,13.2125,29.4142-.7865,3.3035-1.2586,6.6067-1.2586,9.9092,0,22.4923,18.2466,39.3241,39.3248,39.3241,4.2462,0,8.3362-.6277,12.426-2.0441,7.0776,6.921,16.8302,11.3251,27.5271,11.3251Z"/></svg>`);
		console.log('Codex icon registered');

		addIcon('qwen-icon', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><path d="M174.82 108.75L155.38 75L165.64 57.75C166.46 56.31 166.46 54.53 165.64 53.09L155.38 35.84C154.86 34.91 153.87 34.33 152.78 34.33H114.88L106.14 19.03C105.62 18.1 104.63 17.52 103.54 17.52H83.3C82.21 17.52 81.22 18.1 80.7 19.03L61.26 52.77H41.02C39.93 52.77 38.94 53.35 38.42 54.28L28.16 71.53C27.34 72.97 27.34 74.75 28.16 76.19L45.52 107.5L36.78 122.8C35.96 124.24 35.96 126.02 36.78 127.46L47.04 144.71C47.56 145.64 48.55 146.22 49.64 146.22H87.54L96.28 161.52C96.8 162.45 97.79 163.03 98.88 163.03H119.12C120.21 163.03 121.2 162.45 121.72 161.52L141.16 127.78H158.52C159.61 127.78 160.6 127.2 161.12 126.27L171.38 109.02C172.2 107.58 172.2 105.8 171.38 104.36L174.82 108.75Z" fill="url(#paint0_radial)"/><path d="M119.12 163.03H98.88L87.54 144.71H49.64L61.26 126.39H80.7L38.42 55.29H61.26L83.3 19.03L93.56 37.35L83.3 55.29H161.58L151.32 72.54L170.76 106.28H151.32L141.16 88.34L101.18 163.03H119.12Z" fill="white"/><path d="M127.86 79.83H76.14L101.18 122.11L127.86 79.83Z" fill="url(#paint1_radial)"/><defs><radialGradient id="paint0_radial" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(100 100) rotate(90) scale(100)"><stop stop-color="#665CEE"/><stop offset="1" stop-color="#332E91"/></radialGradient><radialGradient id="paint1_radial" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(100 100) rotate(90) scale(100)"><stop stop-color="#665CEE"/><stop offset="1" stop-color="#332E91"/></radialGradient></defs></svg>`);
		console.log('Qwen icon registered');

		this.registerView(
			CLAUDE_VIEW_TYPE,
			(leaf) => new ToolView(leaf, this, 'claude')
		);

		this.registerView(
			GEMINI_VIEW_TYPE,
			(leaf) => new ToolView(leaf, this, 'gemini')
		);

		this.registerView(
			CODEX_VIEW_TYPE,
			(leaf) => new ToolView(leaf, this, 'codex')
		);

		this.registerView(
			QWEN_VIEW_TYPE,
			(leaf) => new ToolView(leaf, this, 'qwen')
		);

		this.addCommand({
			id: 'open-claude-code',
			name: 'Claude Code',
			callback: () => {
				this.activateView(CLAUDE_VIEW_TYPE);
			}
		});

		this.addCommand({
			id: 'open-gemini-cli',
			name: 'Gemini CLI',
			callback: () => {
				this.activateView(GEMINI_VIEW_TYPE);
			}
		});

		this.addCommand({
			id: 'open-codex',
			name: 'OpenAI Codex',
			callback: () => {
				this.activateView(CODEX_VIEW_TYPE);
			}
		});

		this.addCommand({
			id: 'open-qwen',
			name: 'Qwen Code',
			callback: () => {
				this.activateView(QWEN_VIEW_TYPE);
			}
		});

		this.addSettingTab(new ObsidianAICliSettingTab(this.app, this));
	}

	async activateView(viewType: string) {
		const { workspace } = this.app;
		
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(viewType);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: viewType, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(CLAUDE_VIEW_TYPE);
		this.app.workspace.detachLeavesOfType(GEMINI_VIEW_TYPE);
		this.app.workspace.detachLeavesOfType(CODEX_VIEW_TYPE);
		this.app.workspace.detachLeavesOfType(QWEN_VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getCurrentContext(): { file: TFile | null, selection: string, lineRange: { start: number, end: number } | null, debug: string } {
		let debugInfo = '';
		let file = null;
		let selection = '';
		let lineRange: { start: number, end: number } | null = null;

		// Method 1: Try getActiveFile() (most reliable)
		file = this.app.workspace.getActiveFile();
		debugInfo += `getActiveFile(): ${file ? file.path : 'null'}\n`;

		// Method 2: Get active MarkdownView for selection
		let activeView = null;
		
		// First try getMostRecentLeaf (since this worked for you)
		const mostRecentLeaf = this.app.workspace.getMostRecentLeaf();
		if (mostRecentLeaf?.view instanceof MarkdownView) {
			activeView = mostRecentLeaf.view;
			debugInfo += `Found MarkdownView via getMostRecentLeaf\n`;
		}

		// Fallback to getActiveViewOfType
		if (!activeView) {
			activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				debugInfo += `Found MarkdownView via getActiveViewOfType\n`;
			} else {
				debugInfo += `No MarkdownView found via getActiveViewOfType\n`;
			}
		}

		// Fallback to activeLeaf
		if (!activeView) {
			const activeLeaf = this.app.workspace.activeLeaf;
			if (activeLeaf?.view instanceof MarkdownView) {
				activeView = activeLeaf.view;
				debugInfo += `Found MarkdownView via activeLeaf\n`;
			}
		}

		// Get selection if we have an activeView
		if (activeView) {
			debugInfo += `ActiveView file: ${activeView.file?.path || 'null'}\n`;
			
			// If getActiveFile() didn't work, use the file from activeView
			if (!file && activeView.file) {
				file = activeView.file;
				debugInfo += `Using file from activeView\n`;
			}
			
			// Try to get selection from the editor
			if (activeView.editor) {
				selection = activeView.editor.getSelection() || '';
				debugInfo += `Selection length: ${selection.length}\n`;
				if (selection.length > 0) {
					debugInfo += `Selection preview: "${selection.substring(0, 50)}${selection.length > 50 ? '...' : ''}"\n`;
					
					// Get line range for selection
					const selectionRange = activeView.editor.listSelections()[0];
					if (selectionRange) {
						lineRange = {
							start: selectionRange.anchor.line + 1, // Convert to 1-based line numbers
							end: selectionRange.head.line + 1
						};
						// Ensure start is always less than or equal to end
						if (lineRange.start > lineRange.end) {
							[lineRange.start, lineRange.end] = [lineRange.end, lineRange.start];
						}
						debugInfo += `Line range: ${lineRange.start}-${lineRange.end}\n`;
					}
				}
			} else {
				debugInfo += `No editor found on activeView\n`;
			}
		} else {
			debugInfo += `No MarkdownView found\n`;
		}

		return { file, selection, lineRange, debug: debugInfo };
	}

	async expandFileReferences(prompt: string): Promise<string> {
		const filePattern = /@([^\s]+\.md)/g;
		let expandedPrompt = prompt;
		const matches = prompt.match(filePattern);
		
		if (matches) {
			for (const match of matches) {
				const fileName = match.substring(1);
				const file = this.app.vault.getAbstractFileByPath(fileName);
				
				if (file instanceof TFile) {
					try {
						const content = await this.app.vault.read(file);
						expandedPrompt = expandedPrompt.replace(match, `File: ${fileName}\nContent:\n${content}\n`);
					} catch (error) {
						expandedPrompt = expandedPrompt.replace(match, `[Error reading file: ${fileName}]`);
					}
				} else {
					expandedPrompt = expandedPrompt.replace(match, `[File not found: ${fileName}]`);
				}
			}
		}
		
		return expandedPrompt;
	}

	async loadPrompts(): Promise<{[key: string]: string}> {
		const file = this.app.vault.getAbstractFileByPath(this.settings.promptStorageFile);
		if (!(file instanceof TFile)) {
			return {};
		}

		try {
			const content = await this.app.vault.read(file);
			const prompts: {[key: string]: string} = {};
			
			// Parse markdown headings and content
			const lines = content.split('\n');
			let currentPromptName = '';
			let currentPromptContent: string[] = [];
			
			for (const line of lines) {
				const headingMatch = line.match(/^#+ (.+)$/);
				if (headingMatch) {
					// Save previous prompt if exists
					if (currentPromptName && currentPromptContent.length > 0) {
						prompts[currentPromptName] = currentPromptContent.join('\n').trim();
					}
					// Start new prompt
					currentPromptName = headingMatch[1];
					currentPromptContent = [];
				} else if (currentPromptName) {
					// Add content to current prompt
					currentPromptContent.push(line);
				}
			}
			
			// Save last prompt
			if (currentPromptName && currentPromptContent.length > 0) {
				prompts[currentPromptName] = currentPromptContent.join('\n').trim();
			}
			
			return prompts;
		} catch (error) {
			console.error('Failed to load prompts:', error);
			return {};
		}
	}

	async savePrompt(name: string, content: string): Promise<void> {
		// Ensure we have a valid prompt name and content
		if (!name.trim() || !content.trim()) {
			throw new Error('Prompt name and content cannot be empty');
		}

		let file = this.app.vault.getAbstractFileByPath(this.settings.promptStorageFile);
		let fileContent = '';
		let prompts: {[key: string]: string} = {};
		
		// Load existing prompts if file exists
		if (file instanceof TFile) {
			prompts = await this.loadPrompts();
		}
		
		// Add or update the prompt
		prompts[name] = content;
		
		// Generate markdown content
		const sortedNames = Object.keys(prompts).sort();
		for (const promptName of sortedNames) {
			fileContent += `# ${promptName}\n\n${prompts[promptName]}\n\n`;
		}
		
		// Create or update the file
		if (file instanceof TFile) {
			await this.app.vault.modify(file, fileContent);
		} else {
			await this.app.vault.create(this.settings.promptStorageFile, fileContent);
		}
	}

	async deletePrompt(name: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(this.settings.promptStorageFile);
		if (!(file instanceof TFile)) {
			return;
		}

		const prompts = await this.loadPrompts();
		delete prompts[name];
		
		// Regenerate file content without the deleted prompt
		let fileContent = '';
		const sortedNames = Object.keys(prompts).sort();
		for (const promptName of sortedNames) {
			fileContent += `# ${promptName}\n\n${prompts[promptName]}\n\n`;
		}
		
		await this.app.vault.modify(file, fileContent);
	}
}

class ToolView extends ItemView {
	plugin: ObsidianAICliPlugin;
	toolType: 'claude' | 'gemini' | 'codex' | 'qwen';
	promptInput: HTMLTextAreaElement;
	runButton: HTMLButtonElement;
	cancelButton: HTMLButtonElement;
	savePromptButton: HTMLButtonElement;
	loadPromptButton: HTMLButtonElement;
	promptDropdown: HTMLSelectElement;
	outputDiv: HTMLDivElement;
	resultDiv: HTMLDivElement;
	executionDiv: HTMLDivElement;
	contextDiv: HTMLDivElement;
	contextCheckbox: HTMLInputElement;
	isRunning: boolean = false;
	currentProcess: any = null;
	contextEnabled: boolean = true;
	private eventRefs: any[] = [];
	private autocompleteEl: HTMLDivElement | null = null;
	private currentAutocompleteItems: string[] = [];
	private selectedAutocompleteIndex: number = -1;
	private cachedFiles: string[] = [];
	private autocompleteDebounceTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ObsidianAICliPlugin, toolType: 'claude' | 'gemini' | 'codex' | 'qwen') {
		super(leaf);
		this.plugin = plugin;
		this.toolType = toolType;
		this.eventRefs = [];
	}

	registerEvent(eventRef: any) {
		this.eventRefs.push(eventRef);
	}

	getViewType() {
		switch (this.toolType) {
			case 'claude': return CLAUDE_VIEW_TYPE;
			case 'gemini': return GEMINI_VIEW_TYPE;
			case 'codex': return CODEX_VIEW_TYPE;
			case 'qwen': return QWEN_VIEW_TYPE;
		}
	}

	getDisplayText() {
		switch (this.toolType) {
			case 'claude': return "Claude Code";
			case 'gemini': return "Gemini CLI";
			case 'codex': return "OpenAI Codex";
			case 'qwen': return "Qwen Code";
		}
	}

	getIcon() {
		let iconName: string;
		switch (this.toolType) {
			case 'claude': iconName = 'claude-icon'; break;
			case 'gemini': iconName = 'gemini-icon'; break;
			case 'codex': iconName = 'codex-icon'; break;
			case 'qwen': iconName = 'qwen-icon'; break;
		}
		console.log(`getIcon() called for ${this.toolType}, returning: ${iconName}`);
		return iconName;
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.createEl("h2", { text: this.getDisplayText() });

		// Add platform warning for Codex
		if (this.toolType === 'codex') {
			const warningDiv = container.createDiv("codex-warning");
			warningDiv.createEl("p", {
				text: "⚠️ Note: OpenAI Codex only works correctly on macOS, Linux, and Windows under WSL2.",
				cls: "platform-warning"
			});
		}

		const promptContainer = container.createDiv("prompt-container");
		promptContainer.createEl("label", { text: "Prompt:" });
		
		// Add collapsible help text
		const helpDetails = promptContainer.createEl("details", { cls: "help-details" });
		helpDetails.createEl("summary", { text: "💡 Tips and examples" });
		const helpText = helpDetails.createEl("div", {
			cls: "help-text"
		});
		helpText.innerHTML = `Open a file (markdown, text, image, pdf) and optionally select text for automatic context. Click the "Run" button to execute the prompt.<br>
		You can use @file_path to reference other files in your vault. For example, "@other_note.md" or "@subfolder/other_note.md".<br>
		<br><br>
		<strong>Example prompts:</strong><br>
		• "Translate the selected text to French"<br>
		• "Fix grammar in this note"<br>
		• "Summarize the main points and add them to a new Summary header at the top of the file"<br>
		• "This image is a character sheet, create a new note with the full character information"<br>
		• "Create a note named "todo-list". Use dataviewjs to list all the notes with the #todo tag in this vault."<br>
		• "Give me 5 suggestions to make this character more interesting"<br>
		• "Summarize this PDF in a new note"<br>
		• "Make the style of this note the same as @other_note.md"`;
		
		this.promptInput = promptContainer.createEl("textarea", {
			cls: "prompt-input",
			attr: { 
				placeholder: "Enter your prompt here...",
				rows: "4"
			}
		});

		// Update context when user focuses on the prompt input
		this.promptInput.addEventListener('focus', () => {
			this.updateContext();
		});

		// Add autocomplete functionality
		this.promptInput.addEventListener('input', (e) => {
			this.handleAutocomplete(e);
		});

		this.promptInput.addEventListener('keydown', (e) => {
			this.handleAutocompleteKeydown(e);
		});

		this.promptInput.addEventListener('blur', () => {
			// Hide autocomplete after a short delay to allow for clicks
			setTimeout(() => this.hideAutocomplete(), 200);
		});

		// Register workspace change listeners
		this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => {
			this.updateContext();
		}));

		this.registerEvent(this.plugin.app.workspace.on('file-open', () => {
			this.updateContext();
		}));

		// Register vault change listeners for file cache invalidation
		this.registerEvent(this.plugin.app.vault.on('create', () => {
			this.invalidateFileCache();
		}));

		this.registerEvent(this.plugin.app.vault.on('delete', () => {
			this.invalidateFileCache();
		}));

		this.registerEvent(this.plugin.app.vault.on('rename', () => {
			this.invalidateFileCache();
		}));

		// Prompt management section
		const promptManagementContainer = promptContainer.createDiv("prompt-management");
		promptManagementContainer.createEl("label", { text: "Saved Prompts:" });
		
		const promptManagementButtons = promptManagementContainer.createDiv("prompt-management-buttons");
		
		this.promptDropdown = promptManagementButtons.createEl("select", {
			cls: "prompt-dropdown"
		});
		this.promptDropdown.createEl("option", { 
			text: "Select a saved prompt...",
			value: ""
		});
		this.promptDropdown.onchange = () => this.loadSelectedPrompt();
		
		this.loadPromptButton = promptManagementButtons.createEl("button", {
			text: "Load",
			cls: "load-prompt-button"
		});
		this.loadPromptButton.onclick = () => this.loadSelectedPrompt();
		
		this.savePromptButton = promptManagementButtons.createEl("button", {
			text: "Save",
			cls: "save-prompt-button"
		});
		this.savePromptButton.onclick = () => this.showSavePromptDialog();

		const buttonContainer = promptContainer.createDiv("button-container");
		
		this.runButton = buttonContainer.createEl("button", {
			text: "Run",
			cls: "run-button"
		});
		this.runButton.onclick = () => this.runTool();

		this.cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
			cls: "cancel-button"
		});
		this.cancelButton.onclick = () => this.cancelTool();
		this.cancelButton.style.display = 'none';

		// Result section (always visible)
		const resultContainer = container.createDiv("result-container");
		resultContainer.createEl("h4", { text: "Result:" });
		this.resultDiv = resultContainer.createDiv("result-text");
		
		// Command execution section (collapsible)
		this.outputDiv = container.createDiv("output-container");
		const executionDetails = this.outputDiv.createEl("details");
		executionDetails.createEl("summary", { text: "Command Execution" });
		this.executionDiv = executionDetails.createDiv("execution-text");

		this.contextDiv = container.createDiv("context-container");
		const contextHeader = this.contextDiv.createDiv("context-header");
		contextHeader.createEl("h4", { text: "Context:" });
		
		const checkboxContainer = contextHeader.createDiv("context-checkbox-container");
		this.contextCheckbox = checkboxContainer.createEl("input", {
			type: "checkbox",
			attr: { id: "context-checkbox" }
		});
		this.contextCheckbox.checked = this.contextEnabled;
		this.contextCheckbox.addEventListener('change', () => {
			this.contextEnabled = this.contextCheckbox.checked;
		});
		
		checkboxContainer.createEl("label", {
			text: "Include context",
			attr: { for: "context-checkbox" }
		});
		
		this.updateContext();
		this.refreshPromptDropdown();

		this.addStyles();
	}

	addStyles() {
		const style = document.createElement('style');
		style.textContent = `
			.prompt-container { margin: 10px 0; }
			.help-details {
				margin: 5px 0;
			}
			.help-details summary {
				cursor: pointer;
				font-size: 0.9em;
				color: var(--interactive-accent);
				margin-bottom: 5px;
			}
			.help-details summary:hover {
				color: var(--interactive-accent-hover);
			}
			.help-text {
				font-size: 0.9em;
				color: var(--text-muted);
				margin: 5px 0;
				padding: 8px;
				background: var(--background-secondary);
				border-radius: 4px;
				border-left: 3px solid var(--interactive-accent);
			}
			.prompt-input { 
				width: 100%; 
				margin: 5px 0; 
				padding: 8px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				resize: vertical;
			}
			.button-container {
				display: flex;
				gap: 10px;
				margin: 5px 0;
			}
			.run-button, .cancel-button { 
				padding: 8px 16px; 
				border: none;
				border-radius: 4px;
				cursor: pointer;
			}
			.run-button {
				background: var(--interactive-accent);
				color: var(--text-on-accent);
				flex: 1;
			}
			.cancel-button {
				background: var(--text-error);
				color: white;
			}
			.run-button:disabled, .cancel-button:disabled {
				background: var(--background-modifier-border);
				cursor: not-allowed;
			}
			.result-container, .output-container, .context-container { 
				margin: 15px 0; 
				padding: 10px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
			}
			.result-text {
				background: var(--background-primary-alt);
				padding: 10px;
				border-radius: 4px;
				max-height: 600px;
				overflow-y: auto;
				user-select: text;
				-webkit-user-select: text;
				-moz-user-select: text;
				-ms-user-select: text;
			}
			.execution-text {
				font-family: var(--font-monospace);
				white-space: pre-wrap;
				background: var(--background-primary-alt);
				padding: 10px;
				border-radius: 4px;
				max-height: 300px;
				overflow-y: auto;
				user-select: text;
				-webkit-user-select: text;
				-moz-user-select: text;
				-ms-user-select: text;
			}
			.execution-text {
				margin-top: 10px;
			}
			.context-notice {
				font-size: 0.85em;
				color: var(--text-muted);
				margin: 8px 0;
				padding: 6px;
				background: var(--background-secondary);
				border-radius: 3px;
				border-left: 2px solid var(--interactive-accent);
			}
			.file-autocomplete {
				background: var(--background-primary);
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
				max-height: 200px;
				overflow-y: auto;
				z-index: 1000;
				font-size: 0.9em;
			}
			.autocomplete-item {
				padding: 8px 12px;
				cursor: pointer;
				border-bottom: 1px solid var(--background-modifier-border);
				color: var(--text-normal);
			}
			.autocomplete-item:last-child {
				border-bottom: none;
			}
			.autocomplete-item:hover,
			.autocomplete-item.selected {
				background: var(--background-modifier-hover);
				color: var(--text-accent);
			}
			.autocomplete-item.selected {
				background: var(--interactive-accent);
				color: var(--text-on-accent);
			}
			.context-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				margin-bottom: 10px;
			}
			.context-checkbox-container {
				display: flex;
				align-items: center;
				gap: 5px;
				font-size: 0.9em;
			}
			.context-checkbox-container input[type="checkbox"] {
				margin: 0;
			}
			.context-checkbox-container label {
				cursor: pointer;
				color: var(--text-normal);
			}
			.codex-warning {
				margin: 10px 0;
				padding: 10px;
				background: var(--background-secondary);
				border: 1px solid var(--text-warning);
				border-radius: 4px;
			}
			.platform-warning {
				color: var(--text-warning);
				font-weight: bold;
				margin: 0;
				text-align: center;
			}
			.result-container h4 {
				margin-top: 0;
			}
			.context-header h4 {
				margin-top: 0;
			}
			.prompt-management {
				margin: 10px 0;
				padding: 10px;
				background: var(--background-secondary);
				border-radius: 4px;
				border: 1px solid var(--background-modifier-border);
			}
			.prompt-management label {
				display: block;
				margin-bottom: 8px;
				font-weight: bold;
			}
			.prompt-management-buttons {
				display: flex;
				gap: 8px;
				align-items: center;
			}
			.prompt-dropdown {
				flex: 1;
				padding: 6px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				background: var(--background-primary);
			}
			.load-prompt-button, .save-prompt-button {
				padding: 6px 12px;
				border: none;
				border-radius: 4px;
				cursor: pointer;
				font-size: 0.9em;
			}
			.load-prompt-button {
				background: var(--interactive-accent);
				color: var(--text-on-accent);
			}
			.save-prompt-button {
				background: var(--text-success);
				color: white;
			}
			.load-prompt-button:disabled, .save-prompt-button:disabled {
				background: var(--background-modifier-border);
				cursor: not-allowed;
			}
		`;
		document.head.appendChild(style);
	}

	async renderMarkdown(content: string): Promise<void> {
		// Clear previous content
		this.resultDiv.empty();
		
		// Create a component for the markdown renderer
		const component = new Component();
		
		// Render the markdown content
		await MarkdownRenderer.renderMarkdown(content, this.resultDiv, '', component);
		
		// Auto-scroll to bottom
		this.resultDiv.scrollTop = this.resultDiv.scrollHeight;
	}

	handleAutocomplete(e: Event) {
		// Clear previous debounce timer
		if (this.autocompleteDebounceTimer) {
			clearTimeout(this.autocompleteDebounceTimer);
		}

		// Debounce the autocomplete to avoid excessive processing
		this.autocompleteDebounceTimer = window.setTimeout(() => {
			const input = e.target as HTMLTextAreaElement;
			const cursorPos = input.selectionStart;
			const text = input.value;
			
			// Find the last @ symbol before cursor
			let atIndex = -1;
			for (let i = cursorPos - 1; i >= 0; i--) {
				if (text[i] === '@') {
					atIndex = i;
					break;
				}
				if (text[i] === ' ' || text[i] === '\n') {
					break; // Stop at whitespace
				}
			}
			
			if (atIndex !== -1) {
				const searchTerm = text.substring(atIndex + 1, cursorPos);
				// Only show autocomplete if search term is at least 0 characters (so it shows on @)
				this.showAutocomplete(searchTerm, atIndex);
			} else {
				this.hideAutocomplete();
			}
		}, 150); // 150ms debounce delay
	}

	handleAutocompleteKeydown(e: KeyboardEvent) {
		if (!this.autocompleteEl || this.autocompleteEl.style.display === 'none') {
			return;
		}

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				this.selectedAutocompleteIndex = Math.min(
					this.selectedAutocompleteIndex + 1,
					this.currentAutocompleteItems.length - 1
				);
				this.updateAutocompleteSelection();
				break;
			case 'ArrowUp':
				e.preventDefault();
				this.selectedAutocompleteIndex = Math.max(this.selectedAutocompleteIndex - 1, -1);
				this.updateAutocompleteSelection();
				break;
			case 'Enter':
			case 'Tab':
				if (this.selectedAutocompleteIndex >= 0) {
					e.preventDefault();
					this.selectAutocompleteItem(this.currentAutocompleteItems[this.selectedAutocompleteIndex]);
				}
				break;
			case 'Escape':
				this.hideAutocomplete();
				break;
		}
	}

	invalidateFileCache() {
		this.cachedFiles = [];
	}

	getFiles(): string[] {
		// Use cached files if available
		if (this.cachedFiles.length === 0) {
			this.cachedFiles = this.plugin.app.vault.getFiles().map(file => file.path);
		}
		return this.cachedFiles;
	}

	showAutocomplete(searchTerm: string, atIndex: number) {
		// Skip very short search terms to avoid showing too many results
		if (searchTerm.length === 0 && this.getFiles().length > 50) {
			this.hideAutocomplete();
			return;
		}

		// Get cached files
		const allFiles = this.getFiles();
		
		// Optimized search with early termination
		const searchTermLower = searchTerm.toLowerCase();
		const filteredFiles: string[] = [];
		const maxResults = 10;
		
		// First pass: exact matches at start of filename
		for (const filePath of allFiles) {
			if (filteredFiles.length >= maxResults) break;
			const fileName = filePath.split('/').pop()?.toLowerCase() || '';
			if (fileName.startsWith(searchTermLower)) {
				filteredFiles.push(filePath);
			}
		}
		
		// Second pass: partial matches if we need more results
		if (filteredFiles.length < maxResults && searchTerm.length > 0) {
			for (const filePath of allFiles) {
				if (filteredFiles.length >= maxResults) break;
				if (!filteredFiles.includes(filePath) && 
					filePath.toLowerCase().includes(searchTermLower)) {
					filteredFiles.push(filePath);
				}
			}
		}

		if (filteredFiles.length === 0) {
			this.hideAutocomplete();
			return;
		}

		this.currentAutocompleteItems = filteredFiles;
		this.selectedAutocompleteIndex = -1;

		if (!this.autocompleteEl) {
			this.autocompleteEl = document.createElement('div');
			this.autocompleteEl.className = 'file-autocomplete';
			document.body.appendChild(this.autocompleteEl);
		}

		// Position the autocomplete dropdown
		const rect = this.promptInput.getBoundingClientRect();
		this.autocompleteEl.style.position = 'fixed';
		this.autocompleteEl.style.left = rect.left + 'px';
		this.autocompleteEl.style.top = (rect.bottom + 2) + 'px';
		this.autocompleteEl.style.width = rect.width + 'px';
		this.autocompleteEl.style.display = 'block';

		// Populate the dropdown
		this.autocompleteEl.innerHTML = '';
		filteredFiles.forEach((filePath, index) => {
			const item = document.createElement('div');
			item.className = 'autocomplete-item';
			item.textContent = filePath;
			item.addEventListener('click', () => {
				this.selectAutocompleteItem(filePath);
			});
			this.autocompleteEl!.appendChild(item);
		});
	}

	hideAutocomplete() {
		if (this.autocompleteEl) {
			this.autocompleteEl.style.display = 'none';
		}
		this.selectedAutocompleteIndex = -1;
	}

	updateAutocompleteSelection() {
		if (!this.autocompleteEl) return;

		const items = this.autocompleteEl.querySelectorAll('.autocomplete-item');
		items.forEach((item, index) => {
			if (index === this.selectedAutocompleteIndex) {
				item.classList.add('selected');
			} else {
				item.classList.remove('selected');
			}
		});
	}

	selectAutocompleteItem(filePath: string) {
		const cursorPos = this.promptInput.selectionStart;
		const text = this.promptInput.value;
		
		// Find the @ symbol before cursor
		let atIndex = -1;
		for (let i = cursorPos - 1; i >= 0; i--) {
			if (text[i] === '@') {
				atIndex = i;
				break;
			}
			if (text[i] === ' ' || text[i] === '\n') {
				break;
			}
		}
		
		if (atIndex !== -1) {
			// Replace the partial path with the selected file path
			const newText = text.substring(0, atIndex + 1) + filePath + text.substring(cursorPos);
			this.promptInput.value = newText;
			
			// Set cursor position after the inserted file path
			const newCursorPos = atIndex + 1 + filePath.length;
			this.promptInput.setSelectionRange(newCursorPos, newCursorPos);
			this.promptInput.focus();
		}
		
		this.hideAutocomplete();
	}

	async refreshPromptDropdown() {
		// Clear existing options except the first one
		while (this.promptDropdown.children.length > 1) {
			this.promptDropdown.removeChild(this.promptDropdown.lastChild!);
		}

		try {
			const prompts = await this.plugin.loadPrompts();
			const promptNames = Object.keys(prompts).sort();
			
			for (const name of promptNames) {
				const option = this.promptDropdown.createEl("option", {
					text: name,
					value: name
				});
			}
		} catch (error) {
			console.error('Failed to refresh prompt dropdown:', error);
		}
	}

	async loadSelectedPrompt() {
		const selectedPromptName = this.promptDropdown.value;
		if (!selectedPromptName) {
			return;
		}

		try {
			const prompts = await this.plugin.loadPrompts();
			const promptContent = prompts[selectedPromptName];
			
			if (promptContent) {
				this.promptInput.value = promptContent;
				this.promptInput.focus();
			} else {
				new Notice(`Prompt "${selectedPromptName}" not found`);
				this.refreshPromptDropdown(); // Refresh in case the file was modified externally
			}
		} catch (error) {
			console.error('Failed to load prompt:', error);
			new Notice('Failed to load prompt');
		}
	}

	async showSavePromptDialog() {
		const promptContent = this.promptInput.value.trim();
		if (!promptContent) {
			new Notice('Please enter a prompt before saving');
			return;
		}

		// Create a simple input dialog
		const modal = new SavePromptModal(this.plugin.app, async (name: string) => {
			try {
				await this.plugin.savePrompt(name, promptContent);
				new Notice(`Prompt "${name}" saved successfully`);
				this.refreshPromptDropdown();
			} catch (error) {
				console.error('Failed to save prompt:', error);
				new Notice(`Failed to save prompt: ${error.message}`);
			}
		});

		modal.open();
	}

	updateContext() {
		const { file, selection, lineRange, debug } = this.plugin.getCurrentContext();
		
		// Clear existing context content but keep the header
		const existingContent = this.contextDiv.querySelector('.context-content');
		if (existingContent) {
			existingContent.remove();
		}
		
		const contentDiv = this.contextDiv.createDiv("context-content");
		
		if (file) {
			contentDiv.createEl("p", { 
				text: `📄 Current file: ${file.path}`,
				cls: "context-file"
			});
		} else {
			contentDiv.createEl("p", { 
				text: "📄 No file open",
				cls: "context-no-file"
			});
		}
		
		if (selection && selection.trim()) {
			const truncated = selection.length > 100 ? selection.substring(0, 100) + '...' : selection;
			const lineRangeText = lineRange ? ` (lines ${lineRange.start}-${lineRange.end})` : '';
			contentDiv.createEl("p", { 
				text: `✏️ Selected: "${truncated}"${lineRangeText}`,
				cls: "context-selection"
			});
		} else {
			contentDiv.createEl("p", { 
				text: "✏️ No text selected",
				cls: "context-no-selection"
			});
		}
		
		// Add notice about text selection requirement
		const noticeDiv = contentDiv.createDiv("selection-notice");
		noticeDiv.createEl("p", {
			text: "💡 Note: Text selection only works when the note is in edit mode, not preview mode.",
			cls: "context-notice"
		});
	}

	async runTool() {
		if (this.isRunning) return;
		
		let prompt = this.promptInput.value.trim();
		if (!prompt) {
			new Notice('Please enter a prompt');
			return;
		}

		this.isRunning = true;
		this.runButton.disabled = true;
		this.runButton.textContent = 'Running...';
		this.cancelButton.style.display = 'inline-block';
		
		await this.renderMarkdown('*Processing prompt...*');
		this.executionDiv.textContent = '';

		try {
			prompt = await this.plugin.expandFileReferences(prompt);
			
			const commandInfo = this.buildCommand(prompt);
			const vaultPath = (this.plugin.app.vault.adapter as any).basePath || (this.plugin.app.vault.adapter as any).path || process.cwd();
			
			let executionText = `Full command being executed:\n${commandInfo.command}\n`;
			
			if (commandInfo.useStdin && commandInfo.stdinContent) {
				executionText += `\nPrompt content being sent via stdin:\n${'-'.repeat(50)}\n${commandInfo.stdinContent}\n${'-'.repeat(50)}\n`;
			}
			
			executionText += '\nExecuting...\n';
			this.executionDiv.textContent = executionText;
			console.log(commandInfo.command);
			
			await this.runCommandWithSpawn(commandInfo.command, vaultPath, commandInfo.stdinContent);
			
		} catch (error) {
			await this.renderMarkdown(`**Error:** ${error.message}`);
			this.executionDiv.textContent += `\nError: ${error.message}`;
			if (error.message.includes('ENOENT')) {
				new Notice('CLI tool not found. Check the path in settings.');
			} else if (error.message.includes('cancelled')) {
				new Notice('Command was cancelled.');
			} else {
				new Notice('Command execution failed. Check output for details.');
			}
		} finally {
			this.isRunning = false;
			this.runButton.disabled = false;
			this.runButton.textContent = 'Run';
			this.cancelButton.style.display = 'none';
			this.currentProcess = null;
		}
	}

	async runCommandWithSpawn(command: string, cwd: string, stdinContent?: string): Promise<void> {
		return new Promise(async (resolve, reject) => {
			const timeout = 600000;

			// Get extended environment with user's actual shell PATH
			const env = await getExtendedEnv();

			this.currentProcess = spawn(command, [], {
				cwd,
				shell: true,
				stdio: ['pipe', 'pipe', 'pipe'],
				env
			});

			// Handle stdin content or close immediately to prevent hanging
			if (this.currentProcess.stdin) {
				if (stdinContent) {
					this.currentProcess.stdin.write(stdinContent);
					this.currentProcess.stdin.end();
				} else {
					this.currentProcess.stdin.end();
				}
			}

			let fullOutput = '';
			let resultBuffer = '';
			let isFirstOutput = true;


			this.currentProcess.stdout?.on('data', async (data: Buffer) => {
				const output = data.toString();
				fullOutput += output;
				
				// Add to execution log
				this.executionDiv.textContent += output;
				this.executionDiv.scrollTop = this.executionDiv.scrollHeight;
				
				// For result display, accumulate in buffer and filter
				resultBuffer += output;
				
				// Apply filtering for Gemini
				// Loaded cached credentials.
				let filteredResult = resultBuffer;
				if (this.toolType === 'gemini') {
					filteredResult = filteredResult.replace(/^Loaded cached credentials\.\s*\n?/m, '');
				}

				// Apply filtering for Qwen
				// Loaded cached Qwen credentials.
				if (this.toolType === 'qwen') {
					filteredResult = filteredResult.replace(/^Loaded cached Qwen credentials\.\s*\n?/m, '');
				}
				
				// Update result display with markdown rendering
				await this.renderMarkdown(filteredResult);
			});

			this.currentProcess.stderr?.on('data', (data: Buffer) => {
				const output = data.toString();
				this.executionDiv.textContent += '\nStderr: ' + output;
				this.executionDiv.scrollTop = this.executionDiv.scrollHeight;
			});

			this.currentProcess.on('close', async (code: number, signal: string) => {
				if (code === 0) {
					this.executionDiv.textContent += '\n\nCommand completed successfully.';
					resolve();
				} else if (signal === 'SIGTERM' || signal === 'SIGKILL') {
					this.executionDiv.textContent += '\n\nCommand was cancelled.';
					await this.renderMarkdown('*Command was cancelled.*');
					reject(new Error('Command was cancelled'));
				} else {
					this.executionDiv.textContent += `\n\nCommand failed with exit code ${code}`;
					reject(new Error(`Command failed with exit code ${code}`));
				}
			});

			this.currentProcess.on('error', (error: Error) => {
				reject(error);
			});

			// Set timeout
			setTimeout(() => {
				if (this.currentProcess && !this.currentProcess.killed) {
					this.currentProcess.kill('SIGTERM');
					reject(new Error(`Command timed out after ${timeout/1000} seconds`));
				}
			}, timeout);
		});
	}

	buildCommand(prompt: string): { command: string, useStdin: boolean, stdinContent: string } {
		let contextPrompt = prompt;
		
		// Only add context if checkbox is enabled
		if (this.contextEnabled) {
			const { file, selection, lineRange } = this.plugin.getCurrentContext();
			
			// Add file reference using @file_path syntax (both tools support this)
			if (file) {
				contextPrompt += ` @${file.path}`;
			}
			
			// Add selection as compact JSON context if available
			if (selection && selection.trim()) {
				const contextData: { selectedText: string, lineRange?: { start: number, end: number } } = { 
					selectedText: selection 
				};
				if (lineRange) {
					contextData.lineRange = lineRange;
				}
				const contextJson = JSON.stringify(contextData);
				contextPrompt += ` Context: ${contextJson}`;
			}
		}

		// Always use stdin for consistency and robustness
		switch (this.toolType) {
			case 'claude':
				return {
					command: `${this.plugin.settings.claudeCodePath} ${this.plugin.settings.claudeParams}`,
					useStdin: true,
					stdinContent: contextPrompt
				};
			case 'gemini':
				return {
					command: `${this.plugin.settings.geminiCliPath} ${this.plugin.settings.geminiParams}`,
					useStdin: true,
					stdinContent: contextPrompt
				};
			case 'codex':
				return {
					command: `${this.plugin.settings.codexPath} ${this.plugin.settings.codexParams}`,
					useStdin: true,
					stdinContent: contextPrompt
				};
			case 'qwen':
				return {
					command: `${this.plugin.settings.qwenPath} ${this.plugin.settings.qwenParams}`,
					useStdin: true,
					stdinContent: contextPrompt
				};
		}
	}

	cancelTool() {
		if (this.currentProcess && !this.currentProcess.killed) {
			// Try SIGTERM first, then SIGKILL if it doesn't respond
			this.currentProcess.kill('SIGTERM');
			setTimeout(() => {
				if (this.currentProcess && !this.currentProcess.killed) {
					this.currentProcess.kill('SIGKILL');
				}
			}, 2000);
			
			// Reset UI state immediately
			this.isRunning = false;
			this.runButton.disabled = false;
			this.runButton.textContent = 'Run';
			this.cancelButton.style.display = 'none';
			this.currentProcess = null;
		}
	}

	async onClose() {
		// Clean up event listeners
		this.eventRefs.forEach(ref => {
			if (ref && typeof ref.off === 'function') {
				ref.off();
			}
		});
		this.eventRefs = [];
		
		// Clean up debounce timer
		if (this.autocompleteDebounceTimer) {
			clearTimeout(this.autocompleteDebounceTimer);
			this.autocompleteDebounceTimer = null;
		}
		
		// Clean up autocomplete element
		if (this.autocompleteEl) {
			this.autocompleteEl.remove();
			this.autocompleteEl = null;
		}
		
		// Clean up any running process
		if (this.currentProcess && !this.currentProcess.killed) {
			this.currentProcess.kill('SIGTERM');
		}
	}
}

class SavePromptModal extends Modal {
	private onSubmit: (name: string) => Promise<void>;
	private nameInput: HTMLInputElement;

	constructor(app: App, onSubmit: (name: string) => Promise<void>) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Save Prompt' });

		const form = contentEl.createEl('form');
		form.style.display = 'flex';
		form.style.flexDirection = 'column';
		form.style.gap = '15px';

		const inputContainer = form.createDiv();
		inputContainer.createEl('label', { 
			text: 'Prompt name:',
			attr: { for: 'prompt-name' }
		});
		
		this.nameInput = inputContainer.createEl('input', {
			type: 'text',
			attr: { 
				id: 'prompt-name',
				placeholder: 'Enter a name for this prompt...'
			}
		});
		this.nameInput.style.width = '100%';
		this.nameInput.style.marginTop = '5px';
		this.nameInput.style.padding = '8px';
		this.nameInput.style.border = '1px solid var(--background-modifier-border)';
		this.nameInput.style.borderRadius = '4px';

		const buttonContainer = form.createDiv();
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '10px';
		buttonContainer.style.justifyContent = 'flex-end';

		const cancelButton = buttonContainer.createEl('button', {
			text: 'Cancel',
			type: 'button'
		});
		cancelButton.style.padding = '8px 16px';
		cancelButton.onclick = () => this.close();

		const saveButton = buttonContainer.createEl('button', {
			text: 'Save',
			type: 'submit'
		});
		saveButton.style.padding = '8px 16px';
		saveButton.style.background = 'var(--interactive-accent)';
		saveButton.style.color = 'var(--text-on-accent)';
		saveButton.style.border = 'none';
		saveButton.style.borderRadius = '4px';

		form.onsubmit = async (e) => {
			e.preventDefault();
			const name = this.nameInput.value.trim();
			if (name) {
				await this.onSubmit(name);
				this.close();
			} else {
				new Notice('Please enter a prompt name');
			}
		};

		// Focus the input field
		setTimeout(() => this.nameInput.focus(), 50);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ObsidianAICliSettingTab extends PluginSettingTab {
	plugin: ObsidianAICliPlugin;

	constructor(app: App, plugin: ObsidianAICliPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'AI Tools Settings'});

		// Claude Code Settings
		containerEl.createEl('h3', {text: 'Claude Code'});

		new Setting(containerEl)
			.setName('CLI Path')
			.setDesc('Path to the Claude Code CLI executable')
			.addText(text => text
				.setPlaceholder('claude')
				.setValue(this.plugin.settings.claudeCodePath)
				.onChange(async (value) => {
					this.plugin.settings.claudeCodePath = value;
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText('Test')
				.onClick(async () => {
					try {
						const env = await getExtendedEnv();
						await execAsync(`${this.plugin.settings.claudeCodePath} --version`, { env });
						new Notice('Claude Code CLI found and working!');
					} catch (error) {
						new Notice('Claude Code CLI not found or not working. Check the path.');
					}
				}));

		new Setting(containerEl)
			.setName('Parameters')
			.setDesc('Command line parameters and flags for Claude Code CLI')
			.addText(text => text
				.setPlaceholder('--allowedTools Read,Edit,Write,Bash,Grep,MultiEdit,WebFetch,TodoRead,TodoWrite,WebSearch')
				.setValue(this.plugin.settings.claudeParams)
				.onChange(async (value) => {
					this.plugin.settings.claudeParams = value;
					await this.plugin.saveSettings();
				}));

		// Gemini CLI Settings
		containerEl.createEl('h3', {text: 'Gemini CLI'});

		new Setting(containerEl)
			.setName('CLI Path')
			.setDesc('Path to the Gemini CLI executable')
			.addText(text => text
				.setPlaceholder('gemini')
				.setValue(this.plugin.settings.geminiCliPath)
				.onChange(async (value) => {
					this.plugin.settings.geminiCliPath = value;
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText('Test')
				.onClick(async () => {
					try {
						const env = await getExtendedEnv();
						await execAsync(`${this.plugin.settings.geminiCliPath} --version`, { env });
						new Notice('Gemini CLI found and working!');
					} catch (error) {
						new Notice('Gemini CLI not found or not working. Check the path.');
					}
				}));

		new Setting(containerEl)
			.setName('Parameters')
			.setDesc('Command line parameters and flags for Gemini CLI')
			.addText(text => text
				.setPlaceholder('--yolo')
				.setValue(this.plugin.settings.geminiParams)
				.onChange(async (value) => {
					this.plugin.settings.geminiParams = value;
					await this.plugin.saveSettings();
				}));

		// OpenAI Codex Settings
		containerEl.createEl('h3', {text: 'OpenAI Codex'});

		// Add platform compatibility warning
		const codexWarning = containerEl.createEl('div', {
			cls: 'setting-item-description',
			text: '⚠️ Note: OpenAI Codex only works correctly on macOS, Linux, and Windows under WSL2.'
		});
		codexWarning.style.color = 'var(--text-warning)';
		codexWarning.style.fontWeight = 'bold';
		codexWarning.style.marginBottom = '10px';

		new Setting(containerEl)
			.setName('CLI Path')
			.setDesc('Path to the OpenAI Codex CLI executable')
			.addText(text => text
				.setPlaceholder('codex')
				.setValue(this.plugin.settings.codexPath)
				.onChange(async (value) => {
					this.plugin.settings.codexPath = value;
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText('Test')
				.onClick(async () => {
					try {
						const env = await getExtendedEnv();
						await execAsync(`${this.plugin.settings.codexPath} --version`, { env });
						new Notice('OpenAI Codex CLI found and working!');
					} catch (error) {
						new Notice('OpenAI Codex CLI not found or not working. Check the path.');
					}
				}));

		new Setting(containerEl)
			.setName('Parameters')
			.setDesc('Command line parameters and flags for OpenAI Codex CLI')
			.addText(text => text
				.setPlaceholder('exec --full-auto --skip-git-repo-check')
				.setValue(this.plugin.settings.codexParams)
				.onChange(async (value) => {
					this.plugin.settings.codexParams = value;
					await this.plugin.saveSettings();
				}));

		// Qwen Code Settings
		containerEl.createEl('h3', {text: 'Qwen Code'});

		new Setting(containerEl)
			.setName('CLI Path')
			.setDesc('Path to the Qwen Code CLI executable')
			.addText(text => text
				.setPlaceholder('qwen')
				.setValue(this.plugin.settings.qwenPath)
				.onChange(async (value) => {
					this.plugin.settings.qwenPath = value;
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText('Test')
				.onClick(async () => {
					try {
						const env = await getExtendedEnv();
						await execAsync(`${this.plugin.settings.qwenPath} --version`, { env });
						new Notice('Qwen Code CLI found and working!');
					} catch (error) {
						new Notice('Qwen Code CLI not found or not working. Check the path.');
					}
				}));

		new Setting(containerEl)
			.setName('Parameters')
			.setDesc('Command line parameters and flags for Qwen Code CLI')
			.addText(text => text
				.setPlaceholder('--yolo')
				.setValue(this.plugin.settings.qwenParams)
				.onChange(async (value) => {
					this.plugin.settings.qwenParams = value;
					await this.plugin.saveSettings();
				}));

		// Prompt Storage Settings
		containerEl.createEl('h3', {text: 'Prompt Storage'});

		new Setting(containerEl)
			.setName('Prompt Storage File')
			.setDesc('Path to the markdown file where saved prompts will be stored. The file will be created automatically when you save your first prompt.')
			.addText(text => text
				.setPlaceholder('ai-prompts.md')
				.setValue(this.plugin.settings.promptStorageFile)
				.onChange(async (value) => {
					this.plugin.settings.promptStorageFile = value || 'ai-prompts.md';
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('p', {
			text: 'Note: Make sure the CLI tools are installed and accessible from your system PATH.',
			cls: 'setting-item-description'
		});
	}
}
