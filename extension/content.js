// --- STATE ---
let questions = [];
let currentIndex = 0;
let answers = {};
let recognition = null;
let keepListening = false;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setNativeValue(el, value) {
  const prototype = el.tagName.toLowerCase() === "textarea"
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function setVoiceStatus(message) {
  const status = document.getElementById("fg-voice-status");
  if (status) status.innerText = message;
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    setVoiceStatus("Voice playback is unavailable. You can still read or type.");
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.95;
  utterance.onerror = () => setVoiceStatus("Could not play audio. You can still read or type.");
  window.speechSynthesis.speak(utterance);
}

function stopListening() {
  keepListening = false;
  if (recognition) recognition.abort();
  recognition = null;
  setListeningState(false);
}

function normalizeSpeech(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getWordLimit(q) {
  const source = `${q.question} ${q.originalLabel || ""} ${q.context || ""}`.toLowerCase();
  const match = source.match(/(\d+)\s*-?\s*words?\s*max|max(?:imum)?\s*(?:of\s*)?(\d+)\s*-?\s*words?|(\d+)\s*-?\s*word\s*limit|word\s*limit\s*(?:of\s*)?(\d+)/i);
  return match ? parseInt(match[1] || match[2] || match[3] || match[4], 10) : null;
}

function setListeningState(isListening) {
  const micButton = document.getElementById("fg-mic");
  if (micButton) {
    micButton.innerText = isListening ? "■ Stop" : "🎤 Speak";
  }
}

function listen(onFinalText, onError) {
  if (!SpeechRecognition) {
    onError("Voice input is unavailable in this browser. Please type your answer.");
    return;
  }

  window.speechSynthesis?.cancel();
  stopListening();
  keepListening = true;
  const sessionRecognition = new SpeechRecognition();
  recognition = sessionRecognition;
  sessionRecognition.lang = "en-US";
  sessionRecognition.interimResults = true;
  sessionRecognition.continuous = true;
  sessionRecognition.maxAlternatives = 1;

  sessionRecognition.onstart = () => {
    setListeningState(true);
    setVoiceStatus("Listening… speak naturally, then select Stop when you are finished.");
  };
  sessionRecognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index++) {
      if (event.results[index].isFinal) {
        onFinalText(event.results[index][0].transcript.trim());
      }
    }
  };
  sessionRecognition.onerror = (event) => {
    if (event.error === "aborted") return;
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
      keepListening = false;
      onError(`Microphone access failed: ${event.error}. Please type your answer.`);
    }
  };
  sessionRecognition.onend = () => {
    if (recognition !== sessionRecognition || !keepListening) {
      if (recognition === sessionRecognition) recognition = null;
      setListeningState(false);
      return;
    }

    // Chrome can end recognition after a pause. Restart the same user-started
    // dictation session so long answers do not lose their place.
    setTimeout(() => {
      if (recognition !== sessionRecognition || !keepListening) return;
      try {
        sessionRecognition.start();
      } catch (error) {
        keepListening = false;
        recognition = null;
        setListeningState(false);
        onError("Voice input stopped. Your captured text is still in the answer box.");
      }
    }, 150);
  };
  sessionRecognition.start();
}

function spokenDigits(text) {
  const digitWords = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
  const tokens = normalizeSpeech(text).split(" ").filter(Boolean);
  if (tokens.length > 0 && tokens.every((token) => /^\d+$/.test(token) || digitWords[token] !== undefined)) {
    return tokens.map((token) => digitWords[token] ?? token).join("");
  }
  return null;
}

