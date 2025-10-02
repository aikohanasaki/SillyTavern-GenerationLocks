import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import { eventSource, event_types, chat_metadata, name2, systemUserName, neutralCharacterName, characters, saveSettingsDebounced } from '../../../../script.js';
import { power_user } from '../../../power-user.js';
import { oai_settings, promptManager } from '../../../openai.js';
import { selected_group, groups, editGroup } from '../../../group-chats.js';
import { escapeHtml, debounce } from '../../../utils.js';
import { executeSlashCommands } from '../../../slash-commands.js';

const CHAT_TYPES = {
    SINGLE: 'single',
    GROUP: 'group'
};

const SETTING_SOURCES = {
    CHARACTER: 'character',
    MODEL: 'model',
    CHAT: 'chat',
    GROUP: 'group',
    GROUP_CHAT: 'group chat'
};

const AUTO_APPLY_MODES = {
    NEVER: 'never',
    ASK: 'ask',
    ALWAYS: 'always'
};

const LOCKING_MODES = {
    CHARACTER: 'character',
    MODEL: 'model'
};

// ============================================================================
// TEMPLATE OPERATIONS MODULE (Pure Functions)
// ============================================================================

/**
 * Pure functions for template data manipulation
 * No side effects, no external dependencies beyond oai_settings reads
 */
const TemplateOps = {
	/**
	 * Generate unique template ID
	 * @returns {string}
	 */
	generateId() {
		return 'tmpl_' + Math.random().toString(36).substr(2, 9);
	},

	/**
	 * Create template object from current ST prompts
	 * @param {Object} params
	 * @param {string} params.name - Template name
	 * @param {string} params.description - Template description
	 * @param {Array<string>} [params.includePrompts] - Specific prompt identifiers to include (null = all)
	 * @param {string} [params.id] - Optional ID (generates if not provided)
	 * @returns {Object} Template object
	 */
	createFromCurrent({ name, description, includePrompts = null, id = null }) {
		const availablePrompts = oai_settings.prompts || [];

		// Convert array to object keyed by identifier
		const promptsMap = Array.isArray(availablePrompts)
			? availablePrompts.reduce((acc, p) => {
				if (p.identifier) acc[p.identifier] = p;
				return acc;
			}, {})
			: availablePrompts;

		// Select prompts to include
		const selectedPrompts = {};
		const identifiersToInclude = includePrompts || Object.keys(promptsMap);

		for (const identifier of identifiersToInclude) {
			if (promptsMap[identifier]) {
				selectedPrompts[identifier] = { ...promptsMap[identifier] };
			}
		}

		// Get prompt order from PromptManager
		let promptOrder = [];
		let promptOrderCharacterId = null;

		if (promptManager?.activeCharacter) {
			promptOrderCharacterId = promptManager.activeCharacter.id;
			promptOrder = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
		}

		// Get character name from context
		const context = getContext();
		const characterName = context.name2 || name2;

		// Create template object
		return {
			id: id || TemplateOps.generateId(),
			name,
			description,
			prompts: selectedPrompts,
			promptOrder: promptOrder || [],
			promptOrderCharacterId,
			characterName,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};
	},

	/**
	 * Validate template structure
	 * @param {Object} template
	 * @returns {boolean}
	 */
	validate(template) {
		if (!template || typeof template !== 'object') return false;
		if (!template.id || typeof template.id !== 'string') return false;
		if (!template.name || typeof template.name !== 'string') return false;
		if (!template.prompts || typeof template.prompts !== 'object') return false;
		return true;
	},

	/**
	 * Update template fields (pure - returns new object)
	 * @param {Object} template - Original template
	 * @param {Object} updates - Fields to update
	 * @returns {Object} New template object
	 */
	update(template, updates) {
		return {
			...template,
			...updates,
			id: template.id, // Never update ID
			createdAt: template.createdAt, // Never update creation time
			updatedAt: new Date().toISOString()
		};
	},

	/**
	 * Serialize templates for export
	 * @param {Object|Map} templates - Templates to export (Map or Object)
	 * @returns {string} JSON string
	 */
	serialize(templates) {
		const templatesObj = templates instanceof Map
			? Object.fromEntries(templates)
			: templates;
		return JSON.stringify(templatesObj, null, 2);
	},

	/**
	 * Deserialize templates from import
	 * @param {string} json - JSON string
	 * @returns {Object} Templates object
	 */
	deserialize(json) {
		try {
			const parsed = JSON.parse(json);
			// Validate all templates
			const valid = Object.values(parsed).every(t => TemplateOps.validate(t));
			if (!valid) throw new Error('Invalid template format');
			return parsed;
		} catch (error) {
			throw new Error('Failed to parse template JSON: ' + error.message);
		}
	},

	/**
	 * Clone a template with new ID and name
	 * @param {Object} template - Template to clone
	 * @param {string} newName - New template name
	 * @returns {Object} Cloned template
	 */
	clone(template, newName) {
		return {
			...template,
			id: TemplateOps.generateId(),
			name: newName,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};
	}
};

// ============================================================================
// STORAGE MODULE (Simple CRUD - No Logic)
// ============================================================================

/**
 * Simple storage operations - just read/write to extension_settings and chat_metadata
 * No business logic, no validation, no decisions
 */
const Storage = {
	/**
	 * Get extension settings object, creating if needed
	 * @returns {Object}
	 */
	_getExtensionSettings() {
		if (!extension_settings.ccPromptManager) {
			extension_settings.ccPromptManager = {
				templates: {},
				templateLocks: {},
				lockingMode: LOCKING_MODES.MODEL,
				autoApplyMode: AUTO_APPLY_MODES.ASK,
				preferPrimaryOverChat: true,
				preferGroupOverChat: true,
				preferIndividualCharacterInGroup: false,
				version: '1.0.0'
			};
		}
		return extension_settings.ccPromptManager;
	},

	// ===== TEMPLATES =====

	/**
	 * Get single template by ID
	 * @param {string} id
	 * @returns {Object|null}
	 */
	getTemplate(id) {
		const settings = this._getExtensionSettings();
		return settings.templates[id] || null;
	},

	/**
	 * Get all templates as Map
	 * @returns {Map<string, Object>}
	 */
	getAllTemplates() {
		const settings = this._getExtensionSettings();
		return new Map(Object.entries(settings.templates));
	},

	/**
	 * Save template
	 * @param {Object} template
	 */
	saveTemplate(template) {
		const settings = this._getExtensionSettings();
		settings.templates[template.id] = template;
		saveSettingsDebounced();
	},

	/**
	 * Delete template
	 * @param {string} id
	 * @returns {boolean} True if deleted
	 */
	deleteTemplate(id) {
		const settings = this._getExtensionSettings();
		if (settings.templates[id]) {
			delete settings.templates[id];
			saveSettingsDebounced();
			return true;
		}
		return false;
	},

	// ===== LOCKS =====

	/**
	 * Get character lock
	 * @param {string} characterKey - Character name or ID
	 * @returns {string|null} Template ID
	 */
	getCharacterLock(characterKey) {
		if (!characterKey) return null;
		const settings = this._getExtensionSettings();
		const key = String(characterKey);
		return settings.templateLocks?.character?.[key] || null;
	},

	/**
	 * Set character lock
	 * @param {string} characterKey
	 * @param {string} templateId
	 */
	setCharacterLock(characterKey, templateId) {
		if (!characterKey) return;
		const settings = this._getExtensionSettings();
		if (!settings.templateLocks) settings.templateLocks = {};
		if (!settings.templateLocks.character) settings.templateLocks.character = {};
		settings.templateLocks.character[String(characterKey)] = templateId;
		saveSettingsDebounced();
	},

	/**
	 * Clear character lock
	 * @param {string} characterKey
	 * @returns {boolean} True if cleared
	 */
	clearCharacterLock(characterKey) {
		if (!characterKey) return false;
		const settings = this._getExtensionSettings();
		const key = String(characterKey);
		if (settings.templateLocks?.character?.[key]) {
			delete settings.templateLocks.character[key];
			saveSettingsDebounced();
			return true;
		}
		return false;
	},

	/**
	 * Get model lock
	 * @param {string} modelKey - Model preset name
	 * @returns {string|null} Template ID
	 */
	getModelLock(modelKey) {
		if (!modelKey) return null;
		const settings = this._getExtensionSettings();
		const key = String(modelKey);
		return settings.templateLocks?.model?.[key] || null;
	},

	/**
	 * Set model lock
	 * @param {string} modelKey
	 * @param {string} templateId
	 */
	setModelLock(modelKey, templateId) {
		if (!modelKey) return;
		const settings = this._getExtensionSettings();
		if (!settings.templateLocks) settings.templateLocks = {};
		if (!settings.templateLocks.model) settings.templateLocks.model = {};
		settings.templateLocks.model[String(modelKey)] = templateId;
		saveSettingsDebounced();
	},

	/**
	 * Clear model lock
	 * @param {string} modelKey
	 * @returns {boolean} True if cleared
	 */
	clearModelLock(modelKey) {
		if (!modelKey) return false;
		const settings = this._getExtensionSettings();
		const key = String(modelKey);
		if (settings.templateLocks?.model?.[key]) {
			delete settings.templateLocks.model[key];
			saveSettingsDebounced();
			return true;
		}
		return false;
	},

	/**
	 * Get chat lock from chat_metadata
	 * @returns {string|null} Template ID
	 */
	getChatLock() {
		return chat_metadata?.ccpm_template_lock || null;
	},

	/**
	 * Set chat lock in chat_metadata
	 * @param {string} templateId
	 */
	setChatLock(templateId) {
		chat_metadata.ccpm_template_lock = templateId;
		saveMetadataDebounced();
	},

	/**
	 * Clear chat lock
	 * @returns {boolean} True if cleared
	 */
	clearChatLock() {
		if (chat_metadata?.ccpm_template_lock) {
			delete chat_metadata.ccpm_template_lock;
			saveMetadataDebounced();
			return true;
		}
		return false;
	},

	/**
	 * Get group lock from group object
	 * @param {string} groupId
	 * @returns {string|null} Template ID
	 */
	getGroupLock(groupId) {
		if (!groupId) return null;
		const group = groups?.find(g => g.id === groupId);
		return group?.ccpm_template_lock || null;
	},

	/**
	 * Set group lock on group object
	 * @param {string} groupId
	 * @param {string} templateId
	 */
	setGroupLock(groupId, templateId) {
		if (!groupId) return;
		const group = groups?.find(g => g.id === groupId);
		if (group) {
			group.ccpm_template_lock = templateId;
			editGroup(groupId, false); // Save group without refreshing UI
		}
	},

	/**
	 * Clear group lock
	 * @param {string} groupId
	 * @returns {boolean} True if cleared
	 */
	clearGroupLock(groupId) {
		if (!groupId) return false;
		const group = groups?.find(g => g.id === groupId);
		if (group?.ccpm_template_lock) {
			delete group.ccpm_template_lock;
			editGroup(groupId, false);
			return true;
		}
		return false;
	},

	// ===== PREFERENCES =====

	/**
	 * Get all preferences
	 * @returns {Object}
	 */
	getPreferences() {
		const settings = this._getExtensionSettings();
		return {
			lockingMode: settings.lockingMode || LOCKING_MODES.MODEL,
			autoApplyMode: settings.autoApplyMode || AUTO_APPLY_MODES.ASK,
			preferPrimaryOverChat: settings.preferPrimaryOverChat ?? true,
			preferGroupOverChat: settings.preferGroupOverChat ?? true,
			preferIndividualCharacterInGroup: settings.preferIndividualCharacterInGroup ?? false
		};
	},

	/**
	 * Update preference
	 * @param {string} key
	 * @param {any} value
	 */
	setPreference(key, value) {
		const settings = this._getExtensionSettings();
		settings[key] = value;
		saveSettingsDebounced();
	}
};

