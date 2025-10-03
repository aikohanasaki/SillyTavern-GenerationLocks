/**
 * SillyTavern Generation Locks - Migration Utilities
 * Migrate data from STCL (CharacterLocks) and CCPM (CCPromptManager)
 */

import { extension_settings, chat_metadata } from '../../../extensions.js';
import { groups } from '../../../group-chats.js';

const DEBUG_MODE = false;

/**
 * Migration from Character Locks (STCL) to Generation Locks (STGL)
 */
export class STCLMigration {
    /**
     * Check if STCL data exists
     * @returns {boolean}
     */
    static hasSTCLData() {
        // Check for STCL extension settings
        return !!(extension_settings.STCL);
    }

    /**
     * Migrate STCL data to STGL format
     * @param {Object} stglStorage - STGL StorageAdapter instance
     * @returns {Object} Migration report
     */
    static migrate(stglStorage) {
        const report = {
            characterLocks: 0,
            chatLocks: 0,
            groupLocks: 0,
            errors: []
        };

        try {
            const stclData = extension_settings.STCL;
            if (!stclData) return report;

            // Migrate character locks from extension_settings.STCL.characterSettings
            if (stclData.characterSettings) {
                for (const [key, settings] of Object.entries(stclData.characterSettings)) {
                    try {
                        const stglLock = this._convertSTCLToSTGL(settings);
                        // Key can be either chId (number as string) or character name
                        stglStorage.setCharacterLock(key, stglLock);
                        report.characterLocks++;
                    } catch (error) {
                        report.errors.push(`Character ${key}: ${error.message}`);
                    }
                }
            }

            // Migrate chat locks from chat_metadata.STCL
            if (chat_metadata?.STCL) {
                try {
                    const stglLock = this._convertSTCLToSTGL(chat_metadata.STCL);
                    stglStorage.setChatLock(stglLock);
                    report.chatLocks++;
                } catch (error) {
                    report.errors.push(`Chat: ${error.message}`);
                }
            }

            // Migrate group locks from group.stcl_settings (stored directly on group objects)
            if (groups && Array.isArray(groups)) {
                for (const group of groups) {
                    if (group.stcl_settings) {
                        try {
                            const stglLock = this._convertSTCLToSTGL(group.stcl_settings);
                            stglStorage.setGroupLock(group.id, stglLock);
                            report.groupLocks++;
                        } catch (error) {
                            report.errors.push(`Group ${group.id}: ${error.message}`);
                        }
                    }
                }
            }

            if (DEBUG_MODE) {
                console.log('STGL Migration Report (STCL):', report);
            }

            return report;
        } catch (error) {
            console.error('STGL: STCL migration failed:', error);
            report.errors.push(error.message);
            return report;
        }
    }

    /**
     * Convert STCL lock format to STGL format
     * @private
     */
    static _convertSTCLToSTGL(stclSettings) {
        return {
            profile: stclSettings.connectionProfile || null,
            preset: stclSettings.preset || null,
            template: null // STCL didn't have templates
        };
    }

    /**
     * Backup STCL data before migration
     * @returns {string} JSON backup
     */
    static backup() {
        const backup = {
            timestamp: new Date().toISOString(),
            extensionSettings: extension_settings.STCL,
            chatMetadata: chat_metadata?.STCL,
            groupLocks: []
        };

        // Backup group locks from group objects
        if (groups && Array.isArray(groups)) {
            for (const group of groups) {
                if (group.stcl_settings) {
                    backup.groupLocks.push({
                        groupId: group.id,
                        groupName: group.name,
                        settings: group.stcl_settings
                    });
                }
            }
        }

        return JSON.stringify(backup, null, 2);
    }
}

/**
 * Migration from CC Prompt Manager (CCPM) to Generation Locks (STGL)
 */
export class CCPMMigration {
    /**
     * Check if CCPM data exists
     * @returns {boolean}
     */
    static hasCCPMData() {
        return !!(extension_settings.ccPromptManager);
    }