function spokenNumber(text) {
  const direct = text.trim().replace(/[$,]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(direct)) return direct;

  const units = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const tens = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const scales = { hundred: 100, thousand: 1000, million: 1000000, billion: 1000000000 };
  const tokens = normalizeSpeech(text).split(" ").filter((token) => !["and", "dollar", "dollars", "rupee", "rupees"].includes(token));
  if (!tokens.length) return null;

  const digits = spokenDigits(text);
  if (digits && tokens.every((token) => units[token] !== undefined || token === "oh" || /^\d+$/.test(token))) return digits;

  let total = 0;
  let current = 0;
  let decimal = "";
  let decimalMode = false;
  for (const token of tokens) {
    if (token === "point" || token === "decimal") {
      if (decimalMode) return null;
      decimalMode = true;
      continue;
    }
    if (decimalMode) {
      const digit = spokenDigits(token);
      if (!digit || digit.length !== 1) return null;
      decimal += digit;
    } else if (units[token] !== undefined) current += units[token];
    else if (tens[token] !== undefined) current += tens[token];
    else if (token === "hundred") current = (current || 1) * scales.hundred;
    else if (scales[token]) {
      total += (current || 1) * scales[token];
      current = 0;
    } else return null;
  }
  return `${total + current}${decimal ? `.${decimal}` : ""}`;
}

