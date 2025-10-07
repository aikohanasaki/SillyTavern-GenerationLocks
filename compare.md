# Feature Comparison: STGL vs STCL vs CCPM

**[⬅️ Back to STGL README (full usage & setup)](./README.md)**

This document compares the capabilities and design of SillyTavern Generation Locks (STGL), SillyTavern Character Locks (STCL), and CC Prompt Manager (CCPM). It is intended to help users understand the evolution of SillyTavern's generation settings management and decide which system best fits their needs.

> **Note:** Both STGL and CCPM are ONLY useful for chat-completion and are not at all useful with text-completion.

---

## 📝 Overview

| Feature / System                | STGL (Generation Locks)  | STCL (Character Locks) | CCPM (CC Prompt Manager) |
|---------------------------------|:------------------------:|:----------------------:|:------------------------:|
| **Chat Completion**        | Yes                      | Yes                     | Yes                     |
| **Text Completion**        | No                      | Yes                     | No                     |
| **Lockable Items**              | Profile, Preset, Prompt Template| Profile, Preset        | Prompt Template                |
| **Multi-Dimensional Locking**   | Yes (5 dimensions)       | Yes (4 dimensions)          | Yes (Character/Chat)    |
| **Dimensions**                  | Character, Model, Chat, Group, Individual-in-Group | Character, Chat, Group, Individual-in-Group  | Character, Chat         |
| **Custom Priority Order**       | Yes  | Yes             | Yes              |
| **Individual-over-Group Overlay** | Yes (optional, flexible)| Yes                     | No                      |
| **Auto-Apply Modes**            | Never, Ask, Always       | Never, Ask, Always  | Never, Ask, Always |
| **Unified UI**                  | Split (2 modules)  | Yes                     | No                      |
| **Status Indicator**            | Yes (detailed, icons)    | No                     | No                      |
| **Migration Support**           | Yes (from STCL/CCPM)     | N/A                    | N/A                     |
| **Chat Completion Prompt Template Management**         | Global, reusable         | N/A                    | Global, reusable      |
| **Group Chat Support**          | Full (Group & Individual)| Full (Group & Individual) | Limited                 |
| **Preference Settings**         | Flexible, persistent     | Flexible, persistent | Persistent                 |
| **Active Maintenance**          | Yes (active development)        | Bugfixes only            | Bugfixes only             |

---

## 🔍 Key Differences

### STGL (Generation Locks)
> **Only for chat-completion models. Not compatible with text-completion models.**

- **Unified System:** Combines all locking and template management into a single extension.
- **Three Lockable Items:** Profile (API connection), Preset (generation params), Template (prompt structure).
- **Five Dimensions:** Allows locks by Character, Model, Chat, Group, and Individual-in-Group (for group chats).
- **Custom Priority:** User chooses priority order for lock resolution (e.g., Model > Chat > Character/Group).
- **Individual-over-Group Overlay:** In group chats, optionally overlay individual character locks over group settings.
- **Auto-Apply:** Flexible modes (Never, Ask, Always) for lock application on context change.
- **Robustness:** Race condition protection ensures settings are not misapplied during context switches.
- **UI/UX:** Unified management popup, persistent status indicator with icons, and clear feedback.

### STCL (Character Locks)
- **Split Focus:** Handles Profile and Preset locking, no template management.
- **Limited Dimensions:** Supports Character, Chat, and Group locking with a fixed priority order.
- **No Overlay:** Cannot overlay individual character settings within group chats.
- **UI:** Separate management interface, less intuitive than STGL.
- **Legacy:** No new features or maintenance; recommended to migrate to STGL.

### CCPM (CC Prompt Manager)
> **Only for chat-completion models. Not compatible with text-completion models.**

- **Template-Only:** Locks only completion templates (prompt layouts), no profile or preset support.
- **Limited Dimensions:** Locks per Character or Chat, with fixed resolution order.
- **No Overlay:** No support for individual/group overlays.
- **UI:** Standalone template management (not unified with other locks).
- **Legacy:** Deprecated in favor of STGL's integrated approach.

---

## 🚀 Migration & Recommendations

- **STGL is the recommended and actively maintained solution.** It covers all use cases from both STCL and CCPM, and adds new features for advanced users.
- Migration from STCL and CCPM is automatic; existing locks are imported when you switch.
- Users benefit from a single, flexible UI and robust, context-aware locking logic.
- For template sharing or updating, STGL allows global templates to be reused and updated across multiple characters, chats, or models.

---

## 🏁 Summary

- **STGL**: One unified, powerful, and user-friendly extension for all generation locking needs.
- **STCL/CCPM**: Legacy systems with limited scope and no ongoing updates.

**If you are starting new or want the best experience, use STGL.**
