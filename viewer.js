// Set the worker path
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.umd.js';

// Base PDF URL
const BASE_PDF_URL = '/public/assets/program-book.pdf';

// Cache-busting only on initial load
const isInitialLoad = performance.navigation.type === performance.navigation.TYPE_NAVIGATE;
const PDF_URL = isInitialLoad ? `${BASE_PDF_URL}?v=${Date.now()}` : BASE_PDF_URL;

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;

const canvas = document.getElementById('pdf-canvas');
const ctx = canvas.getContext('2d');
const pageInfo = document.getElementById('page-info');
const prevBtn = document.getElementById('prev-page');
const nextBtn = document.getElementById('next-page');

async function loadPDF() {
  try {
    const loadingTask = pdfjsLib.getDocument(PDF_URL);
    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;
    renderPage(currentPage);
  } catch (err) {
    console.error("❌ Failed to load PDF:", err);
    pageInfo.textContent = "Failed to load program book.";
  }
}

async function renderPage(num) {
  try {
    const page = await pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale: 1.5 });

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: ctx, viewport }).promise;

    pageInfo.textContent = `Page ${num} of ${totalPages}`;
    prevBtn.disabled = num <= 1;
    nextBtn.disabled = num >= totalPages;
  } catch (err) {
    console.error("❌ Failed to render page:", err);
    pageInfo.textContent = "Error rendering page.";
  }
}

prevBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    renderPage(currentPage);
  }
});

nextBtn.addEventListener('click', () => {
  if (currentPage < totalPages) {
    currentPage++;
    renderPage(currentPage);
  }
});

loadPDF();
