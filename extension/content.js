// --- STATE ---
let questions = [];
let currentIndex = 0;
let answers = {};

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

    fields.push({
      id: fieldId,
      label: label.trim(),
      context: contextText.trim(),
      type: el.tagName.toLowerCase() === "select" ? "select" : (el.type || "text"),
      options: options.length > 0 ? options : null,
      isRequired: el.hasAttribute("required"),
      maxLength: el.getAttribute("maxlength"),
      minLength: el.getAttribute("minlength")
    });
  });

  return fields;
}

// --- BACKEND API CALL ---
async function getQuestions(fields) {
  try {
    const response = await fetch("http://localhost:8001/translate-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const data = await response.json();
    
    if (!data || !data.questions) return []; 

    data.questions.forEach(q => {
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
      }
    });
    return data.questions;
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
    
    <div id="fg-answer-container" style="margin-bottom:8px;"></div>
    
    <div id="fg-error-message" style="color: #e53e3e; font-size: 13px; margin-bottom: 12px; font-weight: 500; display: none;"></div>
    
    <div style="display:flex; gap:10px;" id="fg-button-group">
      <button id="fg-back" style="padding:10px; background: #e2e8f0; color: #4a5568; border: none; border-radius: 6px; cursor: pointer; font-weight:bold; flex:1; display:none;">Back</button>
      <button id="fg-next" style="padding:10px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight:bold; flex:2; display:none;">Next</button>
    </div>
  `;
  document.body.appendChild(sidebar);
}

function showQuestion() {
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
  document.getElementById("fg-question").style.color = "#2d3748"; 
  document.getElementById("fg-next").style.display = "block";
  
  const answerContainer = document.getElementById("fg-answer-container");
  const savedAnswer = answers[q.fieldId] || ""; 

  if (q.originalOptions && q.originalOptions.length > 0) {
    let html = `<select id="fg-answer" style="width:100%; padding:10px; border: 1px solid #cbd5e0; border-radius: 6px; font-size:14px;">`;
    html += `<option value="">-- Choose an option --</option>`;
    
    const displayOptions = (q.translatedOptions.length === q.originalOptions.length) ? q.translatedOptions : q.originalOptions;
    displayOptions.forEach((opt, idx) => {
      const selected = (savedAnswer === q.originalOptions[idx]) ? "selected" : "";
      html += `<option value="${idx}" ${selected}>${opt}</option>`;
    });
    html += `</select>`;
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
    answerContainer.innerHTML = `<input id="fg-answer" type="date" value="${savedAnswer}" style="width:100%; padding:10px; border: 1px solid #cbd5e0; border-radius: 6px; box-sizing:border-box; font-size:14px;" />`;
  } else if (q.type === "textarea" || (q.originalLabel && q.originalLabel.toLowerCase().includes("describe"))) {
    // Render textareas properly for long text fields
    answerContainer.innerHTML = `<textarea id="fg-answer" style="width:100%; padding:10px; border: 1px solid #cbd5e0; border-radius: 6px; box-sizing:border-box; font-size:14px; resize:vertical; min-height:80px;" placeholder="Type your answer...">${savedAnswer}</textarea>`;
  } else {
    answerContainer.innerHTML = `<input id="fg-answer" type="text" value="${savedAnswer}" style="width:100%; padding:10px; border: 1px solid #cbd5e0; border-radius: 6px; box-sizing:border-box; font-size:14px;" placeholder="Type your answer..." />`;
  }

  document.getElementById("fg-back").style.display = currentIndex > 0 ? "block" : "none";
}

function showSummary() {
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
    if (q.type === "checkbox") {
      displayAnswer = displayAnswer === "true" ? "Agreed" : "Skipped";
    } else if (q.originalOptions && displayAnswer) {
      const idx = q.originalOptions.indexOf(answers[q.fieldId]);
      const displayOptions = (q.translatedOptions.length === q.originalOptions.length) ? q.translatedOptions : q.originalOptions;
      if (idx !== -1 && displayOptions[idx]) displayAnswer = displayOptions[idx];
    }
    
    html += `
      <li style="margin-bottom:12px; background:#f7fafc; padding:10px; border-radius:4px; border:1px solid #e2e8f0;">
        <div style="font-size:12px; color:#718096; margin-bottom:4px;">${q.question}</div>
        <div style="font-size:14px; color:#2d3748; font-weight:500;">${displayAnswer || "<em style='color:#e53e3e;'>Skipped</em>"}</div>
      </li>`;
  });
  html += `</ul>`;
  sidebar.innerHTML = html;
}

async function autoScanForNewFields() {
  const currentFieldsOnPage = extractFields();
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
document.addEventListener("click", (e) => {
  if (e.target.id === "fg-back") {
    currentIndex--;
    showQuestion();
  }
  
  else if (e.target.id === "fg-back-summary") {
    createSidebar(); 
    currentIndex = questions.length - 1; 
    showQuestion();
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

    // 1. Required Check
    if (q.isRequired && (!answer || answer === "false")) {
        errorMsg.innerText = "⚠️ This field is required to continue.";
        errorMsg.style.display = "block";
        return; 
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

    // 3. Smart NLP Feature: Catch Word & Character limits from Text/Instructions
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

    // 4. Smart NLP Feature: 9-digit requirement
    if (combinedText.includes("9-digit") || combinedText.includes("9 digit")) {
        const digitCount = answer.replace(/\D/g, '').length; 
        if (digitCount !== 9) {
            errorMsg.innerText = "⚠️ Please enter exactly 9 digits.";
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
           el.value = actualDOMAnswer;
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