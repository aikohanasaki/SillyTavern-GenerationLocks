# SillyTavern Generation Locks (STGL)

Advanced generation settings management with multi-dimensional locking for connection profiles, generation presets, and completion templates.

## 🎯 Overview

Generation Locks unifies and extends functionality from:
- Character Locks (STCL) — Connection profile + preset management
- CC Prompt Manager (CCPM) — Completion template control

The result is a single system that can lock three independent items (Profile, Preset, Template) across five dimensions (Character, Model, Chat, Group, Individual-in-Group).

## ✨ Features

### Three Lockable Items
- 🔌 Connection Profile — Which API connection to use
- 🎚️ Generation Preset — Sampling parameters (temperature, top-p, etc.)
- 📄 Completion Template — Prompt template structure and order

Each item resolves independently so winners can come from different dimensions (e.g., Profile from Character/Group, Preset from Chat, Template from Model).

### Lock Dimensions
1. Character — Per-character settings (stored by character ID, with a name fallback)
2. Model — Per-model settings (preset + template only, no profile)
3. Chat — Per-chat overrides
4. Group — Group chat settings
5. Individual (in Groups) — Individual character settings within group chats (optional overlay, see below)

### Priority Order (Non‑cascading UI, save‑time validation)
- The priority order selects which dimension has higher precedence when resolving each item.
- UI presents three selects with the same options: Model, Chat, Character/Group.
- The selects are intentionally non‑cascading; duplicates are refused at Save time.
- Default order: Model > Chat > Character/Group.
- In group chats, “Character/Group” refers to Group. The “Individual in Group” behavior (below) can optionally overlay on top of Group.

### Individual over Group (Groups only)
- Checkbox: “In group chats, always prefer individual character settings over group settings” (default: enabled).
- Behavior: When a group member is drafted during generation, individual character locks overlay only over Group winners at the Character/Group position.
- This overlay does NOT override Chat or Model winners; it only supersedes Group where applicable.
- A small inline icon is shown in the status indicator when enabled in group chats.

### Auto‑apply Modes
- Never — Manual application only
- Ask — Prompt before applying when a change would occur
- Always — Apply automatically on context changes

Triggers on:
- Character/chat/group changes
- Settings updates (SETTINGS_UPDATED)
- Other context events (see Event Handlers)

### Race Condition Protection
All apply operations verify the context did not change during async operations to avoid applying settings to the wrong context.

## 🚀 Installation

1) Navigate to your SillyTavern extensions directory:
   SillyTavern/public/scripts/extensions/third-party/

2) Clone or download this extension:
   git clone https://github.com/Aikobots/SillyTavern-GenerationLocks

3) Restart SillyTavern or reload extensions

4) Look for the 🔒 “Generation Locks” button in the extensions menu

## 📖 Usage

### Open the Lock Manager
Click the 🔒 “Generation Locks” button in the extensions menu.

### Set/Clear/Apply
- ✔️ Set Character/Group — Save current UI settings as Character (single chat) or Group (group chat) lock
- ✔️ Set Chat — Save current UI settings as Chat lock
- ✔️ Set Model — Save current UI settings as Model lock (preset + template only)
- ❌ Clear Character/Group / Chat / Model — Clear locks for the selected dimension
- 🔄 Apply Now — Apply currently resolved locks for the active context

### Preferences and Priority
- Show notifications — Toastr success/error messages
- Priority Order — Three selects: Model, Chat, Character/Group (non‑cascading; duplicates refused on Save)
- In group chats, always prefer individual character settings over group settings — Enabled by default
- Auto‑apply Mode — Never / Ask / Always

## 🧭 Understanding the Display

A persistent status indicator (above the Prompt Manager list) shows current resolved winners:
- Profile (🔌), Preset (🎚️), Template (📄), with the winning source label
- Labels are context‑aware:
  - Single chats: sources shown as Character, Chat, Model
  - Group chats: Character/Group is used for the Group/Character position
- When “Individual over Group” is enabled in a group chat, a small user‑lock icon appears with a tooltip explaining that individual overrides can overlay Group winners only

## 🏗️ Architecture

### Critical Application Order
1. Profile — changes API connection (must be first)
2. Preset — depends on the active connection
3. Template — modifies Prompt Manager state

### Priority Resolution
- The resolver uses the configured priority order:
  - Single chats: Character/Group corresponds to Character
  - Group chats: Character/Group corresponds to Group
- Individual overlay (Groups only): applied during GROUP_MEMBER_DRAFTED, after resolution, and only overlays Group winners where the individual has a value for the given item

Example (Group chat, default order Model > Chat > Character/Group, “Individual over Group” enabled):
- Winners from cascade determined among: Model, Chat, Group
- If Template winner is Group and the drafted character has an individual Template lock, it overlays the Group winner for Template only
- Winners from Model or Chat are not affected by the individual overlay

### Storage
- Character locks: extension_settings.STGL.characterLocks[chId | nameKey]
- Model locks: extension_settings.STGL.modelLocks[modelName]
- Chat locks: chat_metadata.STGL
- Group locks: group.stgl_locks
- Templates: extension_settings.STGL.templates[templateId]
- Preferences: extension_settings.STGL.moduleSettings

## 🔌 Event Handlers

- CHAT_CHANGED — Context change trigger
- GROUP_CHAT_CREATED — Group lifecycle
- GROUP_MEMBER_DRAFTED — Individual overlay application (groups only)
- OAI_PRESET_CHANGED_AFTER — Detect preset changes; optionally restore locked template
- SETTINGS_UPDATED — Refresh display
- SETTINGS_LOADED_AFTER — Post‑load initialization hook
- APP_READY — Bootstrap

## 🐛 Troubleshooting

Enable debug logging: set DEBUG_MODE = true in index.js.

Common checks:
- Nothing applies? Verify Auto‑apply Mode (Never vs Ask vs Always)
- Unexpected winners? Review your Priority Order
- Template drift after preset change? You’ll be prompted to restore the locked template (Ask mode); choose accordingly
- Group chat behavior: remember individual overlay only replaces Group winners where the individual has a value

## 📝 Notes

- Locking Modes have been removed. Use the Priority Order selects instead.
- Legacy “prefer chat over …” toggles have been removed; precedence is controlled solely by Priority Order.
- In group chats, “Character/Group” represents the Group dimension. The “Individual over Group” option only overlays Group winners at generation time.

## 🤝 Contributing

This extension is part of the Aikobots suite. Contributions, bug reports, and feature requests are welcome!

## 📜 License

[Add your license here]

## ℹ️ Version

See CHANGELOG.md for recent changes and migration notes.
