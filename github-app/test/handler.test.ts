import { describe, expect, it, vi } from "vitest";
import {
  buildCommentBody,
  COMMENT_MARKER,
  handlePreviewRequest,
  type OrchestratorClient,
  type PrRef,
} from "../src/handler.js";

const PR: PrRef = {
  owner: "kju-ai",
  repo: "app",
  number: 7,
  headSha: "abcdef1234567890",
  labels: ["app-preview"],
};

function mockOctokit(opts: {
  configYaml?: string | null;
  artifacts?: { name: string; expired?: boolean }[];
  existingComment?: boolean;
}) {
  const created: string[] = [];
  const updated: string[] = [];
  return {
    created,
    updated,
    rest: {
      repos: {
        getContent: vi.fn(async () => {
          if (opts.configYaml == null) throw Object.assign(new Error("nf"), { status: 404 });
          return {
            data: {
              content: Buffer.from(opts.configYaml).toString("base64"),
              encoding: "base64",
            },
          };
        }),
      },
      actions: {
        listWorkflowRunsForRepo: vi.fn(async () => ({
          data: { workflow_runs: [{ id: 1 }] },
        })),
        listWorkflowRunArtifacts: vi.fn(async () => ({
          data: {
            artifacts: (opts.artifacts ?? []).map((a, i) => ({
              id: i + 1,
              name: a.name,
              expired: a.expired ?? false,
            })),
          },
        })),
      },
      issues: {
        listComments: vi.fn(async () => ({
          data: opts.existingComment
            ? [{ id: 99, body: `${COMMENT_MARKER}\nold` }]
            : [],
        })),
        createComment: vi.fn(async ({ body }: { body: string }) => {
          created.push(body);
        }),
        updateComment: vi.fn(async ({ body }: { body: string }) => {
          updated.push(body);
        }),
      },
      pulls: { get: vi.fn() },
    },
    request: vi.fn(async () => ({ headers: { location: "https://signed.example/apk.zip" } })),
  };
}

function mockOrchestrator(): OrchestratorClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    createSession: vi.fn(async (req: { device: string }) => {
      calls.push(req);
      return {
        id: `s-${req.device}`,
        status: "booting",
        playerUrl: `https://preview.test/pr/abcdef1/${req.device}?t=jwt`,
      };
    }) as never,
  };
}

describe("handlePreviewRequest", () => {
  it("skips PRs without the configured label", async () => {
    const octokit = mockOctokit({ configYaml: "label: other-label\n" });
    const result = await handlePreviewRequest(octokit as never, mockOrchestrator(), PR);
    expect(result).toBe("skipped");
    expect(octokit.created).toHaveLength(0);
  });

  it("posts a pending comment when no artifact exists yet", async () => {
    const octokit = mockOctokit({ configYaml: null, artifacts: [] });
    const pr = { ...PR, labels: ["app-preview"] };
    const result = await handlePreviewRequest(octokit as never, mockOrchestrator(), pr);
    expect(result).toBe("pending");
    expect(octokit.created[0]).toContain("Waiting for CI");
  });

  it("creates a session per device and comments the links", async () => {
    const octokit = mockOctokit({
      configYaml: `
app_id: ai.kju.app
devices: [pixel-7, samsung-a16]
backend_url: "https://pr-{number}.preview.kju.ai"
artifact: preview-apk
`,
      artifacts: [{ name: "preview-apk" }],
    });
    const orch = mockOrchestrator();
    const result = await handlePreviewRequest(octokit as never, orch, PR);
    expect(result).toBe("done");
    expect(orch.calls).toHaveLength(2);
    expect(orch.calls[0]).toMatchObject({
      prHash: "abcdef1",
      device: "pixel-7",
      apkUrl: "https://signed.example/apk.zip",
      backendUrl: "https://pr-7.preview.kju.ai",
    });
    expect(octokit.created[0]).toContain("▶ Open interactive preview");
    expect(octokit.created[0]).toContain("samsung-a16");
  });

  it("updates the existing marker comment instead of duplicating", async () => {
    const octokit = mockOctokit({
      configYaml: "artifact: preview-apk\n",
      artifacts: [{ name: "preview-apk" }],
      existingComment: true,
    });
    await handlePreviewRequest(octokit as never, mockOrchestrator(), PR);
    expect(octokit.updated).toHaveLength(1);
    expect(octokit.created).toHaveLength(0);
  });

  it("ignores expired artifacts", async () => {
    const octokit = mockOctokit({
      configYaml: "artifact: preview-apk\n",
      artifacts: [{ name: "preview-apk", expired: true }],
    });
    const result = await handlePreviewRequest(octokit as never, mockOrchestrator(), PR);
    expect(result).toBe("pending");
  });
});

describe("buildCommentBody", () => {
  it("always starts with the marker", () => {
    expect(buildCommentBody([], { headSha: "abc1234", pending: true })).toMatch(
      new RegExp(`^${COMMENT_MARKER}`),
    );
  });
});
