// Used exclusively for development to access the S3 bucket

import express from 'express';
import { s3Client } from '../config/aws.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';


const router = new express.Router();

// This route is for DEVELOPMENT ONLY
router.get('/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;

        console.log('Serving file:', filename);

        const command = new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: `uploads/${filename}`
        });

        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 60});

        return res.redirect(302, signedUrl);
    } catch (error) {
        console.error('File serve error:', error);
        res.status(500).json({ error: 'Failed to serve file' });
    }
});

export default router;