# Changelog - SillyTavern Generation Locks (STGL)

## [1.0.0] - 2025-10-02

### 🎉 Initial Release

Complete implementation of Generation Locks system merging functionality from:
- **SillyTavern-CharacterLocks** (STCL) - Connection profile + preset locking
- **SillyTavern-CCPromptManager** (CCPM) - Completion template management

### ✨ Core Features

#### Multi-Dimensional Locking System
- **Three lockable items**: Connection Profile, Generation Preset, Completion Template
- **Independent item resolution**: Each item finds its own winner through priority cascade
- **Five lock dimensions**: Character, Model, Chat, Group, Individual (in groups)
- **Flexible priority system**: Two locking modes + multiple preference toggles

#### Lock Dimensions
1. **Character Locks** - Per-character settings (stored by character ID)
2. **Model Locks** - Per-model settings (preset + template only, no profile)
3. **Chat Locks** - Per-chat overrides
4. **Group Locks** - Group chat settings
5. **Individual Locks** - Individual character settings within groups (optional)

#### Priority Resolution
- **Locking Mode Toggle**: Character/Group mode OR Model mode
- **3-way priority cascade**: Character/Group/Model vs Chat with bidirectional preferences
- **Preference toggles**:
  - Prefer chat over character/group
  - Prefer chat over model
  - Prefer individual character in group (for group chats)
- **Independent item resolution**: Profile, Preset, and Template each resolve separately

#### Auto-Apply System
- **Three modes**: Never / Ask / Always
- **Context-aware**: Triggers on character/chat/group changes
- **Race condition protection**: Validates context before applying
- **Debounced queue**: Handles rapid context changes gracefully

#### User Interface
- **Lock management popup**: Handlebars-based interface with CCPM + STCL styling
- **Current locks display**: Shows active locks for all dimensions
- **Persistent status indicator**: Shows active locks in extensions menu
- **Preferences UI**: Checkboxes and radio buttons for all settings
- **"Apply Now" button**: Manual lock application

### 🏗️ Architecture

#### Section 1: Core Classes
- `ChatContext` - Context detection for single/group chats
- `StorageAdapter` - Unified storage for all lock types
- `PriorityResolver` - Complex priority cascade logic

#### Section 2: Locker Classes
- `ProfileLocker` - Connection profile switching via `/profile`
- `PresetLocker` - Generation preset switching via `/preset`
- `TemplateLocker` - Template switching (stub for future CCPM integration)

#### Section 3: SettingsManager
- Main orchestrator coordinating all components
- Critical application order: Profile → Preset → Template
- Queue-based context change handling

#### Section 4: Event Handlers
- 7 event handlers for comprehensive ST integration
- Persistent display updates
- Individual character lock support in groups

#### Section 5: UI & Popup Management
- Handlebars templates
- Lock management interface
- Menu button injection

#### Section 6: Initialization
- APP_READY event handling
- Component wiring
- Fallback initialization

### 🔒 Security & Stability

- **Race condition protection**: All apply methods validate context hasn't changed
- **Error handling**: Comprehensive try-catch blocks throughout
- **Debug mode**: Conditional logging for troubleshooting
- **Graceful degradation**: Fallbacks for missing features

### 📝 Key Decisions

- Single-file architecture (1,758 lines)
- Multi-item lock structure: `{ profile, preset, template }`
- Profile → Preset → Template application order (CRITICAL)
- ChId-based character storage with name fallback
- Profile locks excluded from model dimension
- Chat Completion only (no Text Completion)
- Explicit null values allowed (intentional unset)
- Empty lock names rejected on save

#### Save/Clear UI (v1.0.0 Complete)
- **Set Character/Group** - Save current settings as character/group lock
- **Set Chat** - Save current settings as chat lock
- **Set Model** - Save current settings as model lock
- **Clear buttons** - Clear locks for each dimension
- **Context-aware buttons** - Different buttons for single/group chats
- **Toastr notifications** - Success/error feedback
- **Popup refresh** - Auto-refresh after save/clear

### 🚀 Future Enhancements

- [ ] Template manager lazy-loading integration
- [ ] Migration from STCL/CCPM
- [ ] Conflict resolution UI warnings
- [ ] Export/Import lock configurations
- [ ] Visual lock indicators in chat interface

---

**Total Implementation**: 2,049 lines across 6 major sections
**Development Time**: Single session (2025-10-02)
**Status**: Ready for testing and deployment
