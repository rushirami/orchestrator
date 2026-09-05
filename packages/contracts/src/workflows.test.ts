import { describe, expect, it } from "vite-plus/test";
import { resolveWorkflowPrompt, workflowVariables } from "./workflows.ts";

describe("workflow prompt variables", () => {
  it("deduplicates variables while preserving first occurrence order", () => {
    expect(workflowVariables("{{ TASK_ID }} / {{SUMMARY}} / {{TASK_ID}}")).toEqual([
      "TASK_ID",
      "SUMMARY",
    ]);
  });
  it("substitutes literally once without interpreting code or replacement strings", () => {
    expect(
      resolveWorkflowPrompt("Review {{TASK}} then {{ TASK }}", { TASK: "$& {{OTHER}} $(echo no)" }),
    ).toBe("Review $& {{OTHER}} $(echo no) then $& {{OTHER}} $(echo no)");
  });
  it("requires own, nonblank values and rejects malformed placeholders", () => {
    expect(() => resolveWorkflowPrompt("{{ toString }}", {})).toThrow("toString");
    expect(() => resolveWorkflowPrompt("{{ TASK }}", { TASK: " " })).toThrow("TASK");
    expect(() => resolveWorkflowPrompt("{{ a.b }}", {})).toThrow("VARIABLE_NAME");
    expect(() => resolveWorkflowPrompt("{{ TASK", {})).toThrow("VARIABLE_NAME");
  });
  it("preserves nested JSON and closing braces around substituted variables", () => {
    const prompt = 'Build {{ TASK }} using {"spec": {"done": true}} and {"name": "{{ TASK }}"}';
    expect(resolveWorkflowPrompt(prompt, { TASK: "a greeting" })).toBe(
      'Build a greeting using {"spec": {"done": true}} and {"name": "a greeting"}',
    );
    expect(resolveWorkflowPrompt('{"spec": {"done": true}}', {})).toBe('{"spec": {"done": true}}');
  });
  it("accepts a reusable prompt without variables", () => {
    expect(resolveWorkflowPrompt("Inspect this project", {})).toBe("Inspect this project");
  });
});
