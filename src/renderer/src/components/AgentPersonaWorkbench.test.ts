import { describe, expect, it } from "vitest";
import { patchAgentFrontmatter, patchTomlScalar } from "./AgentPersonaWorkbench";

describe("AgentPersonaWorkbench raw-field patching", () => {
  it("updates a known Agent field without reserializing comments or unknown YAML", () => {
    const raw = "---\r\nname: reviewer\r\ndescription: >\r\n  Old folded\r\n  description\r\n# keep this comment\r\nfuture_field: keep-me\r\n---\r\n\r\nInstructions\r\n";
    const changed = patchAgentFrontmatter(raw, "description", "New description");
    expect(changed).toContain('description: "New description"\r\n# keep this comment\r\nfuture_field: keep-me');
    expect(changed).toContain("---\r\n\r\nInstructions\r\n");
  });

  it("updates top-level Persona defaults while leaving contracts and unknown TOML intact", () => {
    const raw = "# keep\ndescription = \"Reviewer\"\nfuture_key = \"keep-me\"\n\n[[inputs]]\nname = \"file\"\nrequired = true\n";
    const changed = patchTomlScalar(raw, "default_isolation", "worktree");
    expect(changed).toContain('# keep\ndescription = "Reviewer"\nfuture_key = "keep-me"');
    expect(changed).toContain('default_isolation = "worktree"\n[[inputs]]');
    expect(changed).toContain('name = "file"\nrequired = true');
  });
});
