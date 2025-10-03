/**
 * SillyTavern Generation Locks - Prompt Template Manager UI
 * Provides UI for creating, editing, and managing prompt templates
 * Adapted from CCPM (CC Prompt Manager)
 */

import { Popup, POPUP_TYPE, POPUP_RESULT, callGenericPopup } from '../../../popup.js';
import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

let mainPopup = null;

/**
 * Inject the Prompt Template Manager button into extensions menu
 */
export function injectPromptTemplateManagerButton() {
    const tryInject = () => {
        const menu = document.getElementById('extensionsMenu');
        if (!menu) {
            setTimeout(tryInject, 500);
            return;
        }
        if (document.getElementById('stgl-template-manager-btn')) return;

        const menuItem = $(`
            <div id="stgl-template-manager-container" class="extension_container interactable" tabindex="0">
                <div id="stgl-template-manager-btn" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                    <div class="fa-fw fa-solid fa-folder-open extensionsMenuExtensionButton"></div>
                    <span>Prompt Templates</span>
                </div>
            </div>
        `);

        menuItem.on('click', openPromptTemplateManager);
        $('#extensionsMenu').prepend(menuItem);
    };
    tryInject();
}

/**
 * Open the template manager modal
 */
export function openPromptTemplateManager() {
    const content = document.createElement('div');
    content.innerHTML = `
        <div class="title_restorable">
            <h3>Prompt Template Manager</h3>
        </div>
        <div class="flex-container alignItemsCenter marginBot10" style="padding-bottom: 10px; border-bottom: 1px solid var(--SmartThemeBorderColor);">
            <div class="menu_button menu_button_icon interactable" id="stgl-create-template">
                <i class="fa-solid fa-plus"></i>
                <span>Create from Current</span>
            </div>
            <div class="menu_button menu_button_icon interactable" id="stgl-import-template">
                <i class="fa-solid fa-file-import"></i>
                <span>Import</span>
            </div>
            <div class="menu_button menu_button_icon interactable" id="stgl-export-all">
                <i class="fa-solid fa-file-export"></i>
                <span>Export All</span>
            </div>
        </div>
        <div id="stgl-template-list" class="flex-container flexFlowColumn overflowYAuto" style="max-height: 60vh;"></div>
    `;

    mainPopup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: 'Close',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        onOpen: () => {
            renderTemplateList();
            setupTemplateManagerEvents();
        },
        onClosing: () => {
            mainPopup = null;
            return true;
        },
    });
    mainPopup.show();
}

/**
 * Render the template list
 */
