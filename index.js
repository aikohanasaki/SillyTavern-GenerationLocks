// ============================================================================
// SillyTavern Generation Locks (STGL)
// Merges STCL (Connection Profiles + Presets) with CCPM (Completion Templates)
// ============================================================================

// ===== IMPORTS =====
import { eventSource, event_types, saveSettingsDebounced, chat_metadata, name2, systemUserName, neutralCharacterName, characters } from '../../../../script.js';
import { extension_settings, saveMetadataDebounced, getContext } from '../../../extensions.js';
import { Popup, POPUP_TYPE, POPUP_RESULT, callGenericPopup } from '../../../popup.js';
import { lodash, Handlebars } from '../../../../lib.js';
import { selected_group, groups, editGroup } from '../../../group-chats.js';
import { executeSlashCommandsWithOptions } from '../../../slash-commands.js';
import { oai_settings, promptManager, getChatCompletionModel } from '../../../openai.js';
import { MigrationManager } from './migration.js';
import { injectPromptTemplateManagerButton } from './promptManager.js';

// ===== CONSTANTS AND CONFIGURATION =====

const MODULE_NAME = 'STGL';
const CACHE_TTL = 1000;
const MAX_CONTEXT_QUEUE_SIZE = 20;
const DEBUG_MODE = false;

const CHAT_TYPES = {
    SINGLE: 'single',
    GROUP: 'group'
};

const SETTING_SOURCES = {
    CHARACTER: 'character',
    MODEL: 'model',
    CHAT: 'chat',
    GROUP: 'group',
    INDIVIDUAL: 'individual'
};

const AUTO_APPLY_MODES = {
    NEVER: 'never',
    ASK: 'ask',
    ALWAYS: 'always'
};

const LOCKABLE_ITEMS = {
    PROFILE: 'profile',
    PRESET: 'preset',
    TEMPLATE: 'template'
};

const DEFAULT_SETTINGS = {
    moduleSettings: {
        preferIndividualCharacterInGroup: true,
        showNotifications: true,
        autoApplyOnContextChange: AUTO_APPLY_MODES.ASK,
        // Priority order: first in array wins (highest priority)
        // Default: MODEL > CHAT > CHARACTER/GROUP
        priorityOrder: [SETTING_SOURCES.MODEL, SETTING_SOURCES.CHAT, SETTING_SOURCES.CHARACTER]
    },
    characterLocks: {},  // { [chId]: { profile, preset, template } }
    modelLocks: {},      // { [model]: { preset, template } } - NO profile field
    chatLocks: {},       // Will use chat_metadata.STGL { profile, preset, template }
    groupLocks: {},      // Will use group.stgl_locks { profile, preset, template }
    templates: {},       // Template definitions
    migrationVersion: 1
};

const SELECTORS = {
    menuItem: '#stgl-menu-item'
};

// ============================================================================
// SECTION 1: CORE CLASSES (Shared Infrastructure)
// ============================================================================

/**
 * Centralized chat context detection and management
 * Handles both single character chats and group chats
 */
class ChatContext {
    constructor() {
        this.cache = new Map();
        this.cacheTime = 0;
    }

    getCurrent() {
        const now = Date.now();
        if (now - this.cacheTime < CACHE_TTL && this.cache.has('current')) {
            return this.cache.get('current');
        }

        try {
            const context = this._buildContext();
            this.cache.set('current', context);
            this.cacheTime = now;
            return context;
        } catch (error) {
            console.error('STGL: Error building context:', error);
            if (this.cache.has('current')) {
                console.warn('STGL: Using stale cached context due to build error');
                return this.cache.get('current');
            }
            throw error;
        }
    }

    invalidate() {
        this.cache.clear();
        this.cacheTime = 0;
    }

    _buildContext() {
        const isGroupChat = !!selected_group;

        if (isGroupChat) {
            return this._buildGroupContext();
        } else {
            return this._buildSingleContext();
        }
    }

    _buildGroupContext() {
        const groupId = selected_group;
        const group = groups?.find(x => x.id === groupId);

        return {
            type: CHAT_TYPES.GROUP,
            isGroupChat: true,
            groupId,
            groupName: group?.name || null,
            chatId: group?.chat_id || null,
            chatName: group?.name || null,
            characterName: group?.name || null,
            modelName: this._getCurrentModel(),
            primaryId: groupId,
            secondaryId: group?.chat_id
        };
    }

    _buildSingleContext() {
        const characterName = this._getCharacterNameForSettings();
        const chatId = this._getCurrentChatId();

        return {
            type: CHAT_TYPES.SINGLE,
            isGroupChat: false,
            groupId: null,
            groupName: null,
            chatId,
            chatName: chatId,
            characterName,
            modelName: this._getCurrentModel(),
            primaryId: characterName,
            secondaryId: chatId
        };
    }

    _getCharacterNameForSettings() {
        let characterName = name2;

        if (!characterName || characterName === systemUserName || characterName === neutralCharacterName) {
            characterName = this._getCharacterNameFromChatMetadata();
        }

        if (!characterName) {
            return null;
        }

        characterName = String(characterName).trim();
        if (characterName.normalize) {
            characterName = characterName.normalize('NFC');
        }

        return characterName;
    }

    _getCharacterNameFromChatMetadata() {
        try {
            const metadata = chat_metadata;
            const characterName = metadata?.character_name;
            return characterName && typeof characterName === 'string' ? characterName.trim() : null;
        } catch (error) {
            if (DEBUG_MODE) console.warn('STGL: Error getting character name from chat metadata:', error);
            return null;
        }
    }

    _getCurrentChatId() {
        try {
            const context = getContext();
            return context?.chatId || null;
        } catch (error) {
            if (DEBUG_MODE) console.warn('STGL: Error getting chat ID:', error);
            return null;
        }
    }

    _getCurrentModel() {
        try {
            return getChatCompletionModel() || null;
        } catch (error) {
            if (DEBUG_MODE) console.warn('STGL: Error getting current model:', error);
            return null;
        }
    }
}

/**
 * Centralized storage operations for all lock types
 * Handles multi-item locks: { profile, preset, template }
 */
class StorageAdapter {
    constructor() {
        this.EXTENSION_KEY = MODULE_NAME;
    }

    getExtensionSettings() {
        if (!extension_settings[this.EXTENSION_KEY]) {
            extension_settings[this.EXTENSION_KEY] = lodash.cloneDeep(DEFAULT_SETTINGS);
        }

        const settings = extension_settings[this.EXTENSION_KEY];

        // Cleanup deprecated preferences (alpha)
        if (settings.moduleSettings) {
            delete settings.moduleSettings.lockingMode;
            delete settings.moduleSettings.preferChatOverCharacterOrGroup;
            delete settings.moduleSettings.preferChatOverModel;
        }

        return settings;
    }

    saveExtensionSettings() {
        saveSettingsDebounced();
    }

    // ===== CHARACTER LOCKS =====

    getCharacterLock(characterKey) {
        if (characterKey === undefined || characterKey === null) {
            if (DEBUG_MODE) console.warn('STGL: Cannot get character lock - invalid key');
            return null;
        }

        const settings = this.getExtensionSettings();
        let lock = null;

        if (typeof characterKey === 'number') {
            // New system: Use chId as key
            const chIdKey = String(characterKey);
            lock = settings.characterLocks?.[chIdKey] || null;

            if (!lock && characters?.[characterKey]?.name) {
                // Fallback: Try character name
                const characterName = characters[characterKey].name;
                const nameKey = this._normalizeCharacterName(characterName);
                lock = settings.characterLocks?.[nameKey] || null;
            }
        } else {
            // Backward compatibility: character name lookup
            const nameKey = this._normalizeCharacterName(characterKey);
            lock = settings.characterLocks?.[nameKey] || null;
        }

        return lock;
    }

    setCharacterLock(characterKey, locks) {
        if (characterKey === undefined || characterKey === null) {
            if (DEBUG_MODE) console.warn('STGL: Cannot save character lock - invalid key');
            return false;
        }

        const settings = this.getExtensionSettings();
        if (!settings.characterLocks) {
            settings.characterLocks = {};
        }

        const saveKey = typeof characterKey === 'number' ? String(characterKey) : this._normalizeCharacterName(characterKey);
        settings.characterLocks[saveKey] = locks;

        if (DEBUG_MODE) console.log('STGL: Character lock saved for key:', saveKey, locks);
        this.saveExtensionSettings();
        return true;
    }

    clearCharacterLock(characterKey) {
        if (characterKey === undefined || characterKey === null) return false;

        const settings = this.getExtensionSettings();
        let cleared = false;

        if (typeof characterKey === 'number') {
            const chIdKey = String(characterKey);
            if (settings.characterLocks?.[chIdKey]) {
                delete settings.characterLocks[chIdKey];
                cleared = true;
            }

            if (characters?.[characterKey]?.name) {
                const nameKey = this._normalizeCharacterName(characters[characterKey].name);
                if (settings.characterLocks?.[nameKey]) {
                    delete settings.characterLocks[nameKey];
                    cleared = true;
                }
            }
        } else {
            const nameKey = this._normalizeCharacterName(characterKey);
            if (settings.characterLocks?.[nameKey]) {
                delete settings.characterLocks[nameKey];
                cleared = true;
            }
        }

        if (cleared) this.saveExtensionSettings();
        return cleared;
    }

    // ===== MODEL LOCKS =====

    getModelLock(modelName) {
        if (!modelName) return null;
        const settings = this.getExtensionSettings();
        return settings.modelLocks?.[modelName] || null;
    }

    setModelLock(modelName, locks) {
        if (!modelName) return false;
        const settings = this.getExtensionSettings();
        if (!settings.modelLocks) settings.modelLocks = {};
        settings.modelLocks[modelName] = locks;
        this.saveExtensionSettings();
        return true;
    }

    clearModelLock(modelName) {
        if (!modelName) return false;
        const settings = this.getExtensionSettings();
        if (settings.modelLocks?.[modelName]) {
            delete settings.modelLocks[modelName];
            this.saveExtensionSettings();
            return true;
        }
        return false;
    }


    // ===== CHAT LOCKS =====

