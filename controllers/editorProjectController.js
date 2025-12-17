const mongoose = require("mongoose");
const EditorProject = require("../models/editorProjectModel");
const { getGridFsBucket } = require("../config/gridfs");

const editorRoles = new Set(["seller", "real_estate_developer", "developer"]);

function parseJsonField(payload, field) {
  if (!Object.prototype.hasOwnProperty.call(payload, field)) {
    return;
  }

  const value = payload[field];
  if (typeof value === "string") {
    try {
      payload[field] = JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid JSON format for ${field}`);
    }
  }
}

function normalizeElements(elements = []) {
  if (!Array.isArray(elements)) {
    return [];
  }

  return elements
    .map((element) => ({
      elementId: element.elementId || element.id,
      type: element.type,
      label: element.label,
      transform: element.transform,
      dimensions: element.dimensions,
      material: element.material,
      metadata: element.metadata,
    }))
    .filter((element) => element.elementId && element.type);
}

function parsePayload(body = {}) {
  const payload = { ...body };

  ["landConfig", "elements", "metadata"].forEach((field) => {
    parseJsonField(payload, field);
  });

  if (payload.tags) {
    if (typeof payload.tags === "string") {
      payload.tags = payload.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    } else if (!Array.isArray(payload.tags)) {
      payload.tags = [];
    }
  }

  payload.elements = normalizeElements(payload.elements);
  return payload;
}

function canManageProject(user, project) {
  if (!user || !project) return false;
  if (String(project.owner) === String(user.id)) return true;
  if (user.role === "admin") return true;
  return false;
}

async function removeFileIfExists(fileId) {
  if (!fileId) return;
  try {
    const bucket = getGridFsBucket();
    await bucket.delete(new mongoose.Types.ObjectId(fileId));
  } catch (error) {
    console.warn(`Unable to delete GridFS file ${fileId}:`, error.message);
  }
}

exports.createProject = async (req, res) => {
  try {
    if (!req.user || !editorRoles.has(req.user.role)) {
      return res.status(403).json({ message: "Unauthorized to create editor projects" });
    }

    const payload = parsePayload(req.body);
    if (!payload.name) {
      return res.status(400).json({ message: "Project name is required" });
    }

    const sceneFile = req.editorFiles?.scene;
    const previewFile = req.editorFiles?.preview;

    const project = await EditorProject.create({
      name: payload.name,
      description: payload.description,
      owner: req.user.id,
      roleSnapshot: req.user.role,
      status: payload.status || "draft",
      tags: payload.tags || [],
      landConfig: payload.landConfig || {},
      elements: payload.elements || [],
      metadata: payload.metadata || {},
      sceneVersion: payload.sceneVersion,
      version: payload.version || 1,
      sceneFileId: sceneFile?.id,
      sceneFileName: sceneFile?.filename,
      sceneFileSize: sceneFile?.size,
      previewFileId: previewFile?.id,
      previewFileName: previewFile?.filename,
      previewFileSize: previewFile?.size,
      lastEditedBy: req.user.id,
    });

    res.status(201).json({ message: "Editor project saved successfully", project });
  } catch (error) {
    console.error("Error creating editor project", error);
    const status = error.message?.startsWith("Invalid JSON") ? 400 : 500;
    res.status(status).json({ message: error.message || "Failed to save project" });
  }
};

exports.listProjects = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.mine === "true" && req.user) {
      filter.owner = req.user.id;
    } else if (!req.user) {
      filter.status = "published";
    }

    if (req.query.search) {
      filter.$text = { $search: req.query.search };
    }

    const [projects, total] = await Promise.all([
      EditorProject.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("name status tags owner updatedAt previewFileId previewFileName sceneVersion")
        .populate("owner", "name email role"),
      EditorProject.countDocuments(filter),
    ]);

    res.json({
      data: projects,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error listing editor projects", error);
    res.status(500).json({ message: "Failed to fetch projects" });
  }
};

exports.getProjectById = async (req, res) => {
  try {
    const project = await EditorProject.findById(req.params.id).populate("owner", "name email role");
    if (!project) {
      return res.status(404).json({ message: "Editor project not found" });
    }

    const isOwner = req.user && String(project.owner._id) === String(req.user.id);
    const isPublished = project.status === "published";

    if (!isOwner && !isPublished) {
      return res.status(403).json({ message: "You are not allowed to view this draft project" });
    }

    res.json(project);
  } catch (error) {
    console.error("Error fetching editor project", error);
    res.status(500).json({ message: "Failed to fetch project" });
  }
};

exports.updateProject = async (req, res) => {
  try {
    const project = await EditorProject.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: "Editor project not found" });
    }

    if (!canManageProject(req.user, project)) {
      return res.status(403).json({ message: "You are not allowed to update this project" });
    }

    const payload = parsePayload(req.body);

    if (typeof payload.name !== "undefined") project.name = payload.name;
    if (typeof payload.description !== "undefined") project.description = payload.description;
    if (typeof payload.status !== "undefined") project.status = payload.status;
    if (typeof payload.tags !== "undefined") project.tags = payload.tags;
    if (typeof payload.landConfig !== "undefined") project.landConfig = payload.landConfig;
    if (typeof payload.elements !== "undefined") project.elements = payload.elements;
    if (typeof payload.metadata !== "undefined") project.metadata = payload.metadata;
    if (typeof payload.sceneVersion !== "undefined") project.sceneVersion = payload.sceneVersion;
    if (typeof payload.version !== "undefined") project.version = payload.version;

    const sceneFile = req.editorFiles?.scene;
    if (sceneFile) {
      await removeFileIfExists(project.sceneFileId);
      project.sceneFileId = sceneFile.id || sceneFile._id;
      project.sceneFileName = sceneFile.filename;
      project.sceneFileSize = sceneFile.size;
    }

    const previewFile = req.editorFiles?.preview;
    if (previewFile) {
      await removeFileIfExists(project.previewFileId);
      project.previewFileId = previewFile.id || previewFile._id;
      project.previewFileName = previewFile.filename;
      project.previewFileSize = previewFile.size;
    }

    project.lastEditedBy = req.user.id;
    await project.save();

    res.json({ message: "Editor project updated successfully", project });
  } catch (error) {
    console.error("Error updating editor project", error);
    const status = error.message?.startsWith("Invalid JSON") ? 400 : 500;
    res.status(status).json({ message: error.message || "Failed to update project" });
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const project = await EditorProject.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: "Editor project not found" });
    }

    if (!canManageProject(req.user, project)) {
      return res.status(403).json({ message: "You are not allowed to delete this project" });
    }

    await removeFileIfExists(project.sceneFileId);
    await removeFileIfExists(project.previewFileId);
    await project.deleteOne();

    res.json({ message: "Editor project deleted successfully" });
  } catch (error) {
    console.error("Error deleting editor project", error);
    res.status(500).json({ message: "Failed to delete project" });
  }
};

exports.streamSceneFile = async (req, res) => {
  try {
    const project = await EditorProject.findById(req.params.id).select("sceneFileId sceneFileName owner status");
    if (!project || !project.sceneFileId) {
      return res.status(404).json({ message: "Scene file not found" });
    }

    const isOwner = req.user && canManageProject(req.user, project);
    if (!isOwner && project.status !== "published") {
      return res.status(403).json({ message: "You cannot download this draft scene" });
    }

    const bucket = getGridFsBucket();
    const downloadStream = bucket.openDownloadStream(new mongoose.Types.ObjectId(project.sceneFileId));

    res.setHeader("Content-Type", "model/gltf-binary");
    res.setHeader("Content-Disposition", `attachment; filename="${project.sceneFileName || "scene.glb"}"`);

    downloadStream.on("error", (error) => {
      console.error("Error streaming scene file", error);
      res.status(500).json({ message: "Failed to stream scene file" });
    });

    downloadStream.pipe(res);
  } catch (error) {
    console.error("Error preparing scene stream", error);
    res.status(500).json({ message: "Failed to stream scene file" });
  }
};

exports.streamPreviewFile = async (req, res) => {
  try {
    const project = await EditorProject.findById(req.params.id).select("previewFileId previewFileName owner status");
    if (!project || !project.previewFileId) {
      return res.status(404).json({ message: "Preview not found" });
    }

    if (project.status !== "published" && (!req.user || !canManageProject(req.user, project))) {
      return res.status(403).json({ message: "You cannot view this draft preview" });
    }

    const bucket = getGridFsBucket();
    const downloadStream = bucket.openDownloadStream(new mongoose.Types.ObjectId(project.previewFileId));

    res.setHeader("Content-Type", "image/*");
    res.setHeader("Content-Disposition", `inline; filename="${project.previewFileName || "preview.png"}"`);

    downloadStream.on("error", (error) => {
      console.error("Error streaming preview file", error);
      res.status(500).json({ message: "Failed to stream preview" });
    });

    downloadStream.pipe(res);
  } catch (error) {
    console.error("Error preparing preview stream", error);
    res.status(500).json({ message: "Failed to stream preview" });
  }
};
