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
| Add Tags           | Reads current tags, merges the given IDs, writes the result |
| Remove Tags        | Reads current tags, drops the given IDs, writes the result  |

`Execution ID` defaults to `{{ $execution.id }}` (the current execution).

## Credentials

Create an **Execution Tags API** credential (same fields as the built-in n8n API credential):

- Base URL: `https://<your-host>/api/v1`
- API Key: an n8n API key
- The API key needs the scopes `executionTags:list` and `executionTags:update`.

## Notes and limitations

- The API expects **annotation tag IDs**. Find an ID by running *Get Tags* on an execution that already has the tag.
- Tagging an execution that is still running may not work on every n8n version. If it fails, call the node from a separate workflow after the main one finishes.
- Add / Remove are read-modify-write; two parallel runs on the same execution can overwrite each other.

## Development

```bash
npm install
npm run dev     # local n8n with hot reload via n8n-node
npm run lint
npm run build
```

Releases are published from GitHub Actions with npm provenance: push a tag like `v0.1.0`
(requires the `NPM_TOKEN` repository secret).

## License

MIT