// ============================================================================
// CONTEXT RESOLUTION (Pure Function)
// ============================================================================

/**
 * Resolve current chat context
 * Pure function - no caching (premature optimization removed)
 * @returns {Promise<Object>} Context object
 */
async function resolveContext() {
	const isGroupChat = !!selected_group;

	if (isGroupChat) {
		const groupId = selected_group;
		const group = groups?.find(g => g.id === groupId);
		const modelName = await _getModelName();

		return {
			type: CHAT_TYPES.GROUP,
			isGroupChat: true,
			groupId,
			groupName: group?.name || null,
			chatId: group?.chat_id || null,
			characterName: group?.name || null, // For display
			modelName,
			// Legacy fields for compatibility
			primaryId: groupId,
			secondaryId: group?.chat_id
		};
	}

	// Single chat
	const characterName = _getCharacterName();
	const modelName = await _getModelName();
	const chatId = _getChatId();

	return {
		type: CHAT_TYPES.SINGLE,
		isGroupChat: false,
		groupId: null,
		groupName: null,
		chatId,
		characterName,
		modelName,
		// Legacy fields for compatibility
		primaryId: null, // Will be set by resolveLock based on lockingMode
		secondaryId: chatId
	};
}

/**
 * Get current character name for settings/locks
 * @private
 */
function _getCharacterName() {
	let characterName = name2;

	// Fallback to chat metadata
	if (!characterName || characterName === systemUserName || characterName === neutralCharacterName) {
		const metadata = chat_metadata;
		characterName = metadata?.character_name;
	}

	if (!characterName) return null;

	// Normalize
	characterName = String(characterName).trim();
	if (characterName.normalize) {
		characterName = characterName.normalize('NFC');
	}

	return characterName;
}

/**
 * Get current chat ID
 * @private
 */
function _getChatId() {
	try {
		const context = getContext();
		return context?.chatId || null;
	} catch (error) {
		return null;
	}
}

/**
 * Get current model name using ST's /model slash command
 * @private
 * @returns {Promise<string|null>}
 */
async function _getModelName() {
	try {
		const result = await executeSlashCommands('/model');
		return result?.pipe || null;
	} catch (error) {
		console.warn('CCPM: Error getting model name:', error);
		return null;
	}
}

// ============================================================================
// LOCK RESOLUTION (Pure Function)
// ============================================================================

/**
 * Resolve which lock should be applied based on context and preferences
 * Pure function - just applies priority rules
 * @param {Object} context - Context from resolveContext()
 * @param {Object} preferences - Preferences from Storage.getPreferences()
 * @returns {Object|null} {templateId, source} or null if no lock
 */
function resolveLock(context, preferences) {
	const { lockingMode, preferPrimaryOverChat, preferGroupOverChat, preferIndividualCharacterInGroup } = preferences;

	if (context.isGroupChat) {
		return _resolveGroupLock(context, preferences);
	} else {
		return _resolveSingleLock(context, lockingMode, preferPrimaryOverChat);
	}
}

/**
 * Resolve lock for single chat
 * @private
 */
function _resolveSingleLock(context, lockingMode, preferPrimaryOverChat) {
	// Determine which lock is "primary" based on locking mode
	const isPrimaryModel = lockingMode === LOCKING_MODES.MODEL;
	const primaryKey = isPrimaryModel ? context.modelName : context.characterName;
	const primarySource = isPrimaryModel ? SETTING_SOURCES.MODEL : SETTING_SOURCES.CHARACTER;

	// Get locks
	const primaryLock = isPrimaryModel
		? Storage.getModelLock(primaryKey)
		: Storage.getCharacterLock(primaryKey);
	const chatLock = Storage.getChatLock();

	// Apply priority
	if (preferPrimaryOverChat) {
		// Primary (model/character) > chat
		if (primaryLock) {
			return { templateId: primaryLock, source: primarySource };
		}
		if (chatLock) {
			return { templateId: chatLock, source: `${SETTING_SOURCES.CHAT} (fallback)` };
		}
	} else {
		// Chat > primary (model/character)
		if (chatLock) {
			return { templateId: chatLock, source: SETTING_SOURCES.CHAT };
		}
		if (primaryLock) {
			return { templateId: primaryLock, source: `${primarySource} (fallback)` };
		}
	}

	return null;
}

/**
 * Resolve lock for group chat
 * @private
 */
function _resolveGroupLock(context, preferences) {
	const { lockingMode, preferGroupOverChat, preferIndividualCharacterInGroup } = preferences;

	// Get all possible locks
	const groupLock = Storage.getGroupLock(context.groupId);
	const chatLock = Storage.getChatLock();

	// Individual character lock (based on locking mode)
	const isPrimaryModel = lockingMode === LOCKING_MODES.MODEL;
	const primaryKey = isPrimaryModel ? context.modelName : context.characterName;
	const primaryLock = isPrimaryModel
		? Storage.getModelLock(primaryKey)
		: Storage.getCharacterLock(primaryKey);

	// Apply group priority rules
	if (preferIndividualCharacterInGroup) {
		// Individual character/model > group > chat
		if (primaryLock) {
			const source = isPrimaryModel ? 'model' : 'character';
			return { templateId: primaryLock, source };
		}
		if (groupLock) {
			return { templateId: groupLock, source: SETTING_SOURCES.GROUP };
		}
		if (chatLock) {
			return { templateId: chatLock, source: SETTING_SOURCES.GROUP_CHAT };
		}
	} else if (preferGroupOverChat) {
		// Group > chat > individual character/model
		if (groupLock) {
			return { templateId: groupLock, source: SETTING_SOURCES.GROUP };
		}
		if (chatLock) {
			return { templateId: chatLock, source: SETTING_SOURCES.GROUP_CHAT };
		}
		if (primaryLock) {
			const source = isPrimaryModel ? 'model' : 'character';
			return { templateId: primaryLock, source: `${source} (fallback)` };
		}
	} else {
		// Chat > group > individual character/model
		if (chatLock) {
			return { templateId: chatLock, source: SETTING_SOURCES.GROUP_CHAT };
		}
		if (groupLock) {
			return { templateId: groupLock, source: SETTING_SOURCES.GROUP };
		}
		if (primaryLock) {
			const source = isPrimaryModel ? 'model' : 'character';
			return { templateId: primaryLock, source: `${source} (fallback)` };
		}
	}

	return null;
}

// ============================================================================
// APPLY TEMPLATE ACTION (Side Effect)
// ============================================================================

/**
 * Apply template to current ST settings
 * Side effect function - modifies oai_settings and calls promptManager
 * @param {string} templateId
 * @returns {Promise<boolean>} Success status
 */
async function applyTemplate(templateId) {
	const template = Storage.getTemplate(templateId);
	if (!template) {
		console.error('CCPM: Template not found:', templateId);
		return false;
	}

	if (!promptManager) {
		console.error('CCPM: PromptManager not available');
		return false;
	}

	try {
		// Replace entire prompts array
		oai_settings.prompts = Object.values(template.prompts);

		// Restore prompt order if saved in template
		if (template.promptOrder?.length > 0) {
			const targetCharacterId = template.promptOrderCharacterId ?? 100000;

			// Find or create order entry for this character
			const existingOrderEntry = oai_settings.prompt_order?.find(
				entry => String(entry.character_id) === String(targetCharacterId)
			);

			if (existingOrderEntry) {
				// Replace existing order
				existingOrderEntry.order = [...template.promptOrder];
			} else {
				// Add new order entry
				if (!oai_settings.prompt_order) {
					oai_settings.prompt_order = [];
				}
				oai_settings.prompt_order.push({
					character_id: targetCharacterId,
					order: [...template.promptOrder]
				});
			}

			// Update promptManager's activeCharacter to match
			if (promptManager.activeCharacter) {
				promptManager.activeCharacter.id = targetCharacterId;
			}
		}

		// Save and render
		await promptManager.saveServiceSettings();
		await promptManager.render();

		console.log('CCPM: Applied template:', template.name);
		return true;
	} catch (error) {
		console.error('CCPM: Failed to apply template:', error);
		return false;
	}
}

// ============================================================================
// UPDATE DISPLAY ACTION (Side Effect)
// ============================================================================

/**
 * Update display box in ST's prompt manager UI
 * Side effect function - modifies DOM
 * @param {string|null} appliedTemplateId - ID of currently applied template (null = preset default)
 * @param {Object|null} lockInfo - Lock info from resolveLock() {templateId, source}
 */
