import multer from 'multer';
import path from 'path';
import crypto from 'crypto';

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../config/aws.js';
import { allowedTypes, allowedExts } from '../config/allowedFiles.js';

const generateFilename = (file) => {
    const ext = path.extname(file.originalname);
    return `${crypto.randomUUID()}${ext}`;
};

const fileFilter = (req, file, cb) => {

    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedTypes.includes(file.mimetype) || !allowedExts.includes(ext)) {
        console.log('failed multer verification');
        return cb(new Error('Invalid file format'), false); //`false` skips saving file
    }
    cb(null, true);
};

const storage = multer.memoryStorage();

export const uploadToS3 = async (file) => {
    const key = `uploads/${generateFilename(file)}`;

    await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ContentLength: file.size
    }));

    return key;
};

export const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024
    }
});