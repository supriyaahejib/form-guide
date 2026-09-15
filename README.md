# FormGuide

FormGuide is a voice-first browser assistant for helping people complete confusing online forms. It reads a form one field at a time, translates formal wording into plain English, listens to a spoken response, and fills the matching form control while the person stays in control of every answer.

It is designed for forms that use difficult government, legal, financial, medical, or administrative language. FormGuide does not submit a form. It fills answers as the person progresses, then presents a review screen and reminds them to check the page and use the form's own submit button when they are ready.


## What it does

- Extracts visible text inputs, textareas, dropdowns, radio groups, checkboxes, labels, helper text, and native validation constraints from the current form.
- Converts each field into a short, plain-English spoken question.
- Translates the meaning of every dropdown or radio option while preserving the original option order for safe form filling.
- Uses browser speech recognition for answers and browser speech synthesis to read questions, explanations, confirmations, and the final review reminder.
- Understands natural option answers instead of requiring exact menu wording. It selects a choice only when the description clearly maps to one available option.
- Asks one short clarification when a response could fit more than one option instead of guessing.
- Recognizes spoken help requests such as “what is rent?”, “what does that mean?”, “I don't understand,” and “wait, what?” before they can be mistaken for text-field answers.
- Explains requested terms and the available choices conversationally by voice.
- Extracts the value needed by structured fields. For example, “my rent is two hundred dollars” can become `200` for a number field rather than copying the whole sentence.
- Keeps free-form responses as spoken and offers an explicit **Refine my answer** button for optional clarity/grammar cleanup.
- Detects visible conditional fields after an answer changes the form and adds them to the guided flow.
- Treats detected password, SSN, bank, card, routing, and passcode fields as sensitive: voice controls are hidden and their values are not sent to the AI backend.

## User flow

1. The extension scans the open form and sends non-sensitive field metadata to the local API.
2. The API returns a plain-English question and translated choices for each field.
3. FormGuide reads the current question aloud. The person can type, select a control, or choose **Speak**.
4. For a fixed-choice field, the API either returns the matching supplied choice or a follow-up question. The extension never applies a choice the API did not receive from the page.
5. For a structured value such as an amount, date, name, email, or number, the API returns only the appropriate field value when it can do so without guessing.
6. For a written narrative, the person can choose **Refine my answer** to improve clarity without adding facts.
7. Each answer is filled into the underlying page as it is accepted.
8. At the end, FormGuide shows a review list and says that the form is ready for manual review. The person reviews the original page and uses its own submit button.

## Architecture

| Component | Responsibility |
| --- | --- |
| `extension/content.js` | Chrome content script. Extracts fields, renders the FormGuide sidebar, controls voice input/output, calls the local API, validates answers, and writes them back into the page. |
| `server/app.py` | FastAPI service. Calls Groq with strict JSON schemas for translation, option matching, structured-value extraction, explanations, and optional refinement. |
| `DemoForm/index.html` | A deliberately jargon-heavy local demo form, including a conditional landlord field. |

The browser extension currently runs only on the local demo origins configured in `extension/manifest.json`:

```text
http://localhost:5500/*
http://127.0.0.1:5500/*
```

To use it with other websites, explicitly expand the manifest's `matches` and `host_permissions`, then reload the extension. Review that change carefully: a content script can read the form fields on every site it is allowed to run on.

## Requirements

- Google Chrome or another Chromium browser with support for the Web Speech APIs.
- Python 3.10+.
- A Groq API key with access to the model configured in `server/app.py`.
- A local static web server for the demo page.

## Setup

### 1. Configure the backend

Open a terminal in the `server` directory and create a virtual environment:

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create `server/.env` with your own key. Do not commit this file.

```dotenv
GROQ_API_KEY=your_key_here
```

Start the API:

```powershell
uvicorn app:app --reload --port 8001
```

Confirm it is running:

```powershell
Invoke-WebRequest http://localhost:8001/ping
```

Expected response:

```json
{"status":"alive"}
```

### 2. Serve the demo form

From the repository root, start a local server on port `5500`:

```powershell
python -m http.server 5500 --directory DemoForm
```

Open [http://localhost:5500](http://localhost:5500) in Chrome.

### 3. Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository's `extension` folder.
5. Refresh the demo-form tab.

The FormGuide sidebar should appear on the right side of the page. Allow microphone access when Chrome asks for it.

### After code changes

Reload the extension in `chrome://extensions` and refresh the form tab. Content scripts already injected into a page do not update automatically. Restart the FastAPI server if it is not running with `--reload`.

## API endpoints

All endpoints run locally at `http://localhost:8001`.

| Endpoint | Purpose |
| --- | --- |
| `GET /ping` | Simple backend health check. |
| `POST /translate-fields` | Turns extracted form fields into plain-language questions and translated options. |
| `POST /match-option` | Maps a natural spoken description to one supplied option, or returns a short clarification question. |
| `POST /extract-structured-answer` | Extracts only the value a structured form field needs, or asks for clarification. |
| `POST /explain-question` | Gives a conversational explanation of the question, requested jargon, and supplied choices. |
| `POST /refine-answer` | Optionally improves a subjective answer's clarity without changing its facts. |

The AI responses use strict JSON schemas. The frontend validates option indexes against the choices extracted from the current page before applying them.

## Safety and privacy behavior

- FormGuide never presses the website's submit button and has no “submit” action of its own.
- For uncertain fixed-choice answers, it asks for clarification rather than choosing a plausible option.
- The option matcher is limited to the options supplied by the page. It cannot invent another option.
- The structured-answer extractor is instructed not to calculate, round, infer missing information, or make legal, medical, financial, or eligibility decisions.
- Sensitive fields are detected by keyword and kept out of AI API requests. This detection is heuristic, so it is not a replacement for a formal data-classification or security program.
- Other non-sensitive form metadata and spoken answers are sent from the extension to the local FastAPI service, which sends AI requests to Groq. Do not use this prototype with information you are not authorized to send to that service.
- The development API enables permissive CORS for local development. Do not expose it publicly without authentication, origin restrictions, rate limiting, logging controls, and a security review.

## Manual test checklist

With the demo form open, test the following:

- A plain-language question is understandable before selecting **Explain**.
- Say “what is rent?” or “I don't understand” on a text field. FormGuide should explain rather than enter those words as the answer.
- Give a natural answer to a dropdown or radio question. It should select a matching option or ask a short follow-up if ambiguous.
- Say “my rent is 200 dollars” to a numerical amount field. The input should contain `200` only.
- Give a multi-sentence narrative answer. It should remain unchanged until **Refine my answer** is selected.
- Select a choice that reveals the demo's conditional landlord field. It should be added to the guided questions.
- Reach the final review screen. It should say the form is ready for manual review and should not show a duplicate form-submission button.

## Repository layout

```text
form-guide/
├── DemoForm/
│   └── index.html          # Local demo form
├── extension/
│   ├── content.js          # Sidebar, form extraction, voice, and DOM filling
│   └── manifest.json       # Chrome extension manifest
├── server/
│   ├── app.py              # FastAPI and Groq integration
│   └── requirements.txt    # Python dependencies
└── README.md
```

