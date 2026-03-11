import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export const uploadRouter = Router();

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file
const MAX_FILES = 7;

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|heic|mp4|mov|m4v)$/i;
    if (allowed.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Use jpg, png, heic, mp4, mov.'));
    }
  },
});

uploadRouter.post(
  '/media',
  upload.array('media', MAX_FILES),
  (req: Request, res: Response) => {
    if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const files = (req.files as Express.Multer.File[]).map((f) => ({
      filename: f.filename,
      originalname: f.originalname,
      path: f.path,
    }));
    res.json({ files });
  },
  (err: Error, req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: err.message || 'Upload failed' });
  }
);
