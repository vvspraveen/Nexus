# Nexus: the AI Work OS

**Knowledge goes in, finished work comes out.**

Knowledge workers spend about 20% of their week looking for information, and a lot more turning meetings into follow-ups and policies into checklists. Nexus is one workspace that closes the loop from *knowing* to *deciding* to *done*:

| Capability | What it does | Why it matters |
|---|---|---|
| **Ask** | Answers questions about company knowledge, with inline citations and a confidence level | Trustworthy: every claim is traceable to a source |
| **Conflict detection** ⭐ | Notices when two documents disagree (for example $50 vs $75 meal allowance), says which one to trust and why, and offers to create a fix-it task | Most assistants confidently give the *stale* answer. Nexus catches it. |
| **Meeting Intelligence** | Turns a transcript into decisions, action items (owner, due date, priority), risks, open questions and a follow-up email; one click pushes the actions to the task board | Saves about 30 minutes per meeting, and nothing gets dropped |
| **Knowledge drift** ⭐ | Compares meeting decisions with existing docs and flags documents that are now out of date | Keeps the knowledge base true without anyone maintaining it |
| **Autopilot** | An agent that takes a goal ("Onboard Priya on Monday"), searches policy, creates the owned tasks and drafts the emails, with a live step-by-step trace | Turns policy into action. The trace keeps it transparent and auditable. |
| **Impact** | Live dashboard of hours saved, conflicts caught and work automated | Puts a measurable ROI on the screen |

## Run it (30 seconds, zero dependencies)

Requires Node.js 22.9 or later. There is nothing to `npm install`.

```bash
cd nexus
cp .env.example .env      # add your GEMINI_API_KEY for full AI mode
npm start                 # → http://localhost:3000
```

- **Live mode** (Gemini key set): Google Gemini handles grounded answers, structured extraction and function calling for the agent. Get a key at https://aistudio.google.com/apikey.
- **Demo mode** (no key, or `npm run demo`): runs fully offline with BM25 search and rule-based extraction.
- If the live API fails mid-demo, every feature **falls back to offline mode automatically**, so the demo keeps working.

## Deploy to Google Cloud Run (share a link)

The app runs as-is on Cloud Run. Credentials live in **Secret Manager**, never in the code, and an optional shared **passcode** keeps strangers from using up your AI quota.

In **Cloud Shell** (console.cloud.google.com → `>_` icon), upload `nexus-deploy.zip`, then:

```bash
unzip nexus-deploy.zip -d nexus && cd nexus
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com secretmanager.googleapis.com

# Gemini API key as a secret (hidden while you paste). Run once.
read -s -p "Paste Gemini API key: " KEY; echo
printf '%s' "$KEY" | gcloud secrets create gemini-api-key --data-file=-; unset KEY

# Let Cloud Run read it
SA="$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding gemini-api-key --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor

# Deploy (builds in the cloud, no Docker needed)
gcloud run deploy nexus --source . --region us-central1 --allow-unauthenticated \
  --max-instances 1 \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --set-env-vars NEXUS_PASSCODE=pick-a-passcode
```

**Alternative, with no API key: Gemini on Vertex AI.** Cloud Run signs in to Vertex AI with its own service account, and usage is billed to your Google Cloud project:

```bash
gcloud services enable aiplatform.googleapis.com
gcloud projects add-iam-policy-binding $(gcloud config get-value project) --member="serviceAccount:$SA" --role=roles/aiplatform.user
gcloud run deploy nexus --source . --region us-central1 --set-env-vars AI_PROVIDER=vertex
```

The command prints a `https://nexus-….run.app` URL. Share it together with the passcode (any username works). To remove the passcode: `gcloud run services update nexus --region us-central1 --remove-env-vars NEXUS_PASSCODE`.

- **Redeploy after changes:** `gcloud run deploy nexus --source . --region us-central1`. Secrets and settings are kept.
- **Data is temporary:** uploads, tasks and metrics reset when Cloud Run restarts the app, which happens after it sits idle. Documents in `data/seed/` are always there. On demo day, add `--min-instances 1` so it stays warm with no data loss and no cold start; it costs a few dollars a day, so remove it afterwards.
- **`--max-instances 1`** keeps every visitor on the same copy of the app, so they see the same tasks and documents.

## 3-minute demo script

1. **Hook (20s):** "Every company has the answer somewhere, and usually in two places that disagree."
2. **Ask → conflict (40s):** Click *"What's the daily meal allowance when travelling?"*. Nexus shows the old policy says $50, the September memo says $75, and it trusts the newer one. Click a citation chip to show the source, then click **+ Task** to create a fix-it task.
3. **Meetings (50s):** Open Meetings, click *Load sample transcript*, then *Analyze*. Point out the decisions, the owners with due dates, and the risks. Then show **Knowledge drift**: the roadmap still says five beta partners, but the meeting changed that. Push the actions to the board.
4. **Autopilot (50s):** Click *"Onboard Priya Shah…"*. Watch the agent search the onboarding guide and create 8 owned tasks (IT, hiring manager, Priya) plus a welcome email.
5. **Tasks & Impact (20s):** Show the board filled from three sources, then the Impact page: hours saved, conflicts caught, and the extrapolation to a 200-person company.
6. **Close:** "Nexus doesn't just find answers. It finds the *right* answer, and then gets the work done."

## Architecture

```
public/            Single-page UI (vanilla JS, no build step)
server.js          HTTP API + NDJSON streaming for the agent trace
lib/rag.js         Section-aware chunking + BM25 retrieval (offline, instant)
lib/llm.js         Gemini client (Gemini API or Vertex AI) over plain fetch, no SDK
lib/features.js    ask() · meeting() · autopilot()  each has a live path and an offline fallback
lib/store.js       JSON-file store: docs, tasks, emails, metrics
data/seed/         Sample company knowledge base (Acme Robotics)
```

- **Grounding:** retrieved passages are numbered, the model must cite `[n]`, and it says "not found" instead of guessing.
- **Agent:** a tool-use loop (`search_knowledge`, `create_task`, `draft_email`, `list_tasks`) whose steps stream to the UI as they happen.
- **Model:** `gemini-3.8-flash` by default. Override it with `NEXUS_MODEL` (e.g. `gemini-4-argon` for the most capable model).

## Roadmap after the hackathon

Connectors (Google Drive, Confluence, Slack, Notion) · embeddings for semantic search · per-user permissions on documents · Slack bot surface · push tasks to Jira, Asana or Linear · calendar integration for auto-ingesting meetings.
