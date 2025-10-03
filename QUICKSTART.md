# Quick Start Guide - Generation Locks

## 5-Minute Setup

### 1. Installation ✅

Already installed! You're ready to go.

### 2. Open the Extension 🔒

Click the **🔒 Generation Locks** button in the extensions menu (press ESC to open extensions panel).

### 3. Configure Basic Settings ⚙️

In the popup:
- ✅ Check "Remember per character"
- ✅ Check "Remember per chat" (optional)
- ✅ Select "Ask before applying" for auto-apply mode
- ✅ Select "Character/Group mode" for locking mode

Click "Close" to save.

### 4. How It Works 🎯

**The Three Items:**
- 🔌 **Profile** - Your API connection (OpenAI, Claude, etc.)
- 🎚️ **Preset** - Sampling settings (temperature, top-p, etc.)
- 📄 **Template** - Prompt structure (coming soon)

**What Happens:**
1. Switch to a character
2. STGL asks "Apply locks for [character]?"
3. Say "Yes" or "No"
4. If locks exist, they're applied automatically
5. Status indicator shows what's active

### 5. Creating Locks ✔️

**The easy way (via UI):**
1. Open your character chat
2. Configure your desired settings:
   - Switch to preferred connection profile
   - Select preferred generation preset
   - (Template support coming soon)
3. Open **🔐 Generation Locks** popup
4. Click the button for what you want to save:
   - **✔️ Set Character** - Locks for this character
   - **✔️ Set Chat** - Locks for this chat only
   - **✔️ Set Model** - Locks for the current AI model
5. Done! The locks are saved.

**Clearing locks:**
- **❌ Clear Character** - Removes character locks
- **❌ Clear Chat** - Removes chat locks
- **❌ Clear Model** - Removes model locks

### 6. Example Workflow 📝

**Scenario:** You want GPT-4 to always use a specific preset.

1. Switch to any chat using GPT-4
2. Select your desired preset
3. Open Generation Locks popup
4. Click **✔️ Set Model**
5. Done! Now whenever you use GPT-4, that preset is locked.

**Scenario:** You want a specific character to use Claude.

1. Open that character's chat
2. Switch connection profile to Claude
3. Select your preferred Claude preset
4. Open Generation Locks popup
5. Click **✔️ Set Character**
6. Done! This character always uses Claude with that preset.

### 7. Testing 🧪

**Test auto-apply:**
1. Set auto-apply to "Always"
2. Switch between characters
3. Watch the status indicator update
4. Check console (DEBUG_MODE) to see what's happening

**Test manual apply:**
1. Set auto-apply to "Never"
2. Open Generation Locks popup
3. Click "Apply Now"
4. Check if your settings changed

### 8. Troubleshooting 🔍

**Enable debug logging:**
Edit `index.js` line 21:
```javascript
const DEBUG_MODE = true;  // Change from false
```

**Check console:**
- Open browser DevTools (F12)
- Look for messages starting with "STGL:"
- Watch for errors or warnings

**Common issues:**
- "Locks not applying" → Check auto-apply mode
- "Wrong settings" → Review priority settings
- "Nothing happening" → Check console for errors

### 9. What's Next? 🚀

**Future Enhancements:**
- Template manager integration
- Migration from STCL/CCPM
- Conflict warnings in UI
- Export/Import configurations
- Visual lock indicators
- Advanced priority options

### 10. Need Help? 💬

**Resources:**
- Full documentation: `README.md`
- Change history: `CHANGELOG.md`
- Architecture details: `.claude/SESSION_END_SUMMARY.md`

**Debug checklist:**
1. ✅ DEBUG_MODE enabled?
2. ✅ Extension loaded? (check console)
3. ✅ Locks exist? (check storage)
4. ✅ Auto-apply configured?
5. ✅ Priority settings correct?

---

**Remember:** This is v1.0.0 - fully functional with complete UI for creating, viewing, and clearing locks. Template support is coming in the next version.

**Have fun locking! 🔒**
