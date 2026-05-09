import { createWorker } from 'https://esm.sh/tesseract.js@5.1.1';

let worker = null;
let initPromise = null;
export let isOCRReady = false;

export async function initOCR() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (worker) return;
    worker = await createWorker('eng', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core.wasm.js',
      logger: () => {},
    });
    // PSM 4: single column of variable-size text — best fit for receipts
    await worker.setParameters({ tessedit_pageseg_mode: '4' });
    isOCRReady = true;
  })();
  return initPromise;
}

function preprocessImage(imageFile) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 2000;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const grey = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        // boost contrast
        const boosted = Math.min(255, Math.max(0, (grey - 128) * 1.5 + 128));
        data[i] = data[i + 1] = data[i + 2] = boosted;
      }
      ctx.putImageData(imageData, 0, 0);
      canvas.convertToBlob({ type: 'image/png' }).then(resolve).catch(reject);
    };
    img.onerror = reject;
    img.src = url;
  });
}

export async function recogniseReceipt(imageFile) {
  if (!worker) throw new Error('OCR worker not ready');
  const processed = await preprocessImage(imageFile);
  const { data } = await worker.recognize(processed, {}, { text: true, blocks: true });
  // Flatten blocks → paragraphs → lines so the parser doesn't have to walk the tree
  const lines = [];
  for (const block of (data.blocks || [])) {
    for (const para of (block.paragraphs || [])) {
      for (const line of (para.lines || [])) lines.push(line);
    }
  }
  return { text: data.text || '', lines };
}
