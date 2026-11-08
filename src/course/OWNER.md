# src/course

**Owner:** Medapati (proposed; confirm with the team and add to CODEOWNERS)

RAG over the user's own course materials: chunks and embeds a folder of markdown files once, keeps the index up to date as files change, and returns the closest passages as contract `Evidence` with `source: "course"`. The orchestrator checks these before Wikipedia.

Only the owner edits this folder. Anyone else who needs a change opens a pull request and asks the owner to approve it.
