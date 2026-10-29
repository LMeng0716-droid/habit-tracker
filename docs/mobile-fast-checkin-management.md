# Mobile habit management redesign

- Daily cards focus on immediate check-ins, consecutive and lifetime statistics.
- Habit management is accessed from Account → Manage Habits; edit name/color, input any keyboard emoji, archive, restore and reorder by direct drag.
- Saving a check-in shows the intended state immediately; Supabase confirmation remains authoritative, and network failure must reconcile/rollback.
- Cloud keyboard-emoji acceptance requires separately authorized SQL under `supabase/proposals/202610290001_mobile_custom_keyboard_emoji.sql` before this branch can be deployed.
- Existing checkins, restoration and history remain unchanged. No database migration has been applied by this branch.
