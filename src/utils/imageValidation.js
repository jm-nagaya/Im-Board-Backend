import { fileTypeFromBuffer } from 'file-type';

export const validateImageMagicBytes = async (buffer, allowedTypes) => {
    if (!buffer || buffer.length === 0) {
        console.log('empty buffer');
        return false;
    }

    const detected = await fileTypeFromBuffer(buffer);
    if (!detected) {
        console.log('Failed to detect file type');
        return false;
    }

    // Check MIME type and extension match
    return (
        {
            valid: allowedTypes.includes(detected.mime),
            detectedType: detected.mime,
            detectedExt: detected.ext
        }
    );
};