function spokenDate(text) {
  const cleaned = text.trim().replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  const parsed = Date.parse(cleaned);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function spokenQuestion(q) {
  const options = q.translatedOptions?.length
    ? ` Your choices are: ${q.translatedOptions.join(", ")}.`
    : "";
  return `${q.question}.${options} You may type an answer or select Speak.`;
}

function applySpokenAnswer(q, transcript) {
  const command = normalizeSpeech(transcript);
  if (/^(repeat|repeat question|say that again|again)$/.test(command)) {
    speak(spokenQuestion(q));
    setVoiceStatus("Repeating the question.");
    return;
  }
  if (/^(explain|explain question|what does that mean|help)$/.test(command)) {
    explainCurrentQuestion();
    return;
  }

  const answerEl = document.getElementById("fg-answer");
  if (!answerEl) return;

  if (q.originalOptions?.length) {
    const options = q.translatedOptions?.length === q.originalOptions.length
      ? q.translatedOptions
      : q.originalOptions;
    const matchingIndexes = q.originalOptions
      .map((originalOption, index) => ({
        index,
        translated: normalizeSpeech(options[index]),
        original: normalizeSpeech(originalOption)
      }))
      .filter((option) =>
        option.translated === command ||
        option.original === command ||
        (command.length >= 3 && (option.translated.includes(command) || option.original.includes(command))) ||
        (option.translated.length >= 3 && command.includes(option.translated)) ||
        (option.original.length >= 3 && command.includes(option.original))
      )
      .map((option) => option.index);
    const matchingIndex = matchingIndexes.length === 1 ? matchingIndexes[0] : -1;
    if (matchingIndex === -1) {
      setVoiceStatus(`I heard “${transcript}”. Please say one listed option clearly, or choose it from the menu.`);
      return;
    }
    answerEl.value = String(matchingIndex);
  } else if (q.type === "checkbox") {
    if (["yes", "agree", "i agree", "true"].includes(command)) {
      answerEl.checked = true;
    } else {
      setVoiceStatus("Please say “yes” to agree, or use the checkbox.");
      return;
    }
  } else if (q.type === "date") {
    const normalizedDate = spokenDate(transcript);
    if (!normalizedDate) {
      setVoiceStatus(`I heard “${transcript}”. Please say a date such as “January 2nd 2000”, or type it.`);
      return;
    }
    answerEl.value = normalizedDate;
  } else if (q.type === "number") {
    const normalizedNumber = spokenNumber(transcript);
    if (!normalizedNumber) {
      setVoiceStatus(`I heard “${transcript}”. Please say the number again or type it.`);
      return;
    }
    answerEl.value = normalizedNumber;
  } else if (/\b(\d+\s*-?\s*digit|ssn|social security|identification number)\b/i.test(`${q.question} ${q.originalLabel || ""} ${q.context || ""}`)) {
    const digits = spokenDigits(transcript);
    if (!digits) {
      setVoiceStatus("Please say each digit separately, or type the number.");
      return;
    }
    answerEl.value = digits;
  } else if (q.answerMode === "subjective") {
    // Keep every finalized speech segment. This lets the user pause, continue,
    // or start a second dictation session without losing prior text.
    answerEl.value = [answerEl.value.trim(), transcript].filter(Boolean).join(" ");
  } else {
    answerEl.value = transcript;
  }

  setVoiceStatus(q.answerMode === "subjective"
    ? "Added to your response. Keep speaking, select Stop, then choose Next to improve clarity."
    : "Captured. Review or edit it, then select Next.");
}

// --- DOM EXTRACTION ---
function extractFields() {
  const fields = [];
  const processedRadioNames = new Set(); 
  const inputs = document.querySelectorAll("input, select, textarea");

  inputs.forEach((el) => {
    if (el.closest('#formguide-sidebar')) return; 
    if (el.type === "hidden" || el.type === "submit" || el.type === "button" || el.offsetParent === null) return;

    if (el.type === "radio") {
      if (processedRadioNames.has(el.name)) return; 
      processedRadioNames.add(el.name);
    }

    if (!el.hasAttribute("data-formguide-id")) {
      el.setAttribute("data-formguide-id", "fg_" + Math.random().toString(36).substr(2, 9));
    }
    const fieldId = el.getAttribute("data-formguide-id");

    let label = "";
    let contextText = "";
    let options = [];

    const formGroup = el.closest('.form-group');
    if (formGroup) {
      const helper = formGroup.querySelector('.helper-text');
      if (helper) contextText = helper.innerText;
      if (el.type === "radio") {
        const groupLabel = formGroup.querySelector('label:not([for])') || formGroup.querySelector('label');
        if (groupLabel) label = groupLabel.innerText;
      }
    }

    if (!label && el.id) {
      const labelEl = document.querySelector(`label[for="${el.id}"]`);
      if (labelEl) label = labelEl.innerText;
    }
    if (!label && el.getAttribute("aria-label")) label = el.getAttribute("aria-label");
    if (!label && el.placeholder) label = el.placeholder;
    if (!label && el.closest("label")) label = el.closest("label").innerText;
    if (!label) label = `Unlabeled field`;

    if (el.tagName.toLowerCase() === "select") {
      el.querySelectorAll("option").forEach(opt => {
        if (opt.value) options.push(opt.innerText.trim());
      });
    } else if (el.type === "radio") {
      document.querySelectorAll(`input[name="${el.name}"]`).forEach(radio => {
        let optLabel = radio.value;
        if (radio.id) {
          const l = document.querySelector(`label[for="${radio.id}"]`);
          if (l) optLabel = l.innerText;
        }
        options.push(optLabel);
      });
    }

    const sensitivePattern = /\b(ssn|social security|password|passcode|bank account|routing number|credit card|debit card)\b/i;
    const isSensitive = sensitivePattern.test(`${label} ${contextText}`);

    fields.push({
      id: fieldId,
      label: label.trim(),
      context: contextText.trim(),
      type: isSensitive ? "sensitive" : (el.tagName.toLowerCase() === "select" ? "select" : (el.type || "text")),
      options: options.length > 0 ? options : null,
      isRequired: el.hasAttribute("required"),
      maxLength: el.maxLength > 0 ? el.maxLength : null,
      minLength: el.minLength > 0 ? el.minLength : null,
      pattern: el.pattern || null,
      min: el.min || null,
      max: el.max || null
    });
  });

  return fields;
}

// --- BACKEND API CALL ---
async function getQuestions(fields) {
  try {
    const sensitiveFields = fields.filter((field) => field.type === "sensitive");
    const normalFields = fields.filter((field) => field.type !== "sensitive");
    const localQuestions = sensitiveFields.map((field) => ({
      fieldId: field.id,
      question: "This field requests private information. Please type it directly; it stays in this browser and is not sent to FormGuide's AI service.",
      answerMode: "sensitive"
    }));

    if (normalFields.length === 0) return localQuestions;

    const response = await fetch("http://localhost:8001/translate-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: normalFields }),
    });
    
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const data = await response.json();
    
    if (!data || !Array.isArray(data.questions)) return localQuestions;

    const remoteQuestions = data.questions.filter((question) =>
      normalFields.some((field) => field.id === question.fieldId)
    );
    const returnedFieldIds = new Set(remoteQuestions.map((question) => question.fieldId));
    const fallbackQuestions = normalFields
      .filter((field) => !returnedFieldIds.has(field.id))
      .map((field) => ({
        fieldId: field.id,
        question: `Please provide: ${field.label}`,
        answerMode: "structured"
      }));
    const allQuestions = remoteQuestions.concat(fallbackQuestions, localQuestions);
    allQuestions.forEach(q => {
      const originalField = fields.find(f => f.id === q.fieldId);
      if (originalField) {
        q.originalLabel = originalField.label; 
        q.context = originalField.context; // IMPORTANT: We now attach context for smart validation
        q.originalOptions = originalField.options; 
        q.translatedOptions = (q.translatedOptions && q.translatedOptions.length > 0) ? q.translatedOptions : (originalField.options || []); 
        q.type = originalField.type; 
        
        q.isRequired = originalField.isRequired;
        q.maxLength = originalField.maxLength;
        q.minLength = originalField.minLength;
        q.pattern = originalField.pattern;
        q.min = originalField.min;
        q.max = originalField.max;

        const exactValueTypes = ["date", "number", "email", "tel", "select", "radio", "checkbox"];
        if (exactValueTypes.includes(q.type) || q.originalOptions?.length || q.pattern) {
          q.answerMode = "structured";
        } else if (
          q.answerMode !== "sensitive" &&
          (q.type === "textarea" || /\b(describe|explain|reason|why|details|narrative|statement|comment)\b/i.test(`${q.question} ${q.originalLabel} ${q.context}`))
        ) {
          q.answerMode = "subjective";
        }
      }
    });
    return allQuestions;
  } catch (error) {
    console.error("FormGuide Backend Error:", error);
    return [];
  }
}

