# myboxctl

[한국어](https://github.com/oliverne/myboxctl/blob/main/README.ko.md)

`myboxctl` is a small, predictable CLI for managing files through the NAVER MYBOX Open API.
It is built for AI-agent subprocesses and remains readable for direct terminal use. It is not a
sync tool, SDK, MCP server, or complete API wrapper.

I built it for my own Hermes Agent and Codex CLI workflows. This is an independent project and is
not affiliated with NAVER.

## Commands

| Command       | Purpose                                            |
| ------------- | -------------------------------------------------- |
| `list` / `ls` | List a folder or show one resource                 |
| `info`        | Show file or folder metadata                       |
| `mkdir`       | Create a remote folder; supports `-p`              |
| `upload`      | Upload or update using size and modification time  |
| `download`    | Download without overwriting local data by default |
| `delete`      | Move a remote file or folder to the MYBOX trash    |

## Install

Requires Node.js 20 or later.

```bash
npm install -g @oliverne/myboxctl
myboxctl --version
```

Set a MYBOX PAT through `MYBOX_PAT`, or store one token line in
`~/.config/myboxctl/credentials` with file mode `600`. Never pass a PAT as a CLI argument or put it
in source code, logs, or Git.

## Quick start

Remote paths are absolute POSIX paths beginning with `/`.

```bash
myboxctl list /agents
myboxctl info /agents/report.md
myboxctl mkdir -p /agents/output
myboxctl upload ./report.md /agents/output/ --mkdir
myboxctl download /agents/output/report.md ./report.md
myboxctl delete /agents/output/report.md
```

Paths containing spaces must be quoted so that the shell passes each path as one argument. The
quotes are shell syntax and are not part of the local or remote file name.

PowerShell accepts single or double quotes:

```powershell
myboxctl download '/Team Files/big report.zip' '.\Local Files\big report.zip'
```

Use double quotes in Command Prompt (`cmd.exe`):

```bat
myboxctl download "/Team Files/big report.zip" ".\Local Files\big report.zip"
```

Important behavior:

- `upload` compares size and modification time, not content hashes. It skips matching files and
  rejects a clearly newer remote file; use `--force` only for an intentional overwrite.
- `download` preserves an existing local file unless `--overwrite` is explicit.
- `delete` moves resources to the MYBOX trash. Root, encrypted folders, and shared-with-me folders
  are unsupported.
- New remote names use NFC. Ambiguous Unicode-equivalent names fail safely.

## Automation

Use `--json` and check the exit code first. Stdout contains one `schemaVersion: 1` JSON result. With
`--verbose`, safe progress events are written as JSON Lines to stderr. PATs and signed transfer URLs
are redacted.

```bash
myboxctl upload ./report.md /agents/output/ --mkdir --json
```

| Exit | Meaning                        |
| ---: | ------------------------------ |
|    0 | Success                        |
|  2–5 | Input, auth, missing, conflict |
|  6–8 | API, local I/O, rate limit     |
|   70 | Unexpected internal error      |

See the [versioned CLI contract](docs/reference/cli-contract.md) for exact JSON fields, actions,
options, and exit-code semantics.

## Development

Source development requires Bun 1.4 or later.

```bash
bun install --frozen-lockfile
bun run check
bun run build
```

Live MYBOX tests are opt-in and mutate only an isolated test prefix.

```bash
MYBOX_PAT=<YOUR_PAT> bun run test:integration
```

## Documentation

- [CLI contract](docs/reference/cli-contract.md)
- [NAVER MYBOX Open API](https://developers.mybox.naver.com/getting-started)

## License

[MIT](LICENSE)