    /**
     * Migrate CCPM data to STGL format
     * @param {Object} stglStorage - STGL StorageAdapter instance
     * @returns {Object} Migration report
     */
    static migrate(stglStorage) {
        const report = {
            templates: 0,
            characterLocks: 0,
            modelLocks: 0,
            chatLocks: 0,
            groupLocks: 0,
            errors: []
        };

        try {
            const ccpmData = extension_settings.ccPromptManager;
            if (!ccpmData) return report;

            // Migrate templates
            if (ccpmData.templates) {
                const stglSettings = stglStorage.getExtensionSettings();
                stglSettings.templates = ccpmData.templates;
                report.templates = Object.keys(ccpmData.templates).length;
            }

            // Migrate template locks to STGL locks
            if (ccpmData.templateLocks) {
                // Character locks
                if (ccpmData.templateLocks.character) {
                    for (const [chId, templateId] of Object.entries(ccpmData.templateLocks.character)) {
                        try {
                            const stglLock = this._convertCCPMToSTGL(templateId);
                            stglStorage.setCharacterLock(chId, stglLock);
                            report.characterLocks++;
                        } catch (error) {
                            report.errors.push(`Character ${chId}: ${error.message}`);
                        }
                    }
                }

                // Model locks
                if (ccpmData.templateLocks.model) {
                    for (const [modelName, templateId] of Object.entries(ccpmData.templateLocks.model)) {
                        try {
                            const stglLock = this._convertCCPMToSTGL(templateId);
                            stglStorage.setModelLock(modelName, stglLock);
                            report.modelLocks++;
                        } catch (error) {
                            report.errors.push(`Model ${modelName}: ${error.message}`);
                        }
                    }
                }

                // Group locks - CCPM stores these directly on group objects, not in templateLocks
                // Check all groups for ccpm_template_lock
                if (groups && Array.isArray(groups)) {
                    for (const group of groups) {
                        if (group.ccpm_template_lock) {
                            try {
                                const stglLock = this._convertCCPMToSTGL(group.ccpm_template_lock);
                                stglStorage.setGroupLock(group.id, stglLock);
                                report.groupLocks++;
                            } catch (error) {
                                report.errors.push(`Group ${group.id}: ${error.message}`);
                            }
                        }
                    }
                }
            }

            // Migrate chat lock from chat_metadata
            if (chat_metadata?.ccpm_template_lock) {
                try {
                    const stglLock = this._convertCCPMToSTGL(chat_metadata.ccpm_template_lock);
                    stglStorage.setChatLock(stglLock);
                    report.chatLocks++;
                } catch (error) {
                    report.errors.push(`Chat: ${error.message}`);
                }
            }

            // Migrate preferences
            if (ccpmData.lockingMode !== undefined) {
                stglStorage.updatePreference('lockingMode', ccpmData.lockingMode);
            }
            if (ccpmData.autoApplyMode !== undefined) {
                stglStorage.updatePreference('autoApplyOnContextChange', ccpmData.autoApplyMode);
            }
            if (ccpmData.preferPrimaryOverChat !== undefined) {
                stglStorage.updatePreference('preferCharacterOverChat', ccpmData.preferPrimaryOverChat);
            }
            if (ccpmData.preferGroupOverChat !== undefined) {
                stglStorage.updatePreference('preferGroupOverChat', ccpmData.preferGroupOverChat);
            }
            if (ccpmData.preferIndividualCharacterInGroup !== undefined) {
                stglStorage.updatePreference('preferIndividualCharacterInGroup', ccpmData.preferIndividualCharacterInGroup);
            }

            if (DEBUG_MODE) {
                console.log('STGL Migration Report (CCPM):', report);
            }

            return report;
        } catch (error) {
            console.error('STGL: CCPM migration failed:', error);
            report.errors.push(error.message);
            return report;
        }
    }

    /**
     * Convert CCPM template lock to STGL format
     * @private
     */
    static _convertCCPMToSTGL(templateId) {
        return {
            profile: null, // CCPM didn't lock profiles
            preset: null,  // CCPM didn't lock presets
            template: templateId
        };
    }

    /**
     * Backup CCPM data before migration
     * @returns {string} JSON backup
     */
    static backup() {
        const backup = {
            timestamp: new Date().toISOString(),
            extensionSettings: extension_settings.ccPromptManager,
            chatMetadata: chat_metadata?.ccpm_template_lock,
            groupLocks: []
        };

        // Backup group locks from group objects
        if (groups && Array.isArray(groups)) {
            for (const group of groups) {
                if (group.ccpm_template_lock) {
                    backup.groupLocks.push({
                        groupId: group.id,
                        groupName: group.name,
                        templateId: group.ccpm_template_lock
                    });
                }
            }
        }

        return JSON.stringify(backup, null, 2);
    }
}

/**
 * Main migration coordinator
 */
export class MigrationManager {
    /**
     * Run all available migrations
     * @param {Object} stglStorage - STGL StorageAdapter instance
     * @returns {Object} Combined migration report
     */
    static async migrateAll(stglStorage) {
        const report = {
            stcl: { migrated: false, data: null },
            ccpm: { migrated: false, data: null },
            timestamp: new Date().toISOString()
        };

        // Migrate STCL
        if (STCLMigration.hasSTCLData()) {
            console.log('STGL: Found STCL data, migrating...');
            report.stcl.data = STCLMigration.migrate(stglStorage);
            report.stcl.migrated = true;
        }

        // Migrate CCPM
        if (CCPMMigration.hasCCPMData()) {
            console.log('STGL: Found CCPM data, migrating...');
            report.ccpm.data = CCPMMigration.migrate(stglStorage);
            report.ccpm.migrated = true;
        }

        // Mark migration as complete
        const stglSettings = stglStorage.getExtensionSettings();
        stglSettings.migrationComplete = true;
        stglSettings.migrationTimestamp = report.timestamp;

        return report;
    }

    /**
     * Check if migration has been run
     * @param {Object} stglStorage
     * @returns {boolean}
     */
    static hasMigrated(stglStorage) {
        const settings = stglStorage.getExtensionSettings();
        return settings.migrationComplete === true;
    }

    /**
     * Create backup of both STCL and CCPM data
     * @returns {Object} Backup data
     */
    static createBackup() {
        return {
            timestamp: new Date().toISOString(),
            stcl: STCLMigration.hasSTCLData() ? STCLMigration.backup() : null,
            ccpm: CCPMMigration.hasCCPMData() ? CCPMMigration.backup() : null
        };
    }
}
