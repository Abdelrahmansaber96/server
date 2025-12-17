const mongoose = require("mongoose");

const transformSchema = new mongoose.Schema(
  {
    position: {
      type: [Number],
      default: [0, 0, 0],
    },
    rotation: {
      type: [Number],
      default: [0, 0, 0],
    },
    scale: {
      type: [Number],
      default: [1, 1, 1],
    },
  },
  { _id: false }
);

const elementSchema = new mongoose.Schema(
  {
    elementId: { type: String, required: true },
    type: { type: String, required: true },
    label: { type: String },
    dimensions: { type: mongoose.Schema.Types.Mixed },
    transform: { type: transformSchema, default: () => ({}) },
    material: { type: mongoose.Schema.Types.Mixed },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const editorProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, maxlength: 2000 },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    roleSnapshot: { type: String, required: true },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
    },
    tags: { type: [String], default: [] },
    landConfig: { type: mongoose.Schema.Types.Mixed },
    elements: { type: [elementSchema], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed },
    sceneFileId: { type: mongoose.Schema.Types.ObjectId },
    sceneFileName: { type: String },
    sceneFileSize: { type: Number },
    previewFileId: { type: mongoose.Schema.Types.ObjectId },
    previewFileName: { type: String },
    previewFileSize: { type: Number },
    version: { type: Number, default: 1 },
    sceneVersion: { type: String },
    lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

editorProjectSchema.index({ owner: 1, updatedAt: -1 });
editorProjectSchema.index({ status: 1, updatedAt: -1 });
editorProjectSchema.index({ name: "text", description: "text" });

module.exports = mongoose.model("EditorProject", editorProjectSchema);
