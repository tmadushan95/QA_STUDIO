# 0004 — Generic, data-only steps instead of per-application code

**Status:** accepted (2026-10-29)

**Decision.** A fixed library of about 25 generic actions (open, click, fill, assert-text, remember…) finds elements by
role, label, text, placeholder or test id, optionally inside a container. Test cases are lists of these steps; sign-in
is done by the runner from Settings. Application packs remain possible but are optional.

**Why.** The same tool tests any web application, and a new test case or screen needs no code change or release.

**Status of migration.** The delete-project scenarios still use the delete-project pack; they are to be rewritten with
generic steps (and then the pack removed) once they can be checked against a real environment.
