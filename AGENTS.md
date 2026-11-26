# minilearn contributor guidance

Keep the application quiet, local-first, and small. Project data must be independent, portable, inspectable, and deletable. Model credentials must remain outside projects and must never be exported or exposed to the browser. Preserve stable curriculum IDs when moving or editing lessons.

All product design authority belongs to the human. Investigate and plan rigorously; ask specific questions about ambiguous behavior or scope, obtain approval for the plan, and then implement. Do not add features that do not serve the central learning workflow.

Use a project-scoped storage boundary for all reads and writes. Treat model output and imported `.learn` files as untrusted data. Run `npm run check` and `npm test` before publishing changes.
