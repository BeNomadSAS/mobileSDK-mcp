# MSDK MCP

Gives your AI coding assistant (Claude, Codex, Gemini CLI, Cursor, Copilot and others) the documentation of the
BeNomad MSDK for Android: its API reference and its module guides. The assistant looks the MSDK API up instead of
guessing it.

## Status

No release yet. Packages are published with the MSDK: each MSDK release gets a release of this package, and each
beta MSDK version a pre-release. From the first release on, this repository holds the newest release, and this page
describes it.

## Download

**https://github.com/BeNomadSAS/msdk-mcp/releases**: the release whose version equals the MSDK version of your app,
under **Assets**:

| File | For |
|---|---|
| `benomad-msdk-<version>.mcpb` | Claude Desktop: double-click it |
| `benomad-msdk-mcp-<version>.tgz` | every other assistant |
| `SHA256SUMS` | the checksums of both files |

Each package holds its installation guide, `INSTALL.md`.

## What is inside

Documentation, and the small program that serves it:

- the public API reference of the MSDK modules the package covers: every class, function and property, with its
  signature, its parameters and its documentation, exported from the MSDK's published reference;
- the module pages: integration, set-up and samples, in Kotlin;
- the MSDK version they describe.

No MSDK source code, no native code, no account or customer data, no map data. It works offline: the server makes no
network connection and collects no data.

## Install

| Your assistant | How |
|---|---|
| Claude Desktop | double-click the `.mcpb` |
| Claude Code, in a terminal or in VS Code | the `.tgz`, then one command |
| Cursor, VS Code Copilot, Codex, Gemini CLI, Zed, Devin | the `.tgz`, then a few lines of configuration |

Then ask your assistant:

> How do I initialise the MSDK Core?

## Tools

| Tool | What it returns |
|---|---|
| `msdk_status` | The MSDK version documented, its modules and guides, and the rules for using the answers |
| `msdk_get_started` | The integration and initialisation steps |
| `msdk_search_docs` | Ranked search over the API reference and the guides |
| `msdk_get_api` | The exact signature and documentation of a class, function or property, and the members of a type |
| `msdk_get_guide` | A module page or guide, whole or one section |

Every tool is read-only.

## MCP protocol

The server speaks MCP 2026-07-28, the current revision, and the 2025 revisions over stdio: the client's first
message picks the revision. It needs Node.js 20 or later.

Limitations:

- stdio only: no HTTP transport.
- No optional MCP features such as Tasks, resources or prompts: only tools.
- The tool list never changes while the server runs.

## Support

**msdk@benomad.com**. Use of each package is governed by the `LICENSE.md` it contains.
