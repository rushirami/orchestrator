# Orchestrator vision

Orchestrator builds on T3 Code to help users guide coding agents through repeatable workflows, from an initial task to a reviewed pull request. Users choose how the work should happen, which agents should do it, and where they want to review the result before it continues.

This document describes the intended direction of this fork. It is a product vision, not a description of shipped orchestration features or a settled implementation design.

## From a task to a workflow

A user should be able to start with a task they write themselves, a Jira ticket, or a GitHub issue, choose a predefined workflow, and launch it in a dedicated Git worktree. That worktree holds the task's code changes as it moves through planning, implementation, PR creation, and review.

A workflow template is a project-specific, reusable flow of connected stage nodes. The canvas presents a tree-like flow that can branch into multiple activities and join again before continuing. An agent stage runs one or more skills sequentially, produces an expected result, and has a clear condition for continuing. A human approval stage pauses for a decision about an artifact. A skill describes how an agent performs a particular activity, such as writing a specification or reviewing a change. The workflow determines when that activity happens and what follows it.

Users should be able to reuse workflows across tasks and customize them for a project. Configuration should cover the skills and their order, the provider and agent used at each stage, expected outputs, and whether a transition happens automatically or waits for the user.

Stages follow their connections and dependencies. A linear path executes sequentially, while a stage can start multiple selected branches in parallel. Orchestrator imposes no concurrency limit across separate tasks and exposes no concurrent-runs setting.

For example, PR creation can start both a Claude review and an OpenAI review. Each review is its own stage node and agent thread. A downstream **Combine findings** node waits for both reviews, gathers their reports, and either returns the work to Builder or completes the workflow. Selecting multiple branches means running all selected activities, rather than choosing one alternative. A failed or paused review keeps the join waiting for user action; it must not count as a successful review.

The initial parallel example uses read-only reviews of the same PR revision in the shared worktree. Builder waits for both reports before editing again. Concurrent agents modifying the same files need a separate isolation policy and are outside this first branching flow. The OpenAI reviewer uses the available Codex provider; this does not introduce a separate ChatGPT account connection.

## Templates and starting prompts

The project's Orchestration view is where users define the complete workflow: add, remove, and connect stage nodes; create branches and joins; arrange skills within each agent stage; choose thread assignments and providers; and configure expected outputs, handoffs, approvals, and next-stage rules. Connections determine execution order. The selected node's settings let users select multiple successor nodes to run in parallel and choose where their results join. Agent tasks and human approvals are the basic stage types. PR creation is an agent task using a skill and the agent's tools, rather than a separate GitHub connection.

Each template contains one reusable starting prompt. Users place double-brace variables wherever a value should change between tasks:

```text
Start brainstorming on {{ TASK_ID }}
```

Each unique variable becomes an input at launch. The user can paste `T3-148` or a ticket URL into `TASK_ID`; every occurrence of `{{ TASK_ID }}` is replaced with that value. Repeated occurrences require only one input. Variables are user-defined, so task descriptions or other context can be supplied the same way without imposing fixed Jira or GitHub fields.

The template editor shows the detected variables and lets users try example values to preview the resulting prompt. Preview values are examples, not saved launch defaults. At launch, required variable values must be supplied and the completed prompt is visible before it is sent to the first agent. Later stages receive the context and artifacts specified by the workflow.

Template settings also cover the base branch, branch prefix, default agents for named threads, and failure behavior. Stage-specific thread reuse, skills, outputs, and routing belong beside the selected stage. Settings should remain a straightforward editing surface: no Designer / Runs / Versions tabs and no secondary workflow-settings navigation sidebar. **Save template** updates the current definition for future launches; it does not create a browsable version. Editing a template must not change a task already underway.

## Launching a workflow

The launch form brings the setup together before creating the worktree:

- **Project and workflow:** choose the project and one of its templates, with a way to preview the stages.
- **Workspace name:** an editable display name that identifies the task in the sidebar.
- **Base branch:** the branch from which the new worktree starts.
- **Worktree branch:** an editable branch name, initially suggested using the template's branch prefix.
- **Prompt variables:** supply or paste the values and inspect the completed starting prompt.
- **Agent threads:** review the template's thread assignments and override the agents for this task.

Starting creates one dedicated worktree with those settings and begins the first stage. Launch overrides apply to that task without rewriting the reusable template. Superset's creation form is a reference for grouping these controls; Orchestrator remains a T3 Code workflow experience.

