# Installation

**Download** from https://github.com/BeNomadSAS/mobileSDK-mcp/releases the release whose version equals the MSDK version of your
app, under **Assets**: `benomad-msdk-<version>.mcpb` for Claude Desktop, `benomad-msdk-mcp-<version>.tgz` for every
other assistant. Or clone the repository instead of taking the `.tgz` (step 1).

To check a download, compare its SHA-256 with its line in the release's `SHA256SUMS`:
`sha256sum -c SHA256SUMS --ignore-missing` on Linux, `shasum -a 256 <file>` on macOS,
`Get-FileHash <file> -Algorithm SHA256` in Windows PowerShell.

## Claude Desktop: the extension

Download `benomad-msdk-<version>.mcpb` from the release's **Assets** and double-click it, or open Settings →
Extensions → Advanced settings → Install Extension… and pick it. Claude Desktop runs it with its own Node.js: there is
nothing else to install.

To change MSDK version, install the `.mcpb` of that version.

## Every other assistant

You need Node.js 20 or later.

### 1. Install the package

Download `benomad-msdk-mcp-<version>.tgz` from the release's **Assets**, then:

```bash
mkdir -p ~/msdk-mcp && cd ~/msdk-mcp
npm init -y >/dev/null
npm install /path/to/benomad-msdk-mcp-<version>.tgz
```

In Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path "$HOME\msdk-mcp" | Out-Null
Set-Location "$HOME\msdk-mcp"
npm init -y | Out-Null
npm install C:\path\to\benomad-msdk-mcp-<version>.tgz
```

npm installs the server's two dependencies, the MCP SDK and zod, from the npm registry, at the versions the package
pins.

**Or from the repository:** the easiest to keep up to date. The same in a terminal and in PowerShell:

```bash
cd ~
git clone https://github.com/BeNomadSAS/mobileSDK-mcp.git msdk-mcp
cd msdk-mcp
npm install
```

The repository holds the newest release. For another MSDK version, run `git checkout v<version>` before
`npm install`.

Take one way, not both. From a clone, the server in step 2 is `src/index.js` in that folder, instead of
`node_modules/@benomad/msdk-mcp/src/index.js`.

### 2. Register it

**Claude Code:** in a terminal or in VS Code, it is the same registration. The `claude` command needs the Claude Code
CLI: the VS Code extension alone does not add it. From the folder of step 1:

```bash
claude mcp add -s user msdk -- node "$(pwd)/node_modules/@benomad/msdk-mcp/src/index.js"
```

In PowerShell, keep the quotes around `'--'`: without them, PowerShell drops it when `claude` was installed with npm,
and the command fails.

```powershell
claude mcp add -s user msdk '--' node "$PWD\node_modules\@benomad\msdk-mcp\src\index.js"
```

- `-s user` makes the server available in every project.
- Already registered? Run `claude mcp remove msdk -s user` first. In VS Code, then click **Reconnect** next to `msdk`
  in the MCP servers panel.

**Other assistants** use the same server, each in its own configuration file. Give the absolute path to
`node_modules/@benomad/msdk-mcp/src/index.js`, with forward slashes on Windows.

<details>
<summary><strong>Cursor</strong>: <code>~/.cursor/mcp.json</code></summary>

```json
{
  "mcpServers": {
    "msdk": {
      "command": "node",
      "args": ["/absolute/path/to/node_modules/@benomad/msdk-mcp/src/index.js"]
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code with GitHub Copilot</strong>: your user <code>mcp.json</code>, key <code>servers</code></summary>

```json
{
  "servers": {
    "msdk": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/node_modules/@benomad/msdk-mcp/src/index.js"]
    }
  }
}
```

Open it from the command palette: **MCP: Open User Configuration**. The key is `servers`, not `mcpServers`. Prefer it
to the workspace's `.vscode/mcp.json`: the path is the one on your machine.

</details>

<details>
<summary><strong>Devin Desktop</strong> (formerly Windsurf): <code>~/.config/devin/mcp_config.json</code></summary>

On Windows the file is `%APPDATA%\devin\mcp_config.json`.

```json
{
  "mcpServers": {
    "msdk": {
      "command": "node",
      "args": ["/absolute/path/to/node_modules/@benomad/msdk-mcp/src/index.js"]
    }
  }
}
```

</details>

<details>
<summary><strong>OpenAI Codex CLI</strong>: <code>~/.codex/config.toml</code></summary>

```toml
[mcp_servers.msdk]
command = "node"
args = ["/absolute/path/to/node_modules/@benomad/msdk-mcp/src/index.js"]
```

</details>

<details>
<summary><strong>Gemini CLI</strong>: <code>~/.gemini/settings.json</code></summary>

```json
{
  "mcpServers": {
    "msdk": {
      "command": "node",
      "args": ["/absolute/path/to/node_modules/@benomad/msdk-mcp/src/index.js"]
    }
  }
}
```

Add `mcpServers` beside the file's other settings; `gemini mcp list` shows the server.

</details>

<details>
<summary><strong>Zed</strong>: your user <code>settings.json</code>, key <code>context_servers</code></summary>

```json
{
  "context_servers": {
    "msdk": {
      "command": "node",
      "args": ["/absolute/path/to/node_modules/@benomad/msdk-mcp/src/index.js"]
    }
  }
}
```

The file is `~/.config/zed/settings.json`, or `%APPDATA%\Zed\settings.json` on Windows.

</details>

## Check it works

Ask your assistant:

> Using the msdk tools, how do I initialise the MSDK Core?

The answer names `Core.init`. To see which MSDK version the server documents, ask for the MSDK documentation status:
the `msdk_status` tool gives it.

## If something is wrong

- **The assistant does not see the tools:** check `claude mcp list` (or `/mcp` in Claude Code's VS Code panel), then
  restart the assistant.
- **The answers describe another MSDK version:** `msdk_status` says which version the server documents. Install the
  release of your app's MSDK version.
- **`npm install` cannot download the dependencies:** they come from the npm registry. Behind a company proxy or
  registry, set npm up for it (`npm config get registry`), or use Claude Desktop's `.mcpb`, which includes them.
- **npm warns "Unsupported engine", or the server does not start:** your Node.js is older than 20. Check it with
  `node --version`, then install Node.js 20 or later.

## Upgrading

When your app moves to another MSDK version, install the release of that version:

- **Claude Desktop:** install its `.mcpb`.
- **The package:** install its `.tgz` the same way, in the same folder: it replaces the previous one.
- **A clone:** `git pull` for the newest release, or `git checkout v<version>` for another one, then `npm install`.

Then restart your assistant.

## Support

**msdk@benomad.com**
