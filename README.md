# Craftly Ideas

Craftly Ideas is a web MVP for generating handcraft project ideas from the materials a user types into the Creative prompt box.

## What It Does

- Landing page with login/signup flow
- Apple, Google, and email preview sign-in options
- Prompt-bound craft idea generation
- Step-by-step instructions using only the materials in the prompt
- Related web inspiration link generated from the prompt
- Privacy framing that prompts and creations are not used to train AI

## Run Locally

```bash
npm start
```

Then open:

```text
http://localhost:8000
```

## Replit Notes

Replit can run this project with the `npm start` script. For real web search results, add a secret named `BRAVE_SEARCH_API_KEY`. Without that key, the app falls back to a focused Google search link based on the user prompt.