## One worktree, configurable threads

A workflow execution is a task with one worktree and one or more agent threads. A stage is not automatically a new thread. Multiple stages can reuse the same thread, preserving its conversation and agent context. Choosing a new thread starts a separate conversation in the same worktree, optionally with a different provider.

For example, a **Builder** thread handles planning, implementation, validation, and PR creation. Separate **Claude Reviewer** and **OpenAI Reviewer** threads then review the changes in parallel in the same worktree. These are configurable assignments, not mandatory agent roles or a fixed reviewer count. Users can choose a single review, reuse Builder for a sequential review, or add other branches. Parallel agent nodes use separate threads so they do not submit overlapping work to one conversation. A human approval stage does not require an agent thread.

New threads receive explicit handoffs such as the approved spec, task context, code changes, validation evidence, and PR URL. Sharing the worktree does not mean sharing conversation history or credentials. If review finds issues, the workflow can route back to the original Builder thread, preserving its context and existing worktree, then return to review.

## An example: plan, build, and review

1. **Start a task.** The user chooses a workflow, fills its prompt variables, reviews workspace, branch, and agent settings, and creates a worktree. The first agent receives the completed prompt and uses its configured tools to fetch relevant context and produce a task brief for later stages.
2. **Generate a specification.** A planning skill produces a spec file with the proposed behavior, scope, and acceptance criteria. The workflow pauses for review.
3. **Review the specification.** The user reads the file and either requests revisions or approves it. Approval advances the same worktree into the implementation and PR flow.
4. **Implement and create a PR.** The same Builder thread executes the configured implementation, validation, and PR skills in order. The result includes the changes, validation evidence, and a link to the created GitHub pull request.
5. **Run reviews.** PR creation starts the selected review branches in the same worktree. In the branching example, Claude and OpenAI review concurrently in separate threads. Each receives the approved spec, task brief, PR URL and revision, changes, and validation results, and uses its own configured tools for any additional access. Combine findings waits for both reports before continuing.
6. **Resolve findings.** Review findings can return the task to implementation and another review. The user can inspect the results and decide when the work is ready. Creating a PR, completing review, and merging are distinct milestones; this example does not assume automatic merging.

The worktree provides continuity for the code. Agent sessions can change between stages without losing the task's specification, outputs, or history. Editing stages run sequentially in the shared worktree; parallel reviews inspect the same revision without conflicting edits.

## Agents bring their own tools

Orchestrator should require no separate Orchestrator account. Users bring their agents and configure tool access and authentication in those agents. Jira and GitHub are useful initial workflow examples, but Orchestrator does not need its own connections or credentials for them.

An agent can use its configured MCP servers, CLIs, or other tools to read tickets, gather context, create PRs, and update external systems. MCP is an option, not a requirement. Skills describe the work and required capabilities; the agent uses the tools available in its environment. External actions are agent stages with configured skills, not a separate Orchestrator integration system.

Orchestrator owns stage order, worktrees, approvals, retries, progress, and explicit handoffs between stages. Outputs such as the task brief, approved spec, validation results, and PR URL become inputs to later stages. Changing agents must not require rediscovering completed work or imply that credentials transfer between providers. If a stage cannot access a required tool, it should stop with a clear request for user action.

The initial start mechanism is manual: fill the template's prompt variables and launch the workflow. Automatically starting runs when tracker issues change would require a separate watcher and is deferred. Underlying providers and external tools still require their own authentication.

## User control throughout the run

Automation should follow the user's chosen workflow and approval points. Waiting for a spec review is a meaningful state, and the next stage must not start until that approval arrives.

Users should be able to pause, resume, cancel, request revisions, and retry a failed stage. Retries should preserve completed work and avoid duplicating external actions such as PR creation. A workflow should expose why it stopped, what it produced, and what it needs next.

The starting failure policy is **Pause for input**, with automatic retries **Off**. The worktree and agent threads remain available so the user can resolve the issue and resume. Review findings follow the stage's configured next-step rule; they are distinct from execution failures. Any automatic retry or review-loop policy should be explicit and bounded rather than silently repeating work. The mockup's two-review-cycle pause is an example, not a fixed product limit.

