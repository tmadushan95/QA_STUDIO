# Step format

A test case's runnable steps are a list of `{ "action": "...", "params": { ... } }`. People edit them in the visual
editor. Source: `packages/automation-core/src/generic/actions.ts`.

```json
{
  "schemaVersion": 1,
  "caseId": "TC_08",
  "steps": [
    { "action": "go-to-page", "params": { "page": "Draft projects" } },
    {
      "action": "fill",
      "params": {
        "target": { "label": "Search" },
        "value": "{{data.deleteTc08}}"
      }
    },
    {
      "action": "click",
      "params": {
        "target": {
          "role": "button",
          "name": "Delete",
          "within": { "role": "row", "text": "{{data.deleteTc08}}" }
        }
      }
    },
    {
      "action": "assert-visible",
      "params": { "target": { "role": "dialog", "name": "Delete Project?" } }
    },
    {
      "action": "click",
      "params": {
        "target": {
          "role": "button",
          "name": "Confirm",
          "within": { "role": "dialog" }
        },
        "destructive": true
      }
    },
    {
      "action": "assert-text",
      "params": { "text": "Project deleted successfully." }
    }
  ]
}
```

Signing in is never a step: the run signs in once per account, as set in the project's Project settings › Application & sign-in.

## Finding an element (`target`)

Describe the element the way a person would. At least one of these is needed; when several are given the first in
this order is used.

| Field           | Finds                                   | Example                                  |
| --------------- | --------------------------------------- | ---------------------------------------- |
| `testId`        | `data-testid` added by the app team     | `{ "testId": "save" }`                   |
| `role` + `name` | an element by its role and visible name | `{ "role": "button", "name": "Delete" }` |
| `label`         | a form field by its label               | `{ "label": "Search" }`                  |
| `placeholder`   | a field by its placeholder              | `{ "placeholder": "Project code" }`      |
| `text`          | any element by its text                 | `{ "text": "Welcome back" }`             |

Options: `exact` (whole text must match), `nth` (which match, from 0; the first by default), and `within` to look
inside a container: `{ "role": "dialog" }`, `{ "role": "row", "text": "PRJ-1" }` (the row containing PRJ-1), or
`{ "role": "region", "name": "Filters" }`.

## Actions

| Group    | Action                              | Parameters                                                       |
| -------- | ----------------------------------- | ---------------------------------------------------------------- |
| Navigate | `open`                              | `path` (same site, e.g. `/projects`)                             |
|          | `go-to-page`                        | `page` (a name from Settings › Pages); waits for its loaded text |
|          | `back`, `reload`                    | —                                                                |
| Interact | `click`, `double-click`             | `target`, optional `destructive`                                 |
|          | `hover`                             | `target`                                                         |
|          | `fill`                              | `target`, `value`                                                |
|          | `clear`                             | `target`                                                         |
|          | `select`                            | `target`, `option` (visible text)                                |
|          | `check`, `uncheck`                  | `target`                                                         |
|          | `press`                             | `key` (e.g. `Enter`), optional `target`                          |
| Wait     | `wait-for`                          | `target`, `state` (`visible` or `hidden`)                        |
| Check    | `assert-visible`, `assert-hidden`   | `target`                                                         |
|          | `assert-text`, `assert-no-text`     | `text`                                                           |
|          | `assert-enabled`, `assert-disabled` | `target`                                                         |
|          | `assert-value`                      | `target`, `value`                                                |
|          | `assert-url`                        | `contains`                                                       |
|          | `assert-count`                      | `target`, `count`                                                |
|          | `assert-equals`                     | `actual`, `expected`                                             |
| Remember | `remember`                          | `from` (`text`, `value`, `url`), `target` (not for `url`), `as`  |

Checks wait up to the step time limit (Settings › Execution) for the page to settle, then fail with what was expected
and what was found.

## Values in steps

- `{{data.name}}` — a parameter of the test case (its Parameters tab, or auto-filled), filled in before the run. An empty value
  blocks the case and names the value.
- `{{var.name}}` — a value saved earlier in the same case by `remember`, filled in when the step runs.

- `{{input.name}}` — inside a **custom step's** body only: the value its caller filled in for the input `name` (below).

## Custom steps (per project, no code)

A project defines its own steps in **Project settings › Custom steps**. A custom step is a recipe: **inputs** (what a test case
fills in) and a **body** of standard steps that may use `{{input.name}}`. It is registered as the action
`custom.<projectId>.<key>` and offered in the step list under "Custom steps of this project", only to that project's cases.

```json
{
  "key": "check-permission",
  "label": "Check a permission",
  "inputs": [
    { "name": "role", "label": "Role", "kind": "text", "required": true },
    {
      "name": "permission",
      "label": "Permission",
      "kind": "text",
      "required": true
    }
  ],
  "steps": [
    { "action": "go-to-page", "params": { "page": "roles" } },
    {
      "action": "click",
      "params": { "target": { "role": "button", "name": "{{input.role}}" } }
    },
    { "action": "assert-text", "params": { "text": "{{input.permission}}" } }
  ]
}
```

- Input kinds: `text`, `number`, `choice` (with `options`), `boolean`, `page`. A whole-string `{{input.n}}` keeps a number a number.
- The body may use the standard steps only (no application steps, no custom step inside a custom step), so a recipe cannot loop.
  It is checked when saved; a step in it that deletes data makes the custom step count as deleting data.
- A failure names the step of the recipe: `Check a permission, step 3: Expected text to be visible…`.
- A custom step that test cases use cannot be removed. API: `GET|PUT /api/custom-steps/:projectId` (the PUT replaces the list).

## The step editor

Every step is a card: the action, a sentence saying what it does in plain words, then its fields with labels above them. Every
action is a form: standard and custom steps declare their fields, and an application step gets its form from its parameter schema
(`uiFromSchema`), so nothing is edited as raw JSON; only settings no form can show (a nested structure) are offered under "Extra
settings". A "How steps work" guide above the steps explains the idea for beginners.

## Application packs (older)

Code-written actions for one application (`registry.register(defineAction({...}))`), such as the delete-project actions, keep
running so existing test cases still work. They are no longer offered for new steps; a project defines what it needs as custom steps.
