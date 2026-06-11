// Dialog page entry point — runs inside Office.context.ui.displayDialogAsync popup.
// Receives { mode: "import" | "export", csv?: string } from parent via URL params,
// then uses Office.context.ui.messageParent to send results back.

Office.onReady(() => {
  const root = document.getElementById("root")!;
  renderImport(root);
});

function renderImport(root: HTMLElement) {
  root.innerHTML = `
    <div class="container">
      <h2>Import Tags</h2>
      <p>Select a CSV file with columns: <strong>tag</strong>, <strong>description</strong>.</p>
      <div class="drop-zone" id="dropZone">
        <input type="file" id="fileInput" accept=".csv,text/csv" style="display:none" />
        <span id="dropLabel">Click to choose a file, or drag and drop here</span>
      </div>
      <div id="errorMsg" class="error" style="display:none"></div>
      <div class="actions">
        <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
      </div>
    </div>
  `;

  const dropZone = document.getElementById("dropZone")!;
  const fileInput = document.getElementById("fileInput") as HTMLInputElement;
  const errorMsg = document.getElementById("errorMsg")!;

  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("over"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("over"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("over");
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) processFile(file);
  });

  document.getElementById("cancelBtn")!.addEventListener("click", () => {
    Office.context.ui.messageParent(JSON.stringify({ status: "cancelled" }));
  });

  function processFile(file: File) {
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      errorMsg.textContent = "Please select a .csv file.";
      errorMsg.style.display = "block";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const csv = reader.result as string;
      Office.context.ui.messageParent(JSON.stringify({ status: "imported", csv }));
    };
    reader.onerror = () => {
      errorMsg.textContent = "Failed to read file.";
      errorMsg.style.display = "block";
    };
    reader.readAsText(file);
  }
}
