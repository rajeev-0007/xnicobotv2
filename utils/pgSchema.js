const { getPool } = require('./pgPool');
const log = require('./logger-styled');

async function initializeSchema() {
    const pool = getPool();

    await pool.query(`SET search_path TO public;`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.json_store (
            store_name TEXT PRIMARY KEY,
            data JSONB NOT NULL DEFAULT '{}',
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS public.custom_data (
            key TEXT PRIMARY KEY,
            value JSONB,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);

    log.success('[PostgreSQL] Schema initialized');
}

module.exports = { initializeSchema };
