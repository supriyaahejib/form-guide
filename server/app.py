import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional # <-- Add Optional here
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Groq(api_key=os.environ["GROQ_API_KEY"])

QUESTION_RESPONSE_SCHEMA = {
    "name": "formguide_questions",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "fieldId": {"type": "string"},
                        "question": {"type": "string"},
                        "answerMode": {
                            "type": "string",
                            "enum": ["structured", "subjective", "sensitive"],
                        },
                        "translatedOptions": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["fieldId", "question", "answerMode", "translatedOptions"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["questions"],
        "additionalProperties": False,
    },
}

EXPLANATION_RESPONSE_SCHEMA = {
    "name": "formguide_explanation",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {"explanation": {"type": "string"}},
        "required": ["explanation"],
        "additionalProperties": False,
    },
}

REFINEMENT_RESPONSE_SCHEMA = {
    "name": "formguide_refinement",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {"refinedAnswer": {"type": "string"}},
        "required": ["refinedAnswer"],
        "additionalProperties": False,
    },
}

# The browser only applies an option by index.  This schema deliberately keeps
# the model from returning arbitrary form values or inventing another choice.
OPTION_MATCH_RESPONSE_SCHEMA = {
    "name": "formguide_option_match",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "decision": {"type": "string", "enum": ["matched", "clarify"]},
            "optionIndex": {"type": "integer"},
            "clarification": {"type": "string"},
        },
        "required": ["decision", "optionIndex", "clarification"],
        "additionalProperties": False,
    },
}

# Update the Pydantic model to catch all the data from the frontend
class Field(BaseModel):
    id: str
    label: str
    type: str
    context: str = ""
    options: Optional[List[str]] = None
    isRequired: bool = False
    maxLength: Optional[int] = None
    minLength: Optional[int] = None
    pattern: Optional[str] = None
    min: Optional[str] = None
    max: Optional[str] = None

class FieldsRequest(BaseModel):
    fields: List[Field]


class ExplainRequest(BaseModel):
    question: str
    originalLabel: str
    context: str = ""


class OptionCandidate(BaseModel):
    index: int
    original: str
    plain: str


class OptionMatchRequest(BaseModel):
    question: str
    originalLabel: str = ""
    context: str = ""
    options: List[OptionCandidate]
    userAnswer: str


class RefineAnswerRequest(BaseModel):
    question: str
    context: str = ""
    userAnswer: str
    maxLength: Optional[int] = None
    wordLimit: Optional[int] = None

@app.get("/ping")
def ping():
    return {"status": "alive"}


@app.post("/translate-fields")
def translate_fields(request: FieldsRequest):
    fields_json = json.dumps([f.model_dump() for f in request.fields])

    prompt = f"""You are FormGuide, a warm, patient advocate helping someone fill out a confusing bureaucratic form. 
Your job is to translate complex form fields and their options into simple, conversational language.

CRITICAL INSTRUCTIONS:
1. Look at the form fields provided below. 
2. USE THE CONTEXT to figure out what the question is really asking. NO legal jargon. Make sure the user receives all the necessary context for every question.
3. If a field has an "options" array (like a dropdown or multiple choice), translate those options into plain English too. Keep them in the EXACT same order as the original. 
4. Make sure you translate to plain English because the user may not be a native speaker.
5. Explain a consequence only when it is explicitly stated in the supplied label or context. Never infer, add, or exaggerate legal consequences.
6. Return an "answerMode" for every question. It must be one of: "structured" (exact values such as names, IDs, dates, numbers, addresses, selections, or yes/no), "subjective" (a written explanation, reason, or description), or "sensitive" (passwords, SSNs, bank or card details). Do not invent facts or answer the question for the user.
7. Return exactly one question for every supplied field, in the same order, and use each supplied fieldId exactly once.

Fields to translate:
{fields_json}

Respond with ONLY valid JSON in exactly this shape:
{{
  "questions": [
    {{
      "fieldId": "<the field's id>", 
      "question": "<plain conversational question>",
      "answerMode": "<structured|subjective|sensitive>",
      "translatedOptions": ["<plain option 1>", "<plain option 2>"] 
    }}
  ]
}}
For fields with no options, return "translatedOptions": [].
"""

    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[{"role": "user", "content": prompt}],
            reasoning_effort="low",
            response_format={
                "type": "json_schema",
                "json_schema": QUESTION_RESPONSE_SCHEMA,
            },
        )
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"AI translation request failed: {error}") from error

    raw_text = response.choices[0].message.content
    cleaned = raw_text.replace("```json", "").replace("```", "").strip()
    data = json.loads(cleaned)
    return data


