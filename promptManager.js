/**
 * SillyTavern Generation Locks - Prompt Template Manager UI
 * Provides UI for creating, editing, and managing prompt templates
 * Adapted from CCPM (CC Prompt Manager)
 */

import { Popup, POPUP_TYPE, POPUP_RESULT, callGenericPopup } from '../../../popup.js';

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
                        <div class="menu_button menu_button_icon interactable stgl-apply-btn" data-template-id="${escapeHtml(t.id)}" title="Apply Template" style="width: 32px; height: 32px; padding: 0;">
                            <i class="fa-solid fa-play"></i>
                        </div>
                        <div class="menu_button menu_button_icon interactable stgl-view-prompts-btn" data-template-id="${escapeHtml(t.id)}" title="View/Edit Prompts" style="width: 32px; height: 32px; padding: 0;">
                            <i class="fa-solid fa-pencil"></i>
                        </div>
                        <div class="menu_button menu_button_icon interactable stgl-lock-btn" data-template-id="${escapeHtml(t.id)}" title="Lock Template to Context" style="width: 32px; height: 32px; padding: 0;">
                            <i class="fa-solid fa-lock"></i>
                        </div>
                        <div class="menu_button menu_button_icon interactable stgl-edit-btn" data-template-id="${escapeHtml(t.id)}" title="Edit Template Name/Description" style="width: 32px; height: 32px; padding: 0;">
                            <i class="fa-solid fa-edit"></i>
                        </div>
                        <div class="menu_button menu_button_icon interactable redOverlayGlow stgl-delete-btn" data-template-id="${escapeHtml(t.id)}" title="Delete Template" style="width: 32px; height: 32px; padding: 0;">
                            <i class="fa-solid fa-trash"></i>
                        </div>
                    </div>
                </div>
                ${t.description ? `<div class="text_muted fontsize90p marginBot10">${escapeHtml(t.description)}</div>` : ''}
                <div class="flex-container flexWrap flexGap5">
                    ${Object.keys(t.prompts).map(identifier =>
                        `<span class="fontsize80p padding5 toggleEnabled" style="border-radius: 12px;">${escapeHtml(identifier)}</span>`
                    ).join('')}
                </div>
            </div>
        `;
    }).join('');

    // Attach event listeners after rendering
    document.querySelectorAll('.stgl-apply-btn').forEach(button => {
        button.addEventListener('click', () => {
            const templateId = button.dataset.templateId;
            window.stglApplyTemplate(templateId);
        });
    });

    document.querySelectorAll('.stgl-view-prompts-btn').forEach(button => {
        button.addEventListener('click', () => {
            const templateId = button.dataset.templateId;
            window.stglViewPrompts(templateId);
        });
    });

    document.querySelectorAll('.stgl-lock-btn').forEach(button => {
        button.addEventListener('click', () => {
            const templateId = button.dataset.templateId;
            window.stglLockTemplate(templateId);
        });
    });

    document.querySelectorAll('.stgl-edit-btn').forEach(button => {
        button.addEventListener('click', () => {
            const templateId = button.dataset.templateId;
            window.stglEditTemplate(templateId);
        });
    });

    document.querySelectorAll('.stgl-delete-btn').forEach(button => {
        button.addEventListener('click', () => {
            const templateId = button.dataset.templateId;
            window.stglDeleteTemplate(templateId);
        });
    });
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

        // Update template using the central API
        window.promptTemplateManager.updateTemplate(template.id, {
            name: name,
            description: description
        });

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

    // Build list ordered by promptOrder if available
    let orderedPrompts = [];
    if (template.promptOrder && Array.isArray(template.promptOrder) && template.promptOrder.length > 0) {
        orderedPrompts = template.promptOrder
            .map(entry => template.prompts[entry.identifier])
            .filter(prompt => prompt);
    } else {
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

            <ul id="stgl-prompt-order-list" class="text_pole" style="list-style: none; padding: 0; margin: 0; max-height: 60vh; overflow-y: auto;">
                <li class="completion_prompt_manager_list_head">
                    <span>Name</span>
                    <span></span>
                    <span>Role</span>
                </li>
                <li style="grid-column: 1 / -1; margin: 0.5em 0;">
                    <hr style="width: 100%; background: var(--SmartThemeBorderColor);">
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

                    const nameDisplay = isMarker
                        ? `<span title="${escapeHtml(prompt.name || prompt.identifier)}">${escapeHtml(prompt.name || prompt.identifier)}</span>`
                        : `<a class="stgl-expand-prompt" data-identifier="${escapeHtml(prompt.identifier)}">${escapeHtml(prompt.name || prompt.identifier)}</a>`;

                    const editButton = !isMarker
                        ? `<span class="stgl-edit-prompt fa-solid fa-pencil fa-xs" data-identifier="${escapeHtml(prompt.identifier)}" title="Edit prompt" style="margin-left: 8px; opacity: 0.4; cursor: pointer;"></span>`
                        : '';

                    return `
                        <li class="completion_prompt_manager_prompt completion_prompt_manager_prompt_draggable ${isMarker ? 'ccpm_prompt_manager_marker' : ''}" data-identifier="${escapeHtml(prompt.identifier)}">
                            <span class="drag-handle">☰</span>
                            <span class="completion_prompt_manager_prompt_name">
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
                            <span class="stgl_prompt_role">${escapeHtml(prompt.role || 'system')}</span>
                        </li>
                        ${!isMarker ? `
                            <li class="inline-drawer stgl_prompt_drawer" data-identifier="${escapeHtml(prompt.identifier)}" style="grid-column: 1 / -1; margin: 0 0 10px 30px;">
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
            // Setup click handlers for expanding/collapsing prompts
            document.querySelectorAll('.stgl-expand-prompt').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const identifier = link.dataset.identifier;
                    const drawerContent = document.querySelector(`.stgl_prompt_drawer[data-identifier="${identifier}"] .inline-drawer-content`);
                    if (drawerContent) {
                        const isVisible = drawerContent.style.display !== 'none';
                        drawerContent.style.display = isVisible ? 'none' : 'block';
                    }
                });
            });

            // Setup click handlers for editing prompts
            document.querySelectorAll('.stgl-edit-prompt').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const identifier = btn.dataset.identifier;
                    window.stglEditPromptInTemplate(templateId, identifier);
                });
            });

            // Make the list sortable using jQuery UI
            $('#stgl-prompt-order-list').sortable({
                delay: 30,
                handle: '.drag-handle',
                items: '.completion_prompt_manager_prompt_draggable',
                update: function() {
                    // Order changed - will be saved if user clicks Save
                }
            });
        },
        onClosing: async (popup) => {
            if (popup.result === POPUP_RESULT.AFFIRMATIVE) {
                // Save the new order
                const newOrder = [];
                document.querySelectorAll('.completion_prompt_manager_prompt_draggable').forEach(li => {
                    const identifier = li.dataset.identifier;
                    const originalEntry = template.promptOrder?.find(e => e.identifier === identifier);
                    newOrder.push({
                        identifier: identifier,
                        enabled: originalEntry?.enabled ?? true
                    });
                });

                // Update template's promptOrder
                window.promptTemplateManager.updateTemplate(templateId, {
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
window.stglEditPromptInTemplate = async function(templateId, promptIdentifier) {
    const template = window.promptTemplateManager.getTemplate(templateId);
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
    clonedForm.id = 'stgl_temp_edit_form';
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

        // Save template using the central API
        window.promptTemplateManager.saveTemplate(template);

        toastr.success('Prompt updated in template');

        // Refresh the viewer
        await window.stglViewPrompts(templateId);
    }
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

            // Save imported template using the central API
            window.promptTemplateManager.saveTemplate(data);

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
