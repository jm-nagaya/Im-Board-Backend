import { Pool } from 'pg';

export const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ssl: {
        rejectUnauthorized: false
    } 
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Database connection failed:', err.message);
    }
    else {
        console.log('Database connected:', res.rows[0].now);
    }
})