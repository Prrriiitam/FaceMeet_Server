const { Schema, model, Types } = require("mongoose");

const replySchema = new Schema(
  {
    issueId: { type: Types.ObjectId, ref: "Issue", index: true },
    body:    { type: String, required: true, maxlength: 2000 },
    author:  {
      id:     { type: String, required: true },
      name:   String,
      avatar: String,
    },
  },
  { timestamps: true }
);

module.exports = model("Reply", replySchema);