// --- UI / SIDEBAR ---
function createSidebar() {
  const existingSidebar = document.getElementById("formguide-sidebar");
  if (existingSidebar) existingSidebar.remove(); 

  const sidebar = document.createElement("div");
  sidebar.id = "formguide-sidebar";
  sidebar.style.cssText = `
    position: fixed; top: 0; right: 0; width: 340px; height: 100%;
    background: white; border-left: 3px solid #2b6cb0; z-index: 999999;
    padding: 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: -4px 0 15px rgba(0,0,0,0.05);
    overflow-y: auto; display: flex; flex-direction: column;
  `;
  sidebar.innerHTML = `
    <h2 style="margin-top:0; color: #0f365b;">FormGuide</h2>
    <div id="fg-progress" style="color:#666; font-size:13px; margin-bottom:10px; font-weight:600;">Initializing...</div>
    <div id="fg-question" style="font-size:17px; margin-bottom:12px; font-weight: 500; color:#2d3748; line-height:1.4;">Reading the form...</div>
    <div id="fg-explanation" style="display:block; color:#475569; background:#f8fafc; border-left:3px solid #60a5fa; font-size:13px; line-height:1.45; margin-bottom:10px;"></div>
    
    <div id="fg-answer-container" style="margin-bottom:8px;"></div>
    
    <div id="fg-error-message" style="color: #e53e3e; font-size: 13px; margin-bottom: 12px; font-weight: 500; display: none;"></div>
    <div id="fg-voice-status" style="color:#64748b; font-size:12px; min-height:18px; margin-bottom:8px;"></div>
    <div id="fg-voice-controls" style="display:flex; gap:8px; margin-bottom:12px;">
      <button id="fg-mic" style="padding:8px; flex:1; border:1px solid #93c5fd; background:#eff6ff; color:#1d4ed8; border-radius:6px; cursor:pointer;">🎤 Speak</button>
      <button id="fg-repeat" style="padding:8px; border:1px solid #cbd5e0; background:white; border-radius:6px; cursor:pointer;">🔊 Repeat</button>
      <button id="fg-explain" style="padding:8px; border:1px solid #cbd5e0; background:white; border-radius:6px; cursor:pointer;">? Explain</button>
    </div>
    
    <div style="display:flex; gap:10px;" id="fg-button-group">
      <button id="fg-back" style="padding:10px; background: #e2e8f0; color: #4a5568; border: none; border-radius: 6px; cursor: pointer; font-weight:bold; flex:1; display:none;">Back</button>
      <button id="fg-next" style="padding:10px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight:bold; flex:2; display:none;">Next</button>
    </div>
  `;
  document.body.appendChild(sidebar);
}

