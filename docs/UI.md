# UI design: simple and intuitive, without custom JavaScript

Goal (product owner): as simple and intuitive as possible; Odoo has many views, use the ones that help, accept some
custom JS only if really needed. **Result so far: zero custom JS** — everything is stock Odoo 19 views plus a few
small model helpers. Screens were reviewed from real screenshots (`scripts/screens.sh`, headless Chrome driven by
Odoo's own test browser; images are written to a directory you choose, nothing is committed).

## Principles applied
1. **One place to start: "My agenda".** Every pending analysis, action, signature, review and planned task already
   creates an Odoo to-do for the right person. The first menu item is a stock list/calendar/kanban over *my* ISO to-dos,
   defaulting to "overdue or due within 30 days". No new model, no JS.
2. **Every form says what happens next.** A blue banner computed from the state: *"Waiting for the review of: Calidad
   (Ana), Supply Chain (Luis)"*, *"Resp has to verify that each finished action was effective"*. People never have to
   understand the state machine.
3. **The primary action is one click and in the header.** *Save analysis*, *Send to review*, *Review my area*,
   *Approve / Reject…* (signers), *Finish*, *Send to final approval*. Buttons appear only for the person who can use them.
4. **Statusbar = the process.** Findings: analysis → action → verification → closed. Releases and changes likewise.
5. **Single-page forms** for findings, releases and change requests: sections in workflow order instead of tabs that hide
   the next step. Tabs are kept only for the long audit task.
6. **Kanban boards by status** (columns in workflow order, read-only: the workflow moves only through buttons),
   **calendars for deadlines** (tasks as a year view, action deadlines), **pivot/graph** reports. Lists stay available.
7. **Questionnaire = an editable list** (Applies / Requires action) with *Create action* on the row.
8. Odoo-native conventions everywhere (chatter, activities, search filters) so users who know other Odoo apps feel at home.

## Where custom JS would (not) be needed
| Idea | Verdict |
|---|---|
| Unified inbox / calendar across all models | Not needed: stock `mail.activity` views (done) |
| Cards-with-counters home dashboard | Optional. Stock `board` needs `spreadsheet_dashboard` and is user-configured; a counters home needs a small OWL client action (~150 lines). **Wait for user feedback first.** |
| Matrix widget for the 8×N questionnaires | Not needed: the editable list is clear enough (tested on screenshots) |
| Drag & drop between kanban columns | Deliberately off: transitions need validations, so they stay on buttons |
| Hide chatter's "Mark Done" on our to-dos | Not possible per form (chatter shows activities for any model with the activity mixin). Marking a to-do done by hand removes it from the agenda but not from the item; the item still shows in kanban "Pending on". Accepted; revisit if it confuses users |

## Known UI limits / ideas for the next round
- Spanish translation (`i18n/es_AR.po`) is still to do; the screens above are in English.
- The planning calendar opens on the current year; plannings for next year need the arrow. A default "go to next planning" would need JS.
- Empty many2one cells in editable lists (reviewer, auditor) show nothing until clicked: standard Odoo, consider placeholders.
- Real users should try the flows; the biggest risk is vocabulary (labels are English until translated), not layout.
