const { Schema, model, Types } = require("mongoose");

const issueSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    body:  { type: String, required: true, maxlength: 3000 },
    author: {
      id:     { type: String, required: true },
      name:   String,
      avatar: String,
    },
    repliesCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = model("Issue", issueSchema);
