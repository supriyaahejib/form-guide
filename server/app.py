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
    fields_json = json.dumps([f.model_dump() for f in request.fields])

    prompt = f"""You are FormGuide, a warm, patient advocate helping someone fill out a confusing bureaucratic form. 
Your job is to translate complex form fields and their options into simple, conversational language.

CRITICAL INSTRUCTIONS:
1. Look at the form fields provided below. 
2. USE THE CONTEXT to figure out what the question is really asking. NO legal jargon.
3. If a field has an "options" array (like a dropdown or multiple choice), translate those options into plain English too. Keep them in the EXACT same order as the original.

Fields to translate:
{fields_json}

Respond with ONLY valid JSON in exactly this shape:
{{
  "questions": [
    {{
      "fieldId": "<the field's id>", 
      "question": "<plain conversational question>",
      "translatedOptions": ["<plain option 1>", "<plain option 2>"] 
    }}
  ]
}}
Note: Omit "translatedOptions" if the original field had no options.
"""

    response = client.models.generate_content(
        model='gemini-3.6-flash',
        contents=prompt,
    )

    raw_text = response.text
    cleaned = raw_text.replace("```json", "").replace("```", "").strip()
    data = json.loads(cleaned)
    return data