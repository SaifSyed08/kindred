# Kindred

Personal AI agents that talk to each other to find you real friendships, and reasons to reconnect with old ones.

Instead of searching for people, you talk to your agent. It learns who you are, then goes out and has actual conversations with other people's agents. When two agents both decide an introduction is worth their person's time, you each get an invitation; accept, and the agents introduce you in a shared chat with a suggested plan.

## Run

```bash
npm install
npm run dev        # http://localhost:3100
```

Needs `OPENAI_API_KEY` in the environment (or `.env.local`). Node 22+: the scripts pass `--experimental-sqlite` for the built-in `node:sqlite`; the database lives in `data/kindred.db` and is seeded with 8 demo users on first start. "Reset demo data" in the user menu reseeds it.

Optional: `KINDRED_MODEL` (default `gpt-5.4-mini`), `KINDRED_REASONING` (default `low`).

## Screens

- **My Agent**: voice onboarding (tap the orb; it stops listening when you pause). The agent replies out loud and updates the profile and memory live. Private memories stay between you and your agent: no agent-to-agent conversation, verdict or match card ever sees them.
- **Discover**: "Find connections" runs a discovery. A network shows your agent at the centre. Message packets travel along the edges, discoveries pop up as chips, and interest rings fill. The right panel streams each conversation with the agents' reasoning, then both agents' private verdicts.
- **Connections**: invitations with the compatibility explanation, shared interests, suggested plan and the full agent transcript. Once both people accept, the shared chat opens and the agents break the ice.

The user menu (top right) switches who you are viewing as, so one presenter can accept both sides.

## How discovery works

1. **Shortlist**: embeddings (`text-embedding-3-small`) rank everyone by semantic overlap. Friends you haven't talked to in 45+ days always get a conversation (that's how reconnections surface). Friends you talk to regularly and people with a pending intro are skipped.
2. **Conversations** (up to 4 in parallel, 4-8 turns): each turn is a structured message `{thought, type, text, discoveries, interest, done}` written by the speaking agent with only its own person's dossier. It learns about the other person only through the conversation.
3. **Private verdicts**: each agent separately scores the fit against a calibrated rubric and recommends only at 75 or above. Both must say yes.
4. **Match**: a synthesis call writes the card (headline, explanation, shared chips, activity) and a personal invitation for each person, grounded in the transcript.
5. **Memory**: both agents save a note about the conversation, which later conversations can use.

Everything the Discover screen shows is persisted as an event log (`events` table) and streamed over SSE, so reloading the page replays the run.

## Demo script

1. View as Maya, open **Discover**, press **Find connections**.
2. Maya's agent opens with Theo's agent (an old friend from the Cal robotics club; they haven't talked in about 6 months). Within a few turns one agent notices they're both registered for the Golden Gate Hardware Hackathon and both without a team. Strangers like Sam and Marcus get turned down: the agents pass on most people on purpose.
3. A "Reconnection found" card appears. Open the invitation, show "See how your agents found this", then accept.
4. Switch to Theo (top right), accept. The shared chat opens and the agents introduce them with a suggested plan.
5. On **My Agent**, talk to the agent by voice and watch the profile update.

## Layout

- `lib/agents.ts`: all prompts and structured-output schemas (agent turn, verdict, match card, intro, onboarding)
- `lib/discovery.ts`: run orchestration (shortlist, parallel conversations, verdicts, matches, memory)
- `lib/intro.ts`: shared chat creation and the agents' introduction
- `lib/db.ts`, `lib/store.ts`, `lib/seed.ts`: SQLite schema, queries and demo users
- `lib/llm.ts`: OpenAI REST (chat with JSON schema, embeddings, transcription, TTS)
- `app/api/*`: route handlers; `app/{agent,discover,connections}`: screens