function showQuestion() {
  // A continuous dictation session belongs only to the question it started on.
  // Stop it before rendering another question so an old date/number handler
  // cannot process a later answer.
  stopListening();
  if (!questions || questions.length === 0) {
    document.getElementById("fg-question").innerText = "⚠️ Error: No fields loaded. Please check if your Groq backend is running on port 8001.";
    document.getElementById("fg-question").style.color = "#e53e3e";
    document.getElementById("fg-progress").innerText = "Status: Backend Failure";
    document.getElementById("fg-answer-container").innerHTML = "";
    document.getElementById("fg-next").style.display = "none";
    document.getElementById("fg-back").style.display = "none";
    return;
  }

  if (currentIndex >= questions.length) {
    showSummary();
    return;
  }
  
  document.getElementById("fg-error-message").style.display = "none";
  
  const q = questions[currentIndex];
  document.getElementById("fg-progress").innerText = `Question ${currentIndex + 1} of ${questions.length}`;
  document.getElementById("fg-question").innerText = q.question;
  const explanationEl = document.getElementById("fg-explanation");
  explanationEl.innerText = "";
  explanationEl.style.padding = "0";
  document.getElementById("fg-question").style.color = "#2d3748"; 
  document.getElementById("fg-next").style.display = "block";
  document.getElementById("fg-voice-controls").style.display = q.answerMode === "sensitive" ? "none" : "flex";
  setVoiceStatus(q.answerMode === "sensitive"
    ? "For privacy, type this answer directly."
    : "Question read aloud. You can type or select Speak.");
  
  const answerContainer = document.getElementById("fg-answer-container");
  const savedAnswer = answers[q.fieldId] || ""; 

  if (q.originalOptions && q.originalOptions.length > 0) {
    let html = `<select id="fg-answer" style="width:100%; padding:10px; border: 1px solid #cbd5e0; border-radius: 6px; font-size:14px;">`;
    html += `<option value="">-- Choose an option --</option>`;
    
    const displayOptions = (q.translatedOptions.length === q.originalOptions.length) ? q.translatedOptions : q.originalOptions;
    displayOptions.forEach((opt, idx) => {
      const selected = (savedAnswer === q.originalOptions[idx]) ? "selected" : "";
      html += `<option value="${idx}" ${selected}>${escapeHtml(opt)}</option>`;
    });
    html += `</select>`;
    html += `<div style="font-size:12px; color:#64748b; margin-top:7px;">You can choose from the menu or select Speak and say an option.</div>`;
    answerContainer.innerHTML = html;
  } else if (q.type === "checkbox") {
    const checked = savedAnswer === "true" ? "checked" : "";
    answerContainer.innerHTML = `
      <div style="padding:12px; border: 1px solid #cbd5e0; border-radius: 6px; background:#f7fafc; cursor:pointer;">
        <label style="display:flex; align-items:flex-start; font-size:14px; cursor:pointer; margin:0;">
          <input id="fg-answer" type="checkbox" style="width:18px; height:18px; margin:0 12px 0 0; flex-shrink:0;" ${checked} />
          Yes, I agree
        </label>
      </div>`;
  } else if (q.type === "date") {
    answerContainer.innerHTML = `<input id="fg-answer" type="date" value="${escapeHtml(savedAnswer)}" style="width:100%; padding:10px; border: 1px solid #cbd5e0; border-radius: 6px; box-sizing:border-box; font-size:14px;" />`;
  } else if (q.type === "textarea" || q.answerMode === "subjective") {
    // Render textareas properly for long text fields
    const maxLengthAttr = q.maxLength ? ` maxlength="${q.maxLength}"` : "";
    const minLengthAttr = q.minLength ? ` minlength="${q.minLength}"` : "";
    answerContainer.innerHTML = `<textarea id="fg-answer"${maxLengthAttr}${minLengthAttr} style="width:100%; padding:10px; border: 1px solid #cbd5e0; border-radius: 6px; box-sizing:border-box; font-size:14px; resize:vertical; min-height:80px;" placeholder="Type your answer...">${escapeHtml(savedAnswer)}</textarea>`;
  } else if (q.answerMode === "sensitive") {
    answerContainer.innerHTML = `<input id="fg-answer" type="password" value="${escapeHtml(savedAnswer)}" autocomplete="off" style="width:100%; padding:10px; border: 1px solid #cbd5e0; border-radius: 6px; box-sizing:border-box; font-size:14px;" placeholder="Type privately..." />`;
  } else {
    answerContainer.innerHTML = `<input id="fg-answer" type="text" value="${escapeHtml(savedAnswer)}" style="width:100%; padding:10px; border: 1px solid #cbd5e0; border-radius: 6px; box-sizing:border-box; font-size:14px;" placeholder="Type your answer..." />`;
  }

  document.getElementById("fg-back").style.display = currentIndex > 0 ? "block" : "none";

  if (q.answerMode !== "sensitive") {
    speak(spokenQuestion(q));
  }
}

