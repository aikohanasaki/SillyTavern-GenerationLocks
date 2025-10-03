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
import { getPresetManager } from '../../../preset-manager.js';
import { executeSlashCommandsWithOptions } from '../../../slash-commands.js';
import { oai_settings, promptManager } from '../../../openai.js';
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

const LOCKING_MODES = {
    CHARACTER: 'character',
    MODEL: 'model'
};

const LOCKABLE_ITEMS = {
    PROFILE: 'profile',
    PRESET: 'preset',
    TEMPLATE: 'template'
};

const DEFAULT_SETTINGS = {
    moduleSettings: {
        enableCharacterMemory: true,
        enableChatMemory: true,
        enableGroupMemory: true,
        preferChatOverCharacterOrGroup: true,
        preferChatOverModel: true,
        preferIndividualCharacterInGroup: false,
        showNotifications: true,
        autoApplyOnContextChange: AUTO_APPLY_MODES.ASK,
        lockingMode: LOCKING_MODES.CHARACTER
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
            // Read from oai_settings which is updated by /model command
            return oai_settings?.model || null;
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
        return extension_settings[this.EXTENSION_KEY];
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
     * @private
     */
    _buildCascade(context, preferences) {
        const {
            lockingMode,
            preferChatOverCharacterOrGroup,
            preferChatOverModel,
            preferIndividualCharacterInGroup
        } = preferences;

        const { isGroupChat } = context;

        // Determine primary and loser
        const primary = isGroupChat && lockingMode === LOCKING_MODES.CHARACTER
            ? SETTING_SOURCES.GROUP
            : lockingMode;

        const loser = (primary === SETTING_SOURCES.CHARACTER || primary === SETTING_SOURCES.GROUP)
            ? SETTING_SOURCES.MODEL
            : isGroupChat ? SETTING_SOURCES.GROUP : SETTING_SOURCES.CHARACTER;

        // Build cascade array based on both preference toggles
        const cascade = [];

        // Helper to inject individual before group if needed
        const injectIndividualBeforeGroup = (target) => {
            if (isGroupChat && target === SETTING_SOURCES.GROUP && preferIndividualCharacterInGroup) {
                cascade.push(SETTING_SOURCES.INDIVIDUAL);
            }
            cascade.push(target);
        };

        // Determine 3-way ordering based on BOTH preference toggles
        if (primary === SETTING_SOURCES.CHARACTER || primary === SETTING_SOURCES.GROUP) {
            // Primary is character/group, loser is model
            // Use preferChatOverCharacterOrGroup and preferChatOverModel

            if (preferChatOverCharacterOrGroup && preferChatOverModel) {
                // Chat beats both: Chat → Character/Group → Model
                cascade.push(SETTING_SOURCES.CHAT);
                injectIndividualBeforeGroup(primary);
                cascade.push(loser);
            } else if (!preferChatOverCharacterOrGroup && preferChatOverModel) {
                // Character/Group beats chat, chat beats model: Character/Group → Chat → Model
                injectIndividualBeforeGroup(primary);
                cascade.push(SETTING_SOURCES.CHAT);
                cascade.push(loser);
            } else if (preferChatOverCharacterOrGroup && !preferChatOverModel) {
                // Model beats chat, chat beats character/group: Model → Chat → Character/Group
                cascade.push(loser);
                cascade.push(SETTING_SOURCES.CHAT);
                injectIndividualBeforeGroup(primary);
            } else {
                // Both beat chat: Character/Group → Model → Chat
                injectIndividualBeforeGroup(primary);
                cascade.push(loser);
                cascade.push(SETTING_SOURCES.CHAT);
            }
        } else {
            // Primary is model, loser is character/group
            // Use preferChatOverModel and preferChatOverCharacterOrGroup

            if (preferChatOverModel && preferChatOverCharacterOrGroup) {
                // Chat beats both: Chat → Model → Character/Group
                cascade.push(SETTING_SOURCES.CHAT);
                cascade.push(primary);
                injectIndividualBeforeGroup(loser);
            } else if (!preferChatOverModel && preferChatOverCharacterOrGroup) {
                // Model beats chat, chat beats character/group: Model → Chat → Character/Group
                cascade.push(primary);
                cascade.push(SETTING_SOURCES.CHAT);
                injectIndividualBeforeGroup(loser);
            } else if (preferChatOverModel && !preferChatOverCharacterOrGroup) {
                // Character/Group beats chat, chat beats model: Character/Group → Chat → Model
                injectIndividualBeforeGroup(loser);
                cascade.push(SETTING_SOURCES.CHAT);
                cascade.push(primary);
            } else {
                // Both beat chat: Model → Character/Group → Chat
                cascade.push(primary);
                injectIndividualBeforeGroup(loser);
                cascade.push(SETTING_SOURCES.CHAT);
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
            oai_settings.prompts = promptsArray;

            if (template.promptOrder && template.promptOrder.length > 0 && promptManager?.activeCharacter) {
                promptManager.setPromptOrderForCharacter(
                    promptManager.activeCharacter,
                    template.promptOrder
                );
            }

            saveSettingsDebounced();
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

        const trimmedId = templateId.trim();
        if (!trimmedId) {
            console.warn('STGL: Empty template ID provided');
            return false;
        }

        try {
            const settings = this.storage.getExtensionSettings();
            const template = settings.templates?.[trimmedId];

            if (!template) {
                console.warn(`STGL: Template not found: ${trimmedId}`);
                return false;
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

        // 1. Profile first (changes connection)
        if (locks.profile !== null && locks.profile !== undefined) {
            const success = await this.profileLocker.applyProfile(locks.profile, originalContextId);
            if (!success) {
                console.warn('STGL: Failed to apply profile lock');
                return false;
            }
        }

        // 2. Preset second (depends on active connection)
        if (locks.preset !== null && locks.preset !== undefined) {
            const success = await this.presetLocker.applyPreset(locks.preset, originalContextId);
            if (!success) {
                console.warn('STGL: Failed to apply preset lock');
                return false;
            }
        }

        // 3. Template last (modifies prompt manager)
        if (locks.template !== null && locks.template !== undefined) {
            const success = await this.templateLocker.applyTemplate(locks.template, originalContextId);
            if (!success) {
                console.warn('STGL: Failed to apply template lock');
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

            const shouldApply = await this._shouldApplyAutomatically();
            if (shouldApply && !isApplyingSettings) {
                if (DEBUG_MODE) console.log('STGL: Auto-applying locks on context change');
                await this.applyLocksForContext();
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

        // ASK mode - check if there are locks to apply
        const context = this.chatContext.getCurrent();
        const resolved = this.priorityResolver.resolve(context, preferences);

        if (resolved.locks.profile || resolved.locks.preset || resolved.locks.template) {
            const contextName = context.characterName || context.groupName || 'this context';
            const result = await callGenericPopup(
                `Apply locks for ${contextName}?`,
                POPUP_TYPE.CONFIRM
            );
            return result === POPUP_RESULT.AFFIRMATIVE;
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

        // Apply individual locks directly (bypass priority resolver)
        const originalContextId = chatContext.primaryId;
        await settingsManager._applyLocksToUI(individualLock, originalContextId);

        updateDisplay();
    } catch (error) {
        console.error('STGL: Error in GROUP_MEMBER_DRAFTED handler:', error);
    }
}

/**
 * Handle manual preset changes - update display
 */
function onPresetChanged() {
    if (DEBUG_MODE) console.log('STGL: Preset changed manually');
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

    try {
        const resolved = settingsManager.getCurrentLocks();
        const { locks, sources } = resolved;

        // Remove existing display
        const existing = document.getElementById('stgl-status-indicator');
        if (existing) existing.remove();

        // Build display HTML
        const parts = [];
        if (locks.profile) parts.push(`<i class="fa-solid fa-plug"></i> ${locks.profile}`);
        if (locks.preset) parts.push(`<i class="fa-solid fa-sliders"></i> ${locks.preset}`);
        if (locks.template) parts.push(`<i class="fa-solid fa-file-lines"></i> ${locks.template}`);

        if (parts.length === 0) {
            if (DEBUG_MODE) console.log('STGL: No locks to display');
            return;
        }

        const html = parts.join(' <span class="text_muted">|</span> ');

        // Create and inject indicator
        const indicator = document.createElement('div');
        indicator.id = 'stgl-status-indicator';
        indicator.className = 'stgl-status-indicator';
        indicator.innerHTML = `<small class="text_muted">${html}</small>`;

        // Inject into extensions menu or appropriate location
        const extensionsMenu = document.getElementById('extensionsMenu');
        if (extensionsMenu) {
            extensionsMenu.insertAdjacentElement('afterbegin', indicator);
        }

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
<div class="completion_prompt_manager_popup_entry">
    <div class="completion_prompt_manager_error {{#unless isExtensionEnabled}}caution{{/unless}} marginBot10">
        <span>Status: <strong>{{statusText}}</strong></span>
    </div>

    <div class="completion_prompt_manager_popup_entry_form_control flex-container flexFlowColumn justifyCenter" style="text-align: center;">
        {{#each checkboxes}}
        <label class="checkbox_label">
            <input type="checkbox" id="{{id}}" {{#if checked}}checked{{/if}}>
            <span>{{label}}</span>
        </label>
        {{/each}}
    </div>

    <div class="completion_prompt_manager_popup_entry_form_control flex-container flexFlowColumn justifyCenter">
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

    <div class="completion_prompt_manager_popup_entry_form_control flex-container flexFlowColumn justifyCenter">
        <h4 class="standoutHeader">🔒 Locking Mode:</h4>
        <div class="marginTop10">
            {{#each lockingModeOptions}}
            <label class="radio_label">
                <input type="radio" name="stgl-locking-mode" value="{{value}}" {{#if checked}}checked{{/if}}>
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
</div>
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
    if (lock.template) parts.push(`Template: ${lock.template}`);

    return parts.length > 0 ? parts.join('<br>') : 'No locks set';
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

    // Build checkboxes based on context
    const checkboxes = isGroupChat ? [
        { id: 'stgl-enable-character', label: 'Remember per group', checked: preferences.enableGroupMemory },
        { id: 'stgl-enable-chat', label: 'Remember per chat', checked: preferences.enableChatMemory },
        { id: 'stgl-enable-model', label: 'Remember per model', checked: preferences.enableModelMemory || true },
        { id: 'stgl-prefer-chat-over-character-group', label: 'Prefer chat over character/group', checked: preferences.preferChatOverCharacterOrGroup },
        { id: 'stgl-prefer-chat-over-model', label: 'Prefer chat over model', checked: preferences.preferChatOverModel },
        { id: 'stgl-prefer-individual', label: 'Prefer individual character in group', checked: preferences.preferIndividualCharacterInGroup },
        { id: 'stgl-show-notifications', label: 'Show notifications', checked: preferences.showNotifications }
    ] : [
        { id: 'stgl-enable-character', label: 'Remember per character', checked: preferences.enableCharacterMemory },
        { id: 'stgl-enable-chat', label: 'Remember per chat', checked: preferences.enableChatMemory },
        { id: 'stgl-enable-model', label: 'Remember per model', checked: preferences.enableModelMemory || true },
        { id: 'stgl-prefer-chat-over-character-group', label: 'Prefer chat over character/group', checked: preferences.preferChatOverCharacterOrGroup },
        { id: 'stgl-prefer-chat-over-model', label: 'Prefer chat over model', checked: preferences.preferChatOverModel },
        { id: 'stgl-show-notifications', label: 'Show notifications', checked: preferences.showNotifications }
    ];

    // Auto-apply options
    const autoApplyOptions = [
        { value: AUTO_APPLY_MODES.NEVER, label: 'Never auto-apply', checked: preferences.autoApplyOnContextChange === AUTO_APPLY_MODES.NEVER },
        { value: AUTO_APPLY_MODES.ASK, label: 'Ask before applying', checked: preferences.autoApplyOnContextChange === AUTO_APPLY_MODES.ASK },
        { value: AUTO_APPLY_MODES.ALWAYS, label: 'Always auto-apply', checked: preferences.autoApplyOnContextChange === AUTO_APPLY_MODES.ALWAYS }
    ];

    // Locking mode options
    const lockingModeOptions = [
        { value: LOCKING_MODES.CHARACTER, label: 'Character/Group mode', checked: preferences.lockingMode === LOCKING_MODES.CHARACTER },
        { value: LOCKING_MODES.MODEL, label: 'Model mode', checked: preferences.lockingMode === LOCKING_MODES.MODEL }
    ];

    // Get current locks
    const characterLocks = isGroupChat ? null : storage.getCharacterLock(context.characterName);
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
        autoApplyOptions,
        lockingModeOptions,
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
                toastr.success('Locks applied');
            }
        }
    });

    const popupOptions = {
        allowVerticalScrolling: true,
        customButtons,
        cancelButton: 'Close',
        okButton: false,
        onClose: handlePopupClose
    };

    try {
        currentPopupInstance = new Popup(contentWithHeader, POPUP_TYPE.TEXT, '', popupOptions);
        await currentPopupInstance.show();
    } catch (error) {
        console.error('STGL: Error showing popup:', error);
        currentPopupInstance = null;
    }
}

/**
 * Handle popup close - save preferences
 */
async function handlePopupClose(popup) {
    try {
        const popupElement = popup.dlg;
        const storage = new StorageAdapter();

        // Save checkbox preferences
        const checkboxMappings = {
            'stgl-enable-character': 'enableCharacterMemory',
            'stgl-enable-chat': 'enableChatMemory',
            'stgl-enable-model': 'enableModelMemory',
            'stgl-prefer-chat-over-character-group': 'preferChatOverCharacterOrGroup',
            'stgl-prefer-chat-over-model': 'preferChatOverModel',
            'stgl-prefer-individual': 'preferIndividualCharacterInGroup',
            'stgl-show-notifications': 'showNotifications'
        };

        for (const [checkboxId, settingKey] of Object.entries(checkboxMappings)) {
            const checkbox = popupElement.querySelector(`#${checkboxId}`);
            if (checkbox) {
                storage.updatePreference(settingKey, checkbox.checked);
            }
        }

        // Save auto-apply mode
        const autoApplyRadio = popupElement.querySelector('input[name="stgl-auto-apply-mode"]:checked');
        if (autoApplyRadio) {
            storage.updatePreference('autoApplyOnContextChange', autoApplyRadio.value);
        }

        // Save locking mode
        const lockingModeRadio = popupElement.querySelector('input[name="stgl-locking-mode"]:checked');
        if (lockingModeRadio) {
            storage.updatePreference('lockingMode', lockingModeRadio.value);
        }

        if (DEBUG_MODE) console.log('STGL: Preferences saved');
    } catch (error) {
        console.error('STGL: Error saving preferences:', error);
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

        // Expose template manager globally (like CCPM)
        window.promptTemplateManager = {
            listTemplates() {
                return Object.values(storage.getExtensionSettings().templates || {});
            },
            getTemplate(id) {
                return storage.getExtensionSettings().templates?.[id] || null;
            },
            createFromCurrent(name, description) {
                const template = TemplateOps.createFromCurrent({ name, description });
                const settings = storage.getExtensionSettings();
                if (!settings.templates) settings.templates = {};
                settings.templates[template.id] = template;
                storage._saveSettings();
                return template;
            },
            applyTemplate(templateId) {
                const template = this.getTemplate(templateId);
                if (!template) return false;
                const result = TemplateOps.applyToPromptManager(template);
                // Track the applied template so getCurrentTemplate() works
                if (result) {
                    templateLocker.currentTemplate = templateId;
                }
                return result;
            },
            deleteTemplate(id) {
                const settings = storage.getExtensionSettings();
                if (settings.templates?.[id]) {
                    delete settings.templates[id];
                    storage._saveSettings();
                    return true;
                }
                return false;
            }
        };

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
