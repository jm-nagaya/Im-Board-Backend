import express from 'express';
import { upload, uploadToS3 } from '../middleware/upload.js';
import { attachUser, isAuthenticated } from '../middleware/auth.js';
import { sanitizeMessage } from '../utils/sanitize.js';
import { imageService } from '../services/imageService.js';
import { DeleteObjectCommand, PutObjectCommand, GetObjectCommand, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../config/aws.js';
import { validateImageMagicBytes } from '../utils/imageValidation.js';
import { allowedTypes, allowedExts } from '../config/allowedFiles.js';
import path from 'path';
import crypto from 'crypto';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const router = express.Router();

// Endpoint to get all image metadata. Public.
router.get(
    '/',
    attachUser,
    isAuthenticated,
    async (req, res) => {
        try{
            const userId = req.user.sub;
            const images = await imageService.getImages(userId);
            res.json({ images });
        } catch (error) {
            console.error('Fetch images error:', error);
            res.status(500).json({ error: 'Failed to fetch images' });
        }
    }
);

// Image upload endpoint. Deprecated in favor of presigned URL flow. Kept for reference.
// router.post(
//     '/upload',
//     attachUser,
//     isAuthenticated,
//     // Catches exceptions from upload.js
//     (req, res, next) => {
//     upload.single('image') (req, res, (err) => {
//             if (err) {
//                 console.error('Multer error:', err);
//                 return res.status(400).json({ error: 'File upload failed. Ensure the file is an image and under 5MB.' });
//             }
//             next();
//         });
//     },
//     async (req, res) => {
//         try {
//             if (!req.file) {
//                 return res.status(400).json({ error: 'No file uploaded' });
//             }

//             const userId = req.user.sub;
//             const safeMessage = sanitizeMessage(req.body.message);
//             const isValidImage = await validateImageMagicBytes(req.file.buffer, allowedTypes);

//             if (!isValidImage || !allowedExts.includes(req.file.originalname.toLowerCase().slice(req.file.originalname.lastIndexOf('.')))) {
//                 return res.status(400).json({ error: 'Invalid file format' });
//             }

//             const fileKey = await uploadToS3(req.file);
//             req.file.key = fileKey;

//             // Check if user can post today
//             const canPost = await imageService.canUserPostToday(userId);
//             if (!canPost) {
//                 await s3Client.send( new DeleteObjectCommand({
//                     Bucket: process.env.S3_BUCKET_NAME,
//                     Key: req.file.key
//                 }));
//                 return res.status(429).json({ error: 'Daily post limit reached (one image per day)' });
//             }

//             const image = await imageService.createImage({
//                 userId,
//                 filePath: req.file.key,
//                 mimeType: req.file.mimetype,
//                 message: safeMessage
//             });

//             res.status(201).json({
//                 success: true,
//                 image: {
//                     id: image.id,
//                     message: image.message,
//                     file_path: image.file_path
//                 }
//             });
//         } catch (error) {
//             // Clean up in case error occurred after file creation
//             if (req.file?.key) {
//                 await s3Client.send( new DeleteObjectCommand({
//                     Bucket: process.env.S3_BUCKET_NAME,
//                     Key: req.file.key
//                 }));
//             }
//             console.error(error);
//             res.status(500).json({ error: 'Upload failed' });
//         }
//     }
// );

router.post(
    '/presign-upload',
    async (req, res) => {

        //Validation stage (Not a full security check, just a first line of defense)
        const userId = req.user?.sub;
        const { fileSize, fileType } = req.body;
            console.log('📁 File size:', fileSize);
            console.log('📁 File type:', fileType);

        // File type and size validation
        if (!allowedTypes.includes(fileType)) {
            return res.status(400).json({ error: 'Invalid file type' });
        }

        if (!(0 < fileSize <= 5 * 1024 * 1024)) {
            return res.status(400).json({ error: 'File size exceeds 5MB limit' });
        }

        // Check if user can post today and if they have an unconfirmed upload pending
        const canPost = await imageService.canUserPostToday(userId);
        if (!canPost) {
            return res.status(429).json({ error: 'Daily post limit reached (one image per day)' });
        }

        const uploadPending = await imageService.getUnconfirmedUpload(userId);
        if (uploadPending) {
            return res.status(400).json({ error: 'You have an unconfirmed upload pending. Please complete it before starting a new upload.' });
        }

        // URL generation stage
        const fileKey = `uploads/unconfirmed/${crypto.randomUUID()}`;
        try {

            const unconfirmedUpload = await imageService.createUnconfirmedUpload({
                userId,
                fileKey
            });

            if (!unconfirmedUpload) {
                return res.status(500).json({ error: 'Failed to create unconfirmed upload record' });
            }

            const presignedUrl = await getSignedUrl(s3Client, new PutObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: fileKey,
                ContentType: fileType,
                ContentLength: fileSize
            }), { expiresIn: 60 });

            res.json({ presignedUrl });
        } catch (error) {
            console.error('Error generating presigned URL:', error);
            res.status(500).json({ error: 'Failed to generate presigned URL' });
        }
    }
);

