# 🔏 SillyTavern Generation Locks (STGL)

Advanced generation settings management with multi-dimensional locking for connection profiles, generation presets, and completion templates.

## 🎯 Overview

**[📊 See Feature Comparison: STGL vs STCL vs CCPM](./compare.md)**

> **Note:** STGL is ONLY useful for chat-completion and is not at all useful with text-completion.

STGL unifies and extends functionality from:
- Character Locks (STCL): Connection profile + preset management
- CC Prompt Manager (CCPM): Completion template control

It provides a single system to lock three independent items (Profile, Preset, Template) across five dimensions (Character, Model, Chat, Group, Individual-in-Group).

## ✨ Features

### Three Lockable Items
- 🔌 **Connection Profile** — Choose which API connection to use
- 🎚️ **Generation Preset** — Sampling parameters (temperature, top-p, etc.)
- 📄 **Completion Template** — Prompt template structure and order

Each item resolves independently, so winners can come from different dimensions (e.g., Profile from Character/Group, Preset from Chat, Template from Model).

### Lock Dimensions
1. **Character** — Per-character settings (stored by character ID, with a name fallback)
2. **Model** — Per-model settings (preset + template only, no profile)
3. **Chat** — Per-chat overrides
4. **Group** — Group chat settings
5. **Individual (in Groups)** — Individual character settings within group chats (optional overlay)

### Priority Order (Customizable, Non‑Cascading UI)
- Select which dimension has the highest precedence for each lock type using the UI.
- UI presents three selects with the same options: Model, Chat, Character/Group.
- Selections are non‑cascading; duplicates are refused at Save time.
- Default order: Model > Chat > Character/Group.
- In group chats, “Character/Group” refers to Group. The “Individual in Group” option (below) can overlay on top of Group for even more granular control.

### Individual over Group (Groups only)
- **Checkbox:** “In group chats, always prefer individual character settings over group settings” (default: enabled).
- When enabled, individual character locks overlay Group winners at the Character/Group position during generation.
- This overlay does NOT override Chat or Model winners; it only supersedes Group where applicable.
- An inline icon appears in group chats to indicate when this is active.

### Auto‑apply Modes
- **Never:** Manual application only
- **Ask:** Prompt before applying when a change would occur
- **Always:** Apply automatically on context changes

Auto-apply triggers on:
- Character/chat/group changes
- Settings updates
- Other context events

### Race Condition Protection
All lock applications verify the context hasn't changed during async operations, preventing misapplies.

## 📖 Usage

### Open the Lock Manager
Click the 🔒 “Generation Locks” button in the extensions menu (it is the magic wand 🪄 in the text input box on the left).

### Set/Clear/Apply
- **Set Character/Group** — Save current UI settings as Character (single chat) or Group (group chat) lock
- **Set Chat** — Save current UI settings as Chat lock
- **Set Model** — Save current UI settings as Model lock (preset + template only)
- **Clear Character/Group / Chat / Model** — Remove locks for the selected dimension
- **Apply Now** — Apply resolved locks for the active context

### Preferences and Priority
- Show notifications: Toastr success/error messages
- Priority Order: Three selects—Model, Chat, Character/Group (no duplicates)
- In group chats, always prefer individual character settings over group settings: Enabled by default
- Auto‑apply Mode: Never / Ask / Always

## 🧭 Understanding the Display

A persistent status indicator (above the Prompt Manager list) shows current resolved winners:
- Profile (🔌), Preset (🎚️), Template (📄), with the winning source label
- Labels are context-aware:
  - Single chats: sources are Character, Chat, Model
  - Group chats: Character/Group = Group/Character position
- When “Individual over Group” is enabled, a user-lock icon appears with a tooltip explaining the overlay

## 🏗️ Architecture

### Critical Application Order
1. Profile — changes API connection (applied first)
2. Preset — depends on the active connection
3. Template — modifies Prompt Manager state

### Priority Resolution
- Resolver uses your configured order:
  - Single chats: Character/Group = Character
  - Group chats: Character/Group = Group
- Individual overlay (Groups only): applied after resolution, overlays Group winners only if the individual has a value for that item

**Example:**  
Default order Model > Chat > Character/Group, “Individual over Group” enabled:  
If Template winner is Group and the drafted character has an individual Template lock, it overlays the Group winner for Template only.

### Storage
- Character locks: `extension_settings.STGL.characterLocks[chId | nameKey]`
- Model locks: `extension_settings.STGL.modelLocks[modelName]`
- Chat locks: `chat_metadata.STGL`
- Group locks: `group.stgl_locks`
- Templates: `extension_settings.STGL.templates[templateId]`
- Preferences: `extension_settings.STGL.moduleSettings`

## 🔌 Event Handlers

- CHAT_CHANGED — Context change trigger
- GROUP_CHAT_CREATED — Group lifecycle
- GROUP_MEMBER_DRAFTED — Individual overlay (groups only)
- OAI_PRESET_CHANGED_AFTER — Detect preset changes; optionally restore locked template
- SETTINGS_UPDATED — Refresh display
- SETTINGS_LOADED_AFTER — Post‑load initialization
- APP_READY — Bootstrap

## 🐛 Troubleshooting

Enable debug logging by setting `DEBUG_MODE = true` in index.js.

Common checks:
- Nothing applies? Check Auto‑apply Mode (Never, Ask, Always)
- Unexpected winners? Review Priority Order
- Template drift after preset change? In Ask mode, you’ll be prompted; choose accordingly
- Group chat: remember individual overlay only replaces Group winners where the individual has a value

## 📝 Notes

- Locking Modes and “prefer chat over ...” toggles have been removed; use Priority Order selects for all precedence control.
- In group chats, “Character/Group” is Group. “Individual over Group” overlays only Group winners at generation time.

## 🤝 Contributing

This extension is part of the Aikobots suite. Contributions, bug reports, and feature requests are welcome!

## 📜 License

[Add your license here]

## ℹ️ Version

See CHANGELOG.md for recent changes and migration notes.
