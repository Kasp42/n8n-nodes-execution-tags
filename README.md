# n8n-nodes-execution-tags

[n8n](https://n8n.io) community node that reads and changes **annotation tags of an execution**
through the n8n public API (`GET` / `PUT /api/v1/executions/{id}/tags`).

## Installation

In n8n: **Settings → Community nodes → Install**, enter `n8n-nodes-execution-tags`.
See the [community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Operations

| Operation          | What it does                                                |
|--------------------|-------------------------------------------------------------|
| Get Tags           | Returns current tags of the execution                       |
| Set Tags (Replace) | Replaces the whole tag set (empty value clears tags)        |
| Add Tags           | Reads current tags, merges the given tags, writes the result |
| Remove Tags        | Reads current tags, drops the given tags, writes the result  |

`Execution ID` defaults to `{{ $execution.id }}` (the current execution).

Tags can be given **by name** (default) or **by ID** (`Tags By`). With names the node looks tags up via `GET /tags` and, for Add/Set, creates missing ones via `POST /tags` (`Create Missing Tags`), then assigns them. Remove never creates tags.

## Credentials

Create an **Execution Tags API** credential:

- Base URL: optional. Leave empty to use the n8n instance the node runs on, or enter another instance URL, e.g. `https://your-n8n-host/api/v1` (`/api/v1` is appended automatically if missing). The credential test only checks the connection when the field is filled
- API Key: create it in n8n under **Settings → n8n API**
- API key scopes: `execution:list` (credential test), `executionTags:list` and `executionTags:update` (read/change execution tags), `tag:list` and `tag:create` (tags by name). If n8n answers 403 Forbidden, a scope is missing.

## Notes and limitations

- The execution tags endpoint takes tag IDs; by-name mode resolves names through the n8n `/tags` API. If assigning a tag fails with "Some tags not found", your n8n keeps execution tags separately from `/tags` - use `Tags By: IDs` with IDs from *Get Tags*.
- Tagging an execution that is still running may not work on every n8n version. If it fails, call the node from a separate workflow after the main one finishes.
- Add / Remove are read-modify-write; two parallel runs on the same execution can overwrite each other.

## Development

```bash
npm install
npm run dev     # local n8n with hot reload via n8n-node
npm run lint
npm run build
```

Releases are published from GitHub Actions via npm Trusted Publishing (no token needed):
bump `version` in `package.json`, then push a matching tag, e.g. `git tag v0.2.1 && git push origin v0.2.1`.
The publisher (`publish.yml`) must be configured for the package on npmjs.com.

## License

MIT
