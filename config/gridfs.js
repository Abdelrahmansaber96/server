const mongoose = require("mongoose");

let gridfsBucket;

function initGridFS(connection) {
  if (!connection || !connection.connection || !connection.connection.db) {
    throw new Error("Mongo connection is not ready for GridFS initialization");
  }

  gridfsBucket = new mongoose.mongo.GridFSBucket(connection.connection.db, {
    bucketName: process.env.GRIDFS_BUCKET || "editorAssets",
  });

  return gridfsBucket;
}

function getGridFsBucket() {
  if (!gridfsBucket) {
    throw new Error("GridFS bucket is not initialized yet");
  }

  return gridfsBucket;
}

module.exports = { initGridFS, getGridFsBucket };
