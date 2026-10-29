# Mobile habit management redesign

- Daily cards focus on immediate check-ins, consecutive and lifetime statistics.
- Habit management is accessed from Account → Manage Habits; edit name/color, input any keyboard emoji, archive, restore and reorder by direct drag.
- Saving a check-in shows the intended state immediately; Supabase confirmation remains authoritative, and network failure must reconcile/rollback.
- Cloud keyboard-emoji acceptance requires separately authorized SQL under `supabase/proposals/202610290001_mobile_custom_keyboard_emoji.sql` before this branch can be deployed.
- Existing checkins, restoration and history remain unchanged. No database migration has been applied by this branch.

The account screen now uses a single **编辑习惯** entry; selecting a habit opens focused settings. Tap response is optimistic with a visible syncing state; celebration is shown only after cloud confirmation.

## Follow-up UI refinement
The Today page now owns touch drag sorting. The Account page only selects/edit habits; name and Emoji share a single Save Changes action. The color picker is removed; archived habit restoration remains available. No database migration is required.

Validation now includes the compound iOS emoji `👩‍⚕️`, a single name-plus-emoji save, and the Today-page reorder handle. The account editor has no color selector.
