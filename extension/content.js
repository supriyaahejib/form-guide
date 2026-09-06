function extractFields() {
  const fields = [];
  const inputs = document.querySelectorAll("input, select, textarea");

  inputs.forEach((el, index) => {
 
    if (el.type === "hidden" || el.type === "submit" || el.type === "button") {
      return;
    }

    let label = "";

    if (el.id) {
      const labelEl = document.querySelector(`label[for="${el.id}"]`);
      if (labelEl) label = labelEl.innerText;
    }

    if (!label && el.getAttribute("aria-label")) {
      label = el.getAttribute("aria-label");
    }

    if (!label && el.placeholder) {
      label = el.placeholder;
    }

    if (!label && el.closest("label")) {
      label = el.closest("label").innerText;
    }
    
    if (!label) {
      label = `Unlabeled field ${index + 1}`;
    }

   
    const fieldId = `fg_field_${index}`;
    el.setAttribute("data-formguide-id", fieldId);

   
    fields.push({
      id: fieldId,
      label: label.trim(),
      type: el.tagName.toLowerCase() === "select" ? "select" : (el.type || "text"),
    });
  });

  return fields;
}


async function getQuestions(fields) {
  try {
    const response = await fetch("http://localhost:8000/translate-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    
    const data = await response.json();
    return data.questions;
  } catch (error) {
    console.error("FormGuide Backend Error:", error);
    return [];
  }
}

async function init() {
  const fields = extractFields();
  console.log("FormGuide found these fields:", fields);
  
  console.log("Asking Gemini to translate...");
  const questions = await getQuestions(fields);
  
  console.log("FormGuide got these translated questions back:", questions);
}


let questions = [];
let currentIndex = 0;
let answers = {};

function createSidebar() {
  const sidebar = document.createElement("div");
  sidebar.id = "formguide-sidebar";
  sidebar.style.cssText = `
    position: fixed; top: 0; right: 0; width: 320px; height: 100%;
    background: white; border-left: 3px solid #2b6cb0; z-index: 999999;
    padding: 20px; font-family: Arial, sans-serif; box-shadow: -2px 0 10px rgba(0,0,0,0.2);
    overflow-y: auto;
  `;
  sidebar.innerHTML = `
    <h2 style="margin-top:0;">FormGuide</h2>
    <div id="fg-progress" style="color:#666; font-size:13px; margin-bottom:10px;"></div>
    <div id="fg-question" style="font-size:16px; margin-bottom:12px;">Loading...</div>
    <input id="fg-answer" type="text" style="width:100%; padding:8px; box-sizing:border-box;" />
    <button id="fg-next" style="margin-top:10px; padding:8px 16px;">Next</button>
  `;
  document.body.appendChild(sidebar);
}

function showQuestion() {
  if (currentIndex >= questions.length) {
    showSummary();
    return;
  }
  document.getElementById("fg-progress").innerText =
    `Question ${currentIndex + 1} of ${questions.length}`;
  document.getElementById("fg-question").innerText = questions[currentIndex].question;
  document.getElementById("fg-answer").value = "";
}

document.addEventListener("click", (e) => {
  if (e.target.id === "fg-next") {
    const answer = document.getElementById("fg-answer").value;
    answers[questions[currentIndex].fieldId] = answer;
    currentIndex++;
    showQuestion();
  }
});

async function init() {
  const fields = extractFields();
  createSidebar();
  questions = await getQuestions(fields);
  currentIndex = 0;
  showQuestion();
}

init();

  

