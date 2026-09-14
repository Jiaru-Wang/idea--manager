---
name: ideaminer
description: Use the user's local IdeaMiner research library to capture, find, read, edit, link, move, copy, attach files, or checkpoint useful session insights from any local Codex task. Trigger when the user names IdeaMiner or asks to store or retrieve material in their idea library; do not trigger for ordinary brainstorming that is not meant to touch IdeaMiner.
---

# IdeaMiner

Use the IdeaMiner MCP tools for all library access. Never edit `ideaminer.db` directly or infer that a conversational answer has been saved.

## Resolve before writing

- Call `list_projects` before choosing a destination unless the user gave an exact project name or explicitly wants the default `random_chat` project.
- Use `search_ideas`, then `get_idea`, to resolve titles or contextual descriptions to stable `[[idea:ID]]` references. If multiple plausible matches remain and the choice changes the result, ask the user which one they mean.
- Before `update_idea`, always call `get_idea` and pass the returned `updated_at` as `expected_updated_at`. If a conflict is reported, reload the idea and show the user what changed before retrying.

## Mutations and preservation

- An explicit request to save, capture, add, update, link, move, copy, attach, or create a project authorizes the corresponding scoped tool call. Discussion, brainstorming, or asking for suggestions alone does not authorize a library write.
- For a newly captured idea, place the user's original wording verbatim in `raw_text`. Put cleaned, expanded, or structured notes in `content`; later edits must leave `raw_text` unchanged.
- Give each logical write a stable, task-local `idempotency_key` and reuse it only when retrying that same action.
- To create a descendant, call `create_idea` with `parent_reference`; this also creates a `develops-into` relation. For other connections, call `create_relation` with two resolved stable references and a meaningful typed relation.
- File attachments require an explicit user request and an exact path. Use `linked` unless the user explicitly requests a managed copy and the destination project has a managed workspace.
- Permanent deletion is intentionally unavailable through this plugin. Direct the user to the IdeaMiner Recycle view for destructive cleanup.

## Checkpoint a Codex session

- When the user explicitly asks to checkpoint, distill, or save a session's reusable insights to IdeaMiner, use `create_codex_checkpoint` rather than creating ideas directly.
- Resolve the destination project first, write a concise outcome summary, and include at most five distinct actionable proposals. A proposal may use `parent_reference` when it is a descendant of an existing idea.
- The checkpoint tool creates a local review queue only. Explain that the user applies or dismisses its proposals in IdeaMiner's **Review** dashboard; do not say the proposals are already saved as ideas.

## Finish clearly

After a successful write, report the affected idea's title, stable `[[idea:ID]]` reference, project, and relation when applicable. Call `open_ideaminer` only when the user asks to open or show the browser app; the other tools work without opening it.

Examples of requests this skill should handle include: "save this in IdeaMiner," "find my scale-dependent prediction idea," "make three descendants of `[[idea:12]]`," and "link this note to the EEG project idea."

For example: "Checkpoint this task in IdeaMiner's EEG project: summarize the outcome and queue the two testable follow-up ideas for review."
