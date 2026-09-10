import 'dotenv/config';

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { attachUser, isAuthenticated } from './middleware/auth.js';

import imagesRouter from './routes/images.js';
import publicRouter from './routes/public.js'; // For development purposes only

const app = express();
const PORT = process.env.PORT;
const allowedOrigins = [
    process.env.FRONTEND_URL,
    process.env.CLOUDFRONT_URL
];

app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/images', attachUser, isAuthenticated, imagesRouter);

// Only enable public route in development environment
if (process.env.NODE_ENV === 'development') {
    app.use('/uploads', publicRouter);
    console.log('Public uploads route enabled (development mode)');
}

app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
});