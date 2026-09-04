# Orchestrator vision

Orchestrator builds on T3 Code to help users guide coding agents through repeatable workflows, from an initial task to a reviewed pull request. Users choose how the work should happen, which agents should do it, and where they want to review the result before it continues.

This document describes the intended direction of this fork. It is a product vision, not a description of shipped orchestration features or a settled implementation design.

## From a task to a workflow

A user should be able to start with a task they write themselves, a Jira ticket, or a GitHub issue, choose a predefined workflow, and launch it in a dedicated Git worktree. That worktree holds the task's code changes as it moves through planning, implementation, PR creation, and review.

A workflow is an ordered sequence of stages. Each stage runs one or more skills sequentially, produces an expected result, and has a clear condition for continuing. A skill describes how an agent performs a particular activity, such as writing a specification or reviewing a change. The workflow determines when that activity happens and what follows it.

Users should be able to reuse workflows across tasks and customize them for a project. Configuration should cover the skills and their order, the provider and agent used at each stage, expected outputs, and whether a transition happens automatically or waits for the user.

## An example: plan, build, and review

1. **Start a task.** The user selects a ticket or describes the work, chooses a workflow, and creates a worktree. Relevant context from connected tools accompanies the task.
2. **Generate a specification.** A planning skill produces a spec file with the proposed behavior, scope, and acceptance criteria. The workflow pauses for review.
3. **Review the specification.** The user reads the file and either requests revisions or approves it. Approval advances the same worktree into the implementation and PR flow.
4. **Implement and create a PR.** The agent executes the configured implementation, validation, and PR skills in order. The result includes the changes, validation evidence, and a link to the created GitHub pull request.
5. **Run a review.** The review flow runs against the changes in the same worktree. The user can configure it to continue with the existing agent or start a fresh agent, potentially using a different provider. A fresh agent receives the approved spec, relevant task context, and the changes to review.
6. **Resolve findings.** Review findings can return the task to implementation and another review. The user can inspect the results and decide when the work is ready. Creating a PR, completing review, and merging are distinct milestones; this example does not assume automatic merging.

The worktree provides continuity for the code. Agent sessions can change between stages without losing the task's specification, outputs, or history. Sequential stages should avoid agents making conflicting edits in the same worktree.

## Connections to the tools users already use

Jira and GitHub are the initial integration priorities. Jira can supply task descriptions, requirements, and status context. GitHub can supply issues, repository context, pull requests, checks, and review feedback. Other tools should fit the same model as needs become concrete.

Connections should support bringing context into a workflow and, where configured, publishing results back to the source tool. Users should be able to see which external task and PR belong to each run. Workflow configuration should make external actions and status updates explicit.

## User control throughout the run

Automation should follow the user's chosen workflow and approval points. Waiting for a spec review is a meaningful state, and the next stage must not start until that approval arrives.

Users should be able to pause, resume, cancel, request revisions, and retry a failed stage. Retries should preserve completed work and avoid duplicating external actions such as PR creation. A workflow should expose why it stopped, what it produced, and what it needs next.

Agent continuity is a deliberate choice: retaining the existing agent preserves conversational context, while starting a fresh reviewer provides an independent pass. Both should be available through configuration, with provider capabilities made clear.

## A dedicated orchestration view

Users need a precise overview of their orchestrated tasks and a way to act on the ones that need attention. **Orchestration** is the working name; whether it becomes a page or a tab remains open.

For each task, the view should show:

- The task title, source ticket, project, environment, and worktree.
- The selected workflow, current stage, and active agent or provider.
- Whether it is queued, running, awaiting approval, paused, blocked, failed, or complete.
- The latest meaningful result, including the spec, validation results, PR, or review findings.
- The next action the user can take and why it is needed.

Opening a task should reveal its stage history and the associated agent threads. Approvals should be attached to the artifact being reviewed, so the user can read a specification and approve it in context. The existing chat experience remains useful for directing an agent within a stage.

## Direction from OpenAI Symphony

[OpenAI Symphony](https://github.com/openai/symphony) provides inspiration for connecting tracked work to isolated agent execution. Its [service specification](https://github.com/openai/symphony/blob/main/SPEC.md) separates repository-owned workflow policy, workspace management, agent execution, scheduling, and observability. Its `WORKFLOW.md` combines configuration with an agent prompt template.

Orchestrator should borrow the ideas of inspectable workflow definitions, isolated workspaces, and visible execution state. The sequential skill stages, artifact approval checkpoints, configurable agent handoffs, and T3 Code orchestration view described here are our proposed product direction. Symphony is a reference, not a commitment to adopt its implementation or configuration format.

## Build on what makes T3 Code useful

The experience should preserve T3 Code's open foundation, provider choice, performance, and support for local and remote environments. Workflow execution should belong to the environment running the agents and continue when a client disconnects. Web, desktop, and mobile clients should be able to inspect progress and handle relevant approvals against that shared state.

The initial scope should prove one complete journey: start a task with a reusable sequential workflow, generate and approve a spec, implement it, create a PR, and run a configurable review. A general visual workflow builder, arbitrary parallel execution graphs, and a large integration catalog can wait until real workflows justify them.

Success means a user can start several tasks, understand where each one stands, and intervene at the moments they chose without repeatedly restating instructions or manually carrying context between agents.