Agent continuity is a deliberate choice: retaining the existing agent preserves conversational context, while starting a fresh reviewer provides an independent pass. Both should be available through configuration, with provider capabilities made clear.

## A dedicated orchestration view

Users need a precise overview of their current orchestrated tasks and a way to act on the ones that need attention. The main sidebar flips between **Threads** and **Workflows**. Threads preserves the familiar T3 Code conversation list. Workflows groups active tasks by project, showing each task's workspace name, branch, current stage, and status. Expanding a task reveals its agent threads and the stages each thread handles. Several stages handled by Builder appear under one Builder thread, rather than as duplicate conversations.

The Workflows sidebar includes an entry to the project's workflow templates. Template editing and live task inspection serve different purposes: the former defines future work; the latter explains what is happening now. The project view and top action bar provide contextual actions such as starting a workflow, saving a template, pausing a task, or opening its PR.

For each task, the view should show:

- The task title, source ticket, project, environment, and worktree.
- The selected workflow, active stage nodes and branches, and their agents or providers.
- Whether it is starting, running, awaiting approval, paused, blocked, failed, or complete.
- The latest meaningful result, including the spec, validation results, PR, or review findings.
- The next action the user can take and why it is needed.

Opening an active task should reveal its execution progress, associated agent threads, shared worktree, and artifacts. Parallel branches need individual status indicators and a visible join state showing which results are still pending. A single “Step 5 of 5” label is insufficient when multiple nodes are active. The current-task mockup separates Overview, Threads, and Artifacts; these describe the current execution, not a past-run browser. Approvals should be attached to the artifact being reviewed, so the user can read a specification and approve it in context. The existing chat experience remains useful for directing an agent within a stage.

There is no saved archive of past workflow runs and no template version history in the initial product. The workflow sidebar focuses on current tasks, including those waiting for user input. Ordinary T3 Code thread history and files produced in the worktree remain useful independently; omitting a workflow-run archive does not mean deleting those conversations or artifacts.

The designs use a white theme throughout, with T3 Code's sidebar, project breadcrumbs, compact controls, and top-right action placement. Superset informs the launch form's grouping, not the overall app shell or theme. Avoid introducing an unrelated dashboard layout.

The [Paper designs](https://app.paper.design/file/01M1PYQ1380EBK0T3YNH8WQ3S2/1-0) establish the white, T3-style direction. The implementation uses one inline template-settings surface and **Validate** to check a graph and provider capabilities without starting work. Approvals show the exact artifact being approved; failures pause for inspection and explicit retry. Completed tasks stay visible until dismissed, which removes workflow-only state while preserving their ordinary threads and files. Launch and active-task views derive their rows and branches from the configured graph.

## Direction from OpenAI Symphony

[OpenAI Symphony](https://github.com/openai/symphony) provides inspiration for connecting tracked work to isolated agent execution. Its [service specification](https://github.com/openai/symphony/blob/main/SPEC.md) separates repository-owned workflow policy, workspace management, agent execution, scheduling, and observability. Its `WORKFLOW.md` combines configuration with an agent prompt template.

Orchestrator should borrow the ideas of inspectable workflow definitions, isolated workspaces, and visible execution state. The connected skill stages, parallel review branches, artifact approval checkpoints, configurable agent handoffs, and T3 Code orchestration view described here are our proposed product direction. Symphony is a reference, not a commitment to adopt its implementation or configuration format.

## Build on what makes T3 Code useful

The experience should preserve T3 Code's open foundation, provider choice, and performance within this desktop-only fork. The Electron application uses a local loopback backend, with optional desktop-managed WSL environments. Workflow state belongs to that backend and survives renderer reloads and application restarts. Fully quitting the application may stop agent execution; unfinished tasks must reconcile their state when the application reopens. Mobile, remote access, hosted browser clients, T3 accounts, and external analytics are outside this fork's scope.

The initial scope should prove one complete journey: configure a reusable template of connected stages in the project view, fill its variables and launch a worktree, generate and approve a spec, implement it, create a PR, and start multiple selected review branches. Join their findings before completing or returning to Builder. The user follows the active task through the Workflows sidebar and can open its agent threads when intervention is needed. Concurrent editing in a shared worktree and automatic tracker-based dispatch can wait until real workflows justify them.

Success means a user can start several tasks, understand where each one stands, and intervene at the moments they chose without repeatedly restating instructions or manually carrying context between agents.
