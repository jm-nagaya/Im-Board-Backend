import { pool } from '../config/database.js';

async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export const imageService = {

    // True if user has NOT posted in the last 24h; false otherwise
    async canUserPostToday(userId) {
        const result = await pool.query(
            `SELECT COUNT(*) FROM users
            WHERE id = $1
            AND last_post >= DATE_TRUNC('day', NOW())`,
            [userId]
        );
        return parseInt(result.rows[0].count) === 0;
    },

    async createImage(data) {
        const {
            userId,
            filePath,
            externalUrl,
            mimeType,
            fileSize,
            message
        } = data;
        const result = await withTransaction(async (client) => {

            // Create DB record
            const imageResult = await client.query(
                `INSERT INTO images (
                user_id, file_path, external_url, mime_type, file_size, message)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *`,
                [
                    userId,
                    filePath || null,
                    externalUrl || null,
                    mimeType || null,
                    fileSize || null,
                    message || null
                ]
            );

            // Log upload
            await client.query(
                `UPDATE users
                SET last_post = NOW()
                WHERE id = $1`,
                [userId]
            );

            return imageResult.rows[0];
        })
        
        return result;
    },
    // Create, get, and delete unconfirmed upload records
    async createUnconfirmedUpload(data) {
        const {
            userId,
            fileKey
        } = data;

        const result = await pool.query(
            `INSERT INTO unconfirmed_uploads (
            user_id, key)
            VALUES ($1, $2)
            RETURNING *`,
            [
                userId,
                fileKey
            ]
        );
        return result.rows[0];
    },

    async getUnconfirmedUpload(userId) {
        const result = await pool.query(
            `SELECT key FROM unconfirmed_uploads
            WHERE user_id = $1`,
            [userId]
        );
        return result.rows[0];
    },

    async deleteUnconfirmedUpload(userId) {
        const result = await pool.query(
            `DELETE FROM unconfirmed_uploads
            WHERE user_id = $1
            RETURNING key`,
            [userId]
        );
        return result.rows[0];
    },

    // Retrieves ALL images in the database
    async getImages(userId) {
        const result = await pool.query(
            `SELECT
                i.id,
                i.file_path,
                i.external_url,
                i.message,
                i.likes,
                EXISTS(
                    SELECT 1 from likes l
                    WHERE l.image_id = i.id and l.user_id = $1
                ) AS liked_by_user,
                (i.user_id = $1) AS owned_by_user,
                EXISTS(
                    SELECT 1 from flags f
                    WHERE f.image_id = i.id and f.user_id = $1
                ) AS flagged_by_user
                FROM images i
                WHERE i.flags < 3
                AND created_at >= NOW() - INTERVAL '1 day'`,
                [userId]
        );
        return result.rows;
    },

    async deleteImage(imageId, userId) {
        
        // Verify ownership
        const result = await pool.query(
            `DELETE FROM images WHERE id = $1 AND user_id = $2 RETURNING file_path`,
            [imageId, userId]
        );

        if (result.rows.length === 0) {
            throw new Error('Image not found or not owned by user.');
        }

        // Used to delete file from S3
        return result.rows[0];
    },

    async likeImage(imageId, userId) {

        const existing = await pool.query(
            `SELECT 1 FROM likes WHERE
            image_id = $1 AND user_id = $2`,
            [imageId, userId]
        )

        if (existing.rows.length > 0) {
            throw new Error('Already liked this image');
        }

        // Transaction to ensure different likes/unlikes are consistent
        try {
            await withTransaction(async (client) => {
                await client.query(
                    `INSERT INTO likes (image_id, user_id)
                    VALUES ($1, $2)`,
                    [imageId, userId]
                );

                await client.query(
                    `UPDATE images SET likes = likes + 1
                    WHERE id = $1`,
                    [imageId]
                );
            });
        } catch (error) {
            throw error;
        }
    },

    async unlikeImage(imageId, userId) {
        const existing = await pool.query(
            `SELECT 1 FROM likes
            WHERE image_id = $1 AND user_id = $2`,
            [imageId, userId]
        );

        if (existing.rows.length === 0) {
            throw new Error('You have not liked this image');
        }

        // As with likeImage(), use a transaction for consistency

        try {
            await withTransaction(async (client) => {
                await client.query(
                    `DELETE FROM likes
                    WHERE image_id = $1 AND user_id = $2`,
                    [imageId, userId]
                );

                await client.query(
                    `UPDATE images SET likes = likes - 1
                    WHERE id = $1 AND likes > 0`,
                    [imageId]
                );
            });
        } catch (error) {
            throw error;
        }
    },

    async flagImage(imageId, userId) {
        const existing = await pool.query(
            `SELECT 1 FROM flags
            WHERE image_id = $1 AND user_id = $2`,
            [imageId, userId]
        );

        if (existing.rows.length !== 0) {
            throw new Error('You have already reported this image');
        }

        // Transaction for consistency

        try {
            await withTransaction(async (client) => {
                await client.query(
                    `INSERT INTO flags (image_id, user_id)
                    VALUES ($1, $2)`,
                    [imageId, userId]
                );

                await client.query(
                    `UPDATE images SET flags = flags + 1
                    WHERE id = $1`,
                    [imageId]
                );
            });
        } catch (error) {
            throw error;
        }
    }
};