function updateDisplay(appliedTemplateId = null, lockInfo = null) {
	console.log('CCPM DEBUG: updateDisplay called', { appliedTemplateId, lockInfo });
	console.log('CCPM DEBUG: Is promptManager.render still hooked?', promptManager?.render?.name === 'renderHook' || promptManager?.render?.toString().includes('CCPM DEBUG'));
	const promptList = document.getElementById('completion_prompt_manager_list');
	console.log('CCPM DEBUG: promptList found?', !!promptList);
	if (!promptList) return;

	// Remove existing indicator
	const existing = document.getElementById('ccpm-template-indicator');
	if (existing) {
		console.log('CCPM DEBUG: Removing existing indicator');
		existing.remove();
	}

	// Build display HTML
	const html = _buildDisplayHtml(appliedTemplateId, lockInfo);
	console.log('CCPM DEBUG: Built HTML:', html);
	if (!html) return; // Nothing to display

	// Create and insert indicator
	const indicator = document.createElement('div');
	indicator.id = 'ccpm-template-indicator';
	indicator.className = 'ccpm-template-indicator';
	indicator.innerHTML = `<small class="text_muted">${html}</small>`;
	promptList.insertAdjacentElement('beforebegin', indicator);
	console.log('CCPM DEBUG: Display box inserted');
}

/**
 * Build HTML for display indicator
 * @private
 */
function _buildDisplayHtml(appliedId, lock) {
	const hasLock = lock?.templateId;
	const hasMismatch = hasLock && appliedId !== lock.templateId;

	if (hasMismatch) {
		// Show both locked and applied (mismatch state)
		const lockedTemplate = Storage.getTemplate(lock.templateId);
		if (!lockedTemplate) return null;

		let appliedText = 'Preset default';
		if (appliedId) {
			const appliedTemplate = Storage.getTemplate(appliedId);
			appliedText = appliedTemplate ? escapeHtml(appliedTemplate.name) : 'Unknown template';
		}

		return `
			<div><span class="fa-solid fa-lock"></span> Locked: <strong>${escapeHtml(lockedTemplate.name)}</strong> <span class="text_muted">(${escapeHtml(lock.source)})</span></div>
			<div><span class="fa-solid fa-file-lines"></span> Applied: <strong>${appliedText}</strong></div>
		`;
	}

	if (appliedId) {
		// Something is applied (may or may not be locked)
		const template = Storage.getTemplate(appliedId);
		if (!template) return null;

		if (hasLock) {
			// Applied and locked (matching state)
			return `<span class="fa-solid fa-lock"></span> Prompt Template: <strong>${escapeHtml(template.name)}</strong> <span class="text_muted">(${escapeHtml(lock.source)})</span>`;
		} else {
			// Applied but not locked
			return `<span class="fa-solid fa-file-lines"></span> Prompt Template: <strong>${escapeHtml(template.name)}</strong>`;
		}
	}

	if (hasLock) {
		// Locked but not applied
		const lockedTemplate = Storage.getTemplate(lock.templateId);
		if (!lockedTemplate) return null;

		return `
			<div><span class="fa-solid fa-lock"></span> Locked: <strong>${escapeHtml(lockedTemplate.name)}</strong> <span class="text_muted">(${escapeHtml(lock.source)})</span></div>
			<div><span class="fa-solid fa-file-lines"></span> Applied: <strong>Preset default</strong></div>
		`;
	}

	// Nothing locked or applied - show default message
	return '<span class="fa-solid fa-circle-info"></span> No prompt template applied, using preset default';
}

// ============================================================================
// AUTO-APPLY ORCHESTRATION
// ============================================================================

/**
 * Handle auto-apply logic - the main orchestration function
 * Coordinates: context resolution → lock resolution → user prompt → apply → display
 * @param {string} reason - 'chat' or 'preset' (for user messaging)
 */
async function handleAutoApply(reason = 'chat') {
	console.log('CCPM NEW: handleAutoApply called, reason:', reason);

	const context = await resolveContext();
	console.log('CCPM NEW: context:', context);

	const preferences = Storage.getPreferences();
	console.log('CCPM NEW: preferences:', preferences);

	const lock = resolveLock(context, preferences);
	console.log('CCPM NEW: resolved lock:', lock);

	// No lock exists - clear display
	if (!lock?.templateId) {
		console.log('CCPM NEW: No lock found, clearing display');
		updateDisplay(null, null);
		return;
	}

	const { autoApplyMode } = preferences;
	console.log('CCPM NEW: autoApplyMode:', autoApplyMode);

	// NEVER mode - show lock but don't apply
	if (autoApplyMode === AUTO_APPLY_MODES.NEVER) {
		updateDisplay(null, lock);
		return;
	}

	// ASK mode - prompt user
	if (autoApplyMode === AUTO_APPLY_MODES.ASK) {
		const template = Storage.getTemplate(lock.templateId);
		if (!template) {
			updateDisplay(null, null);
			return;
		}

		const userApproved = await _askUserToApply(template, lock, reason, context);

		if (userApproved) {
			const success = await applyTemplate(lock.templateId);
			if (success) {
				toastr.success(`Applied template: ${template.name}`);
				updateDisplay(lock.templateId, lock);
			} else {
				toastr.error('Failed to apply template');
				updateDisplay(null, lock);
			}
		} else {
			// User skipped - show mismatch (locked but not applied)
			updateDisplay(null, lock);
		}
		return;
	}

	// ALWAYS mode - auto-apply without asking
	if (autoApplyMode === AUTO_APPLY_MODES.ALWAYS) {
		const template = Storage.getTemplate(lock.templateId);
		if (!template) {
			updateDisplay(null, null);
			return;
		}

		const success = await applyTemplate(lock.templateId);
		if (success) {
			const message = reason === 'chat' ? `Auto-applied template: ${template.name}` : `Auto-reapplied template: ${template.name}`;
			toastr.info(message);
			updateDisplay(lock.templateId, lock);
		} else {
			toastr.error('Failed to auto-apply template');
			updateDisplay(null, lock);
		}
		return;
	}
}

/**
 * Ask user whether to apply template
 * @private
 */
async function _askUserToApply(template, lock, reason, context) {
	const title = reason === 'chat' ? 'Chat Changed' : 'Preset Changed';
	const contextType = context.isGroupChat ? 'group chat' : 'character';
	const sourceName = context.groupName || context.characterName || 'Unknown';

	const message = reason === 'chat'
		? `Apply locked template "<strong>${escapeHtml(template.name)}</strong>" for ${contextType} "${escapeHtml(sourceName)}"?`
		: `Reapply locked template "<strong>${escapeHtml(template.name)}</strong>" for ${contextType} "${escapeHtml(sourceName)}"?`;

	const popup = new Popup(`
		<div class="flex-container flexFlowColumn flexGap10">
			<h4>${title}</h4>
			<p>${message}</p>
			<p class="text_muted fontsize90p">Source: ${escapeHtml(lock.source)}</p>
		</div>
	`, POPUP_TYPE.CONFIRM, '', {
		okButton: 'Apply',
		cancelButton: 'Skip',
		allowVerticalScrolling: true
	});

	const result = await popup.show();
	return result === POPUP_RESULT.AFFIRMATIVE;
}

// ============================================================================
// NEW EVENT HANDLERS (Using Modular Architecture)
// ============================================================================

/**
 * New simplified event handlers using the modular architecture
 * TODO: Replace old PromptTemplateManager event handlers with these
 */
const NewEventHandlers = {
	/**
	 * Handle CHAT_CHANGED event
	 */
	async onChatChanged() {
		await handleAutoApply('chat');
	},

	/**
	 * Handle OAI_PRESET_CHANGED_AFTER event (model changes)
	 */
	async onPresetChanged() {
		const preferences = Storage.getPreferences();

		// Only handle in model mode
		if (preferences.lockingMode !== LOCKING_MODES.MODEL) {
			return;
		}

		await handleAutoApply('preset');
	},

	/**
	 * Handle SETTINGS_UPDATED event
	 * Just refresh display, don't auto-apply
	 */
	async onSettingsUpdated() {
		const context = await resolveContext();
		const preferences = Storage.getPreferences();
		const lock = resolveLock(context, preferences);

		// Just update display, don't trigger auto-apply
		updateDisplay(null, lock);
	},

	/**
	 * Manual apply from UI button
	 * @param {string} templateId
	 */
	async applyTemplateManual(templateId) {
		const success = await applyTemplate(templateId);

		if (success) {
			const template = Storage.getTemplate(templateId);
			toastr.success(`Template applied: ${template.name}`);

			// Update display
			const context = await resolveContext();
			const preferences = Storage.getPreferences();
			const lock = resolveLock(context, preferences);
			updateDisplay(templateId, lock);
		} else {
			toastr.error('Failed to apply template');
		}

		return success;
	},

	/**
	 * Create template from current prompts
	 * @param {string} name
	 * @param {string} description
	 * @param {Array<string>} includePrompts
	 */
	createTemplate(name, description, includePrompts = null) {
		const template = TemplateOps.createFromCurrent({ name, description, includePrompts });
		Storage.saveTemplate(template);
		console.log('CCPM: Created template:', template.name);
		return template;
	},

	/**
	 * Delete template
	 * @param {string} templateId
	 */
	deleteTemplate(templateId) {
		const success = Storage.deleteTemplate(templateId);
		if (success) {
			console.log('CCPM: Deleted template:', templateId);
		}
		return success;
	},

	/**
	 * Set lock for target
	 * @param {string} templateId
	 * @param {string} target - 'character', 'model', 'chat', 'group'
	 */
	async setLock(templateId, target) {
		const context = await resolveContext();
		const preferences = Storage.getPreferences();

		switch (target) {
			case 'character':
				if (context.characterName) {
					Storage.setCharacterLock(context.characterName, templateId);
				}
				break;
			case 'model':
				if (context.modelName) {
					Storage.setModelLock(context.modelName, templateId);
				}
				break;
			case 'chat':
				Storage.setChatLock(templateId);
				break;
			case 'group':
				if (context.groupId) {
					Storage.setGroupLock(context.groupId, templateId);
				}
				break;
		}

		// Update display after locking
		const lock = resolveLock(context, preferences);
		updateDisplay(null, lock);
	},

	/**
	 * Clear lock for target
	 * @param {string} target - 'character', 'model', 'chat', 'group'
	 */
	async clearLock(target) {
		const context = await resolveContext();
		const preferences = Storage.getPreferences();

		switch (target) {
			case 'character':
				if (context.characterName) {
					Storage.clearCharacterLock(context.characterName);
				}
				break;
			case 'model':
				if (context.modelName) {
					Storage.clearModelLock(context.modelName);
				}
				break;
			case 'chat':
				Storage.clearChatLock();
				break;
			case 'group':
				if (context.groupId) {
					Storage.clearGroupLock(context.groupId);
				}
				break;
		}

		// Update display after clearing
		const lock = resolveLock(context, preferences);
		updateDisplay(null, lock);
	}
};