function showSummary() {
  stopListening();
  window.speechSynthesis?.cancel();
  const sidebar = document.getElementById("formguide-sidebar");
  let html = `
    <h2 style="margin-top:0; color:#0f365b;">Review & Confirm</h2>
    <p style="font-size:13px; color:#4a5568;">Please review your answers before final submission.</p>
    <div style="display:flex; gap:10px; margin-bottom: 20px;">
      <button id="fg-back-summary" style="padding:10px; background: #e2e8f0; color: #4a5568; border: none; border-radius: 6px; cursor: pointer; font-weight:bold; flex:1;">Go Back</button>
      <button id="fg-confirm" style="padding:10px; background: #047857; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight:bold; flex:2;">Fill Form</button>
    </div>
    <ul style="padding-left:0; list-style:none;">`;
  
  questions.forEach((q) => {
    let displayAnswer = answers[q.fieldId];
    if (q.answerMode === "sensitive" && displayAnswer) {
      displayAnswer = "Private value entered";
    } else if (q.type === "checkbox") {
      displayAnswer = displayAnswer === "true" ? "Agreed" : "Skipped";
    } else if (q.originalOptions && displayAnswer) {
      const idx = q.originalOptions.indexOf(answers[q.fieldId]);
      const displayOptions = (q.translatedOptions.length === q.originalOptions.length) ? q.translatedOptions : q.originalOptions;
      if (idx !== -1 && displayOptions[idx]) displayAnswer = displayOptions[idx];
    }
    
    html += `
      <li style="margin-bottom:12px; background:#f7fafc; padding:10px; border-radius:4px; border:1px solid #e2e8f0;">
        <div style="font-size:12px; color:#718096; margin-bottom:4px;">${escapeHtml(q.question)}</div>
        <div style="font-size:14px; color:#2d3748; font-weight:500;">${displayAnswer ? escapeHtml(displayAnswer) : "<em style='color:#e53e3e;'>Skipped</em>"}</div>
      </li>`;
  });
  html += `</ul>`;
  sidebar.innerHTML = html;
}

async function explainCurrentQuestion() {
  const q = questions[currentIndex];
  if (!q || q.answerMode === "sensitive") return;

  setVoiceStatus("Explaining…");
  try {
    const response = await fetch("http://localhost:8001/explain-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: q.question,
        originalLabel: q.originalLabel || "",
        context: q.context || ""
      })
    });
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const data = await response.json();
    if (!data.explanation) throw new Error("No explanation received");

    const explanationEl = document.getElementById("fg-explanation");
    if (explanationEl) {
      explanationEl.innerText = data.explanation;
      explanationEl.style.padding = "10px";
    }
    setVoiceStatus(data.explanation);
    speak(data.explanation);
  } catch (error) {
    console.error("FormGuide explanation error:", error);
    setVoiceStatus("I could not explain that right now. You can repeat the question or type your answer.");
  }
}

async function refineSubjectiveAnswer(q, answer) {
  const wordLimit = getWordLimit(q);
  const response = await fetch("http://localhost:8001/refine-answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: q.question,
      context: q.context || "",
      userAnswer: answer,
      maxLength: q.maxLength || null,
      wordLimit
    })
  });
  if (!response.ok) throw new Error(`Server returned ${response.status}`);

  const data = await response.json();
  if (typeof data.refinedAnswer !== "string") throw new Error("No refined answer received");
  return data.refinedAnswer.trim();
}

