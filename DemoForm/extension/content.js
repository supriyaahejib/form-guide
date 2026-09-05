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


init();

  

