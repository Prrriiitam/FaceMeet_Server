const fs = require("fs");
const path = require("path");
const ort = require("onnxruntime-node");
const { Tokenizer } = require("tokenizers");

let tokenizer;
let session;

async function loadModel() {
  // Load ONNX model
  const modelPath = path.join(__dirname, "models/minilm/model.onnx");

  if (!fs.existsSync(modelPath)) {
    throw new Error("❌ model.onnx not found at: " + modelPath);
  }

  session = await ort.InferenceSession.create(modelPath);

  // Load tokenizer
  const tokenizerPath = path.join(__dirname, "models/minilm/tokenizer.json");

  if (!fs.existsSync(tokenizerPath)) {
    throw new Error("❌ tokenizer.json not found at: " + tokenizerPath);
  }

  tokenizer = await Tokenizer.fromFile(tokenizerPath); // ← simpler

  tokenizer.setTruncation(256);
  tokenizer.setPadding(256);

  console.log("🧠 MiniLMv2 model & tokenizer loaded ✔️");
}

async function moderate(text) {
  const enc = await tokenizer.encode(text); // Encoding object

  // Convert to BigInt64Array and specify 'int64' type for ONNX Runtime
  const inputIds = BigInt64Array.from(enc.getIds().map(id => BigInt(id)));
  const attentionMask = BigInt64Array.from(enc.getAttentionMask().map(mask => BigInt(mask)));
  const typeIds = BigInt64Array.from((enc.getTypeIds().length ?
    enc.getTypeIds() :
    new Array(inputIds.length).fill(0)).map(typeId => BigInt(typeId)));

  const inputs = {
    input_ids: new ort.Tensor("int64", inputIds, [1, inputIds.length]),
    attention_mask: new ort.Tensor("int64", attentionMask, [1, attentionMask.length]),
    token_type_ids: new ort.Tensor("int64", typeIds, [1, typeIds.length]),
  };

  const { logits } = await session.run(inputs);
  const score = 1 / (1 + Math.exp(-logits.data[0])); // sigmoid
  return score > 0.5;
}


module.exports = { loadModel, moderate };