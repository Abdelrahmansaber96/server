const express = require("express");
const editorProjectController = require("../controllers/editorProjectController");
const authMiddleware = require("../Middleware/authMiddleware");
const authorizeRoles = require("../Middleware/authorizeRoles");
const { uploadEditorFiles, persistEditorFiles } = require("../Middleware/editorUpload");
const optionalAuth = require("../Middleware/optionalAuth");

const router = express.Router();
const editorRoles = ["seller", "real_estate_developer", "developer"];

router.get("/", authMiddleware, editorProjectController.listProjects);
router.get("/:id", authMiddleware, editorProjectController.getProjectById);
router.get("/:id/scene", authMiddleware, editorProjectController.streamSceneFile);
router.get("/:id/preview", optionalAuth, editorProjectController.streamPreviewFile);

router.post(
  "/",
  authMiddleware,
  authorizeRoles(...editorRoles),
  uploadEditorFiles,
  persistEditorFiles,
  editorProjectController.createProject
);

router.put(
  "/:id",
  authMiddleware,
  authorizeRoles(...editorRoles),
  uploadEditorFiles,
  persistEditorFiles,
  editorProjectController.updateProject
);

router.delete(
  "/:id",
  authMiddleware,
  authorizeRoles(...editorRoles),
  editorProjectController.deleteProject
);

module.exports = router;