// Expose for testing alongside old code
window.ccpmNewHandlers = NewEventHandlers;

// ============================================================================
// UI HELPER FUNCTIONS (Adapter for UI code)
// ============================================================================

/**
 * UI Helper functions that bridge the UI code to the new modular architecture
 * These replace the old promptTemplateManager instance methods
 */
const UIHelpers = {
	/**
	 * List all templates
	 * @returns {Array<Object>} Array of template objects
	 */
	listTemplates() {
		const templates = Storage.getAllTemplates();
		return Array.from(templates.values());
	},

	/**
	 * Get single template by ID
	 * @param {string} id
	 * @returns {Object|null}
	 */
	getTemplate(id) {
		return Storage.getTemplate(id);
	},

	/**
	 * Get current locks for all targets
	 * @returns {Promise<Object>} {character, model, chat, group}
	 */
	async getCurrentLocks() {
		const context = await resolveContext();
		return {
			character: Storage.getCharacterLock(context.characterName),
			model: Storage.getModelLock(context.modelName),
			chat: Storage.getChatLock(),
			group: context.groupId ? Storage.getGroupLock(context.groupId) : null
		};
	},

	/**
	 * Get effective lock (which lock applies based on priority)
	 * @returns {Promise<Object|null>} {templateId, source} or null
	 */
	async getEffectiveLock() {
		const context = await resolveContext();
		const preferences = Storage.getPreferences();
		const lock = resolveLock(context, preferences);
		return lock || { templateId: null, source: null };
	},

	/**
	 * Apply template by ID
	 * @param {string} templateId
	 * @returns {Promise<boolean>}
	 */
	async applyTemplate(templateId) {
		return await NewEventHandlers.applyTemplateManual(templateId);
	},

	/**
	 * Delete template by ID
	 * @param {string} id
	 * @returns {boolean}
	 */
	deleteTemplate(id) {
		return NewEventHandlers.deleteTemplate(id);
	},

	/**
	 * Create template from current prompts
	 * @param {string} name
	 * @param {string} description
	 * @param {Array<string>} includePrompts - Array of prompt identifiers to include
	 * @returns {Object} Created template
	 */
	createTemplateFromCurrent(name, description, includePrompts) {
		return NewEventHandlers.createTemplate(name, description, includePrompts);
	},

	/**
	 * Update template
	 * @param {string} id
	 * @param {Object} updates
	 * @returns {Object|null} Updated template or null
	 */
	updateTemplate(id, updates) {
		const template = Storage.getTemplate(id);
		if (!template) return null;

		const updated = TemplateOps.update(template, updates);
		Storage.saveTemplate(updated);
		return updated;
	},

	/**
	 * Lock template to target
	 * @param {string} templateId
	 * @param {string} target - 'character', 'model', 'chat', or 'group'
	 * @returns {Promise<boolean>}
	 */
	async lockTemplate(templateId, target) {
		await NewEventHandlers.setLock(templateId, target);
		return true;
	},

	/**
	 * Clear lock for target
	 * @param {string} target
	 * @returns {Promise<boolean>}
	 */
	async clearTemplateLock(target) {
		await NewEventHandlers.clearLock(target);
		return true;
	},

	/**
	 * Export all templates
	 * @returns {Array<Object>}
	 */
	exportTemplates() {
		return this.listTemplates();
	},

	/**
	 * Import templates
	 * @param {Array<Object>} templatesArray
	 * @returns {Object} {imported: number, skipped: number}
	 */
	importTemplates(templatesArray) {
		let imported = 0;
		let skipped = 0;

		for (const data of templatesArray) {
			const valid = TemplateOps.validate(data);
			if (valid) {
				Storage.saveTemplate(data);
				imported++;
			} else {
				skipped++;
			}
		}

		return { imported, skipped };
	},

	/**
	 * Save settings (called by UI after changes)
	 */
	saveSettings() {
		// Storage module auto-saves, but UI expects this method
		// Just ensure debounced save is called
		saveSettingsDebounced();
	},

	/**
	 * Compatibility property for old code that accesses lockManager.chatContext
	 * Provides getCurrent() and invalidate() methods
	 */
	lockManager: {
		chatContext: {
			async getCurrent() {
				return await resolveContext();
			},
			invalidate() {
				// New architecture doesn't cache, so this is a no-op
				// Keep for compatibility
			}
		}
	}
};

// Expose UIHelpers globally for UI code
window.promptTemplateManager = UIHelpers;

// Utility functions
const getCurrentChatMetadata = () => chat_metadata;

/**
 * Inject current CCPM template name into ST's prompt manager UI
 * @param {string|null} appliedTemplateId - ID of template currently applied, or null for preset default
 * @param {Object|null} effectiveLock - Lock object {templateId, source} or null if no lock
 */
function injectTemplateNameIntoPromptManager(appliedTemplateId = null, effectiveLock = null) {
	if (!promptTemplateManager) return;

	// Find ST's prompt manager list
	const promptList = document.getElementById('completion_prompt_manager_list');
	if (!promptList) return;

	// Remove any existing CCPM template indicator
	const existing = document.getElementById('ccpm-template-indicator');
	if (existing) existing.remove();

	let statusHtml = '';

	// Check if there's a mismatch between what's locked and what's applied
	const hasLock = effectiveLock && effectiveLock.templateId;
	const hasMismatch = hasLock && appliedTemplateId !== effectiveLock.templateId;

	if (hasMismatch) {
		// Show both locked and applied
		const lockedTemplate = promptTemplateManager.getTemplate(effectiveLock.templateId);

		if (lockedTemplate) {
			let appliedText = 'Preset default';
			if (appliedTemplateId) {
				const appliedTemplate = promptTemplateManager.getTemplate(appliedTemplateId);
				appliedText = appliedTemplate ? escapeHtml(appliedTemplate.name) : 'Unknown template';
			}

			statusHtml = `
				<div><span class="fa-solid fa-lock"></span> Locked: <strong>${escapeHtml(lockedTemplate.name)}</strong> <span class="text_muted">(${escapeHtml(effectiveLock.source)})</span></div>
				<div><span class="fa-solid fa-file-lines"></span> Applied: <strong>${appliedText}</strong></div>
			`;
		}
	} else if (appliedTemplateId) {
		// Something is applied (may or may not be locked)
		const template = promptTemplateManager.getTemplate(appliedTemplateId);
		if (template) {
			if (hasLock) {
				statusHtml = `<span class="fa-solid fa-lock"></span> Prompt Template: <strong>${escapeHtml(template.name)}</strong> <span class="text_muted">(${escapeHtml(effectiveLock.source)})</span>`;
			} else {
				statusHtml = `<span class="fa-solid fa-file-lines"></span> Prompt Template: <strong>${escapeHtml(template.name)}</strong>`;
			}
		}
	}

	if (!statusHtml) {
		// Nothing applied, show default or just the lock
		if (hasLock) {
			const lockedTemplate = promptTemplateManager.getTemplate(effectiveLock.templateId);
			if (lockedTemplate) {
				statusHtml = `
					<div><span class="fa-solid fa-lock"></span> Locked: <strong>${escapeHtml(lockedTemplate.name)}</strong> <span class="text_muted">(${escapeHtml(effectiveLock.source)})</span></div>
					<div><span class="fa-solid fa-file-lines"></span> Applied: <strong>Preset default</strong></div>
				`;
			} else {
				statusHtml = '<span class="fa-solid fa-circle-info"></span> No prompt template applied, using preset default';
			}
		} else {
			statusHtml = '<span class="fa-solid fa-circle-info"></span> No prompt template applied, using preset default';
		}
	}

	// Create template indicator element
	const indicator = document.createElement('div');
	indicator.id = 'ccpm-template-indicator';
	indicator.className = 'ccpm-template-indicator';
	indicator.innerHTML = `<small class="text_muted">${statusHtml}</small>`;

	// Insert before the prompt list
	promptList.insertAdjacentElement('beforebegin', indicator);
}

// Initialize extension using new modular architecture
(function initCCPM() {
	const defaultSettings = {
		templates: {},
		templateLocks: {},
		lockingMode: LOCKING_MODES.MODEL,
		autoApplyMode: AUTO_APPLY_MODES.ASK,
		preferPrimaryOverChat: true,
		preferGroupOverChat: true,
		preferIndividualCharacterInGroup: false,
		version: '1.0.0'
	};

	if (!extension_settings.ccPromptManager) {
		extension_settings.ccPromptManager = defaultSettings;
	}

	// Ensure all settings exist (migrations)
	if (!extension_settings.ccPromptManager.templates) {
		extension_settings.ccPromptManager.templates = {};
	}
	if (!extension_settings.ccPromptManager.templateLocks) {
		extension_settings.ccPromptManager.templateLocks = {};
	}
	if (extension_settings.ccPromptManager.lockingMode === undefined) {
		extension_settings.ccPromptManager.lockingMode = LOCKING_MODES.MODEL;
	}
	if (extension_settings.ccPromptManager.preferPrimaryOverChat === undefined) {
		extension_settings.ccPromptManager.preferPrimaryOverChat = true;
	}
	if (extension_settings.ccPromptManager.preferGroupOverChat === undefined) {
		extension_settings.ccPromptManager.preferGroupOverChat = true;
	}
	if (extension_settings.ccPromptManager.preferIndividualCharacterInGroup === undefined) {
		extension_settings.ccPromptManager.preferIndividualCharacterInGroup = false;
	}

	// Migrate old settings
	if (extension_settings.ccPromptManager.autoApplyLocked && !extension_settings.ccPromptManager.autoApplyMode) {
		const oldValue = extension_settings.ccPromptManager.autoApplyLocked;
		extension_settings.ccPromptManager.autoApplyMode = oldValue === 'auto' ? AUTO_APPLY_MODES.ALWAYS : oldValue === 'ask' ? AUTO_APPLY_MODES.ASK : AUTO_APPLY_MODES.NEVER;
		delete extension_settings.ccPromptManager.autoApplyLocked;
	}
	if (extension_settings.ccPromptManager.preferCharacterOverChat !== undefined && extension_settings.ccPromptManager.preferPrimaryOverChat === undefined) {
		extension_settings.ccPromptManager.preferPrimaryOverChat = extension_settings.ccPromptManager.preferCharacterOverChat;
		delete extension_settings.ccPromptManager.preferCharacterOverChat;
	}

	console.log('CCPM: Modular architecture initialized');
})();