@app.post("/match-option")
def match_option(request: OptionMatchRequest):
    """Resolve a natural spoken answer to one supplied option, or ask once."""
    if len(request.options) < 2:
        raise HTTPException(status_code=400, detail="At least two options are required")

    options_json = json.dumps([option.model_dump() for option in request.options])
    prompt = f"""You help a person answer a form question with a fixed set of choices.

Question in plain English: {request.question}
Original form label: {request.originalLabel}
Form help text: {request.context}
Allowed options: {options_json}
What the person said: {request.userAnswer}

Decide whether the person's meaning clearly matches exactly one allowed option.

Rules:
- Match meaning, not exact wording. The person can describe their situation in
  their own words.
- Use both each option's original wording and its plain-English wording.
- Select an option only when it is clearly supported by what the person said.
- Never guess between two plausible options and never make an eligibility,
  legal, medical, financial, or factual determination for the person.
- If it is unclear, return decision "clarify", optionIndex -1, and one short,
  neutral follow-up question that distinguishes the relevant choices.
- If it is clear, return decision "matched", the exact supplied option index,
  and an empty clarification string.
- Do not add an option that was not supplied.
"""

    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[{"role": "user", "content": prompt}],
            reasoning_effort="low",
            response_format={
                "type": "json_schema",
                "json_schema": OPTION_MATCH_RESPONSE_SCHEMA,
            },
        )
        result = json.loads(response.choices[0].message.content)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"AI option-matching request failed: {error}") from error

    allowed_indexes = {option.index for option in request.options}
    if result["decision"] == "matched" and result["optionIndex"] in allowed_indexes:
        result["clarification"] = ""
        return result
    if result["decision"] == "clarify":
        result["optionIndex"] = -1
        result["clarification"] = result["clarification"].strip() or "Which option best describes your situation?"
        return result

    # Treat malformed or out-of-range model output as uncertainty, never as a
    # selection.  This protects the form from an unsupported answer.
    return {
        "decision": "clarify",
        "optionIndex": -1,
        "clarification": "Which option best describes your situation?",
    }


@app.post("/explain-question")
def explain_question(request: ExplainRequest):
    combined_text = f"{request.question} {request.originalLabel} {request.context}".lower()
    # Source-backed glossary entry for the legal reference used in the demo
    # form. Keeping this local prevents the model from inventing legal meaning.
    if "title iv-a" in combined_text or "title iv a" in combined_text:
        return {
            "explanation": (
                "Title IV-A is the part of the U.S. Social Security Act that contains "
                "the Temporary Assistance for Needy Families, or TANF, program. This "
                "question is asking whether you or a person in your household receives, "
                "was denied, or is waiting on that type of assistance."
            )
        }

    prompt = f"""Explain this form question in simpler, friendly English.

Plain-language question: {request.question}
Original form label: {request.originalLabel}
Form context: {request.context}

Rules:
- Only clarify wording found in the supplied material.
- Do not answer the question for the user.
- Do not add personal examples, legal advice, eligibility claims, or consequences not explicitly supplied.
- Keep the explanation to two short sentences or fewer.
"""

    response = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[{"role": "user", "content": prompt}],
        response_format={
            "type": "json_schema",
            "json_schema": EXPLANATION_RESPONSE_SCHEMA,
        },
    )
    return json.loads(response.choices[0].message.content)


@app.post("/refine-answer")
def refine_answer(request: RefineAnswerRequest):
    limits = []
    if request.maxLength is not None:
        limits.append(f"at most {request.maxLength} characters")
    if request.wordLimit is not None:
        limits.append(f"at most {request.wordLimit} words")
    limit_text = ", ".join(limits) if limits else "no stated length limit"

    prompt = f"""Improve only the clarity, grammar, and concision of this user's answer to a form question.

Question: {request.question}
Context: {request.context}
User's answer: {request.userAnswer}
Limit: {limit_text}

Rules:
- Preserve the user's facts and meaning. Do not invent, infer, embellish, or add personal details.
- Do not add dates, amounts, diagnoses, qualifications, legal claims, or outcomes.
- You may remove only redundant wording to meet the stated limit.
- If the answer cannot be shortened within the limit without changing facts, return it unchanged so the user can edit it.
- Return only the refined answer.
"""

    response = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[{"role": "user", "content": prompt}],
        response_format={
            "type": "json_schema",
            "json_schema": REFINEMENT_RESPONSE_SCHEMA,
        },
    )
    return json.loads(response.choices[0].message.content)