async function renderTemplateList() {
    const listDiv = document.getElementById('stgl-template-list');
    if (!listDiv) return;

    const templates = window.promptTemplateManager.listTemplates();

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

    listDiv.innerHTML = templates.map(t => {
        const promptCount = Object.keys(t.prompts).length;
        const createdDate = new Date(t.createdAt).toLocaleDateString();

        return `
            <div class="flex-container flexFlowColumn padding10 marginBot10" style="border: 1px solid var(--SmartThemeBorderColor); border-radius: 5px;">
                <div class="flex-container alignItemsCenter justifySpaceBetween">
                    <div class="flex1">
                        <div class="fontsize120p">
                            ${escapeHtml(t.name)}
                        </div>
                        <div class="fontsize90p text_muted flex-container flexGap10">
                            <span class="toggleEnabled">${promptCount} prompt${promptCount !== 1 ? 's' : ''}</span>
                            <span>Created: ${createdDate}</span>
                        </div>
                    </div>
                    <div class="flex-container flexGap2">
                        <div class="menu_button menu_button_icon interactable" onclick="window.stglApplyTemplate('${t.id}')" title="Apply Template" style="width: 32px; height: 32px; padding: 0;">
                            <i class="fa-solid fa-play"></i>
                        </div>
                        <div class="menu_button menu_button_icon interactable" onclick="window.stglViewPrompts('${t.id}')" title="View/Edit Prompts" style="width: 32px; height: 32px; padding: 0;">
                            <i class="fa-solid fa-pencil"></i>
                        </div>
                        <div class="menu_button menu_button_icon interactable" onclick="window.stglLockTemplate('${t.id}')" title="Lock Template to Context" style="width: 32px; height: 32px; padding: 0;">
                            <i class="fa-solid fa-lock"></i>
                        </div>
                        <div class="menu_button menu_button_icon interactable" onclick="window.stglEditTemplate('${t.id}')" title="Edit Template Name/Description" style="width: 32px; height: 32px; padding: 0;">
                            <i class="fa-solid fa-edit"></i>
                        </div>
                        <div class="menu_button menu_button_icon interactable redOverlayGlow" onclick="window.stglDeleteTemplate('${t.id}')" title="Delete Template" style="width: 32px; height: 32px; padding: 0;">
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

/**
 * Setup event handlers for template manager buttons
 */
function setupTemplateManagerEvents() {
    document.getElementById('stgl-create-template')?.addEventListener('click', showCreateTemplateDialog);
    document.getElementById('stgl-import-template')?.addEventListener('click', importTemplate);
    document.getElementById('stgl-export-all')?.addEventListener('click', exportAllTemplates);
}

/**
 * Show create template dialog
 */
async function showCreateTemplateDialog() {
    const content = document.createElement('div');
    content.innerHTML = `
        <div class="flex-container flexFlowColumn flexGap10">
            <label for="stgl-template-name">Template Name:</label>
            <input type="text" id="stgl-template-name" class="text_pole" placeholder="My Custom Template">

            <label for="stgl-template-desc">Description (optional):</label>
            <textarea id="stgl-template-desc" class="text_pole" rows="3" placeholder="Description of this template..."></textarea>

            <p class="text_muted">This will capture all current prompts from the Prompt Manager.</p>
        </div>
    `;

    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Create',
        cancelButton: 'Cancel'
    });

    const result = await popup.show();

    if (result === POPUP_RESULT.AFFIRMATIVE) {
        const name = document.getElementById('stgl-template-name').value.trim();
        const description = document.getElementById('stgl-template-desc').value.trim();

        if (!name) {
            toastr.warning('Template name is required');
            return;
        }

        try {
            const template = window.promptTemplateManager.createFromCurrent(name, description);
            toastr.success('Template created successfully');
            await renderTemplateList();
        } catch (error) {
            toastr.error('Failed to create template: ' + error.message);
        }
    }
}

/**
 * Edit template name/description
 */
window.stglEditTemplate = async function(id) {
    const template = window.promptTemplateManager.getTemplate(id);
    if (!template) {
        toastr.error('Template not found');
        return;
    }

    const content = document.createElement('div');
    content.innerHTML = `
        <div class="flex-container flexFlowColumn flexGap10">
            <label for="stgl-edit-template-name">Template Name:</label>
            <input type="text" id="stgl-edit-template-name" class="text_pole" value="${escapeHtml(template.name)}">

            <label for="stgl-edit-template-desc">Description:</label>
            <textarea id="stgl-edit-template-desc" class="text_pole" rows="3">${escapeHtml(template.description || '')}</textarea>
        </div>
    `;

    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Save',
        cancelButton: 'Cancel'
    });

    const result = await popup.show();

    if (result === POPUP_RESULT.AFFIRMATIVE) {
        const name = document.getElementById('stgl-edit-template-name').value.trim();
        const description = document.getElementById('stgl-edit-template-desc').value.trim();

        if (!name) {
            toastr.warning('Template name is required');
            return;
        }

        template.name = name;
        template.description = description;
        template.updatedAt = new Date().toISOString();

        // Save via storage
        const settings = extension_settings.STGL;
        if (!settings.templates) settings.templates = {};
        settings.templates[template.id] = template;
        saveSettingsDebounced();

        toastr.success('Template updated');
        await renderTemplateList();
    }
};

/**
 * Delete template
 */
window.stglDeleteTemplate = async function(id) {
    const template = window.promptTemplateManager.getTemplate(id);
    if (!template) {
        toastr.error('Template not found');
        return;
    }

    const content = document.createElement('div');
    content.innerHTML = `
        <div class="flex-container flexFlowColumn flexGap10">
            <p>Are you sure you want to delete the template "<strong>${escapeHtml(template.name)}</strong>"?</p>
            <p class="text_muted">This action cannot be undone.</p>
        </div>
    `;

    const result = await callGenericPopup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Delete',
        cancelButton: 'Cancel'
    });

    if (result === POPUP_RESULT.AFFIRMATIVE) {
        if (window.promptTemplateManager.deleteTemplate(id)) {
            toastr.success('Template deleted');
            await renderTemplateList();
        } else {
            toastr.error('Failed to delete template');
        }
    }
};

/**
 * Apply template
 */
window.stglApplyTemplate = async function(id) {
    if (window.promptTemplateManager.applyTemplate(id)) {
        toastr.success('Template applied successfully!');
        if (mainPopup) {
            await mainPopup.completeAffirmative();
        }
    } else {
        toastr.error('Failed to apply template');
    }
};

/**
 * View/edit prompts in template
 */
window.stglViewPrompts = async function(templateId) {
    const template = window.promptTemplateManager.getTemplate(templateId);
    if (!template) {
        toastr.error('Template not found');
        return;
    }

    const prompts = Object.entries(template.prompts).map(([identifier, prompt]) => ({
        identifier,
        name: prompt.name || identifier,
        content: prompt.content || ''
    }));

    const content = document.createElement('div');
    content.innerHTML = `
        <h3>Prompts in "${escapeHtml(template.name)}"</h3>
        <div class="flex-container flexFlowColumn flexGap10 overflowYAuto" style="max-height: 60vh;">
            ${prompts.map(p => `
                <div class="flex-container flexFlowColumn padding10" style="border: 1px solid var(--SmartThemeBorderColor); border-radius: 5px;">
                    <div class="flex-container alignItemsCenter justifySpaceBetween">
                        <strong>${escapeHtml(p.name)}</strong>
                        <small class="text_muted">${p.identifier}</small>
                    </div>
                    <textarea class="text_pole marginTop10" rows="4" readonly>${escapeHtml(p.content)}</textarea>
                </div>
            `).join('')}
        </div>
        <p class="text_muted marginTop10">To edit prompts, apply this template and modify them in SillyTavern's Prompt Manager, then create a new template.</p>
    `;

    await callGenericPopup(content, POPUP_TYPE.TEXT, '', { okButton: 'Close' });
};

/**
 * Lock template to character/model/chat
 */
window.stglLockTemplate = async function(templateId) {
    const template = window.promptTemplateManager.getTemplate(templateId);
    if (!template) {
        toastr.error('Template not found');
        return;
    }

    // We need to call the main STGL lock popup with this template pre-selected
    // But since we're in a separate module, we'll create a simplified lock UI
    const content = document.createElement('div');
    content.innerHTML = `
        <h3>Lock Template: ${escapeHtml(template.name)}</h3>
        <p class="text_muted marginBot10">Save this template as a lock for the current context.</p>

        <div class="flex-container flexFlowColumn flexGap10">
            <button id="stgl-lock-to-character" class="menu_button menu_button_icon">
                <i class="fa-solid fa-user"></i>
                <span>Lock to Current Character/Group</span>
            </button>
            <button id="stgl-lock-to-chat" class="menu_button menu_button_icon">
                <i class="fa-solid fa-comments"></i>
                <span>Lock to Current Chat</span>
            </button>
            <button id="stgl-lock-to-model" class="menu_button menu_button_icon">
                <i class="fa-solid fa-microchip"></i>
                <span>Lock to Current Model</span>
            </button>
        </div>

        <p class="text_muted marginTop10">
            <i class="fa-solid fa-info-circle"></i>
            This will save only the template lock. Use the main Generation Locks menu to lock profile/preset as well.
        </p>
    `;

    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: 'Cancel'
    });

    // Add click handlers
    content.querySelector('#stgl-lock-to-character').addEventListener('click', async () => {
        if (await lockTemplateToContext(templateId, 'character')) {
            await popup.completeAffirmative();
        }
    });
    content.querySelector('#stgl-lock-to-chat').addEventListener('click', async () => {
        if (await lockTemplateToContext(templateId, 'chat')) {
            await popup.completeAffirmative();
        }
    });
    content.querySelector('#stgl-lock-to-model').addEventListener('click', async () => {
        if (await lockTemplateToContext(templateId, 'model')) {
            await popup.completeAffirmative();
        }
    });

    await popup.show();
};

/**
 * Lock template to a specific context dimension
 */
async function lockTemplateToContext(templateId, dimension) {
    // Access STGL's storage and context via window API
    if (!window.stglSettingsManager) {
        toastr.error('STGL not initialized');
        return false;
    }

    try {
        const context = window.stglSettingsManager.chatContext.getCurrent();
        const storage = window.stglSettingsManager.storage;

        // Get existing lock or create new one with only template
        let existingLock = null;
        let key = null;

        if (dimension === 'character') {
            if (context.isGroupChat) {
                key = context.groupId;
                existingLock = storage.getGroupLock(key);
            } else {
                key = context.characterName;
                existingLock = storage.getCharacterLock(key);
            }
        } else if (dimension === 'chat') {
            existingLock = storage.getChatLock();
        } else if (dimension === 'model') {
            key = context.modelName;
            existingLock = storage.getModelLock(key);
        }

        // Merge template into existing lock or create new
        const newLock = existingLock
            ? { ...existingLock, template: templateId }
            : { profile: null, preset: null, template: templateId };

        // Save the lock
        if (dimension === 'character') {
            if (context.isGroupChat) {
                await storage.setGroupLock(key, newLock);
                toastr.success('Template locked to group');
            } else {
                storage.setCharacterLock(key, newLock);
                toastr.success('Template locked to character');
            }
        } else if (dimension === 'chat') {
            storage.setChatLock(newLock);
            toastr.success('Template locked to chat');
        } else if (dimension === 'model') {
            storage.setModelLock(key, newLock);
            toastr.success('Template locked to model');
        }

        await renderTemplateList();
        return true;
    } catch (error) {
        console.error('STGL: Failed to lock template:', error);
        toastr.error('Failed to lock template');
        return false;
    }
}

/**
 * Import template from JSON
 */
async function importTemplate() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (!data.id || !data.name || !data.prompts) {
                throw new Error('Invalid template format');
            }

            const settings = extension_settings.STGL;
            if (!settings.templates) settings.templates = {};
            settings.templates[data.id] = data;
            saveSettingsDebounced();

            toastr.success('Template imported successfully');
            await renderTemplateList();
        } catch (error) {
            toastr.error('Failed to import template: ' + error.message);
        }
    };

    input.click();
}

/**
 * Export all templates to JSON
 */
function exportAllTemplates() {
    const templates = window.promptTemplateManager.listTemplates();

    if (templates.length === 0) {
        toastr.warning('No templates to export');
        return;
    }

    const data = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        templates: templates
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stgl-templates-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toastr.success('Templates exported successfully');
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
