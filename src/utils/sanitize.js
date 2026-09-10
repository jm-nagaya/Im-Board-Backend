import DOMPurify from 'isomorphic-dompurify';

export const sanitizeMessage = (input) => {
    if (!input) return null;

    return DOMPurify.sanitize(input, {
        // No HTML allowed
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: []
    }).trim();
};