// Expose for debugging
// window.ccpmTemplateManager = promptTemplateManager;
window.ccpmInjectTemplateName = injectTemplateNameIntoPromptManager;
window.ccpmNewHandlers = NewEventHandlers;
// --- CCPM Prompt Template Manager UI Injection ---
function injectPromptTemplateManagerButton() {
	// Wait for DOM ready and #extensionsMenuButton to exist
	const tryInject = () => {
		const menu = document.getElementById('extensionsMenu');
		if (!menu) {
			setTimeout(tryInject, 500);
			return;
		}
		if (document.getElementById('ccpm-prompt-template-btn')) return;

		// Create menu item using SillyTavern's standard extension menu format
		const menuItem = $(`
			<div id="ccpm-menu-item-container" class="extension_container interactable" tabindex="0">
				<div id="ccpm-prompt-template-btn" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
					<div class="fa-fw fa-solid fa-folder-open extensionsMenuExtensionButton"></div>
					<span>Prompt Templates</span>
				</div>
			</div>
		`);

		// Attach click handler
		menuItem.on('click', openPromptTemplateManagerModal);

		// Insert at top of extensions menu
		$('#extensionsMenu').prepend(menuItem);
	};
	tryInject();
}

function openPromptTemplateManagerModal() {
	const content = document.createElement('div');
	content.innerHTML = `
		<div class="title_restorable">
			<h3>Prompt Template Manager</h3>
		</div>
		<div class="flex-container alignItemsCenter marginBot10" style="padding-bottom: 10px; border-bottom: 1px solid var(--SmartThemeBorderColor);">
			<div class="menu_button menu_button_icon interactable" id="ccpm-create-from-current">
				<i class="fa-solid fa-plus"></i>
				<span>Create from Current</span>
			</div>
			<div class="menu_button menu_button_icon interactable" id="ccpm-import-template">
				<i class="fa-solid fa-file-import"></i>
				<span>Import</span>
			</div>
			<div class="menu_button menu_button_icon interactable" id="ccpm-export-all">
				<i class="fa-solid fa-file-export"></i>
				<span>Export All</span>
			</div>
		</div>
		<div id="ccpm-ptm-list" class="flex-container flexFlowColumn overflowYAuto" style="max-height: 60vh;"></div>
	`;

	// Render the template list after popup is shown
	ccpmMainPopup = new Popup(content, POPUP_TYPE.TEXT, '', {
		okButton: false,
		cancelButton: 'Close',
		wide: true,
		large: true,
		allowVerticalScrolling: true,
		onOpen: () => {
			renderPromptTemplateList();
			setupTemplateManagerEvents();
		},
		onClosing: () => {
			ccpmMainPopup = null; // Clear reference when popup closes
			return true;
		},
	});
	ccpmMainPopup.show();
}

async function renderPromptTemplateList() {
	const listDiv = document.getElementById('ccpm-ptm-list');
	if (!listDiv) return;
	const templates = promptTemplateManager.listTemplates();

	if (templates.length === 0) {
		listDiv.innerHTML = `
			<div class="flex-container justifyCenter">
				<div class="text_pole textAlignCenter">
					<i class="fa-solid fa-info-circle"></i>
					No templates found. Create one from your current prompts!
				</div>
			</div>
		`;
		return;
	}

	// Get current locks to show lock status
	const currentLocks = await promptTemplateManager.getCurrentLocks();
	const effectiveLock = await promptTemplateManager.getEffectiveLock();

	listDiv.innerHTML = templates.map(t => {
		const promptCount = Object.keys(t.prompts).length;
		const createdDate = new Date(t.createdAt).toLocaleDateString();

		// Check if this template is locked to any target
		const isLockedToCharacter = currentLocks.character === t.id;
		const isLockedToModel = currentLocks.model === t.id;
		const isLockedToChat = currentLocks.chat === t.id;
		const isLockedToGroup = currentLocks.group === t.id;
		const isEffectiveTemplate = effectiveLock.templateId === t.id;

		let lockStatus = '';
		if (isEffectiveTemplate) {
			lockStatus = `<span class="fontsize80p toggleEnabled" title="Currently active from ${effectiveLock.source}">🔒 Active (${effectiveLock.source})</span>`;
		} else if (isLockedToModel || isLockedToCharacter || isLockedToChat || isLockedToGroup) {
			const lockTypes = [];
			if (isLockedToModel) lockTypes.push('model');
			if (isLockedToCharacter) lockTypes.push('character');
			if (isLockedToChat) lockTypes.push('chat');
			if (isLockedToGroup) lockTypes.push('group');
			lockStatus = `<span class="fontsize80p text_muted" title="Locked to: ${lockTypes.join(', ')}">🔒 ${lockTypes.join(', ')}</span>`;
		}

		const borderStyle = isEffectiveTemplate ? 'border-left: 4px solid var(--SmartThemeQuoteColor);' : '';

		return `
			<div class="text_pole padding10 marginBot10" style="${borderStyle}">
				<div class="flex-container spaceBetween alignItemsCenter marginBot5">
					<div class="flexGrow">
						<div class="fontsize120p">
							${escapeHtml(t.name)}
							${lockStatus}
						</div>
						<div class="fontsize90p text_muted flex-container flexGap10">
							<span class="toggleEnabled">${promptCount} prompt${promptCount !== 1 ? 's' : ''}</span>
							<span>Created: ${createdDate}</span>
						</div>
					</div>
					<div class="flex-container flexGap2">
						<div class="menu_button menu_button_icon interactable" onclick="window.ccpmApplyTemplate('${t.id}')" title="Apply Template" style="width: 32px; height: 32px; padding: 0;">
							<i class="fa-solid fa-play"></i>
						</div>
						<div class="menu_button menu_button_icon interactable" onclick="window.ccpmViewPrompts('${t.id}')" title="View/Edit Prompts" style="width: 32px; height: 32px; padding: 0;">
							<i class="fa-solid fa-pencil"></i>
						</div>
						<div class="menu_button menu_button_icon interactable" onclick="window.ccpmShowLockMenu('${t.id}')" title="Lock/Unlock Template" style="width: 32px; height: 32px; padding: 0;">
							<i class="fa-solid fa-lock"></i>
						</div>
						<div class="menu_button menu_button_icon interactable" onclick="window.ccpmEditTemplate('${t.id}')" title="Edit Template Name/Description" style="width: 32px; height: 32px; padding: 0;">
							<i class="fa-solid fa-edit"></i>
						</div>
						<div class="menu_button menu_button_icon interactable redOverlayGlow" onclick="window.ccpmDeleteTemplate('${t.id}')" title="Delete Template" style="width: 32px; height: 32px; padding: 0;">
							<i class="fa-solid fa-trash"></i>
						</div>
					</div>
				</div>
				${t.description ? `<div class="text_muted fontsize90p marginBot10">${escapeHtml(t.description)}</div>` : ''}
				<div class="flex-container flexWrap flexGap5">
					${Object.keys(t.prompts).map(identifier =>
						`<span class="fontsize80p padding5 toggleEnabled" style="border-radius: 12px;">${identifier}</span>`
					).join('')}
				</div>
			</div>
		`;
	}).join('');
}

function setupTemplateManagerEvents() {
	// Setup toolbar events
	document.getElementById('ccpm-create-from-current')?.addEventListener('click', () => {
		showCreateTemplateDialog();
	});

	document.getElementById('ccpm-import-template')?.addEventListener('click', () => {
		showImportTemplateDialog();
	});

	document.getElementById('ccpm-export-all')?.addEventListener('click', () => {
		exportAllTemplates();
	});
}

// Store reference to the main template manager popup
let ccpmMainPopup = null;

// Expose template management functions for buttons
window.ccpmApplyTemplate = async function(id) {
	if (await promptTemplateManager.applyTemplate(id)) {
		toastr.success('Template applied successfully!');
		// Update display to show applied template
		const effectiveLock = await promptTemplateManager.getEffectiveLock();
		injectTemplateNameIntoPromptManager(id, effectiveLock);
		// Close the main popup properly using complete() to trigger proper cleanup
		if (ccpmMainPopup) {
			await ccpmMainPopup.completeAffirmative();
		}
	} else {
		toastr.error('Failed to apply template');
	}
};

window.ccpmEditTemplate = async function(id) {
	const template = promptTemplateManager.getTemplate(id);
	if (!template) {
		toastr.error('Template not found');
		return;
	}
	await showEditTemplateDialog(template);
};

window.ccpmDeleteTemplate = async function(id) {
	const template = promptTemplateManager.getTemplate(id);
	if (!template) {
		toastr.error('Template not found');
		return;
	}

	const content = document.createElement('div');
	content.innerHTML = `
		<div class="flex-container flexFlowColumn flexGap10">
			<p>Are you sure you want to delete the template "<strong>${escapeHtml(template.name)}</strong>"?</p>
			<div class="text_pole padding10 text_danger">
				<strong>⚠️ This action cannot be undone.</strong>
			</div>
		</div>
	`;

	const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
		okButton: 'Delete',
		cancelButton: 'Cancel',
		allowVerticalScrolling: true
	});

	const result = await popup.show();
	if (result) {
		if (promptTemplateManager.deleteTemplate(id)) {
			toastr.success('Template deleted successfully');
			await renderPromptTemplateList();
		} else {
			toastr.error('Failed to delete template');
		}
	}
};

