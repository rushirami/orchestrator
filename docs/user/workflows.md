# Orchestrating agents with workflows

A workflow template belongs to a project. It describes stages, the skills each stage runs, and which agent conversations carry the work. Starting a workflow creates one Git worktree and the named threads in that template.

Open **Workflows** in the sidebar, then **Configure workflows**. You can also open the command palette and choose **Configure project workflows**. Select your project, create a template, and connect its stage nodes. Connections set execution order; dragging a node only changes its position.

## Configure a template

New templates start with a blank canvas, an empty starting prompt, and no agent threads or review revisions. Choose **Add stage** to create your first stage, then select its type and instructions. Adding the first agent stage creates a thread using your project's default agent and model. Set the workflow name, starting prompt, and agent assignments in **Workflow settings**. Add and configure at least one stage before saving.

An **Agent task** has ordered skill instructions and a named thread. Instructions can refer to skills installed in that agent's own setup. Several stages can reuse a thread to preserve its conversation. Add separate threads for independent work. Agents retain their own credentials, tools, and MCP configuration; workflows do not add Jira or GitHub accounts.

**Human approval** opens an artifact such as `spec.md` before continuing. Once its earlier stages have finished, you can review and request revisions even if the workflow is paused and the approval still says **pending**. Approving while paused keeps the remaining work paused. Approval applies to the contents you read. If the file changes, reload it before approving. **Request revision** sends your line comments back to the configured earlier agent stage and resumes it automatically, including when the workflow is paused. That stage receives the file path, line ranges, original text, and requested changes. Stages after it run again, and the revised artifact returns for approval.

Select multiple outgoing stages to start all branches. Every incoming branch must finish before a stage proceeds. A **Join branches** node makes that dependency explicit without starting an agent. Read-and-write stages run exclusively in their worktree; parallel stages must use distinct threads with read-only access. Codex and Claude support enforced read-only workflow stages. Other providers can run writing stages; validation explains unsupported reviewer assignments before launch.

Read-only stages return findings in their result summary. They cannot write review files. Follow them with a Builder stage to combine reports and save an artifact. The application checks that reviews still match the code before advancing. An outside edit requires fresh reviews.

**Workflow settings** contains the reusable prompt, worktree defaults, thread providers and models, and an optional bounded return to an earlier stage for review fixes. For example:

```text
Start brainstorming on {{ TASK_ID }}
```

The editor detects `TASK_ID` and previews example values. Examples are not saved as launch defaults. Variables are replaced literally, without evaluating expressions. Prompts can include ordinary JSON examples such as `{"spec": {"done": true}}`. **Validate** checks the graph and provider capabilities without launching agents or creating a worktree. **Save template** replaces the saved settings; there are no version or run-history tabs.

## Start and supervise work

Use the **+** beside a project in the Workflows sidebar to start a new workflow from one of its saved templates. You can also choose **New project workflow** in the command palette. If there are no templates yet, choose **Configure templates** to create and save one. From the template editor, choose **Start workflow**. Review the workspace name, base branch, new worktree branch, variable values, and one provider/model assignment per thread. The resolved prompt is shown before launch. Launch overrides apply only to that task.

The Workflows sidebar groups tasks by project. Click a project's folder or name to open its workflow templates. Click a workflow's icon, name, or status to open its overview, and use the separate chevron to expand or collapse its conversations. Sidebar controls highlight on hover and keyboard focus, with tooltips explaining each action. The overview graph shows every stage, its status, and a count of completed stages. Running stages and stages needing attention are highlighted without continuous animation. Click an agent stage to open its thread. Use **Stage details** or a status chip to inspect results, files, and retry controls; approval nodes open their review panel.

The breadcrumb follows **Project / Workflows / Workflow name / Agent name**. Click the workflow name to return to the overview or **Workflows** to return to its project templates. The project selector switches projects. These breadcrumbs also appear when you open a workflow conversation from Threads or search, and disappear after its workflow is dismissed. Switch back to Threads to use the familiar conversation list.

- **Pause after current stages** lets current turns finish and prevents new stages from starting.
- **Resume** continues eligible work. Failed stages must first be recovered or prepared for retry.
- **Recheck completed turn** recovers a failed stage when its recorded provider turn completed successfully and its checkpoint and required files are available. It uses the saved result without running the agent again and keeps the workflow paused until you resume. A result saying `complete` alone does not override a provider failure or interruption.
- **Prepare skill retry** creates a fresh attempt for the failed skill while keeping the task paused. Inspect the original thread and any side effects before resuming.
- **Cancel task** prevents further work and requests interruption of active turns. It preserves files and conversations.
- **Dismiss task** removes a completed or fully stopped workflow from the sidebar. Its ordinary threads, worktree, and files remain available.

Agent stages must return a structured result and produce their required files. A completed conversation alone does not count as success. Missing artifacts, an invalid result, a failed checkpoint capture, or an unreadable agent-turn record pause the affected task with an explanation. A missing diff summary does not fail a stage if its checkpoint was saved successfully. Other workflows can continue. Automatic retries are off.

## Persistence and restarts

Saved templates and unfinished tasks live in the local environment's database and survive app restarts. Projects can have different templates, including templates with the same name. A task keeps the settings it launched with even when its template is edited or deleted.

Quitting the desktop stops its local backend. Work does not continue while the app or machine is off. On restart, uncertain agent operations pause for inspection instead of being silently repeated. This matters for actions such as creating a pull request, whose external outcome may already exist.

Deleting a project is blocked while it owns unfinished or still-running workflow work. Finish or cancel those tasks first. Separate desktop-managed environments keep separate workflow data.

Workflow screens follow your Appearance settings, including light, dark, system, and custom themes. The canvas, stage details, reports, and launch dialog update with the rest of the app.

Open an approval artifact or a file listed in a stage result to read it in the workflow’s **Files** tab. Documents render as Markdown, with headings, lists, links, and code blocks. Approval and revision actions appear below the document. **Reload artifact** refreshes the reviewed version; switch back to **Workflow** to see the graph, or choose **Close file** to clear the preview.

To change a specification before approving it:

1. Open the approval artifact in **Files** and choose **Comment on lines**.
2. Select a line number, or drag across line numbers, and describe the change. Choose **Add comment**. Repeat for each change.
3. Review your comments below the file. **Edit** or **Remove** any comment before submitting. **Rendered Markdown** returns to the formatted document.
4. Choose **Request revision** to send all comments to the earlier agent stage. Adding comments alone does not approve the document or start the agent.

Draft comments are saved locally for the exact file version, including when you close the preview or leave the workflow. If the file changes, old feedback stays visible with a warning. Copy any comments you want to keep, then clear the old feedback and review the current lines. Comments from an older version cannot be submitted against new line numbers. Finish or cancel an unfinished comment before submitting. Approval is available once there are no outstanding comments. Wait for active branches to finish before requesting revision. If a failed stage would not rerun as part of the revision, use **Prepare skill retry** or **Recheck completed turn** on that stage first. Until then, requesting revision keeps the workflow paused and preserves your comments.
