import os
import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from google import genai
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])


class Field(BaseModel):
    id: str
    label: str
    type: str


class FieldsRequest(BaseModel):
    fields: List[Field]


@app.get("/ping")
def ping():
    return {"status": "alive"}


@app.post("/translate-fields")
def translate_fields(request: FieldsRequest):
    fields_json = json.dumps([f.dict() for f in request.fields])

    prompt = f"""You are helping translate a confusing government or insurance
form into plain, friendly conversational questions.

Here is a list of form fields as JSON. Each has an id, a label (the real text
from the form), and a type:

{fields_json}

For each field, write ONE short, plain-English question that a normal person
would understand, which would collect the same information the field is
asking for. If a label is too vague to be sure what it means, still write
your best-guess question, but keep it extra simple and clear.

Order the questions from simplest/least sensitive first (like name) to more
sensitive later (like income or medical info), where that makes sense.

Respond with ONLY valid JSON, nothing else, no explanation, no markdown
fences, in exactly this shape:

{{
  "questions": [
    {{"fieldId": "<the field's id>", "question": "<plain question>", "expectedFormat": "<text|number|currency|date|yesno>"}}
  ]
}}
"""

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
    )

    raw_text = response.text
    cleaned = raw_text.replace("```json", "").replace("```", "").strip()
    data = json.loads(cleaned)
    return data