window.ccpmShowLockMenu = async function(templateId) {
	const template = promptTemplateManager.getTemplate(templateId);
	if (!template) {
		toastr.error('Template not found');
		return;
	}

	const currentLocks = await promptTemplateManager.getCurrentLocks();
	const context = await promptTemplateManager.lockManager.chatContext.getCurrent();

	// Determine locking mode and available targets
	const lockingMode = extension_settings.ccPromptManager?.lockingMode || LOCKING_MODES.MODEL;
	const primaryTarget = lockingMode === LOCKING_MODES.MODEL ? 'model' : 'character';
	const primaryLabel = lockingMode === LOCKING_MODES.MODEL ? 'Model' : 'Character';

	// Determine available lock targets based on context
	const availableTargets = [];
	// Add primary target (model or character) if available
	if (lockingMode === LOCKING_MODES.MODEL && context.modelName) {
		availableTargets.push('model');
	} else if (lockingMode === LOCKING_MODES.CHARACTER && context.characterName) {
		availableTargets.push('character');
	}
	if (context.chatId || context.groupId) {
		availableTargets.push('chat');
	}
	if (context.isGroupChat && context.groupId) {
		availableTargets.push('group');
	}

	const autoApplyMode = extension_settings.ccPromptManager?.autoApplyMode || AUTO_APPLY_MODES.ASK;
	const preferPrimaryOverChat = extension_settings.ccPromptManager?.preferPrimaryOverChat ?? true;
	const preferGroupOverChat = extension_settings.ccPromptManager?.preferGroupOverChat ?? true;
	const preferIndividualCharacterInGroup = extension_settings.ccPromptManager?.preferIndividualCharacterInGroup ?? false;

	const content = document.createElement('div');
	content.innerHTML = `
		<div class="flex-container flexFlowColumn flexGap10">
			<h4>Lock Template: ${escapeHtml(template.name)}</h4>

			<div class="completion_prompt_manager_popup_entry_form_control">
				<label for="ccpm-locking-mode">Locking Mode:</label>
				<select id="ccpm-locking-mode" class="text_pole" onchange="window.ccpmSetLockingMode(this.value)">
					<option value="${LOCKING_MODES.MODEL}" ${lockingMode === LOCKING_MODES.MODEL ? 'selected' : ''}>Model (recommended)</option>
					<option value="${LOCKING_MODES.CHARACTER}" ${lockingMode === LOCKING_MODES.CHARACTER ? 'selected' : ''}>Character</option>
				</select>
				<small class="text_muted">Model mode locks templates to API models (e.g., GPT-4, Claude). Character mode locks to character names.</small>
			</div>

			<hr>

			<p>Choose where to lock this template:</p>

			<div class="flex-container flexFlowColumn flexGap10">
				${availableTargets.map(target => {
					const isCurrentlyLocked = currentLocks[target] === templateId;
					const hasOtherLock = currentLocks[target] && currentLocks[target] !== templateId;
					const contextName = getContextName(context, target);

					return `
						<label class="checkbox_label">
							<input type="checkbox"
								id="ccpm-lock-${target}"
								${isCurrentlyLocked ? 'checked' : ''}
								onchange="if(this.checked) { ccpmLockToTarget('${templateId}', '${target}'); } else { ccpmClearLock('${target}'); }">
							<span>
								<strong>${target === 'model' || target === 'character' ? (target === 'model' ? 'Model' : 'Character') : target.charAt(0).toUpperCase() + target.slice(1)}</strong>
								${contextName ? ` - <small class="text_muted">${escapeHtml(contextName)}</small>` : ''}
								${hasOtherLock ? '<br><small class="text_danger">⚠️ Another template is locked</small>' : ''}
							</span>
						</label>
					`;
				}).join('')}
			</div>

			${availableTargets.length === 0 ? '<p class="text_muted">No lock targets available in current context.</p>' : ''}

			<hr>

			<div class="completion_prompt_manager_popup_entry_form_control">
				<h4>⚙️ Auto-apply when preset changes:</h4>
				<div class="marginTop10">
					<label class="radio_label">
						<input type="radio" name="ccpm-auto-apply-mode" value="${AUTO_APPLY_MODES.NEVER}" ${autoApplyMode === AUTO_APPLY_MODES.NEVER ? 'checked' : ''} onchange="window.ccpmSetAutoApplyMode('${AUTO_APPLY_MODES.NEVER}')">
						<span>Never - Don't reapply locked templates</span>
					</label>
					<label class="radio_label">
						<input type="radio" name="ccpm-auto-apply-mode" value="${AUTO_APPLY_MODES.ASK}" ${autoApplyMode === AUTO_APPLY_MODES.ASK ? 'checked' : ''} onchange="window.ccpmSetAutoApplyMode('${AUTO_APPLY_MODES.ASK}')">
						<span>Ask - Prompt before applying locked templates</span>
					</label>
					<label class="radio_label">
						<input type="radio" name="ccpm-auto-apply-mode" value="${AUTO_APPLY_MODES.ALWAYS}" ${autoApplyMode === AUTO_APPLY_MODES.ALWAYS ? 'checked' : ''} onchange="window.ccpmSetAutoApplyMode('${AUTO_APPLY_MODES.ALWAYS}')">
						<span>Always - Automatically apply locked templates</span>
					</label>
				</div>
			</div>

			<hr>

			<div class="completion_prompt_manager_popup_entry_form_control">
				<h4>⚙️ Lock Priority:</h4>
				${context.isGroupChat ? `
					<div class="marginTop10">
						<label class="checkbox_label">
							<input type="checkbox" id="ccpm-pref-group-over-chat" ${preferGroupOverChat ? 'checked' : ''} onchange="window.ccpmSetPriority('preferGroupOverChat', this.checked)">
							<span>Prefer group settings over chat</span>
						</label>
						<label class="checkbox_label">
							<input type="checkbox" id="ccpm-pref-individual-char" ${preferIndividualCharacterInGroup ? 'checked' : ''} onchange="window.ccpmSetPriority('preferIndividualCharacterInGroup', this.checked)">
							<span>Prefer ${primaryLabel.toLowerCase()} settings over group or chat</span>
						</label>
					</div>
				` : `
					<div class="marginTop10">
						<label class="checkbox_label">
							<input type="checkbox" id="ccpm-pref-primary-over-chat" ${preferPrimaryOverChat ? 'checked' : ''} onchange="window.ccpmSetPriority('preferPrimaryOverChat', this.checked)">
							<span>Prefer ${primaryLabel.toLowerCase()} over chat</span>
						</label>
					</div>
				`}
			</div>
		</div>
	`;

	const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
		okButton: false,
		cancelButton: 'Close',
		wide: true,
		allowVerticalScrolling: true
	});
	popup.show();
};

function getContextName(context, target) {
	switch (target) {
		case 'character':
			return context.characterName || 'Current Character';
		case 'model':
			return context.modelName || 'Current Model';
		case 'chat':
			if (context.isGroupChat) {
				return context.groupName ? `${context.groupName} Chat` : 'Group Chat';
			} else {
				return context.chatName || 'Current Chat';
			}
		case 'group':
			return context.groupName || 'Current Group';
		default:
			return '';
	}
}

window.ccpmLockToTarget = async function(templateId, target) {
	const success = await promptTemplateManager.lockTemplate(templateId, target);
	if (success) {
		// The lock menu popup will close itself via its cancelButton
		// Just refresh the template list in the main popup
		await renderPromptTemplateList();
		// Update the template name display in ST's prompt manager
		injectTemplateNameIntoPromptManager();
	}
};

window.ccpmClearLock = async function(target) {
	const success = await promptTemplateManager.clearTemplateLock(target);
	if (success) {
		// The lock menu popup will close itself via its cancelButton
		// Just refresh the template list in the main popup
		await renderPromptTemplateList();
		// Update the template name display in ST's prompt manager
		injectTemplateNameIntoPromptManager();
	}
};

window.ccpmSetAutoApplyMode = function(mode) {
	extension_settings.ccPromptManager.autoApplyMode = mode;
	saveSettingsDebounced();
	console.log('CCPM: Auto-apply mode set to:', mode);
};

window.ccpmSetPriority = function(preference, value) {
	extension_settings.ccPromptManager[preference] = value;
	saveSettingsDebounced();
	console.log('CCPM: Priority preference set:', preference, '=', value);
};

window.ccpmSetLockingMode = function(mode) {
	extension_settings.ccPromptManager.lockingMode = mode;
	saveSettingsDebounced();
	console.log('CCPM: Locking mode set to:', mode);
	// Invalidate context cache to force reload with new mode
	if (promptTemplateManager?.lockManager?.chatContext) {
		promptTemplateManager.lockManager.chatContext.invalidate();
	}
	toastr.success(`Locking mode changed to ${mode}. Template list will update on next interaction.`);
};