router.post(
    '/complete-upload',
    attachUser,
    isAuthenticated,
    async (req, res) => {
        let fileKey;
        let newKey;
        let userId;

        try {
            userId = req.user.sub;
            const { message } = req.body;

            // Get file key from unconfirmed uploads
            const unconfirmedUpload = await imageService.getUnconfirmedUpload(userId);
            fileKey = unconfirmedUpload?.key;
            if (!fileKey) {
                return res.status(400).json({ error: 'No unconfirmed upload found for user' });
            }
            console.log('Confirming upload for fileKey:', fileKey);

            // Validation stage

            // Exists
            const head = await s3Client.send(new HeadObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: fileKey,
            }));
            if (!head) {
                return res.status(400).json({ error: 'File not found in storage' });
            }

            // Size
            const fileSize = head.ContentLength;

            if (fileSize > 5 * 1024 * 1024) {
                await s3Client.send( new DeleteObjectCommand({
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: fileKey
                }));
                return res.status(400).json({ error: 'File size exceeds 5MB limit' });
            }

            // Type
            const { Body: file } = await s3Client.send(new GetObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: fileKey
            }));
            if (!file) {
                return res.status(400).json({ error: 'File not found in storage' });
            }

            const { valid, detectedType, detectedExt } = await validateImageMagicBytes(await file.transformToByteArray(), allowedTypes);
            if (!valid) {
                await s3Client.send( new DeleteObjectCommand({
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: fileKey
                }));
                return res.status(400).json({ error: 'Invalid file format' });
            }

            // Check if user can post today
            const canPost = await imageService.canUserPostToday(userId);
            if (!canPost) {
                await s3Client.send( new DeleteObjectCommand({
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: fileKey
                }));
                return res.status(429).json({ error: 'Daily post limit reached (one image per day)' });
            }

            // Add message sanitization and move file to confirmed uploads
            const safeMessage = sanitizeMessage(message);
            newKey = fileKey.replace('uploads/unconfirmed/', 'uploads/') + detectedExt;
            await s3Client.send(new CopyObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: newKey,
                CopySource: `${process.env.S3_BUCKET_NAME}/${fileKey}`,
                ContentType: detectedType
            }));
            await s3Client.send(new DeleteObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: fileKey
            }));

            console.log('File moved to confirmed uploads:', newKey);

            // Create image record in database (logs upload)
            const image = await imageService.createImage({
                userId,
                filePath: newKey,
                message: safeMessage
            });

            res.status(201).json({
                success: true,
                image: {
                    id: image.id,
                    message: image.message,
                    file_path: image.file_path
                }
            });
        } catch (error) {
            if (newKey) {
                await s3Client.send( new DeleteObjectCommand({
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: newKey
                }));
            }

            if (fileKey) {
                await s3Client.send( new DeleteObjectCommand({
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: fileKey
                }));
            }
            console.error('Confirm upload error:', error);
            res.status(500).json({ error: 'Failed to confirm upload' });
        } finally {
            imageService.deleteUnconfirmedUpload(userId);
        }
    }
);

router.post(
    '/upload/gif',
    attachUser,
    isAuthenticated,
    upload.none(),
    async (req, res) => {
        try {
            const { external_url, message } = req.body;

            // Validate URL
            const parsedUrl = new URL(external_url);
            if (!external_url || parsedUrl.origin !== 'https://static.klipy.com') {
                return res.status(400).json({ error: 'Invalid GIF URL' });
            }

            const userId = req.user.sub;
            const safeMessage = sanitizeMessage(message);

            // Check if user can post today
            const canPost = await imageService.canUserPostToday(userId);
            if (!canPost) {
                return res.status(429).json({ error: 'Daily post limit reached (one image per day)' });
            }

            const image = await imageService.createImage({
                userId,
                externalUrl: external_url,
                message: safeMessage
            });

            res.status(201).json({
                success: true,
                image: {
                    id: image.id,
                    message: image.message,
                    external_url: image.external_url
                }
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Upload failed' });
        }
    }
);

router.delete(
    '/:id',
    attachUser,
    isAuthenticated,
    async (req, res) => {
        try {
            const imageId = req.params.id;
            const userId = req.user.sub;

            const result = await imageService.deleteImage(imageId, userId);

            console.log(result?.file_path);

            if (result && result.file_path) {
                const deleteResult = await s3Client.send( new DeleteObjectCommand({
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: result.file_path
                }));
                if (deleteResult.$metadata.httpStatusCode !== 204) {
                    console.error('Failed to delete file from S3:', deleteResult);
                    return res.status(500).json({ error: 'Failed to delete image from storage' });
                }
            } else if (result) {
                // No file to delete for external URLs
            } else {
                return res.status(404).json({ error: 'Image not found or not owned by user' });
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Delete error:', error);
            res.status(500).json({ error: 'Failed to delete image' });
        }
    }
);

router.post(
    '/:id/like',
    attachUser,
    isAuthenticated,
    async (req, res) => {
        try {
            const imageId = req.params.id;
            const userId = req.user.sub;

            await imageService.likeImage(imageId, userId);

            res.json({ success: true });
        } catch (error) {
            console.error('Like error:', error);
            if (error.message === 'Already liked this image') {
                return res.status(409).json({ error: 'You have already liked this image' });
            }
            res.status(500).json({ error: 'Failed to like image' });
        }
    }
);

router.delete(
    '/:id/like',
    attachUser,
    isAuthenticated,
    async (req, res) => {
        try {
            const imageId = req.params.id;
            const userId = req.user.sub;

            await imageService.unlikeImage(imageId, userId);

            res.json({ success: true });
        } catch (error) {
            console.error('Unlike error:', error);
            if (error.message === 'You have not liked this image') {
                return res.status(409).json({ error: 'You have not liked this image' });
            }
            res.status(500).json({ error: 'Failed to unlike image' });
        }
    }
);

router.post(
    '/:id/flag',
    attachUser,
    isAuthenticated,
    async (req, res) => {
        try {
            const imageId = req.params.id;
            const userId = req.user.sub;

            await imageService.flagImage(imageId, userId);

            res.json({ success: true });

        } catch (error) {
            console.error('Flag error:', error);
            res.status(500).json({ error: 'Failed to flag image' });
        }
    }
);

export default router;