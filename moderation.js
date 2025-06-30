const THRESHOLD = 0.50;
let classifier;
let isInitialized = false;

async function initialize() {
  try {
    // Force WASM backend for better compatibility
    process.env.BACKENDS = 'wasm';
    
    const { pipeline } = await import('@xenova/transformers');
    classifier = await pipeline('text-classification', 'Xenova/toxic-bert', {
      quantized: true,
    });
    isInitialized = true;
    console.log("Moderation model loaded successfully");
  } catch (err) {
    console.error("MODEL LOADING ERROR:", err);
    throw err; // Re-throw to handle in index.js
  }
}

async function isAbusive(text) {
  if (!isInitialized) {
    console.warn("Moderation system not yet initialized");
    return false;
  }
  
  try {
    const scores = await classifier(text, { topk: undefined });
    return scores.some(s => s.score > THRESHOLD && s.label !== 'non_toxic');
  } catch (err) {
    console.error('Toxicity check failed:', err);
    return false;
  }
}

module.exports = { isAbusive, initialize };