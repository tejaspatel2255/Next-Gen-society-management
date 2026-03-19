// models/ContactRequest.js
const mongoose = require("mongoose");

const contactRequestSchema = new mongoose.Schema({
  fromResident: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  toResident: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, enum: ["pending", "approved"], default: "pending" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("ContactRequest", contactRequestSchema);
