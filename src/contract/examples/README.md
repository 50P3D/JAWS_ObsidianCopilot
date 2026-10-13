# Example claim cards

Fake data for building and testing against the claim card format in `../claimCard.ts`.

- The `revision_id` values and URLs are placeholders. They do not point to real Wikipedia revisions.
- The reliability badges and retrieval scores are made up.
- Use these as input for the plugin panel and the MCP server, and as expected output shapes for retrieval, the scorer and the verifier.

| File | Shows |
|---|---|
| `refuted.json` | A claim that is wrong, with a suggested fix |
| `supported.json` | A claim that is right, with a Medium trust badge |
| `not-enough-info.json` | Weak evidence, so no verdict either way. Also shows the `stubbed` field. |
