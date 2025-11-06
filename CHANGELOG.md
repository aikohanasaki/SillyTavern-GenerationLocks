# Changelog - SillyTavern Generation Locks (STGL)

## [1.2.1] - 2025-11-06
### Bugfix
- fix Z-index for prompt templates popup

## [1.2.0] - 2025-10-30
### Enhancement
- add generation start lock check/apply

## [1.1.1] - 2025-10-29
### Changed
- fixed button wrapping in chat mode

## [1.1.0] - 2025-10-06
### Changed
- STGL is now stable and recommended for all users; removed WIP/beta warnings from documentation.
- README.md fully rewritten for end users to reflect current feature set, locking dimensions, auto-apply logic, and stable status.
- Minor documentation clarifications for troubleshooting and installation.

### Compatibility
- No breaking changes. All migration and lock manager logic remains fully backward compatible.

---

## [1.0.1] - 2025-10-04
### Changed
- Priority labeling unified in group contexts:
  - All user-facing labels now show “Character/Group” when in group chats (status indicator, auto-apply confirmation, preset-restore prompt).
- Priority order UI clarified and simplified:
  - Three non-cascading selects with options: Model, Chat, Character/Group.
  - Duplicates are refused at Save time; popup remains open and shows a toast.
  - Default order remains: Model > Chat > Character/Group.
- Individual-over-Group behavior refined:
  - Applies only when “In group chats, always prefer individual character settings over group settings” is enabled.
  - Overlays individual character values ONLY over Group winners (at the Character/Group position).
  - Does NOT override Chat or Model winners.
  - Applied at GROUP_MEMBER_DRAFTED (generation time), not in the general resolver cascade.

### Removed
- Locking Modes (documentation/UI): the system no longer exposes or references “Character/Group mode” or “Model mode”.
- INDIVIDUAL leg from the resolver’s cascade: per-character overlay in groups is handled post-resolution during the drafting event instead.

### Docs
- README updated to reflect:
  - Removal of Locking Modes.
  - Non-cascading priority selects with save-time uniqueness validation.
  - The Individual-over-Group overlay semantics (Group-only overlay, gated by the checkbox).
  - Context-aware labeling (“Character/Group”).

### Internal
- PriorityResolver._buildCascade no longer injects INDIVIDUAL for group contexts.
- onGroupMemberDrafted now merges individual locks onto resolved winners, overlaying only items whose winner is Group.
- Tooltips and messages updated to reflect the Group-only overlay constraint.

### Migration
- No changes. Existing migration from STCL/CCPM remains intact.

### Compatibility
- No breaking API changes. Behavior change: individual overlays no longer supersede Model/Chat winners in group chats; they only supersede Group where present.

---

## [1.0.0] - 2025-10-02
### 🎉 Initial Release

Complete implementation of Generation Locks system merging functionality from:
- SillyTavern-CharacterLocks (STCL) — Connection profile + preset locking
- SillyTavern-CCPromptManager (CCPM) — Completion template management

### ✨ Core Features

#### Multi-Dimensional Locking System
- Three lockable items: Connection Profile, Generation Preset, Completion Template
- Independent item resolution: Each item finds its own winner through priority cascade
- Five lock dimensions: Character, Model, Chat, Group, Individual (in groups)

#### Lock Dimensions
1. Character — Per-character settings (stored by character ID)
2. Model — Per-model settings (preset + template only, no profile)
3. Chat — Per-chat overrides
4. Group — Group chat settings
5. Individual — Individual character settings within groups (optional)

#### Auto-Apply System
- Three modes: Never / Ask / Always
- Context-aware: Triggers on character/chat/group changes
- Race condition protection: Validates context before applying
- Debounced queue: Handles rapid context changes gracefully

#### User Interface
- Lock management popup (Handlebars-based)
- Current locks display for all dimensions
- Persistent status indicator
- Preferences and Apply Now controls

### 🏗️ Architecture

- ChatContext / StorageAdapter / PriorityResolver
- ProfileLocker (/profile), PresetLocker (/preset), TemplateLocker
- SettingsManager orchestrates resolution and application
- Event handlers for deep integration
- APP_READY bootstrap

### 🔒 Security & Stability

- Context validation during async applies
- Robust error handling
- DEBUG mode logging
- Graceful degradation

### Key Decisions
- Critical application order: Profile → Preset → Template
- Model dimension excludes Profile
- Character storage by chId with name fallback
- Explicit nulls allowed; empty names rejected

### Future Enhancements
- Template manager lazy-loading
- Migration helpers and conflict UI
- Export/Import
- Visual indicators in chat
