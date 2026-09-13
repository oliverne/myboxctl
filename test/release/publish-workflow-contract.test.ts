import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const WORKFLOW_PATH = ".github/workflows/publish-npm.yml";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};

type Job = {
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps?: Step[];
};

type Workflow = {
  on?: { workflow_dispatch?: { inputs?: Record<string, { required?: boolean }> } };
  permissions?: Record<string, string>;
  jobs?: Record<string, Job>;
};

const REQUESTED_TAG_REF = /^\$\{\{ inputs\.tag \}\}$/u;

async function readWorkflow(): Promise<Workflow> {
  return Bun.YAML.parse(await readFile(WORKFLOW_PATH, "utf8")) as Workflow;
}

function steps(job: Job | undefined): Step[] {
  return job?.steps ?? [];
}

function runScript(job: Job | undefined): string {
  return steps(job)
    .map((step) => step.run ?? "")
    .join("\n");
}

function stepIndex(job: Job | undefined, pattern: RegExp): number {
  return steps(job).findIndex((step) => pattern.test(step.run ?? ""));
}

function checkoutRef(job: Job | undefined): unknown {
  return steps(job).find((step) => step.uses?.startsWith("actions/checkout"))?.with?.ref;
}

describe("publish-npm workflow", () => {
  test("keeps the tag dispatch contract used by npm Trusted Publishing", async () => {
    const workflow = await readWorkflow();
    const inputs = workflow.on?.workflow_dispatch?.inputs;
    expect(inputs?.tag?.required).toBe(true);
  });

  test("splits OIDC publish and contents-write release permissions", async () => {
    const workflow = await readWorkflow();

    expect(Object.keys(workflow.permissions ?? {})).toEqual([]);
    expect(workflow.jobs?.publish?.permissions).toEqual({
      contents: "read",
      "id-token": "write",
    });
    expect(workflow.jobs?.release?.permissions).toEqual({ contents: "write" });
  });

  test("creates the GitHub Release only after the npm publish succeeds", async () => {
    const workflow = await readWorkflow();
    const publish = workflow.jobs?.publish;
    const release = workflow.jobs?.release;

    expect([release?.needs].flat()).toContain("publish");
    expect(runScript(release)).not.toMatch(/publish:npm|npm publish/);
    expect(runScript(publish)).not.toMatch(/gh release create/);
  });

  test("verifies the release note before publishing and reuses it for the Release", async () => {
    const workflow = await readWorkflow();
    const publish = workflow.jobs?.publish;
    const release = workflow.jobs?.release;

    const verify = /verify:release-notes|verify-release-notes/;
    const publishStep = /publish:npm/;

    const verifyIndex = stepIndex(publish, verify);
    const publishIndex = stepIndex(publish, publishStep);
    expect(verifyIndex).toBeGreaterThanOrEqual(0);
    expect(publishIndex).toBeGreaterThanOrEqual(0);
    expect(verifyIndex).toBeLessThan(publishIndex);

    const releaseScript = runScript(release);
    expect(releaseScript).toMatch(verify);
    expect(releaseScript).toMatch(/gh release create/);
    expect(releaseScript).toMatch(/--notes-file/);
    expect(releaseScript).toMatch(/--verify-tag/);
  });

  test("accepts an existing Release only when it matches the note", async () => {
    const workflow = await readWorkflow();
    const script = runScript(workflow.jobs?.release);

    expect(script).toContain("--json tagName,body,isDraft,isPrerelease");
    expect(script).toContain(".isDraft");
    expect(script).toContain(".isPrerelease");
    expect(script).toContain('"$tag_name" != "$TAG"');
    expect(script).toContain('"$existing" != "$expected"');
    expect(script).toContain("exit 1");
    expect(script).toContain("exit 0");
    expect(script).not.toMatch(/gh release (edit|delete)/);
  });

  test("never creates or moves tags and never generates the body automatically", async () => {
    const workflow = await readWorkflow();
    const script = `${runScript(workflow.jobs?.publish)}\n${runScript(workflow.jobs?.release)}`;

    expect(script).not.toMatch(/\bgit tag\b/);
    expect(script).not.toMatch(/\bgit push\b/);
    expect(script).not.toMatch(/--generate-notes/);
  });

  test("checks out the requested tag in both jobs", async () => {
    const workflow = await readWorkflow();
    expect(checkoutRef(workflow.jobs?.publish)).toMatch(REQUESTED_TAG_REF);
    expect(checkoutRef(workflow.jobs?.release)).toMatch(REQUESTED_TAG_REF);
  });
});