window.ccpmViewPrompts = async function(templateId) {
	const template = promptTemplateManager.getTemplate(templateId);
	if (!template) {
		toastr.error('Template not found');
		return;
	}

	// Build list ordered by promptOrder if available - include markers for reordering
	let orderedPrompts = [];
	if (template.promptOrder && Array.isArray(template.promptOrder) && template.promptOrder.length > 0) {
		// Use promptOrder to determine sequence, include all prompts (including markers)
		orderedPrompts = template.promptOrder
			.map(entry => template.prompts[entry.identifier])
			.filter(prompt => prompt); // Filter out nulls only
	} else {
		// Fallback to all prompts including markers
		orderedPrompts = Object.values(template.prompts);
	}

	if (orderedPrompts.length === 0) {
		toastr.info('This template contains no prompts');
		return;
	}

	const content = document.createElement('div');
	content.innerHTML = `
		<div class="flex-container flexFlowColumn" style="gap: 10px;">
			<div class="title_restorable">
				<h3>${escapeHtml(template.name)}</h3>
			</div>
			${template.description ? `<div class="text_muted">${escapeHtml(template.description)}</div>` : ''}

			<ul id="ccpm-prompt-order-list" class="text_pole" style="list-style: none; padding: 0; margin: 0; max-height: 60vh; overflow-y: auto;">
				<li class="ccpm_prompt_manager_list_head">
					<span>Name</span>
					<span></span>
					<span>Role</span>
				</li>
				<li class="ccpm_prompt_manager_list_separator">
					<hr>
				</li>
				${orderedPrompts.map(prompt => {
					const isMarker = prompt.marker;
					const isSystemPrompt = prompt.system_prompt;
					const isInjectionPrompt = prompt.injection_position === 1;
					const promptRoles = {
						assistant: { roleIcon: 'fa-robot', roleTitle: 'Prompt will be sent as Assistant' },
						user: { roleIcon: 'fa-user', roleTitle: 'Prompt will be sent as User' },
					};
					const iconLookup = prompt.role === 'system' && prompt.system_prompt ? '' : prompt.role;
					const roleIcon = promptRoles[iconLookup]?.roleIcon || '';
					const roleTitle = promptRoles[iconLookup]?.roleTitle || '';

					// Markers show name but are not expandable or editable
					const nameDisplay = isMarker
						? `<span title="${escapeHtml(prompt.name || prompt.identifier)}">${escapeHtml(prompt.name || prompt.identifier)}</span>`
						: `<a class="ccpm-expand-prompt" data-identifier="${escapeHtml(prompt.identifier)}">${escapeHtml(prompt.name || prompt.identifier)}</a>`;

					// Edit button only for non-markers
					const editButton = !isMarker
						? `<span class="ccpm-edit-prompt fa-solid fa-pencil fa-xs" data-identifier="${escapeHtml(prompt.identifier)}" title="Edit prompt" style="margin-left: 8px; opacity: 0.4; cursor: pointer;"></span>`
						: '';

					return `
						<li class="ccpm_prompt_manager_prompt ccpm_prompt_draggable ${isMarker ? 'ccpm_prompt_manager_marker' : ''}" data-identifier="${escapeHtml(prompt.identifier)}">
							<span class="drag-handle">☰</span>
							<span class="ccpm_prompt_manager_prompt_name">
								${isMarker ? '<span class="fa-fw fa-solid fa-thumb-tack" title="Marker"></span>' : ''}
								${!isMarker && isSystemPrompt ? '<span class="fa-fw fa-solid fa-square-poll-horizontal" title="System Prompt"></span>' : ''}
								${!isMarker && !isSystemPrompt ? '<span class="fa-fw fa-solid fa-asterisk" title="User Prompt"></span>' : ''}
								${isInjectionPrompt ? '<span class="fa-fw fa-solid fa-syringe" title="In-Chat Injection"></span>' : ''}
								${nameDisplay}
								${editButton}
								${roleIcon ? `<span data-role="${escapeHtml(prompt.role)}" class="fa-xs fa-solid ${roleIcon}" title="${roleTitle}"></span>` : ''}
								${isInjectionPrompt ? `<small class="prompt-manager-injection-depth">@ ${escapeHtml(prompt.injection_depth)}</small>` : ''}
							</span>
							<span></span>
							<span class="ccpm_prompt_role">${escapeHtml(prompt.role || 'system')}</span>
						</li>
						${!isMarker ? `
							<li class="inline-drawer ccpm_prompt_drawer" data-identifier="${escapeHtml(prompt.identifier)}" style="grid-column: 1 / -1; margin: 0 0 10px 30px;">
								<div class="inline-drawer-toggle inline-drawer-header" style="display: none;">
									<span>Prompt Content</span>
									<div class="fa-solid fa-circle-chevron-down inline-drawer-icon down"></div>
								</div>
								<div class="inline-drawer-content text_pole padding10" style="background: var(--black30a); display: none;">
									${prompt.injection_position === 1 ? `
										<div class="flex-container flexGap10 marginBot5 fontsize90p text_muted">
											<span><strong>Position:</strong> Absolute (In-Chat)</span>
											<span><strong>Depth:</strong> ${prompt.injection_depth || 4}</span>
											<span><strong>Order:</strong> ${prompt.injection_order || 100}</span>
										</div>
									` : ''}
									<div class="fontsize90p" style="white-space: pre-wrap; font-family: monospace; max-height: 300px; overflow-y: auto;">
${escapeHtml(prompt.content || '(empty)')}
									</div>
								</div>
							</li>
						` : ''}
					`;
				}).join('')}
			</ul>
			<div class="text_muted fontsize90p">
				<i class="fa-solid fa-info-circle"></i> Drag prompts by the handle to reorder. Click prompt names to expand/collapse content.
			</div>
		</div>
	`;

	const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
		okButton: 'Save Order',
		cancelButton: 'Close',
		wide: true,
		large: true,
		allowVerticalScrolling: true,
		onOpen: () => {
			// Setup click handlers for expanding/collapsing prompts using inline-drawer
			document.querySelectorAll('.ccpm-expand-prompt').forEach(link => {
				link.addEventListener('click', (e) => {
					e.preventDefault();
					const identifier = link.dataset.identifier;
					const drawerContent = document.querySelector(`.ccpm_prompt_drawer[data-identifier="${identifier}"] .inline-drawer-content`);
					if (drawerContent) {
						const isVisible = drawerContent.style.display !== 'none';
						drawerContent.style.display = isVisible ? 'none' : 'block';
					}
				});
			});

			// Setup click handlers for editing prompts
			document.querySelectorAll('.ccpm-edit-prompt').forEach(btn => {
				btn.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					const identifier = btn.dataset.identifier;
					ccpmEditPromptInTemplate(templateId, identifier);
				});
			});

			// Make the list sortable using jQuery UI
			$('#ccpm-prompt-order-list').sortable({
				delay: 30,
				handle: '.drag-handle',
				items: '.ccpm_prompt_draggable',
				update: function() {
					// Order changed - will be saved if user clicks Save
				}
			});
		},
		onClosing: async (popup) => {
			if (popup.result === POPUP_RESULT.AFFIRMATIVE) {
				// Save the new order
				const newOrder = [];
				document.querySelectorAll('.ccpm_prompt_draggable').forEach(li => {
					const identifier = li.dataset.identifier;
					// Find the original entry in promptOrder to preserve enabled status
					const originalEntry = template.promptOrder?.find(e => e.identifier === identifier);
					newOrder.push({
						identifier: identifier,
						enabled: originalEntry?.enabled ?? true
					});
				});

				// Update template's promptOrder
				promptTemplateManager.updateTemplate(templateId, {
					promptOrder: newOrder
				});

				toastr.success('Prompt order saved');
				return true;
			}
			return true;
		}
	});

	await popup.show();
};

/**
 * Edit a prompt within a template using ST's existing edit form
 */
window.ccpmEditPromptInTemplate = async function(templateId, promptIdentifier) {
	const template = promptTemplateManager.getTemplate(templateId);
	if (!template) {
		toastr.error('Template not found');
		return;
	}

	const prompt = template.prompts[promptIdentifier];
	if (!prompt) {
		toastr.error('Prompt not found in template');
		return;
	}

	// Clone ST's existing edit form from the DOM
	const formContainer = document.getElementById('completion_prompt_manager_popup_edit');
	if (!formContainer) {
		toastr.error('Edit form container not found');
		return;
	}

	// Clone ST's form to use in our popup
	const clonedForm = formContainer.cloneNode(true);
	clonedForm.id = 'ccpm_temp_edit_form';
	clonedForm.style.display = 'block';

	let savedData = null;

	const editPopup = new Popup(clonedForm, POPUP_TYPE.CONFIRM, '', {
		okButton: 'Save',
		cancelButton: 'Cancel',
		wide: true,
		large: true,
		allowVerticalScrolling: true,
		onOpen: () => {
			// Re-populate after clone (DOM elements are new)
			const clonedNameField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_name');
			const clonedRoleField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_role');
			const clonedPromptField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_prompt');
			const clonedInjectionPositionField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_injection_position');
			const clonedInjectionDepthField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_injection_depth');
			const clonedInjectionOrderField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_injection_order');
			const clonedInjectionTriggerField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_injection_trigger');
			const clonedDepthBlock = clonedForm.querySelector('#completion_prompt_manager_depth_block');
			const clonedOrderBlock = clonedForm.querySelector('#completion_prompt_manager_order_block');
			const clonedForbidOverridesField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_forbid_overrides');

			if (clonedNameField) clonedNameField.value = prompt.name || '';
			if (clonedRoleField) clonedRoleField.value = prompt.role || 'system';
			if (clonedPromptField) clonedPromptField.value = prompt.content || '';
			if (clonedInjectionPositionField) clonedInjectionPositionField.value = (prompt.injection_position ?? 0).toString();
			if (clonedInjectionDepthField) clonedInjectionDepthField.value = (prompt.injection_depth ?? 4).toString();
			if (clonedInjectionOrderField) clonedInjectionOrderField.value = (prompt.injection_order ?? 100).toString();

			if (clonedInjectionTriggerField) {
				Array.from(clonedInjectionTriggerField.options).forEach(option => {
					option.selected = Array.isArray(prompt.injection_trigger) && prompt.injection_trigger.includes(option.value);
				});
			}

			if (clonedDepthBlock && clonedOrderBlock) {
				const showFields = clonedInjectionPositionField && clonedInjectionPositionField.value === '1';
				clonedDepthBlock.style.visibility = showFields ? 'visible' : 'hidden';
				clonedOrderBlock.style.visibility = showFields ? 'visible' : 'hidden';

				// Add change listener for injection position
				if (clonedInjectionPositionField) {
					clonedInjectionPositionField.addEventListener('change', (e) => {
						const showFields = e.target.value === '1';
						clonedDepthBlock.style.visibility = showFields ? 'visible' : 'hidden';
						clonedOrderBlock.style.visibility = showFields ? 'visible' : 'hidden';
					});
				}
			}

			if (clonedForbidOverridesField) clonedForbidOverridesField.checked = prompt.forbid_overrides ?? false;
		},
		onClosing: (popup) => {
			if (popup.result === POPUP_RESULT.AFFIRMATIVE) {
				// Capture form values
				const clonedNameField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_name');
				const clonedRoleField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_role');
				const clonedPromptField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_prompt');
				const clonedInjectionPositionField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_injection_position');
				const clonedInjectionDepthField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_injection_depth');
				const clonedInjectionOrderField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_injection_order');
				const clonedInjectionTriggerField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_injection_trigger');
				const clonedForbidOverridesField = clonedForm.querySelector('#completion_prompt_manager_popup_entry_form_forbid_overrides');

				savedData = {
					name: clonedNameField?.value || prompt.name,
					role: clonedRoleField?.value || prompt.role,
					content: clonedPromptField?.value || prompt.content,
					injection_position: clonedInjectionPositionField ? Number(clonedInjectionPositionField.value) : prompt.injection_position,
					injection_depth: clonedInjectionDepthField ? Number(clonedInjectionDepthField.value) : prompt.injection_depth,
					injection_order: clonedInjectionOrderField ? Number(clonedInjectionOrderField.value) : prompt.injection_order,
					injection_trigger: clonedInjectionTriggerField ? Array.from(clonedInjectionTriggerField.selectedOptions).map(opt => opt.value) : prompt.injection_trigger,
					forbid_overrides: clonedForbidOverridesField?.checked ?? prompt.forbid_overrides,
				};
			}
			return true;
		}
	});

	const result = await editPopup.show();

	if (result && savedData) {
		// Update the prompt in the template
		Object.assign(template.prompts[promptIdentifier], savedData);
		template.updatedAt = new Date().toISOString();
		promptTemplateManager.saveSettings();
		toastr.success('Prompt updated in template');

		// Refresh the viewer
		await window.ccpmViewPrompts(templateId);
	}
};