async function autoScanForNewFields() {
  const currentFieldsOnPage = extractFields();
  const visibleFieldIds = new Set(currentFieldsOnPage.map((field) => field.id));

  // A changed answer can hide a previously discovered conditional field.
  // Remove its stale question and answer before checking for new fields.
  const removedQuestions = questions.filter((question) => !visibleFieldIds.has(question.fieldId));
  removedQuestions.forEach((question) => delete answers[question.fieldId]);
  questions = questions.filter((question) => visibleFieldIds.has(question.fieldId));

  const unseenFields = currentFieldsOnPage.filter(f => !questions.some(q => q.fieldId === f.id));
  
  if (unseenFields.length > 0) {
    const nextBtn = document.getElementById("fg-next");
    if (nextBtn) nextBtn.innerText = "Processing dynamic fields...";
    
    const newQuestions = await getQuestions(unseenFields);
    questions.splice(currentIndex + 1, 0, ...newQuestions); 
    
    if (nextBtn) nextBtn.innerText = "Next";
  }
}

// --- GLOBAL CLICK HANDLER ---
document.addEventListener("click", async (e) => {
  if (e.target.id === "fg-back") {
    currentIndex--;
    showQuestion();
  }
  
  else if (e.target.id === "fg-back-summary") {
    createSidebar(); 
    currentIndex = questions.length - 1; 
    showQuestion();
  }

  else if (e.target.id === "fg-repeat") {
    const q = questions[currentIndex];
    if (q) speak(spokenQuestion(q));
  }

  else if (e.target.id === "fg-explain") {
    await explainCurrentQuestion();
  }

  else if (e.target.id === "fg-mic") {
    const q = questions[currentIndex];
    if (!q || q.answerMode === "sensitive") return;
    if (recognition) {
      stopListening();
      setVoiceStatus("Stopped. Your captured answer is ready to review or edit.");
      return;
    }
    listen(
      (transcript) => applySpokenAnswer(q, transcript),
      (message) => setVoiceStatus(message)
    );
  }

  else if (e.target.id === "fg-next") {
    const answerEl = document.getElementById("fg-answer");
    if (!answerEl) return;
    
    let answer = answerEl.type === "checkbox" ? (answerEl.checked ? "true" : "false") : answerEl.value.trim();
    const q = questions[currentIndex];
    
    // ==========================================
    // VALIDATION ENGINE
    // ==========================================
    const errorMsg = document.getElementById("fg-error-message");
    errorMsg.style.display = "none"; 

    // 1. FormGuide asks one question at a time, so a blank answer must never
    // advance accidentally. Optional fields can later get an explicit Skip button.
    if (!answer || (q.type === "checkbox" && answer === "false")) {
        errorMsg.innerText = "⚠️ Please provide an answer before continuing.";
        errorMsg.style.display = "block";
        return;
    }

    // Only written explanations can be polished. IDs, dates, names, choices,
    // numbers, and other structured values are always preserved exactly.
    if (q.answerMode === "subjective") {
      const nextButton = document.getElementById("fg-next");
      nextButton.disabled = true;
      nextButton.innerText = "Improving clarity…";
      setVoiceStatus("Improving clarity without adding facts…");
      try {
        answer = await refineSubjectiveAnswer(q, answer);
        answerEl.value = answer;
        setVoiceStatus("Edited only for clarity. You can go back to change it.");
      } catch (error) {
        console.error("FormGuide refinement error:", error);
        setVoiceStatus("Could not improve wording right now; your original answer will be used.");
      } finally {
        nextButton.disabled = false;
        nextButton.innerText = "Next";
      }
    }

    // 2. HTML Character Limits
    if (q.maxLength && answer.length > parseInt(q.maxLength)) {
        errorMsg.innerText = `⚠️ Too long! Max ${q.maxLength} characters (you used ${answer.length}).`;
        errorMsg.style.display = "block";
        return; 
    }
    if (q.minLength && answer.length < parseInt(q.minLength)) {
        errorMsg.innerText = `⚠️ Too short! Minimum ${q.minLength} characters needed.`;
        errorMsg.style.display = "block";
      return;
    }

    // 3. Native pattern and numeric range constraints
    if (q.pattern) {
      try {
        if (!(new RegExp(`^(?:${q.pattern})$`)).test(answer)) {
          errorMsg.innerText = "⚠️ That answer does not match the required format.";
          errorMsg.style.display = "block";
          return;
        }
      } catch {
        console.warn("FormGuide ignored an invalid HTML pattern:", q.pattern);
      }
    }

    if (q.type === "number" && answer !== "") {
      const numericAnswer = Number(answer);
      if (!Number.isFinite(numericAnswer)) {
        errorMsg.innerText = "⚠️ Please enter a valid number.";
        errorMsg.style.display = "block";
        return;
      }
      if (q.min !== null && q.min !== "" && numericAnswer < Number(q.min)) {
        errorMsg.innerText = `⚠️ The value must be at least ${q.min}.`;
        errorMsg.style.display = "block";
        return;
      }
      if (q.max !== null && q.max !== "" && numericAnswer > Number(q.max)) {
        errorMsg.innerText = `⚠️ The value must be no more than ${q.max}.`;
        errorMsg.style.display = "block";
        return;
      }
    }

    // 4. Smart NLP Feature: Catch Word & Character limits from Text/Instructions
    const combinedText = (q.question + " " + (q.originalLabel || "") + " " + (q.context || "")).toLowerCase();
    
    // Looks for: "500 words max", "max 500 words", "word limit 500", "500 word limit"
    const wordLimitMatch = combinedText.match(/(\d+)\s*-?\s*words?\s*max|max(?:imum)?\s*(?:of\s*)?(\d+)\s*-?\s*words?|(\d+)\s*-?\s*word\s*limit|word\s*limit\s*(?:of\s*)?(\d+)/i);
    
    if (wordLimitMatch) {
        const limit = parseInt(wordLimitMatch[1] || wordLimitMatch[2] || wordLimitMatch[3] || wordLimitMatch[4], 10);
        const wordCount = answer === "" ? 0 : answer.trim().split(/\s+/).length;
        
        if (wordCount > limit) {
            errorMsg.innerText = `⚠️ Word limit exceeded! Max is ${limit} words, but you wrote ${wordCount}.`;
            errorMsg.style.display = "block";
            return;
        }
    }

    // 5. Smart NLP Feature: 9-digit requirement
    if (combinedText.includes("9-digit") || combinedText.includes("9 digit")) {
        if (!/^\d{9}$/.test(answer)) {
            errorMsg.innerText = "⚠️ Please enter exactly 9 digits and no other characters.";
            errorMsg.style.display = "block";
            return; 
        }
    }
    // ==========================================

    let actualDOMAnswer = answer;
    if (q.originalOptions && answer !== "") {
      actualDOMAnswer = q.originalOptions[parseInt(answer)];
    }
    
    answers[q.fieldId] = actualDOMAnswer;
    
    // REAL DOM INJECTION
    const el = document.querySelector(`[data-formguide-id="${q.fieldId}"]`);
    if (el) {
      if (el.type === "radio") {
        document.querySelectorAll(`input[name="${el.name}"]`).forEach(r => {
           let rLabel = r.id ? document.querySelector(`label[for="${r.id}"]`)?.innerText || r.value : r.value;
           if (rLabel === actualDOMAnswer) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
        });
      } else if (el.type === "checkbox") {
        el.checked = (actualDOMAnswer === "true");
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        if (el.tagName.toLowerCase() === "select") {
           const targetOption = Array.from(el.options).find(o => o.innerText.includes(actualDOMAnswer) || o.value === actualDOMAnswer);
           if (targetOption) el.value = targetOption.value;
        } else {
           setNativeValue(el, actualDOMAnswer);
        }
        el.dispatchEvent(new Event(el.tagName.toLowerCase() === "select" ? "change" : "input", { bubbles: true }));
      }
    }
    
    setTimeout(async () => {
      await autoScanForNewFields();
      currentIndex++;
      showQuestion();
    }, 150);
  }

  else if (e.target.id === "fg-confirm") {
    alert("Answers mapped to the document! Please review the form visually.");
  }
});

async function init() {
  createSidebar(); 
  const fields = extractFields();
  questions = await getQuestions(fields);
  currentIndex = 0;
  showQuestion(); 
}

init();
