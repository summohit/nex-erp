# Location-wise task tracking — design

One parent task ("Do This Configuration") carries the common facts; each
location it applies to (17 states, say) gets its own execution record with its
own status, people, dates, time, remarks, evidence and history.

## What exists today (reviewed)

| Area | Where | Notes |
|---|---|---|
| Task | `Issue` (schema.prisma) | Status is driven by the board column (`columnId` → `status`); `completedAt` set on DONE |
| Create Task modal | `frontend/.../projects/projects.html` → `POST /tasks` → `TasksService.createTask` | General / Project / Pre-sales tabs |
| Board + detail modal | `project-detail.*` → `/projects/:p/issues` → `IssuesService` | Done-column moves go through `assertCanCompleteOrArchive` |
| Time | `IssueTimeLog` (TIMER / MANUAL), budget = `estimatedHours + additionalHours` | Timesheets, budgets and project cost all sum this table |
| Evidence | `IssueAttachment` | Uploaded via `/attachments/upload` |
| Permissions | `canManageTask`, `resolveProjectViewer`, `taskVisibilityFilter` | Admin / project lead / PROJECT_MANAGER manage; members work |
| Master data | `TaskType`, `VisitLocation`, … | Soft-disable rather than delete once used |
| Migrations | `backend/prisma/manual-sql/*.sql` | Additive, guarded, re-runnable |

## Database (additive only — `manual-sql/2026-10-23-task-locations.sql`)

- **`TaskLocation`** — admin-managed hierarchy. `level` STATE / CITY / SITE,
  self-referencing `parentId`, `code`, `isActive`, `position`. Soft-disabled
  once any task uses it.
- **`IssueLocation`** — one execution record per (task, location).
  `status` NOT_STARTED / IN_PROGRESS / IN_REVIEW / COMPLETED / BLOCKED,
  `startDate`, `dueDate`, `startedAt`, `completedAt`, `completedById`,
  `remarks`, `blockedReason`, `overdueNotifiedAt`, and `removedAt` /
  `removedById` for soft removal.
  `UNIQUE (issueId, locationId)` prevents duplicates; re-adding a removed
  location restores the same row and its history.
- **`IssueLocationAssignee`** — people per location.
- **`IssueLocationActivity`** — per-location audit trail and comments
  (ASSIGNED, STATUS_CHANGED, COMMENT, TIME_LOGGED, EVIDENCE_ADDED, REMOVED,
  RESTORED, UPDATED), with actor and timestamp.
- **`IssueTimeLog.issueLocationId`** (nullable) and
  **`IssueAttachment.issueLocationId`** (nullable).

### Why time and evidence stay on the existing tables

Location time is a normal `IssueTimeLog` row on the parent task, tagged with
the location and stored with `source = 'LOCATION'`. So:

- parent logged hours = sum of every log (unchanged query), and
- a location's hours = the same logs filtered by `issueLocationId`.

Nothing is counted twice, and timesheets, task budgets and project cost
need no change. The parent's estimate stays the single hours budget. The
timesheet grid treats LOCATION rows like TIMER rows: recorded evidence it
never rewrites.

Evidence works the same way: it is an ordinary task attachment, linked to a
location.

## Rules

- **Progress** = completed ÷ active (non-removed) locations.
- **Parent auto-status:**
  - Every active location completed → the task moves to the Done column.
  - Any work started while the parent is in To Do → it moves to In Progress.
  - A location reopened or added while the parent is Done → back to In Progress.
- **Manual Done with locations open:** refused, unless an administrator
  confirms the override. The override is recorded in the activity log.
- **Removing a location:**
  - No history → the row is deleted.
  - Has history (time, evidence, activity, or a status other than Not
    Started) → soft-removed. It leaves progress, but its records stay.
- **Mandatory:** the Create Task modal requires at least one location for
  project and general tasks, whenever the company has active locations (the
  same rule phases use). Board quick-add, pre-sales tasks and every existing
  task without locations behave exactly as before.

## Permissions

- **Viewing:** whoever can see the parent task (the existing visibility rule)
  sees its locations.
- **Managing** (add or remove locations, set assignees and dates): admin,
  project lead, or PROJECT_MANAGER (`canManageTask`).
- **Updating a location** (status, time, comment, evidence): managers, plus
  that location's assignees. When a location has no assignees, the task's
  own assignees and members may update it.

## API

The master-data routes (create, update and delete) are admin only.

| Method | Path | Purpose |
|---|---|---|
| GET | `/task-locations?activeOnly=` | Location hierarchy (flat, with parentId) |
| POST | `/task-locations` | Create one location |
| POST | `/task-locations/bulk` | Create many (`names[]`, `level`, `parentId`) |
| PUT | `/task-locations/:id` | Rename, move, enable/disable |
| DELETE | `/task-locations/:id` | Delete; soft-disabled if in use |
| GET | `/task-locations/executions` | Location-wise execution view, filterable |
| GET | `/task-locations/report` | Completed / pending / overdue / blocked per parent task |
| GET | `/projects/:p/issues/:id/locations` | Locations of one task, with progress |
| POST | `/projects/:p/issues/:id/locations` | Add locations (`locationIds`, `assigneeIds`, `dueDate`) |
| PATCH | `/projects/:p/issues/:id/locations/:locId` | Status, assignees, dates, remarks |
| DELETE | `/projects/:p/issues/:id/locations/:locId` | Remove (soft when it has history) |
| POST | `/projects/:p/issues/:id/locations/:locId/comments` | Add a comment |
| POST | `/projects/:p/issues/:id/locations/:locId/time-log` | Log time (`durationMin`, `note`) |
| POST | `/projects/:p/issues/:id/locations/:locId/evidence` | Link uploaded attachments |
| GET | `/projects/:p/issues/:id/locations/:locId/activity` | One location's history |

`POST /tasks` also accepts `locationIds`. `GET /tasks/my` and the board's
issue list now include a light `locations` summary for cards and filters.

## Notifications

| When | Who is notified |
|---|---|
| A location is assigned | Its assignees |
| A location is blocked or completed | Its assignees, the task reporter, and the project lead |
| A location becomes overdue | Its assignees and the reporter, once per location (`overdueNotifiedAt`); checked hourly |

## UI

- **Create Task modal:** a "Locations" section.
  - A searchable multi-select grouped by state.
  - Bulk actions: select all shown, select a whole state with its cities,
    and clear.
  - Chips for the selected locations.
  - A "Manage locations" link to Master Data, for admins.
- **Board cards:** a "8/17 locations" pill and a progress bar. Blocked and
  overdue counts are shown in red.
- **Task details modal:** a "Location Progress" section.
  - Overall bar with counts.
  - Status and search filters.
  - An expandable row per location: status selector, assignees, dates,
    remarks, log time, comment, upload evidence, mark complete, history.
  - Managers can add or remove locations.
- **Tasks page:** a "By location" view, a flat execution list with filters
  for state, city, location, status, assignee, and progress. It also has a
  location report.
- **Master Data:** a "Task Locations" tab to manage the hierarchy, with bulk
  add (one name per line).