    getChatLock() {
        try {
            return chat_metadata?.[this.EXTENSION_KEY] || null;
        } catch (error) {
            console.warn('STGL: Error getting chat lock:', error);
            return null;
        }
    }

    setChatLock(locks) {
        try {
            if (!chat_metadata) {
                console.warn('STGL: Cannot save chat lock - no chat metadata available');
                return false;
            }
            chat_metadata[this.EXTENSION_KEY] = locks;
            saveMetadataDebounced();
            return true;
        } catch (error) {
            console.error('STGL: Error saving chat lock:', error);
            return false;
        }
    }

    clearChatLock() {
        try {
            if (chat_metadata?.[this.EXTENSION_KEY]) {
                delete chat_metadata[this.EXTENSION_KEY];
                saveMetadataDebounced();
                return true;
            }
            return false;
        } catch (error) {
            console.error('STGL: Error clearing chat lock:', error);
            return false;
        }
    }

    // ===== GROUP LOCKS =====

    getGroupLock(groupId) {
        if (!groupId) return null;
        try {
            const group = groups?.find(x => x.id === groupId);
            return group?.stgl_locks || null;
        } catch (error) {
            console.warn('STGL: Error getting group lock:', error);
            return null;
        }
    }

    async setGroupLock(groupId, locks) {
        if (!groupId) return false;
        try {
            const group = groups?.find(x => x.id === groupId);
            if (!group) {
                console.warn('STGL: Cannot save group lock - group not found');
                return false;
            }
            group.stgl_locks = locks;
            await editGroup(groupId, false, false);
            return true;
        } catch (error) {
            console.error('STGL: Error saving group lock:', error);
            return false;
        }
    }

    async clearGroupLock(groupId) {
        if (!groupId) return false;
        try {
            const group = groups?.find(x => x.id === groupId);
            if (group?.stgl_locks) {
                delete group.stgl_locks;
                await editGroup(groupId, false, false);
                return true;
            }
            return false;
        } catch (error) {
            console.error('STGL: Error clearing group lock:', error);
            return false;
        }
    }

    // ===== TEMPLATE STORAGE =====

    getTemplate(templateId) {
        const settings = this.getExtensionSettings();
        return settings.templates?.[templateId] || null;
    }

    getAllTemplates() {
        const settings = this.getExtensionSettings();
        return settings.templates || {};
    }

    saveTemplate(template) {
        const settings = this.getExtensionSettings();
        if (!settings.templates) settings.templates = {};
        settings.templates[template.id] = template;
        this.saveExtensionSettings();
    }

    deleteTemplate(templateId) {
        const settings = this.getExtensionSettings();
        if (settings.templates?.[templateId]) {
            delete settings.templates[templateId];
            this.saveExtensionSettings();
            return true;
        }
        return false;
    }

    // ===== PREFERENCES =====

    getPreferences() {
        const settings = this.getExtensionSettings();
        return settings.moduleSettings || {};
    }

    updatePreference(key, value) {
        const settings = this.getExtensionSettings();
        if (!settings.moduleSettings) {
            settings.moduleSettings = {};
        }
        settings.moduleSettings[key] = value;
        this.saveExtensionSettings();
    }

    // ===== HELPER METHODS =====

    _normalizeCharacterName(characterName) {
        let normalized = String(characterName).trim();
        if (normalized.normalize) {
            normalized = normalized.normalize('NFC');
        }
        return normalized;
    }
}

/**
 * Priority Resolver - Determines which locks to apply based on context and preferences
 * Implements independent item resolution with flexible priority cascades
 */
class PriorityResolver {
    constructor(storage) {
        this.storage = storage;
    }

    /**
     * Resolve locks for current context
     * @param {Object} context - From ChatContext.getCurrent()
     * @param {Object} preferences - User preferences
     * @returns {Object} { locks: { profile, preset, template }, sources: {...} }
     */
    resolve(context, preferences) {
        // Build priority cascade based on context and preferences
        const cascade = this._buildCascade(context, preferences);

        if (DEBUG_MODE) {
            console.log('STGL: Priority cascade:', cascade);
        }

        // Resolve each item independently
        const result = {
            locks: {},
            sources: {}
        };

        for (const itemName of [LOCKABLE_ITEMS.PROFILE, LOCKABLE_ITEMS.PRESET, LOCKABLE_ITEMS.TEMPLATE]) {
            const resolved = this._resolveItem(itemName, cascade, context);
            result.locks[itemName] = resolved.value;
            result.sources[itemName] = resolved.source;
        }

        return result;
    }

    /**
     * Build priority cascade array based on context and preferences
     * Uses priorityOrder array from preferences - first in array wins (highest priority)
     * @private
     */
    _buildCascade(context, preferences) {
        const {
            preferIndividualCharacterInGroup,
            priorityOrder
        } = preferences;

        const { isGroupChat } = context;

        // Validate and normalize priority order; fallback to default if invalid
        const validSources = new Set([SETTING_SOURCES.CHAT, SETTING_SOURCES.CHARACTER, SETTING_SOURCES.MODEL]);
        const baseOrder = Array.isArray(priorityOrder) ? priorityOrder.filter(s => validSources.has(s)) : [];
        const order = baseOrder.length ? baseOrder : [SETTING_SOURCES.MODEL, SETTING_SOURCES.CHAT, SETTING_SOURCES.CHARACTER];

        const cascade = [];

        for (const source of order) {
            if (source === SETTING_SOURCES.CHARACTER) {
                if (isGroupChat) {
                    cascade.push(SETTING_SOURCES.GROUP);
                } else {
                    cascade.push(SETTING_SOURCES.CHARACTER);
                }
            } else {
                cascade.push(source);
            }
        }

        return cascade;
    }

    /**
     * Resolve single item through cascade
     * @private
     */
    _resolveItem(itemName, cascade, context) {
        for (const dimension of cascade) {
            // Special case: Model locks cannot have profile field
            if (itemName === LOCKABLE_ITEMS.PROFILE && dimension === SETTING_SOURCES.MODEL) {
                continue;
            }

            const lock = this._getLockForDimension(dimension, context);
            if (!lock) continue;

            // Check if this lock has the item
            const value = lock[itemName];
            if (value !== null && value !== undefined) {
                return { value, source: dimension };
            }

            // null or undefined - continue to next dimension
        }

        // All exhausted
        return { value: null, source: null };
    }

    /**
     * Get lock for a specific dimension
     * @private
     */
    _getLockForDimension(dimension, context) {
        switch (dimension) {
            case SETTING_SOURCES.CHARACTER:
                if (context.isGroupChat) return null; // Skip in groups
                const chId = this._getCharacterIndex(context.characterName);
                return this.storage.getCharacterLock(chId !== -1 ? chId : context.characterName);

            case SETTING_SOURCES.MODEL:
                return this.storage.getModelLock(context.modelName);

            case SETTING_SOURCES.CHAT:
                return this.storage.getChatLock();

            case SETTING_SOURCES.GROUP:
                return this.storage.getGroupLock(context.groupId);

            case SETTING_SOURCES.INDIVIDUAL:
                // Individual character in group
                const speakerChId = this._getCurrentSpeakerChId(context);
                if (speakerChId === -1) return null;
                return this.storage.getCharacterLock(speakerChId);

            default:
                return null;
        }
    }

    /**
     * Get character index from name
     * @private
     */
    _getCharacterIndex(characterName) {
        if (!characterName || !characters) return -1;
        return characters.findIndex(x => x.name === characterName);
    }

    /**
     * Get current speaker character ID in group
     * @private
     * @returns {number} -1 (not available in cascade resolution)
     *
     * Note: Individual character locks in groups are applied directly via the
     * GROUP_MEMBER_DRAFTED event handler, not through cascade resolution,
     * because the "current speaker" is only known during that event.
     */
    _getCurrentSpeakerChId(context) {
        // Individual locks are handled by GROUP_MEMBER_DRAFTED event, not cascade
        return -1;
    }

    /**
     * Detect conflicts in locks
     * @param {Object} context
     * @param {Object} preferences
     * @returns {Array} Array of conflict objects
     */
    detectConflicts(context, preferences) {
        const cascade = this._buildCascade(context, preferences);
        const conflicts = [];

        for (const itemName of [LOCKABLE_ITEMS.PROFILE, LOCKABLE_ITEMS.PRESET, LOCKABLE_ITEMS.TEMPLATE]) {
            const values = new Map(); // dimension -> value

            for (const dimension of cascade) {
                // Skip model for profile
                if (itemName === LOCKABLE_ITEMS.PROFILE && dimension === SETTING_SOURCES.MODEL) {
                    continue;
                }

                const lock = this._getLockForDimension(dimension, context);
                const value = lock?.[itemName];

                if (value !== null && value !== undefined) {
                    values.set(dimension, value);
                }
            }

            // Check if more than one unique value exists
            const uniqueValues = new Set(values.values());
            if (uniqueValues.size > 1) {
                conflicts.push({
                    item: itemName,
                    sources: Object.fromEntries(values)
                });
            }
        }

        return conflicts;
    }
}

// ============================================================================
// TEMPLATE OPERATIONS (Embedded from CCPM)
// ============================================================================

/**
 * Pure functions for template data manipulation
 */
