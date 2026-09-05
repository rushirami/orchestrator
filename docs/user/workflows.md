# Orchestrating agents with workflows

A workflow template belongs to a project. It describes stages, the skills each stage runs, and which agent conversations carry the work. Starting a workflow creates one Git worktree and the named threads in that template.

Open **Workflows** in the sidebar, then **Configure workflows**. You can also open the command palette and choose **Configure project workflows**. Select your project, create a template, and connect its stage nodes. Connections set execution order; dragging a node only changes its position.

## Configure a template

An **Agent task** has ordered skill instructions and a named thread. Instructions can refer to skills installed in that agent's own setup. Several stages can reuse Builder to preserve its conversation. Add separate reviewer threads for independent reviews. Agents retain their own credentials, tools, and MCP configuration; workflows do not add Jira or GitHub accounts.

**Human approval** opens an artifact such as `spec.md` before continuing. Approval applies to the contents you read. If the file changes, reload it before approving. **Request revision** sends work back to the configured earlier stage.

Select multiple outgoing stages to start all branches. Every incoming branch must finish before a stage proceeds. A **Join branches** node makes that dependency explicit without starting an agent. Read-and-write stages run exclusively in their worktree; parallel stages must use distinct threads with read-only access. Codex and Claude support enforced read-only workflow stages. Other providers can run writing stages; validation explains unsupported reviewer assignments before launch.

Read-only stages return findings in their result summary. They cannot write review files. Follow them with a Builder stage to combine reports and save an artifact. The application checks that reviews still match the code before advancing. An outside edit requires fresh reviews.

**Workflow settings** contains the reusable prompt, worktree defaults, thread providers and models, and an optional bounded return-to-Builder path for review fixes. For example:

```text
Start brainstorming on {{ TASK_ID }}
```

The editor detects `TASK_ID` and previews example values. Examples are not saved as launch defaults. Variables are replaced literally, without evaluating expressions. Prompts can include ordinary JSON examples such as `{"spec": {"done": true}}`. **Validate** checks the graph and provider capabilities without launching agents or creating a worktree. **Save template** replaces the saved settings; there are no version or run-history tabs.

## Start and supervise work

Save the template, then choose **Start workflow**. Review the workspace name, base branch, new worktree branch, variable values, and one provider/model assignment per thread. The resolved prompt is shown before launch. Launch overrides apply only to that task.

The Workflows sidebar groups tasks by project and expands to their conversations. Select a task to see stage status, inspect results and files, open agent threads, or review an approval. Switch back to Threads to use the familiar conversation list.

- **Pause after current stages** lets current turns finish and prevents new stages from starting.
- **Resume** continues eligible work. Failed stages must first be prepared for retry.
- **Prepare skill retry** creates a fresh attempt for the failed skill while keeping the task paused. Inspect the original thread and any side effects before resuming.
- **Cancel task** prevents further work and requests interruption of active turns. It preserves files and conversations.
- **Dismiss task** removes a completed or fully stopped workflow from the sidebar. Its ordinary threads, worktree, and files remain available.

Agent stages must return a structured result and produce their required files. A completed conversation alone does not count as success. Missing artifacts or an invalid result pause the task with an explanation. Automatic retries are off.

## Persistence and restarts

Saved templates and unfinished tasks live in the local environment's database and survive app restarts. Projects can have different templates, including templates with the same name. A task keeps the settings it launched with even when its template is edited or deleted.

Quitting the desktop stops its local backend. Work does not continue while the app or machine is off. On restart, uncertain agent operations pause for inspection instead of being silently repeated. This matters for actions such as creating a pull request, whose external outcome may already exist.

Deleting a project is blocked while it owns unfinished or still-running workflow work. Finish or cancel those tasks first. Separate desktop-managed environments keep separate workflow data.

Workflow screens follow your Appearance settings, including light, dark, system, and custom themes. The canvas, stage details, reports, and launch dialog update with the rest of the app.
