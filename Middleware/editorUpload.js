const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const { Readable } = require("stream");
const { getGridFsBucket } = require("../config/gridfs");

const allowedSceneTypes = ["model/gltf-binary", "application/octet-stream"];
const allowedPreviewTypes = ["image/png", "image/jpeg", "image/webp"];

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB scenes / previews
  },
  fileFilter: (req, file, cb) => {
    const isScene = file.fieldname === "scene";
    if (isScene && !allowedSceneTypes.includes(file.mimetype)) {
      return cb(new Error("Scene upload must be a GLB binary file"));
    }
    if (!isScene && file.fieldname === "preview" && !allowedPreviewTypes.includes(file.mimetype)) {
      return cb(new Error("Preview upload must be an image (png, jpg, webp)"));
    }
    cb(null, true);
  },
});

function bufferToStream(buffer) {
  const readable = new Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
}

async function saveFileToGridFs(file, ownerId) {
  if (!file) return null;
  const bucket = getGridFsBucket();
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${path.extname(
    file.originalname || ""
  )}`;

  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: file.mimetype,
      metadata: {
        owner: ownerId,
        field: file.fieldname,
        originalName: file.originalname,
      },
    });

    bufferToStream(file.buffer)
      .pipe(uploadStream)
      .on("error", reject)
      .on("finish", (storedFile) => {
        resolve({
          id: storedFile._id,
          filename: storedFile.filename,
          size: storedFile.length,
          metadata: storedFile.metadata,
        });
      });
  });
}

async function persistEditorFiles(req, res, next) {
  try {
    if (!req.files) return next();
    const sceneFile = req.files?.scene?.[0];
    const previewFile = req.files?.preview?.[0];

    const [sceneResult, previewResult] = await Promise.all([
      saveFileToGridFs(sceneFile, req.user?.id),
      saveFileToGridFs(previewFile, req.user?.id),
    ]);

    req.editorFiles = {
      scene: sceneResult,
      preview: previewResult,
    };

    next();
  } catch (error) {
    next(error);
  }
}

const uploadEditorFiles = upload.fields([
  { name: "scene", maxCount: 1 },
  { name: "preview", maxCount: 1 },
]);

module.exports = { uploadEditorFiles, persistEditorFiles };
