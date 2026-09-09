import os
import json
from fastapi import FastAPI
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

# Update the Pydantic model to catch all the data from the frontend
class Field(BaseModel):
    id: str
    label: str
    type: str
    context: str = ""
    options: Optional[List[str]] = None

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
2. USE THE CONTEXT to figure out what the question is really asking. NO legal jargon. Make sure the user receives all the necessary context for every question.
3. If a field has an "options" array (like a dropdown or multiple choice), translate those options into plain English too. Keep them in the EXACT same order as the original. 
4. Make sure you translate to plain english because the user may not be a native speaker.
5. If any action or option has a consequence, for example perjury or any legal charges, it must explain that consequence very clearly.

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

    response = client.chat.completions.create(
        model="openai/gpt-oss-20b",  
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )

    raw_text = response.choices[0].message.content
    cleaned = raw_text.replace("```json", "").replace("```", "").strip()
    data = json.loads(cleaned)
    return data