const TemplateOps = {
    generateId() {
        return 'tmpl_' + Math.random().toString(36).substr(2, 9);
    },

    createFromCurrent({ name, description, includePrompts = null, id = null }) {
        const availablePrompts = oai_settings.prompts || [];
        const promptsMap = Array.isArray(availablePrompts)
            ? availablePrompts.reduce((acc, p) => {
                if (p.identifier) acc[p.identifier] = p;
                return acc;
            }, {})
            : availablePrompts;

        const selectedPrompts = {};
        const identifiersToInclude = includePrompts || Object.keys(promptsMap);

        for (const identifier of identifiersToInclude) {
            if (promptsMap[identifier]) {
                selectedPrompts[identifier] = { ...promptsMap[identifier] };
            }
        }

        let promptOrder = [];
        let promptOrderCharacterId = null;

        if (promptManager?.activeCharacter) {
            promptOrderCharacterId = promptManager.activeCharacter.id;
            promptOrder = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
        }

        const context = getContext();
        const characterName = context.name2 || name2;

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

    validate(template) {
        if (!template || typeof template !== 'object') return false;
        if (!template.id || typeof template.id !== 'string') return false;
        if (!template.name || typeof template.name !== 'string') return false;
        if (!template.prompts || typeof template.prompts !== 'object') return false;
        return true;
    },

    applyToPromptManager(template) {
        if (!this.validate(template)) {
            console.error('STGL: Invalid template');
            return false;
        }

        try {
            const promptsArray = Object.values(template.prompts);

            // Prefer PromptManager API to update prompts; fallback to oai_settings if unavailable
            if (promptManager && typeof promptManager.setPrompts === 'function') {
                promptManager.setPrompts(promptsArray);
            } else {
                oai_settings.prompts = promptsArray;
            }

            // Apply prompt order for the active character if provided
            if (template.promptOrder && template.promptOrder.length > 0 && promptManager?.activeCharacter) {
                try {
                    if (typeof promptManager.removePromptOrderForCharacter === 'function') {
                        promptManager.removePromptOrderForCharacter(promptManager.activeCharacter);
                    }
                    if (typeof promptManager.addPromptOrderForCharacter === 'function') {
                        promptManager.addPromptOrderForCharacter(promptManager.activeCharacter, template.promptOrder);
                    }
                } catch (e) {
                    console.warn('STGL: Failed to set prompt order for character:', e);
                }
            }

            // Persist via PromptManager if available, otherwise fall back to global save
            if (promptManager && typeof promptManager.saveServiceSettings === 'function') {
                promptManager.saveServiceSettings();
            } else {
                saveSettingsDebounced();
            }

            return true;
        } catch (error) {
            console.error('STGL: Failed to apply template:', error);
            return false;
        }
    }
};

// ============================================================================
// SECTION 2: LOCKER CLASSES (Lockable Items)
// ============================================================================

/**
 * ProfileLocker - Handles connection profile switching
 * Uses /profile slash command to switch active connection profile
 */
class ProfileLocker {
    constructor() {
        this.currentProfile = null;
    }

    /**
     * Get the currently active connection profile name
     * @returns {string|null} Current profile name or null
     */
    getCurrentProfile() {
        try {
            // Read from connection manager extension settings
            const selectedProfileId = extension_settings?.connectionManager?.selectedProfile;
            if (!selectedProfileId) return null;

            const profile = extension_settings?.connectionManager?.profiles?.find(p => p.id === selectedProfileId);
            return profile?.name || null;
        } catch (error) {
            console.error('STGL: Error getting current profile:', error);
            return null;
        }
    }

    /**
     * Apply (switch to) a connection profile
     * @param {string|null} profileName - Profile name to switch to, or null to keep current
     * @param {string} originalContextId - The context ID when this apply was initiated
     * @returns {Promise<boolean>} Success status
     */
    async applyProfile(profileName, originalContextId) {
        // null means "keep prevailing settings" - intentional no-op
        if (profileName === null) {
            if (DEBUG_MODE) console.log('STGL: Profile lock returned null, keeping current profile');
            return true;
        }

        if (!profileName || typeof profileName !== 'string') {
            console.warn('STGL: Invalid profile name:', profileName);
            return false;
        }

        const trimmedName = profileName.trim();
        if (!trimmedName) {
            console.warn('STGL: Empty profile name provided');
            return false;
        }

        try {
            const currentProfile = this.getCurrentProfile();

            // Skip if already active
            if (currentProfile === trimmedName) {
                if (DEBUG_MODE) console.log(`STGL: Profile "${trimmedName}" already active`);
                return true;
            }

            if (DEBUG_MODE) console.log(`STGL: Switching to profile: ${trimmedName}`);

            // Check context hasn't changed before applying
            const currentContextId = new ChatContext().getCurrent().primaryId;
            if (currentContextId !== originalContextId) {
                if (DEBUG_MODE) console.log('STGL: Context changed, aborting profile application');
                return false;
            }

            // Use ST's slash command to switch profile
            await executeSlashCommandsWithOptions(`/profile ${trimmedName}`);

            this.currentProfile = trimmedName;
            return true;
        } catch (error) {
            console.error(`STGL: Failed to apply profile "${profileName}":`, error);
            return false;
        }
    }
}

/**
 * PresetLocker - Handles generation preset switching
 * Uses /preset slash command to switch active preset
 */
class PresetLocker {
    constructor() {
        this.currentPreset = null;
    }

    /**
     * Get the currently active preset name
     * @returns {string|null} Current preset name or null
     */
    getCurrentPreset() {
        try {
            // Read from oai_settings which is updated by /preset command
            return oai_settings?.preset_settings_openai || null;
        } catch (error) {
            console.error('STGL: Error getting current preset:', error);
            return null;
        }
    }

    /**
     * Apply (switch to) a generation preset
     * @param {string|null} presetName - Preset name to switch to, or null to keep current
     * @param {string} originalContextId - The context ID when this apply was initiated
     * @returns {Promise<boolean>} Success status
     */
    async applyPreset(presetName, originalContextId) {
        // null means "keep prevailing settings" - intentional no-op
        if (presetName === null) {
            if (DEBUG_MODE) console.log('STGL: Preset lock returned null, keeping current preset');
            return true;
        }

        if (!presetName || typeof presetName !== 'string') {
            console.warn('STGL: Invalid preset name:', presetName);
            return false;
        }

        const trimmedName = presetName.trim();
        if (!trimmedName) {
            console.warn('STGL: Empty preset name provided');
            return false;
        }

        try {
            const currentPreset = this.getCurrentPreset();

            // Skip if already active
            if (currentPreset === trimmedName) {
                if (DEBUG_MODE) console.log(`STGL: Preset "${trimmedName}" already active`);
                return true;
            }

            if (DEBUG_MODE) console.log(`STGL: Switching to preset: ${trimmedName}`);

            // Check context hasn't changed before applying
            const currentContextId = new ChatContext().getCurrent().primaryId;
            if (currentContextId !== originalContextId) {
                if (DEBUG_MODE) console.log('STGL: Context changed, aborting preset application');
                return false;
            }

            // Use ST's slash command to switch preset
            await executeSlashCommandsWithOptions(`/preset ${trimmedName}`);

            this.currentPreset = trimmedName;
            return true;
        } catch (error) {
            console.error(`STGL: Failed to apply preset "${presetName}":`, error);
            return false;
        }
    }
}

/**
 * TemplateLocker - Handles completion template switching
 * Uses embedded TemplateOps for template operations
 */
class TemplateLocker {
    constructor(storage) {
        this.currentTemplate = null;
        this.storage = storage;
    }

    /**
     * Get the currently active template ID
     * @returns {Promise<string|null>} Current template ID or null
     */
    async getCurrentTemplate() {
        // Return the last applied template ID
        return this.currentTemplate;
    }

    /**
     * Compare current prompt manager state with a stored template
     * @param {string} templateId - Template ID to compare against
     * @returns {boolean} True if prompts match the template
     */
    compareWithTemplate(templateId) {
        const template = this.storage.getTemplate(templateId);
        if (!template) return false;

        const currentPrompts = oai_settings?.prompts || [];
        const currentPromptsMap = Array.isArray(currentPrompts)
            ? currentPrompts.reduce((acc, p) => {
                if (p.identifier) acc[p.identifier] = p;
                return acc;
            }, {})
            : currentPrompts;

        const templatePrompts = template.prompts || {};

        // Compare number of prompts
        if (Object.keys(currentPromptsMap).length !== Object.keys(templatePrompts).length) {
            return false;
        }

        // Compare each prompt by identifier, content, and key attributes
        for (const [identifier, templatePrompt] of Object.entries(templatePrompts)) {
            const currentPrompt = currentPromptsMap[identifier];
            if (!currentPrompt) return false;

            // Compare content
            if (currentPrompt.content !== templatePrompt.content) return false;

            // Extended attribute comparison (tolerant defaults)
            const norm = (p) => ({
                role: p?.role ?? null,
                system_prompt: !!p?.system_prompt,
                marker: !!p?.marker,
                injection_position: p?.injection_position ?? null,
                injection_depth: p?.injection_depth ?? null,
                injection_order: p?.injection_order ?? null,
                injection_trigger: Array.isArray(p?.injection_trigger) ? [...new Set(p.injection_trigger)].sort() : null,
                forbid_overrides: p?.forbid_overrides ?? null,
            });

            const arrEq = (x, y) => {
                if (x === null && y === null) return true;
                if (!Array.isArray(x) || !Array.isArray(y)) return x === y;
                if (x.length !== y.length) return false;
                for (let i = 0; i < x.length; i++) {
                    if (x[i] !== y[i]) return false;
                }
                return true;
            };

            const a = norm(currentPrompt);
            const b = norm(templatePrompt);

            if (
                a.role !== b.role ||
                a.system_prompt !== b.system_prompt ||
                a.marker !== b.marker ||
                a.injection_position !== b.injection_position ||
                a.injection_depth !== b.injection_depth ||
                a.injection_order !== b.injection_order ||
                a.forbid_overrides !== b.forbid_overrides ||
                !arrEq(a.injection_trigger, b.injection_trigger)
            ) {
                return false;
            }
        }

        // Compare prompt order if template has one
        if (template.promptOrder && template.promptOrder.length > 0 && promptManager?.activeCharacter) {
            const currentOrder = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter) || [];
            const tplOrder = Array.isArray(template.promptOrder) ? template.promptOrder : [];

            // Compare order arrays structurally (identifier + enabled), not by object reference
            if (currentOrder.length !== tplOrder.length) {
                return false;
            }

            const normalizeOrder = (arr) => arr.map(e => ({
                identifier: e?.identifier ?? null,
                // default enabled to true if missing
                enabled: e?.enabled === false ? false : true,
            }));

            const a = normalizeOrder(currentOrder);
            const b = normalizeOrder(tplOrder);

            for (let i = 0; i < a.length; i++) {
                if (a[i].identifier !== b[i].identifier || a[i].enabled !== b[i].enabled) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Apply (switch to) a completion template
     * @param {string|null} templateId - Template ID to apply, or null to keep current
     * @param {string} originalContextId - The context ID when this apply was initiated
     * @returns {Promise<boolean>} Success status
     */
    async applyTemplate(templateId, originalContextId) {
        // null means "keep prevailing settings" - intentional no-op
        if (templateId === null) {
            if (DEBUG_MODE) console.log('STGL: Template lock returned null, keeping current template');
            return true;
        }

        if (!templateId || typeof templateId !== 'string') {
            console.warn('STGL: Invalid template ID:', templateId);
            return false;
        }

        let trimmedId = templateId.trim();
        if (!trimmedId) {
            console.warn('STGL: Empty template ID provided');
            return false;
        }

        try {
            const settings = this.storage.getExtensionSettings();
            let template = settings.templates?.[trimmedId];

            if (!template) {
                // Fallback: find by template name (case-insensitive)
                const all = settings.templates || {};
                const found = Object.values(all).find(t => t && typeof t.name === 'string' && (t.name === trimmedId || t.name.toLowerCase() === trimmedId.toLowerCase()));
                if (found) {
                    template = found;
                    // Use the resolved id for tracking
                    trimmedId = found.id;
                } else {
                    console.warn(`STGL: Template not found: ${trimmedId}`);
                    return false;
                }
            }

            if (DEBUG_MODE) console.log(`STGL: Applying template: ${template.name} (${trimmedId})`);

            // Check context hasn't changed before applying
            const currentContextId = new ChatContext().getCurrent().primaryId;
            if (currentContextId !== originalContextId) {
                if (DEBUG_MODE) console.log('STGL: Context changed, aborting template application');
                return false;
            }

            // Apply template using TemplateOps
            const result = TemplateOps.applyToPromptManager(template);
            if (!result) {
                console.warn(`STGL: Failed to apply template "${template.name}"`);
                return false;
            }

            this.currentTemplate = trimmedId;
            try {
                if (promptManager && typeof promptManager.render === 'function') {
                    await promptManager.render();
                }
            } catch (e) {
                if (DEBUG_MODE) console.warn('STGL: Error refreshing promptManager after template apply:', e);
            }
            return true;
        } catch (error) {
            console.error(`STGL: Failed to apply template "${templateId}":`, error);
            return false;
        }
    }
}

// ============================================================================
// SECTION 3: SETTINGS MANAGER (Orchestration)
// ============================================================================

/**
 * SettingsManager - Main orchestrator for lock resolution and application
 * Coordinates PriorityResolver and all three Locker classes
 */
class SettingsManager {
    constructor(storage, chatContext, priorityResolver, profileLocker, presetLocker, templateLocker) {
        this.storage = storage;
        this.chatContext = chatContext;
        this.priorityResolver = priorityResolver;
        this.profileLocker = profileLocker;
        this.presetLocker = presetLocker;
        this.templateLocker = templateLocker;
        this._queueProcessingTimeout = null;
    }

    /**
     * Main public API - Apply locks for current context
     * @returns {Promise<boolean>} Success status
     */
    async applyLocksForContext() {
        if (isApplyingSettings) {
            if (DEBUG_MODE) console.log('STGL: Already applying locks, skipping');
            return false;
        }

        try {
            isApplyingSettings = true;

            const context = this.chatContext.getCurrent();
            const originalContextId = context.primaryId;
            const preferences = this.storage.getPreferences();

            if (DEBUG_MODE) console.log('STGL: Resolving locks for context:', context);

            // Resolve which locks to apply
            const resolved = this.priorityResolver.resolve(context, preferences);
            if (DEBUG_MODE) console.log('STGL: Resolved locks:', resolved);

            // Check for conflicts (informational only)
            const conflicts = this.priorityResolver.detectConflicts(context, preferences);
            if (conflicts.length > 0 && DEBUG_MODE) {
                console.log('STGL: Lock conflicts detected:', conflicts);
            }

            // Apply locks in critical order
            return await this._applyLocksToUI(resolved.locks, originalContextId);
        } finally {
            isApplyingSettings = false;
        }
    }

    /**
     * Get currently effective locks for context
     * @returns {Object} { locks, sources }
     */
    getCurrentLocks() {
        const context = this.chatContext.getCurrent();
        const preferences = this.storage.getPreferences();
        return this.priorityResolver.resolve(context, preferences);
    }

    /**
     * Context change event handler
     */
    onContextChanged() {
        if (contextChangeQueue.length >= MAX_CONTEXT_QUEUE_SIZE) {
            contextChangeQueue.shift();
        }
        contextChangeQueue.push(Date.now());
        if (DEBUG_MODE) console.log('STGL: Context change queued');
        this._processContextChangeQueue();
    }

    /**
     * Apply locks to UI - CRITICAL ORDER: Profile → Preset → Template
     * @private
     */
    async _applyLocksToUI(locks, originalContextId) {
        if (DEBUG_MODE) console.log('STGL: Applying locks to UI:', locks);
        const prefs = this.storage.getPreferences ? this.storage.getPreferences() : {};

        // Normalize lock values: treat undefined, null, or empty/whitespace strings as "no lock"
        const norm = (v) => {
            if (v === null || v === undefined) return null;
            if (typeof v === 'string') {
                const t = v.trim();
                return t.length ? t : null;
            }
            return v;
        };
        const nProfile = norm(locks.profile);
        const nPreset = norm(locks.preset);
        const nTemplate = norm(locks.template);

        // 1. Profile first (changes connection)
        if (nProfile !== null) {
            const success = await this.profileLocker.applyProfile(nProfile, originalContextId);
            if (!success) {
                console.warn('STGL: Failed to apply profile lock');
                try { if (prefs.showNotifications) toastr.error('Failed to apply profile lock'); } catch (e) {}
                return false;
            }
        }

        // 2. Preset second (depends on active connection)
        if (nPreset !== null) {
            const success = await this.presetLocker.applyPreset(nPreset, originalContextId);
            if (!success) {
                console.warn('STGL: Failed to apply preset lock');
                try { if (prefs.showNotifications) toastr.error('Failed to apply preset lock'); } catch (e) {}
                return false;
            }
        }

        // 3. Template last (modifies prompt manager)
        if (nTemplate !== null) {
            const success = await this.templateLocker.applyTemplate(nTemplate, originalContextId);
            if (!success) {
                console.warn('STGL: Failed to apply template lock');
                try { if (prefs.showNotifications) toastr.error('Failed to apply template lock'); } catch (e) {}
                return false;
            }
        }

        if (DEBUG_MODE) console.log('STGL: All locks applied successfully');
        return true;
    }

    /**
     * Process context change queue (debounced)
     * @private
     */
    async _processContextChangeQueue() {
        if (processingContext || contextChangeQueue.length === 0) return;

        processingContext = true;
        try {
            contextChangeQueue.length = 0;
            this.chatContext.invalidate();

            // Skip auto-apply if we're handling a preset change (let onPresetChanged handle it)
            if (isHandlingPresetChange) {
                if (DEBUG_MODE) console.log('STGL: Skipping auto-apply during preset change');
                return;
            }

            const shouldApply = await this._shouldApplyAutomatically();
            if (shouldApply && !isApplyingSettings) {
                if (DEBUG_MODE) console.log('STGL: Auto-applying locks on context change');
                const success = await this.applyLocksForContext();
                try {
                    const prefs = this.storage.getPreferences?.() || {};
                    if (prefs.showNotifications) {
                        if (success) {
                            toastr.success('Generation locks applied');
                        } else {
                            toastr.error('Failed to apply generation locks');
                        }
                    }
                } catch (e) {
                    if (DEBUG_MODE) console.warn('STGL: Notification error:', e);
                }
            }
        } catch (error) {
            console.error('STGL: Error processing context change:', error);
        } finally {
            processingContext = false;

            if (contextChangeQueue.length > 0) {
                this._scheduleQueueProcessing();
            }
        }
    }

    /**
     * Schedule debounced queue processing
     * @private
     */
    _scheduleQueueProcessing() {
        if (this._queueProcessingTimeout) {
            clearTimeout(this._queueProcessingTimeout);
        }
        this._queueProcessingTimeout = setTimeout(() => {
            this._queueProcessingTimeout = null;
            this._processContextChangeQueue();
        }, 100);
    }

    /**
     * Check if locks should be applied automatically
     * @private
     */
    async _shouldApplyAutomatically() {
        const preferences = this.storage.getPreferences();
        const mode = preferences.autoApplyOnContextChange;

        if (mode === AUTO_APPLY_MODES.NEVER) return false;
        if (mode === AUTO_APPLY_MODES.ALWAYS) return true;

        // ASK mode - check if there are locks to apply AND if they differ from current settings
        const context = this.chatContext.getCurrent();
        const resolved = this.priorityResolver.resolve(context, preferences);

        if (resolved.locks.profile || resolved.locks.preset || resolved.locks.template) {
            // Check if locks differ from current settings
            const currentProfile = this.profileLocker.getCurrentProfile();
            const currentPreset = this.presetLocker.getCurrentPreset();
            const currentTemplate = await this.templateLocker.getCurrentTemplate();

            const profileDiffers = resolved.locks.profile && resolved.locks.profile !== currentProfile;
            const presetDiffers = resolved.locks.preset && resolved.locks.preset !== currentPreset;
            const templateDiffers = resolved.locks.template && !this.templateLocker.compareWithTemplate(resolved.locks.template);

            // Only ask if something would actually change
            if (profileDiffers || presetDiffers || templateDiffers) {
const contextName = context.characterName || context.groupName || 'this context';
const profileName = resolved.locks.profile || '—';
const presetName = resolved.locks.preset || '—';
let templateName = '—';
if (resolved.locks.template) {
    const templateObj = this.storage.getTemplate(resolved.locks.template);
    templateName = templateObj ? templateObj.name : resolved.locks.template;
}
// Human-readable sources (Character becomes Group in group chats for labeling)
const isGroupChatAuto = context.isGroupChat;
const toTitleCase = (s) => s ? ({ chat: 'Chat', character: isGroupChatAuto ? 'Character/Group' : 'Character', group: isGroupChatAuto ? 'Character/Group' : 'Group', model: 'Model', individual: 'Individual' }[s] || s) : null;
const profileSource = resolved.sources?.profile ? toTitleCase(resolved.sources.profile) : null;
const presetSource = resolved.sources?.preset ? toTitleCase(resolved.sources.preset) : null;
const templateSource = resolved.sources?.template ? toTitleCase(resolved.sources.template) : null;

const popupBody =
    `<div style="font-size:1.1em;font-weight:bold;margin-bottom:10px;">
        Apply saved locks for ${contextName}?
     </div>
     <div style="margin-bottom:10px;"><b>This will set:</b></div>
     <div>
       Profile → <b>${profileName}</b>${profileSource ? ` <small class="text_muted">(from ${profileSource})</small>` : ''}<br>
       Preset → <b>${presetName}</b>${presetSource ? ` <small class="text_muted">(from ${presetSource})</small>` : ''}<br>
       Template → <b>${templateName}</b>${templateSource ? ` <small class="text_muted">(from ${templateSource})</small>` : ''}
     </div>
     <div style="margin-top:10px;">Proceed?</div>`;
const result = await callGenericPopup(
    popupBody,
    POPUP_TYPE.CONFIRM,
    '',
    { okButton: 'Apply', cancelButton: 'Skip' }
);
                return result === POPUP_RESULT.AFFIRMATIVE;
            }
        }

        return false;
    }

    /**
     * Save current UI settings as locks
     * @param {Object} targets - Which dimensions to save { character, chat, model }
     */
    async saveCurrentUILocks(targets) {
        const context = this.chatContext.getCurrent();

        // Get current active settings
        const currentLocks = {
            profile: this.profileLocker.getCurrentProfile(),
            preset: this.presetLocker.getCurrentPreset(),
            template: await this.templateLocker.getCurrentTemplate()
        };

        let savedCount = 0;

        try {
            if (context.isGroupChat) {
                // Group chat context
                if (targets.character && context.groupId) {
                    await this.storage.setGroupLock(context.groupId, currentLocks);
                    savedCount++;
                    if (DEBUG_MODE) console.log('STGL: Saved group lock');
                }
                if (targets.chat && context.groupId) {
                    this.storage.setChatLock(currentLocks);
                    savedCount++;
                    if (DEBUG_MODE) console.log('STGL: Saved chat lock (group)');
                }
            } else {
                // Single character context
                if (targets.character && context.characterName) {
                    const chId = characters?.findIndex(x => x.name === context.characterName);
                    const characterKey = chId !== -1 ? chId : context.characterName;
                    this.storage.setCharacterLock(characterKey, currentLocks);
                    savedCount++;
                    if (DEBUG_MODE) console.log('STGL: Saved character lock');
                }
                if (targets.chat) {
                    this.storage.setChatLock(currentLocks);
                    savedCount++;
                    if (DEBUG_MODE) console.log('STGL: Saved chat lock');
                }
            }

            if (targets.model && context.modelName) {
                // Model locks don't include profile
                const modelLocks = {
                    profile: null,
                    preset: currentLocks.preset,
                    template: currentLocks.template
                };
                this.storage.setModelLock(context.modelName, modelLocks);
                savedCount++;
                if (DEBUG_MODE) console.log('STGL: Saved model lock');
            }

            return savedCount > 0;
        } catch (error) {
            console.error('STGL: Error saving locks:', error);
            return false;
        }
    }

    /**
     * Clear locks for specified dimensions
     * @param {Object} targets - Which dimensions to clear { character, chat, model }
     */
    async clearLocks(targets) {
        const context = this.chatContext.getCurrent();
        let clearedCount = 0;

        try {
            if (context.isGroupChat) {
                if (targets.character && context.groupId) {
                    await this.storage.clearGroupLock(context.groupId);
                    clearedCount++;
                }
                if (targets.chat) {
                    this.storage.clearChatLock();
                    clearedCount++;
                }
            } else {
                if (targets.character && context.characterName) {
                    const chId = characters?.findIndex(x => x.name === context.characterName);
                    const characterKey = chId !== -1 ? chId : context.characterName;
                    this.storage.clearCharacterLock(characterKey);
                    clearedCount++;
                }
                if (targets.chat) {
                    this.storage.clearChatLock();
                    clearedCount++;
                }
            }

            if (targets.model && context.modelName) {
                this.storage.clearModelLock(context.modelName);
                clearedCount++;
            }

            return clearedCount > 0;
        } catch (error) {
            console.error('STGL: Error clearing locks:', error);
            return false;
        }
    }
}

// ============================================================================
// Module-level state
// ============================================================================

let isApplyingSettings = false;
let processingContext = false;
let isHandlingPresetChange = false;
const contextChangeQueue = [];

// ============================================================================
// SECTION 4: EVENT HANDLERS
// ============================================================================

/**
 * Module-level instance (initialized in Section 6)
 */
let settingsManager = null;

/**
 * Registered event handlers for cleanup
 */
const registeredEventHandlers = [];

/**
 * Register event handler with tracking
 * @private
 */
function registerEventHandler(eventType, handler, description = '') {
    if (!eventSource || !eventType) {
        console.warn('STGL: Cannot register event handler - eventSource or eventType missing');
        return false;
    }

    eventSource.on(eventType, handler);
    registeredEventHandlers.push({ eventType, handler, description });
    if (DEBUG_MODE) console.log(`STGL: Registered event handler for ${eventType}${description ? ': ' + description : ''}`);
    return true;
}

/**
 * Main context change handler
 */
function onContextChanged() {
    if (!settingsManager) {
        if (DEBUG_MODE) console.warn('STGL: settingsManager not initialized');
        return;
    }
    settingsManager.onContextChanged();
    updateDisplay();
}

/**
 * Handle GROUP_MEMBER_DRAFTED - apply individual character locks
 */
async function onGroupMemberDrafted(chId) {
    if (!settingsManager) return;

    try {
        const preferences = settingsManager.storage.getPreferences();
        if (!preferences.preferIndividualCharacterInGroup) {
            if (DEBUG_MODE) console.log('STGL: Individual character locks disabled');
            return;
        }

        const chatContext = settingsManager.chatContext.getCurrent();
        if (!chatContext.isGroupChat) return;

        // Get individual character lock
        const individualLock = settingsManager.storage.getCharacterLock(chId);
        if (!individualLock) {
            if (DEBUG_MODE) console.log(`STGL: No individual lock for character ${chId}`);
            return;
        }

        if (DEBUG_MODE) console.log(`STGL: Applying individual locks for character ${chId}:`, individualLock);

        // Respect priority order: overlay individual ONLY over Group at the Character/Group position
        const originalContextId = chatContext.primaryId;

        // Resolve current winners first
        const resolved = settingsManager.priorityResolver.resolve(chatContext, preferences);

        // Build merged locks where individual only overrides items whose winner is Group
        const mergedLocks = {
            profile: resolved.locks.profile,
            preset: resolved.locks.preset,
            template: resolved.locks.template,
        };

        const items = [LOCKABLE_ITEMS.PROFILE, LOCKABLE_ITEMS.PRESET, LOCKABLE_ITEMS.TEMPLATE];
        for (const item of items) {
            const winner = resolved.sources[item];
            const value = individualLock[item];
            const isValueSet = value !== undefined && value !== null && (typeof value !== 'string' || value.trim().length > 0);
            if (winner === SETTING_SOURCES.GROUP && isValueSet) {
                mergedLocks[item] = value;
            }
        }

        await settingsManager._applyLocksToUI(mergedLocks, originalContextId);

        updateDisplay();
    } catch (error) {
        console.error('STGL: Error in GROUP_MEMBER_DRAFTED handler:', error);
    }
}

/**
 * Handle manual preset changes - check if locked template needs restoration
 */
async function onPresetChanged() {
    console.log('STGL: Preset changed event received');

    // Set flag to prevent auto-apply during preset change handling
    isHandlingPresetChange = true;

    if (!settingsManager) {
        console.log('STGL: No settings manager, updating display only');
        updateDisplay();
        isHandlingPresetChange = false;
        return;
    }

    try {
        // Get current locked template
        const context = settingsManager.chatContext.getCurrent();
        const preferences = settingsManager.storage.getPreferences();
        const resolved = settingsManager.priorityResolver.resolve(context, preferences);

        console.log('STGL: Resolved template lock:', resolved.locks.template);

        // If there's a locked template, check if we need to restore it
        if (resolved.locks.template) {
            // Check if current prompts match the locked template
            const promptsMatchTemplate = settingsManager.templateLocker.compareWithTemplate(resolved.locks.template);

            console.log('STGL: Prompts match template?', promptsMatchTemplate);

            // Template differs from locked one - ask to restore
            if (!promptsMatchTemplate) {
                const templateObj = settingsManager.storage.getTemplate(resolved.locks.template);
                const templateName = templateObj ? templateObj.name : resolved.locks.template;
                const isGroupChat = context.isGroupChat;
                const toTitleCase = (s) => s ? ({ chat: 'Chat', character: isGroupChat ? 'Character/Group' : 'Character', group: isGroupChat ? 'Character/Group' : 'Group', model: 'Model', individual: 'Individual' }[s] || s) : null;
                const sourceLabel = resolved.sources?.template ? toTitleCase(resolved.sources.template) : 'unknown';

                const message = `The preset you selected may have changed your completion template.<br><br>` +
                    `Do you want to restore the locked template?<br><br>` +
                    `<b>${templateName}</b> <small class="text_muted">(locked from ${sourceLabel})</small>`;

                const result = await callGenericPopup(
                    message,
                    POPUP_TYPE.CONFIRM,
                    '',
                    { okButton: 'Restore Template', cancelButton: 'Keep New Template' }
                );

                if (result === POPUP_RESULT.AFFIRMATIVE) {
                    const originalContextId = context.primaryId;
                    await settingsManager.templateLocker.applyTemplate(resolved.locks.template, originalContextId);
                    toastr.success('Template restored');
                }
            }
        }
    } catch (error) {
        console.error('STGL: Error checking template after preset change:', error);
    } finally {
        isHandlingPresetChange = false;
    }

    updateDisplay();
}

/**
 * Handle settings updates - refresh display
 */
function onSettingsUpdated() {
    if (DEBUG_MODE) console.log('STGL: Settings updated');
    updateDisplay();
}

/**
 * Update persistent UI display
 */
function updateDisplay() {
    if (!settingsManager) return;

    const promptList = document.getElementById('completion_prompt_manager_list');
    if (!promptList) return;

    try {
        const { locks, sources } = settingsManager.getCurrentLocks();
        const context = settingsManager.chatContext.getCurrent();
        const isGroupChat = context.isGroupChat;
        const toTitleCase = (s) => s ? ({ chat: 'Chat', character: isGroupChat ? 'Character/Group' : 'Character', group: isGroupChat ? 'Character/Group' : 'Group', model: 'Model', individual: 'Individual' }[s] || s) : null;

        // Remove existing display
        const existing = document.getElementById('stgl-status-indicator');
        if (existing) existing.remove();

        // Build display HTML
        let html = '';
        const hasLock = locks.profile || locks.preset || locks.template;
        
        if (hasLock) {
            html += '<div><span class="fa-solid fa-lock"></span> <b>Locked:</b> ';
            const parts = [];
            
            if (locks.profile) {
                const activeProfile = settingsManager.profileLocker.getCurrentProfile();
                const profileMismatch = !!locks.profile && locks.profile !== activeProfile;

                let profileDisplay = `<i class="fa-solid fa-plug" title="Profile"></i> ${locks.profile} <small class="text_muted">(${toTitleCase(sources.profile)})</small>`;
                if (profileMismatch) {
                    profileDisplay += ` <i class="fa-solid fa-triangle-exclamation" style="color: orange;" title="Locked profile is not currently active"></i> <small style="color: orange;">(not active)</small>`;
                }

                parts.push(`<span>${profileDisplay}</span>`);
            }
            if (locks.preset) {
                const activePreset = settingsManager.presetLocker.getCurrentPreset();
                const presetMismatch = !!locks.preset && locks.preset !== activePreset;

                let presetDisplay = `<i class="fa-solid fa-sliders" title="Preset"></i> ${locks.preset} <small class="text_muted">(${toTitleCase(sources.preset)})</small>`;
                if (presetMismatch) {
                    presetDisplay += ` <i class="fa-solid fa-triangle-exclamation" style="color: orange;" title="Locked preset is not currently active"></i> <small style="color: orange;">(not active)</small>`;
                }

                parts.push(`<span>${presetDisplay}</span>`);
            }
            if (locks.template) {
                // Fetch the template object to get its name!
                const template = settingsManager.storage.getTemplate(locks.template);
                const templateName = template ? template.name : 'Unknown Template';

                // Check if current prompts match the locked template
                const isActive = settingsManager.templateLocker.compareWithTemplate(locks.template);

                let templateDisplay = `<i class="fa-solid fa-file-lines" title="Template"></i> ${templateName} <small class="text_muted">(${toTitleCase(sources.template)})</small>`;

                if (!isActive) {
                    templateDisplay += ` <i class="fa-solid fa-triangle-exclamation" style="color: orange;" title="Locked template is not currently active"></i> <small style="color: orange;">(not active)</small>`;
                }

                parts.push(`<span>${templateDisplay}</span>`);
            }
            html += parts.join(' | ');
            html += '</div>';
        } else {
            html = '<span class="fa-solid fa-circle-info"></span> No generation locks applied for this context.';
        }

        // Append inline indicator for Individual-over-Group when enabled in group chats
        try {
            const prefs = settingsManager.storage.getPreferences ? settingsManager.storage.getPreferences() : {};
            if (isGroupChat && prefs.preferIndividualCharacterInGroup) {
                const tip = 'Individual character overrides are enabled. In group chats, saved settings for the drafted character may override Group settings only.';
                html += ` <i class="fa-solid fa-user-lock" title="${tip}"></i>`;
            }
        } catch (e) {
            if (DEBUG_MODE) console.warn('STGL: Tooltip append failed:', e);
        }

        // Create and inject indicator
        const indicator = document.createElement('div');
        indicator.id = 'stgl-status-indicator';
        indicator.className = 'text_pole padding10 marginTop5';
        indicator.innerHTML = `<small class="text_muted">${html}</small>`;

        // Insert before the prompt list, inside the prompt manager UI.
        promptList.insertAdjacentElement('beforebegin', indicator);

        if (DEBUG_MODE) console.log('STGL: Display updated:', locks);
    } catch (error) {
        console.error('STGL: Error updating display:', error);
    }
}

/**
 * Register all event handlers
 */
function registerAllEventHandlers() {
    try {
        // Primary context change events
        registerEventHandler(event_types.CHAT_CHANGED, onContextChanged, 'character/chat change');
        registerEventHandler(event_types.GROUP_CHAT_CREATED, onContextChanged, 'group chat creation');

        // Individual character locks in groups
        if (event_types.GROUP_MEMBER_DRAFTED) {
            registerEventHandler(event_types.GROUP_MEMBER_DRAFTED, onGroupMemberDrafted, 'group member drafted');
        }

        // UI update events
        if (event_types.OAI_PRESET_CHANGED_AFTER) {
            registerEventHandler(event_types.OAI_PRESET_CHANGED_AFTER, onPresetChanged, 'preset changed');
        }

        registerEventHandler(event_types.SETTINGS_UPDATED, onSettingsUpdated, 'settings updated');

        // Initialization timing
        if (event_types.SETTINGS_LOADED_AFTER) {
            registerEventHandler(event_types.SETTINGS_LOADED_AFTER, () => {
                if (settingsManager) {
                    settingsManager.onContextChanged();
                }
            }, 'settings loaded');
        }

        if (DEBUG_MODE) console.log('STGL: All event handlers registered successfully');
    } catch (error) {
        console.error('STGL: Error registering event handlers:', error);
    }
}

// ============================================================================
// SECTION 5: UI & POPUP MANAGEMENT
// ============================================================================

/**
 * Current popup instance
 */
let currentPopupInstance = null;

/**
 * Handlebars template for lock management popup
 */
const lockManagementTemplate = Handlebars.compile(`
<div class="completion_prompt_manager_error {{#unless isExtensionEnabled}}caution{{/unless}} marginBot10">
    <span>Status: <strong>{{statusText}}</strong></span>
</div>

<div class="completion_prompt_manager_popup_entry_form_control">
    {{#each checkboxes}}
    <label class="checkbox_label">
        <input type="checkbox" id="{{id}}" {{#if checked}}checked{{/if}}>
        <span>{{label}}</span>
    </label>
    {{/each}}
</div>

<div class="completion_prompt_manager_popup_entry_form_control">
    <h4 class="standoutHeader">📊 Priority Order:</h4>
    <div id="stgl-priority-dropdowns" class="marginTop10 alignItemsCenter">
        <div class="flex-container flexFlowRow flexGap10">
            <label class="flex1">1st (highest):</label>
            <select id="stgl-priority-select-1" class="flex1">
                {{#each priorityOptions1}}
                <option value="{{value}}" {{#if selected}}selected{{/if}}>{{label}}</option>
                {{/each}}
            </select>
        </div>
        <div class="flex-container flexFlowRow flexGap10">
            <label class="flex1">2nd:</label>
            <select id="stgl-priority-select-2" class="flex1">
                {{#each priorityOptions2}}
                <option value="{{value}}" {{#if selected}}selected{{/if}}>{{label}}</option>
                {{/each}}
            </select>
        </div>
        <div class="flex-container flexFlowRow flexGap10">
            <label class="flex1">3rd (lowest):</label>
            <select id="stgl-priority-select-3" class="flex1">
                {{#each priorityOptions3}}
                <option value="{{value}}" {{#if selected}}selected{{/if}}>{{label}}</option>
                {{/each}}
            </select>
        </div>
    </div>
</div>

<div class="completion_prompt_manager_popup_entry_form_control alignItemsCenter">
    <label class="checkbox_label">
        <input type="checkbox" id="stgl-prefer-individual" {{#if preferIndividualCharacterInGroup}}checked{{/if}}>
        <span>In group chats, always prefer individual character settings over group settings</span>
    </label>
</div>

<div class="completion_prompt_manager_popup_entry_form_control">
    <h4 class="standoutHeader">⚙️ Auto-apply Mode:</h4>
    <div class="marginTop10">
        {{#each autoApplyOptions}}
        <label class="radio_label">
            <input type="radio" name="stgl-auto-apply-mode" value="{{value}}" {{#if checked}}checked{{/if}}>
            <span>{{label}}</span>
        </label>
        {{/each}}
    </div>
</div>

{{#if hasActiveChat}}
    <div class="completion_prompt_manager_popup_entry_form_control">
        <h4 class="standoutHeader">📍 Current Locks:</h4>
        <div class="marginTop10 flex-container flexFlowColumn flexGap10">
            {{#if isGroupChat}}
                {{#if groupLocks}}
                <div class="text_pole padding10">
                    <strong>Group:</strong> {{groupName}}<br>
                    {{groupLocks}}
                </div>
                {{/if}}
            {{else}}
                {{#if characterLocks}}
                <div class="text_pole padding10">
                    <strong>Character:</strong> {{characterName}}<br>
                    {{characterLocks}}
                </div>
                {{/if}}
            {{/if}}
            {{#if chatLocks}}
            <div class="text_pole padding10">
                <strong>Chat Locks:</strong><br>
                {{chatLocks}}
            </div>
            {{/if}}
            {{#if modelLocks}}
            <div class="text_pole padding10">
                <strong>Model:</strong> {{modelName}}<br>
                {{modelLocks}}
            </div>
            {{/if}}
        </div>
    </div>
{{/if}}
`);

/**
 * Format lock info for display
 */
function formatLockInfo(lock) {
    if (!lock || typeof lock !== 'object') {
        return 'No locks set';
    }

    const parts = [];
    if (lock.profile) parts.push(`Profile: ${lock.profile}`);
    if (lock.preset) parts.push(`Preset: ${lock.preset}`);
    if (lock.template) {
        let tplDisplay = lock.template;
        try {
            const t = (settingsManager?.storage || new StorageAdapter())?.getTemplate(lock.template);
            if (t?.name) tplDisplay = t.name;
        } catch (e) {}
        parts.push(`Template: ${tplDisplay}`);
    }

    return parts.length > 0 ? parts.join(' | ') : 'No locks set';
}

/**
 * Get popup content data
 */
async function getPopupContent() {
    const storage = new StorageAdapter();
    const preferences = storage.getPreferences();
    const chatContext = new ChatContext();
    const context = chatContext.getCurrent();

    const isGroupChat = context.isGroupChat;
    const statusText = `Active${isGroupChat ? ' - Group Chat' : ''}`;
    const stContext = getContext();
    const hasActiveChat = !!(stContext?.chatId);

    // Build checkboxes (notifications only; prefer-individual rendered separately)
    const checkboxes = [
        { id: 'stgl-show-notifications', label: 'Show notifications', checked: preferences.showNotifications }
    ];

    // Priority order - cascading dropdown options
    const sourceLabels = {
        [SETTING_SOURCES.MODEL]: '🤖 Model',
        [SETTING_SOURCES.CHAT]: '💬 Chat',
        [SETTING_SOURCES.CHARACTER]: '👤 Character/Group'
    };

    const order = Array.isArray(preferences.priorityOrder) && preferences.priorityOrder.length
        ? preferences.priorityOrder
        : [SETTING_SOURCES.MODEL, SETTING_SOURCES.CHAT, SETTING_SOURCES.CHARACTER];

    const allSources = [SETTING_SOURCES.MODEL, SETTING_SOURCES.CHAT, SETTING_SOURCES.CHARACTER];

    // Cascading disabled: all selects show the same set; uniqueness enforced on save
    const makeOptionsAll = (selected) => {
        return allSources.map(s => ({ value: s, label: sourceLabels[s], selected: s === selected }));
    };

    const sel1 = order[0] || SETTING_SOURCES.MODEL;
    const sel2 = order[1] || SETTING_SOURCES.CHAT;
    const sel3 = order[2] || SETTING_SOURCES.CHARACTER;

    const priorityOptions1 = makeOptionsAll(sel1);
    const priorityOptions2 = makeOptionsAll(sel2);
    const priorityOptions3 = makeOptionsAll(sel3);

    // Auto-apply options
    const autoApplyOptions = [
        { value: AUTO_APPLY_MODES.NEVER, label: 'Never auto-apply', checked: preferences.autoApplyOnContextChange === AUTO_APPLY_MODES.NEVER },
        { value: AUTO_APPLY_MODES.ASK, label: 'Ask before applying', checked: preferences.autoApplyOnContextChange === AUTO_APPLY_MODES.ASK },
        { value: AUTO_APPLY_MODES.ALWAYS, label: 'Always auto-apply', checked: preferences.autoApplyOnContextChange === AUTO_APPLY_MODES.ALWAYS }
    ];


    // Get current locks
    const chIndex = !isGroupChat && context.characterName && Array.isArray(characters) ? characters.findIndex(x => x.name === context.characterName) : -1;
    const characterLocks = isGroupChat ? null : storage.getCharacterLock(chIndex !== -1 ? chIndex : context.characterName);
    const groupLocks = isGroupChat ? storage.getGroupLock(context.groupId) : null;
    const chatLocks = storage.getChatLock();
    const modelLocks = storage.getModelLock(context.modelName);

    return lockManagementTemplate({
        isExtensionEnabled: true,
        statusText,
        isGroupChat,
        hasActiveChat,
        characterName: context.characterName,
        groupName: context.groupName,
        modelName: context.modelName,
        checkboxes,
        priorityOptions1,
        priorityOptions2,
        priorityOptions3,
        preferIndividualCharacterInGroup: preferences.preferIndividualCharacterInGroup,
        autoApplyOptions,
        characterLocks: formatLockInfo(characterLocks),
        groupLocks: formatLockInfo(groupLocks),
        chatLocks: formatLockInfo(chatLocks),
        modelLocks: formatLockInfo(modelLocks)
    });
}

/**
 * Refresh popup content after save/clear
 */
async function refreshPopupAfterSave() {
    if (currentPopupInstance && typeof currentPopupInstance.completeCancelled === 'function') {
        currentPopupInstance.completeCancelled();
        currentPopupInstance = null;
    }
    setTimeout(async () => {
        currentPopupInstance = null;
        await showLockManagementPopup();
        updateDisplay();
    }, 200);
}


/**
 * Initialize cascading priority dropdowns
 */
function initializePriorityDropdowns() {
    // Cascading disabled; uniqueness is enforced on save
    return;
}

function addPopupWrapStyle() {
    if (document.getElementById('stgl-popup-fix')) return;

    const css = `
        .popup-controls {
            flex-wrap: wrap !important;
            justify-content: center !important;
        }
    `;

    const style = document.createElement('style');
    style.id = 'stgl-popup-fix';
    style.textContent = css;
    document.head.appendChild(style);
}

/**
 * Show lock management popup
 */
async function showLockManagementPopup() {
    if (currentPopupInstance?.dlg?.hasAttribute('open')) {
        if (DEBUG_MODE) console.log('STGL: Popup already open');
        currentPopupInstance.dlg.focus();
        return;
    }

    const content = await getPopupContent();
    const header = '🔐 Generation Locks';
    const contentWithHeader = `<h3>${header}</h3>${content}`;

    const chatContext = new ChatContext();
    const context = chatContext.getCurrent();
    const stContext = getContext();
    const hasActiveChat = !!(stContext?.chatId);

const customButtons = [];
// Save preferences explicitly (refuses duplicates, keeps dialog open)
    customButtons.push({
        text: '💾 Save',
        classes: ['menu_button'],
        action: async (event) => {
            event.preventDefault();
            event.stopPropagation();
            try {
                const root = currentPopupInstance?.dlg;
                const ok = await savePreferencesFromPopup(root);
                if (ok) {
                    try { toastr.success('Preferences saved'); } catch (e) {}
                    updateDisplay();
                }
            } catch (e) {
                console.error('STGL: Error saving preferences:', e);
                try { toastr.error('Failed to save preferences'); } catch (_e) {}
            }
        }
    });

    // Add save/clear buttons if there's an active chat
    if (hasActiveChat && settingsManager) {
        const isGroupChat = context.isGroupChat;

        if (!isGroupChat) {
            // Single character buttons
            customButtons.push(
                {
                    text: '✔️ Set Character',
                    classes: ['menu_button'],
                    action: async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        try {
                            await settingsManager.saveCurrentUILocks({ character: true, chat: false, model: false });
                            toastr.success('Character locks saved');
                            await refreshPopupAfterSave();
                        } catch (error) {
                            console.error('STGL: Error saving character locks:', error);
                            toastr.error('Failed to save character locks');
                        }
                    }
                },
                {
                    text: '✔️ Set Chat',
                    classes: ['menu_button'],
                    action: async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        try {
                            await settingsManager.saveCurrentUILocks({ character: false, chat: true, model: false });
                            toastr.success('Chat locks saved');
                            await refreshPopupAfterSave();
                        } catch (error) {
                            console.error('STGL: Error saving chat locks:', error);
                            toastr.error('Failed to save chat locks');
                        }
                    }
                },
                {
                    text: '✔️ Set Model',
                    classes: ['menu_button'],
                    action: async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        try {
                            await settingsManager.saveCurrentUILocks({ character: false, chat: false, model: true });
                            toastr.success('Model locks saved');
                            await refreshPopupAfterSave();
                        } catch (error) {
                            console.error('STGL: Error saving model locks:', error);
                            toastr.error('Failed to save model locks');
                        }
                    }
                }
            );
        } else {
            // Group chat buttons
            customButtons.push(
                {
                    text: '✔️ Set Group',
                    classes: ['menu_button'],
                    action: async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        try {
                            await settingsManager.saveCurrentUILocks({ character: true, chat: false, model: false });
                            toastr.success('Group locks saved');
                            await refreshPopupAfterSave();
                        } catch (error) {
                            console.error('STGL: Error saving group locks:', error);
                            toastr.error('Failed to save group locks');
                        }
                    }
                },
                {
                    text: '✔️ Set Chat',
                    classes: ['menu_button'],
                    action: async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        try {
                            await settingsManager.saveCurrentUILocks({ character: false, chat: true, model: false });
                            toastr.success('Chat locks saved');
                            await refreshPopupAfterSave();
                        } catch (error) {
                            console.error('STGL: Error saving chat locks:', error);
                            toastr.error('Failed to save chat locks');
                        }
                    }
                },
                {
                    text: '✔️ Set Model',
                    classes: ['menu_button'],
                    action: async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        try {
                            await settingsManager.saveCurrentUILocks({ character: false, chat: false, model: true });
                            toastr.success('Model locks saved');
                            await refreshPopupAfterSave();
                        } catch (error) {
                            console.error('STGL: Error saving model locks:', error);
                            toastr.error('Failed to save model locks');
                        }
                    }
                }
            );
        }

        // Clear buttons
        customButtons.push(
            {
                text: isGroupChat ? '❌ Clear Group' : '❌ Clear Character',
                classes: ['menu_button'],
                action: async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                        await settingsManager.clearLocks({ character: true, chat: false, model: false });
                        toastr.info(isGroupChat ? 'Group locks cleared' : 'Character locks cleared');
                        await refreshPopupAfterSave();
                    } catch (error) {
                        console.error('STGL: Error clearing locks:', error);
                        toastr.error('Failed to clear locks');
                    }
                }
            },
            {
                text: '❌ Clear Chat',
                classes: ['menu_button'],
                action: async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                        await settingsManager.clearLocks({ character: false, chat: true, model: false });
                        toastr.info('Chat locks cleared');
                        await refreshPopupAfterSave();
                    } catch (error) {
                        console.error('STGL: Error clearing chat locks:', error);
                        toastr.error('Failed to clear chat locks');
                    }
                }
            },
            {
                text: '❌ Clear Model',
                classes: ['menu_button'],
                action: async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                        await settingsManager.clearLocks({ character: false, chat: false, model: true });
                        toastr.info('Model locks cleared');
                        await refreshPopupAfterSave();
                    } catch (error) {
                        console.error('STGL: Error clearing model locks:', error);
                        toastr.error('Failed to clear model locks');
                    }
                }
            }
        );
    }

    // Apply button (always shown)
    customButtons.push({
        text: '🔄 Apply Now',
        classes: ['menu_button'],
        action: async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (settingsManager) {
                await settingsManager.applyLocksForContext();
                updateDisplay();
                toastr.success('Locks applied');
            }
        }
    });

    const popupOptions = {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        customButtons: customButtons,
        cancelButton: 'Close',
        okButton: false,
        onClose: handlePopupClose
    };

    try {
        currentPopupInstance = new Popup(contentWithHeader, POPUP_TYPE.TEXT, '', popupOptions);
        await currentPopupInstance.show();

        // Initialize cascading priority dropdowns after popup is rendered
        initializePriorityDropdowns();

        // Ensure popup buttons can wrap onto a second row using ST utility classes (no custom CSS)
        try {
            const btnContainer = currentPopupInstance?.dlg?.querySelector?.('.popup-controls');
            if (btnContainer) {
                // Ensure container is flex and allows wrapping and spacing
                btnContainer.classList.add('flex-container', 'flexWrap', 'justifyCenter', 'flexGap5', 'flexFlowRow');
            }
        } catch (e) {}
    } catch (error) {
        console.error('STGL: Error showing popup:', error);
        currentPopupInstance = null;
    }
}