async function showCreateTemplateDialog() {
	const availablePrompts = oai_settings.prompts || [];

	// Handle array format - extract identifiers from prompt objects
	const promptList = Array.isArray(availablePrompts)
		? availablePrompts.filter(p => p.identifier).map(p => ({ identifier: p.identifier, name: p.name || p.identifier }))
		: Object.keys(availablePrompts).map(id => ({ identifier: id, name: availablePrompts[id].name || id }));

	if (promptList.length === 0) {
		toastr.warning('No prompts found to create template from');
		return;
	}

	const content = document.createElement('div');
	content.innerHTML = `
		<div class="flex-container flexFlowColumn flexGap10">
			<div class="flex-container flexFlowColumn">
				<label for="ccpm-template-name"><strong>Template Name:</strong></label>
				<input type="text" id="ccpm-template-name" class="text_pole" placeholder="Enter template name" required>
			</div>
			<div class="flex-container flexFlowColumn">
				<label for="ccpm-template-desc"><strong>Description (optional):</strong></label>
				<textarea id="ccpm-template-desc" class="text_pole" placeholder="Describe this template" style="min-height: 80px; resize: vertical;"></textarea>
			</div>
			<div class="flex-container flexFlowColumn">
				<label><strong>Include Prompts:</strong></label>
				<div class="flex-container flexGap5 m-b-1">
					<button type="button" id="ccpm-select-all" class="menu_button menu_button_icon interactable">Select All</button>
					<button type="button" id="ccpm-unselect-all" class="menu_button menu_button_icon interactable">Unselect All</button>
				</div>
				<div class="flex-container flexWrap flexGap10 m-t-1">
					${promptList.map(p => `
						<div class="flex-container alignItemsCenter flexGap5">
							<input type="checkbox" name="ccpm-prompts" value="${escapeHtml(p.identifier)}" checked class="interactable">
							<label>${escapeHtml(p.name)}</label>
						</div>
					`).join('')}
				</div>
			</div>
		</div>
	`;

	let capturedData = null;

	const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
		okButton: 'Create',
		cancelButton: 'Cancel',
		allowVerticalScrolling: true,
		onOpen: () => {
			// Setup select/unselect all buttons
			document.getElementById('ccpm-select-all')?.addEventListener('click', () => {
				document.querySelectorAll('input[name="ccpm-prompts"]').forEach(cb => cb.checked = true);
			});
			document.getElementById('ccpm-unselect-all')?.addEventListener('click', () => {
				document.querySelectorAll('input[name="ccpm-prompts"]').forEach(cb => cb.checked = false);
			});
		},
		onClosing: (popup) => {
			// Capture values before popup closes and DOM is removed
			if (popup.result === POPUP_RESULT.AFFIRMATIVE) {
				const name = document.getElementById('ccpm-template-name')?.value.trim();
				const description = document.getElementById('ccpm-template-desc')?.value.trim();
				const selectedPrompts = Array.from(document.querySelectorAll('input[name="ccpm-prompts"]:checked'))
					.map(cb => cb.value);

				console.log('CCPM DEBUG: Captured values - name:', name, 'description:', description, 'prompts:', selectedPrompts);

				if (!name) {
					toastr.error('Template name is required');
					return false; // Prevent popup from closing
				}

				if (selectedPrompts.length === 0) {
					toastr.error('Select at least one prompt');
					return false; // Prevent popup from closing
				}

				capturedData = { name, description, selectedPrompts };
			}
			return true; // Allow popup to close
		}
	});

	const result = await popup.show();
	console.log('CCPM DEBUG: Popup result:', result);

	if (!result || !capturedData) {
		console.log('CCPM DEBUG: User cancelled or no data captured');
		return;
	}

	console.log('CCPM DEBUG: User clicked Create');

	try {
		console.log('CCPM DEBUG: Calling createTemplateFromCurrent');
		const template = promptTemplateManager.createTemplateFromCurrent(
			capturedData.name,
			capturedData.description,
			capturedData.selectedPrompts
		);
		console.log('CCPM DEBUG: createTemplateFromCurrent returned:', template);
		console.log('CCPM DEBUG: Template count after creation:', promptTemplateManager.listTemplates().length);
		console.log('CCPM DEBUG: extension_settings.ccPromptManager=', extension_settings.ccPromptManager);
		toastr.success('Template created successfully');
		await renderPromptTemplateList();
	} catch (error) {
		console.error('CCPM DEBUG: Error creating template:', error);
		toastr.error('Failed to create template: ' + error.message);
	}
}

async function showEditTemplateDialog(template) {
	const content = document.createElement('div');
	content.innerHTML = `
		<div class="flex-container flexFlowColumn flexGap10">
			<div class="flex-container flexFlowColumn">
				<label for="ccpm-edit-name"><strong>Template Name:</strong></label>
				<input type="text" id="ccpm-edit-name" class="text_pole" value="${escapeHtml(template.name)}" required>
			</div>
			<div class="flex-container flexFlowColumn">
				<label for="ccpm-edit-desc"><strong>Description:</strong></label>
				<textarea id="ccpm-edit-desc" class="text_pole" style="min-height: 80px; resize: vertical;">${escapeHtml(template.description || '')}</textarea>
			</div>
		</div>
	`;

	let capturedData = null;

	const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
		okButton: 'Save',
		cancelButton: 'Cancel',
		allowVerticalScrolling: true,
		onClosing: (popup) => {
			if (popup.result === POPUP_RESULT.AFFIRMATIVE) {
				const name = document.getElementById('ccpm-edit-name')?.value.trim();
				const description = document.getElementById('ccpm-edit-desc')?.value.trim();

				if (!name) {
					toastr.error('Template name is required');
					return false;
				}

				capturedData = { name, description };
			}
			return true;
		}
	});

	const result = await popup.show();
	if (!result || !capturedData) return;

	try {
		promptTemplateManager.updateTemplate(template.id, capturedData);
		toastr.success('Template updated successfully');
		await renderPromptTemplateList();
	} catch (error) {
		toastr.error('Failed to update template: ' + error.message);
	}
}

async function showImportTemplateDialog() {
	// Create file input
	const fileInput = document.createElement('input');
	fileInput.type = 'file';
	fileInput.accept = '.json';

	fileInput.addEventListener('change', async () => {
		if (fileInput.files.length === 0) return;

		try {
			const file = fileInput.files[0];
			const text = await file.text();
			const templates = JSON.parse(text);
			const templatesArray = Array.isArray(templates) ? templates : [templates];

			const result = promptTemplateManager.importTemplates(templatesArray);

			if (result.imported > 0) {
				toastr.success(`Imported ${result.imported} template(s) successfully`);
				await renderPromptTemplateList();
			}

			if (result.skipped > 0) {
				toastr.warning(`Skipped ${result.skipped} invalid template(s)`);
			}

			if (result.imported === 0 && result.skipped === 0) {
				toastr.error('No valid templates found in file');
			}
		} catch (error) {
			toastr.error('Failed to import template: ' + error.message);
		}
	});

	// Trigger file picker
	fileInput.click();
}

function exportAllTemplates() {
	const templates = promptTemplateManager.exportTemplates();
	if (templates.length === 0) {
		toastr.warning('No templates to export');
		return;
	}

	const jsonData = JSON.stringify(templates, null, 2);

	// Create downloadable file
	const blob = new Blob([jsonData], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `ccpm-templates-${new Date().toISOString().split('T')[0]}.json`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);

	toastr.success(`Exported ${templates.length} template(s)`);
}

// Extension initialization - wait for SillyTavern to be ready
function initializeExtension() {
	console.log('CCPM: initializeExtension called');
	console.log('CCPM: promptManager exists?', !!promptManager);

	// Inject UI when app is ready
	injectPromptTemplateManagerButton();

	// Hook into promptManager.renderPromptManagerListItems() to inject display box
	// This way our display is part of the rendered content, not inserted afterward
	if (promptManager) {
		console.log('CCPM: Hooking into promptManager.renderPromptManagerListItems()');

		const originalRenderListItems = promptManager.renderPromptManagerListItems.bind(promptManager);

		promptManager.renderPromptManagerListItems = async function(...args) {
			console.log('CCPM DEBUG: renderPromptManagerListItems() called');
			// Let ST render the list first
			await originalRenderListItems(...args);

			// Now inject our display box at the top of the list
			const context = await resolveContext();
			const preferences = Storage.getPreferences();
			const lock = resolveLock(context, preferences);
			updateDisplay(null, lock);
		};

		console.log('CCPM: Hook applied to renderPromptManagerListItems');
	} else {
		console.warn('CCPM: promptManager not available at initialization');
	}

	console.log('CCPM: Extension initialized');
}

// Register event handlers using new modular architecture
eventSource.on(event_types.APP_READY, initializeExtension);
eventSource.on(event_types.CHAT_CHANGED, () => NewEventHandlers.onChatChanged());
eventSource.on(event_types.SETTINGS_UPDATED, () => NewEventHandlers.onSettingsUpdated());
if (event_types.OAI_PRESET_CHANGED_AFTER) {
	eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => NewEventHandlers.onPresetChanged());
}

