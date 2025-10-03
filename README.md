# SillyTavern Generation Locks (STGL)

Advanced generation settings management with multi-dimensional locking for connection profiles, generation presets, and completion templates.

## 🎯 Overview

**Generation Locks** merges and extends functionality from two powerful extensions:
- **Character Locks (STCL)** - Connection profile + preset management
- **CC Prompt Manager (CCPM)** - Completion template control

The result is a unified system that locks **three independent items** (Profile, Preset, Template) across **five dimensions** (Character, Model, Chat, Group, Individual).

## ✨ Features

### Multi-Dimensional Locking

Lock your generation settings across multiple dimensions:

1. **Character Locks** - Remember settings per character
2. **Model Locks** - Remember settings per AI model (preset + template only)
3. **Chat Locks** - Override settings for specific chats
4. **Group Locks** - Settings for group chats
5. **Individual Locks** - Individual character settings within groups (optional)

### Three Lockable Items

Each dimension can lock up to three items independently:

- 🔌 **Connection Profile** - Which API connection to use
- 🎚️ **Generation Preset** - Sampling parameters (temperature, top-p, etc.)
- 📄 **Completion Template** - Prompt template structure

### Flexible Priority System

**Locking Modes:**
- **Character/Group Mode** - Prioritize character/group settings
- **Model Mode** - Prioritize model-specific settings

**Priority Toggles:**
- Prefer chat over character/group
- Prefer chat over model
- Prefer individual character in group

**Independent Resolution:**
Each item (profile, preset, template) finds its own winner through the priority cascade. This means:
- Profile might come from Character
- Preset might come from Chat
- Template might come from Model

All applied together in one cohesive configuration.

### Auto-Apply System

**Three modes:**
- **Never** - Manual application only
- **Ask** - Prompt before applying
- **Always** - Automatic application

Triggers automatically when you:
- Switch characters
- Switch chats
- Create/enter group chats
- Change settings (with SETTINGS_UPDATED event)

### Race Condition Protection

All lock applications validate that the context hasn't changed during async operations, preventing wrong settings from being applied when switching contexts rapidly.

## 🚀 Installation

1. Navigate to your SillyTavern extensions directory:
   ```
   SillyTavern/public/scripts/extensions/third-party/
   ```

2. Clone or download this extension:
   ```bash
   git clone https://github.com/Aikobots/SillyTavern-GenerationLocks
   ```

3. Restart SillyTavern or reload extensions

4. Look for the 🔒 **Generation Locks** button in the extensions menu

## 📖 Usage

### Opening the Lock Manager

Click the 🔒 **Generation Locks** button in the extensions menu to open the lock management interface.

### Setting Locks

**v1.0.0 Complete UI:**
- ✅ **Set Character/Group** - Save current UI settings as character/group lock
- ✅ **Set Chat** - Save current UI settings as chat lock
- ✅ **Set Model** - Save current UI settings as model lock (preset + template only)
- ✅ **Clear buttons** - Clear locks for each dimension individually
- ✅ **Apply Now** - Manually apply locks for current context
- ✅ View current locks for all dimensions
- ✅ Configure preferences and priority settings

**Future enhancements:**
- Lock editing interface
- Visual conflict warnings
- Bulk operations

### Understanding the Display

The persistent status indicator shows active locks:
- 🔌 Connection Profile name
- 🎚️ Generation Preset name
- 📄 Completion Template name

### Preferences

**Memory Settings:**
- ☑️ Remember per character/group
- ☑️ Remember per chat
- ☑️ Remember per model

**Priority Settings:**
- ☑️ Prefer chat over character/group
- ☑️ Prefer chat over model
- ☑️ Prefer individual character in group

**Auto-Apply Mode:**
- ⭕ Never auto-apply
- ⭕ Ask before applying
- ⭕ Always auto-apply

**Locking Mode:**
- ⭕ Character/Group mode
- ⭕ Model mode

## 🏗️ Architecture

### Application Order (CRITICAL)

Locks are always applied in this order:
1. **Profile** (changes API connection)
2. **Preset** (depends on active connection)
3. **Template** (modifies prompt manager)

This order is critical because:
- Presets are connection-specific
- Templates modify the prompt structure for the current connection

### Priority Cascade Example

**Scenario:** Character mode with "Prefer chat over character" enabled

**Cascade order:** Chat → Character → Model

**Resolution:**
- Profile: Found in Character → Use Character's profile
- Preset: Found in Chat → Use Chat's preset
- Template: Found in Model → Use Model's template

**Result:** Three different sources, one cohesive configuration!

### Storage

- **Character locks**: `extension_settings.STGL.characterLocks[chId]`
- **Model locks**: `extension_settings.STGL.modelLocks[modelName]`
- **Chat locks**: `chat_metadata.STGL`
- **Group locks**: `group.stgl_locks`

## 🔧 Technical Details

**Total Code:** 1,758 lines across 6 sections
**Dependencies:** None (uses ST's built-in libraries)
**Compatibility:** SillyTavern Chat Completion mode

### Event Handlers

- `CHAT_CHANGED` - Main context change trigger
- `GROUP_CHAT_CREATED` - Group support
- `GROUP_MEMBER_DRAFTED` - Individual locks in groups
- `OAI_PRESET_CHANGED_AFTER` - Manual preset change detection
- `SETTINGS_UPDATED` - Display refresh
- `SETTINGS_LOADED_AFTER` - Initialization timing
- `APP_READY` - Bootstrap

## 🐛 Troubleshooting

### Enable Debug Mode

Set `DEBUG_MODE = true` in `index.js` line 21 to see detailed console logging.

### Common Issues

**Locks not applying:**
- Check auto-apply mode (might be set to "Never")
- Verify the lock dimension is enabled in preferences
- Check browser console for errors

**Wrong settings applied:**
- Review your priority settings
- Check which dimension won in the console (DEBUG_MODE)
- Verify lock values are correct

**UI not showing:**
- Check that the extension loaded (look for "STGL: Module loaded" in console)
- Refresh SillyTavern
- Check for conflicts with other extensions

## 📝 Future Plans

- [ ] Template manager integration (lazy-loaded)
- [ ] Migration tool from STCL/CCPM
- [ ] Save/Clear buttons in UI
- [ ] Conflict resolution warnings
- [ ] Export/Import configurations
- [ ] Visual lock indicators in chat

## 🤝 Contributing

This extension is part of the Aikobots suite. Contributions, bug reports, and feature requests are welcome!

## 📜 License

[Add your license here]

## 🙏 Credits

Built by combining and extending:
- **SillyTavern-CharacterLocks** - Connection profile management
- **SillyTavern-CCPromptManager** - Template management

---

**Version:** 1.0.0
**Author:** Aikobots
**Status:** Ready for testing