/**
 * Save preferences from popup (explicit save button)
 */
async function savePreferencesFromPopup(popupElement) {
    try {
        const storage = new StorageAdapter();

        // Save checkbox preferences
        const checkboxMappings = {
            'stgl-prefer-individual': 'preferIndividualCharacterInGroup',
            'stgl-show-notifications': 'showNotifications'
        };

        for (const [checkboxId, settingKey] of Object.entries(checkboxMappings)) {
            const checkbox = popupElement.querySelector(`#${checkboxId}`);
            if (checkbox) {
                storage.updatePreference(settingKey, checkbox.checked);
            }
        }

        // Save priority order (refuse duplicates)
        const s1 = popupElement.querySelector('#stgl-priority-select-1');
        const s2 = popupElement.querySelector('#stgl-priority-select-2');
        const s3 = popupElement.querySelector('#stgl-priority-select-3');
        if (s1 && s2 && s3) {
            const all = ['model', 'chat', 'character'];
            const seq = [s1.value, s2.value, s3.value].filter(v => all.includes(v));
            const isValid = seq.length === 3 && new Set(seq).size === 3;
            if (!isValid) {
                try {
                    toastr.error('Priority order must be unique (Model, Chat, Character/Group). Please adjust and try again.');
                } catch (e) {}
                if (DEBUG_MODE) console.warn('STGL: Refused to save invalid/duplicate priority order:', seq);
                return false;
            } else {
                storage.updatePreference('priorityOrder', seq);
            }
        }

        // Save auto-apply mode
        const autoApplyRadio = popupElement.querySelector('input[name="stgl-auto-apply-mode"]:checked');
        if (autoApplyRadio) {
            storage.updatePreference('autoApplyOnContextChange', autoApplyRadio.value);
        }

        if (DEBUG_MODE) console.log('STGL: Preferences saved (explicit)');
        return true;
    } catch (error) {
        console.error('STGL: Error saving preferences:', error);
        return false;
    }
}

/**
 * Handle popup close - do not save (explicit close)
 */
async function handlePopupClose(popup) {
    try {
        // No-op: do not save on close
    } finally {
        currentPopupInstance = null;
    }
}

/**
 * Inject menu item into extensions menu
 */
function injectMenuButton() {
    const tryInject = () => {
        const menu = document.getElementById('extensionsMenu');
        if (!menu) {
            setTimeout(tryInject, 500);
            return;
        }
        if (document.getElementById('stgl-menu-item')) return;

        const menuItem = $(`
            <div id="stgl-menu-item-container" class="extension_container interactable" tabindex="0">
                <div id="stgl-menu-item" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                    <div class="fa-fw fa-solid fa-lock extensionsMenuExtensionButton"></div>
                    <span>Generation Locks</span>
                </div>
            </div>
        `);

        menuItem.on('click', showLockManagementPopup);
        $('#extensionsMenu').prepend(menuItem);

        if (DEBUG_MODE) console.log('STGL: Menu button injected');
    };
    tryInject();
}

// ============================================================================
// SECTION 6: INITIALIZATION & BOOTSTRAP
// ============================================================================

/**
 * Initialize extension
 */
async function init() {
    if (DEBUG_MODE) console.log('STGL: Initializing...');

    try {
        // Ensure popup controls wrap like STMTL
        addPopupWrapStyle();

        // Initialize storage and ensure default settings exist
        const storage = new StorageAdapter();
        const settings = storage.getExtensionSettings();

        if (DEBUG_MODE) console.log('STGL: Settings loaded:', settings);

        // Run migration from STCL/CCPM if needed
        if (!MigrationManager.hasMigrated(storage)) {
            console.log('STGL: Running migration from STCL/CCPM...');
            const migrationReport = await MigrationManager.migrateAll(storage);

            if (migrationReport.stcl.migrated || migrationReport.ccpm.migrated) {
                console.log('STGL: Migration complete:', migrationReport);

                // Show migration summary to user
                let message = '<h3>Migration Complete</h3>';

                if (migrationReport.stcl.migrated) {
                    const stclData = migrationReport.stcl.data;
                    message += `<p><strong>Character Locks (STCL):</strong></p>`;
                    message += `<ul>`;
                    message += `<li>Character locks: ${stclData.characterLocks}</li>`;
                    message += `<li>Chat locks: ${stclData.chatLocks}</li>`;
                    message += `<li>Group locks: ${stclData.groupLocks}</li>`;
                    if (stclData.errors.length > 0) {
                        message += `<li>Errors: ${stclData.errors.length}</li>`;
                    }
                    message += `</ul>`;
                }

                if (migrationReport.ccpm.migrated) {
                    const ccpmData = migrationReport.ccpm.data;
                    message += `<p><strong>CC Prompt Manager (CCPM):</strong></p>`;
                    message += `<ul>`;
                    message += `<li>Templates: ${ccpmData.templates}</li>`;
                    message += `<li>Character locks: ${ccpmData.characterLocks}</li>`;
                    message += `<li>Model locks: ${ccpmData.modelLocks}</li>`;
                    message += `<li>Chat locks: ${ccpmData.chatLocks}</li>`;
                    message += `<li>Group locks: ${ccpmData.groupLocks}</li>`;
                    if (ccpmData.errors.length > 0) {
                        message += `<li>Errors: ${ccpmData.errors.length}</li>`;
                    }
                    message += `</ul>`;
                }

                message += `<p>Your settings have been migrated to Generation Locks!</p>`;

                toastr.success('Migration from STCL/CCPM complete!');

                // Optionally show detailed popup
                if (DEBUG_MODE) {
                    await callGenericPopup(message, POPUP_TYPE.TEXT, '', { okButton: 'OK' });
                }
            }
        }

        // Initialize core components
        const chatContext = new ChatContext();
        const priorityResolver = new PriorityResolver(storage);
        const profileLocker = new ProfileLocker();
        const presetLocker = new PresetLocker();
        const templateLocker = new TemplateLocker(storage);

        // Initialize settings manager
        settingsManager = new SettingsManager(
            storage,
            chatContext,
            priorityResolver,
            profileLocker,
            presetLocker,
            templateLocker
        );

        // Register event handlers
        registerAllEventHandlers();

        // Inject UI
        injectMenuButton();
        injectPromptTemplateManagerButton();

        // Hook into promptManager to keep the display updated.
        if (promptManager && promptManager.render) {
            const originalRender = promptManager.render.bind(promptManager);
            promptManager.render = async function(...args) {
                await originalRender(...args);
                updateDisplay(); // Call our new display function after ST renders.
            };
            console.log('STGL: Hooked into promptManager.render for UI updates.');
        }

        // Expose template manager globally (like CCPM)
        window.promptTemplateManager = {
            listTemplates() {
                return Object.values(storage.getExtensionSettings().templates || {});
            },
            getTemplate(id) {
                return storage.getExtensionSettings().templates?.[id] || null;
            },
            createFromCurrent(name, description, includePrompts = null) {
                const template = TemplateOps.createFromCurrent({ name, description, includePrompts });
                const settings = storage.getExtensionSettings();
                if (!settings.templates) settings.templates = {};
                settings.templates[template.id] = template;
                storage.saveExtensionSettings();
                return template;
            },
            updateTemplate(templateId, updates) {
                const template = storage.getTemplate(templateId);
                if (!template) {
                    if (DEBUG_MODE) console.warn('STGL: Cannot update template - not found:', templateId);
                    return false;
                }
                Object.assign(template, updates, { updatedAt: new Date().toISOString() });
                storage.saveTemplate(template);
                return true;
            },
            saveTemplate(template) {
                storage.saveTemplate(template);
            },
            async applyTemplate(templateId) {
                // Use TemplateLocker for race condition protection
                const currentContext = new ChatContext().getCurrent();
                return await templateLocker.applyTemplate(templateId, currentContext.primaryId);
            },
            deleteTemplate(id) {
                const settings = storage.getExtensionSettings();
                if (settings.templates?.[id]) {
                    delete settings.templates[id];
                    storage.saveExtensionSettings();
                    return true;
                }
                return false;
            }
        };

        // Expose settingsManager globally for promptManager.js to access
        window.stglSettingsManager = settingsManager;

        // Initial context check
        settingsManager.onContextChanged();

        console.log('STGL: Initialization complete');
    } catch (error) {
        console.error('STGL: Initialization failed:', error);
    }
}

/**
 * Bootstrap on APP_READY
 */
if (eventSource && event_types && event_types.APP_READY) {
    eventSource.on(event_types.APP_READY, init);
    if (DEBUG_MODE) console.log('STGL: Registered for APP_READY event');
} else {
    console.warn('STGL: APP_READY event not available, initializing immediately');
    // Fallback: initialize immediately
    jQuery(async () => {
        await init();
    });
}

console.log('STGL: Module loaded');
