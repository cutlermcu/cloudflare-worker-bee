import { Pool } from 'pg';

// Helper function to format dates consistently
function formatDate(dateInput) {
    if (!dateInput) return null;

    if (dateInput instanceof Date) {
        return dateInput.toISOString().split('T')[0];
    }

    const date = new Date(dateInput);
    if (isNaN(date.getTime())) {
        throw new Error('Invalid date format');
    }

    return date.toISOString().split('T')[0];
}

// Helper function to handle CORS
function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
        'Access-Control-Max-Age': '86400',
    };
}

function corsResponse(response = null, status = 200) {
    const headers = corsHeaders();
    
    if (response) {
        if (typeof response === 'object') {
            headers['Content-Type'] = 'application/json';
            return new Response(JSON.stringify(response), { status, headers });
        }
        return new Response(response, { status, headers });
    }
    
    return new Response(null, { status, headers });
}

// Database connection pool (global)
let pool = null;

function initializePool(env) {
    if (!pool && env.DATABASE_URL) {
        pool = new Pool({
            connectionString: env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
            max: 20,
            min: 5
        });
    }
    return pool;
}

function ensurePoolExists(env) {
    if (!pool) {
        if (env.DATABASE_URL) {
            pool = initializePool(env);
            console.log('Database pool created');
        } else {
            throw new Error('No database URL available');
        }
    }
    return pool;
}

export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight requests
        if (request.method === 'OPTIONS') {
            return corsResponse();
        }

        const url = new URL(request.url);
        
        // API routes
        if (url.pathname.startsWith('/api/')) {
            return handleApiRequest(request, env, url);
        }
        
        // Serve static assets for everything else
        return env.ASSETS.fetch(request);
    }
};

async function handleApiRequest(request, env, url) {
    const method = request.method;
    const pathname = url.pathname;

    try {
        // Root API info
        if (pathname === '/api/' || pathname === '/api') {
            return corsResponse({
                name: 'WLWV Life Calendar API',
                version: '3.0.0',
                status: 'running',
                environment: 'production',
                endpoints: {
                    health: '/api/health',
                    init: 'POST /api/init',
                    daySchedules: '/api/day-schedules',
                    dayTypes: '/api/day-types',
                    events: '/api/events',
                    materials: '/api/materials'
                },
                features: [
                    'Password-protected materials',
                    'Multi-school support',
                    'A/B day scheduling',
                    'Event management',
                    'Grade-level materials',
                    'Auto-reconnecting database pool'
                ]
            });
        }

        // Health check
        if (pathname === '/api/health') {
            try {
                const activePool = ensurePoolExists(env);
                const client = await activePool.connect();
                const result = await client.query('SELECT NOW() as timestamp, version() as db_version');
                client.release();

                return corsResponse({ 
                    status: 'healthy', 
                    message: 'Database connected',
                    connected: true,
                    timestamp: result.rows[0].timestamp,
                    database: 'PostgreSQL',
                    environment: 'production'
                });
            } catch (error) {
                console.error('Health check failed:', error);
                return corsResponse({ 
                    error: 'Database connection failed',
                    connected: false,
                    details: error.message,
                    environment: 'production'
                }, 500);
            }
        }

        // Initialize database
        if (pathname === '/api/init' && method === 'POST') {
            return handleDatabaseInit(request, env);
        }

        // Day schedules routes
        if (pathname === '/api/day-schedules') {
            if (method === 'GET') {
                return handleGetDaySchedules(env);
            } else if (method === 'POST') {
                return handlePostDaySchedule(request, env);
            }
        }

        // Day types routes
        if (pathname === '/api/day-types') {
            if (method === 'GET') {
                return handleGetDayTypes(env);
            } else if (method === 'POST') {
                return handlePostDayType(request, env);
            }
        }

        // Events routes
        if (pathname === '/api/events') {
            if (method === 'GET') {
                return handleGetEvents(request, env, url);
            } else if (method === 'POST') {
                return handlePostEvent(request, env);
            }
        }

        if (pathname.startsWith('/api/events/')) {
            const eventId = pathname.split('/')[3];
            if (method === 'PUT') {
                return handlePutEvent(request, env, eventId);
            } else if (method === 'DELETE') {
                return handleDeleteEvent(env, eventId);
            }
        }

        // Materials routes
        if (pathname === '/api/materials') {
            if (method === 'GET') {
                return handleGetMaterials(request, env, url);
            } else if (method === 'POST') {
                return handlePostMaterial(request, env);
            }
        }

        if (pathname.startsWith('/api/materials/')) {
            const materialId = pathname.split('/')[3];
            if (method === 'PUT') {
                return handlePutMaterial(request, env, materialId);
            } else if (method === 'DELETE') {
                return handleDeleteMaterial(env, materialId);
            }
        }

        // 404 for unknown API routes
        return corsResponse({ 
            error: 'Not found',
            path: pathname,
            method: method
        }, 404);

    } catch (error) {
        console.error('API Error:', error);
        return corsResponse({ 
            error: 'Internal server error',
            message: error.message
        }, 500);
    }
}

async function handleDatabaseInit(request, env) {
    try {
        const body = await request.json().catch(() => ({}));
        const dbUrl = env.DATABASE_URL || body.dbUrl;

        if (!dbUrl) {
            return corsResponse({ 
                error: 'Database URL is required. Set DATABASE_URL environment variable or provide in request.',
                hasEnvVar: !!env.DATABASE_URL
            }, 400);
        }

        console.log('Initializing database connection...');
        
        if (!pool) {
            pool = initializePool(env);
        }

        const client = await pool.connect();
        console.log('Database connection successful!');

        // Create tables
        console.log('Creating/updating database schema...');

        await client.query(`
            CREATE TABLE IF NOT EXISTS day_schedules (
                date DATE PRIMARY KEY,
                schedule VARCHAR(1) NOT NULL CHECK (schedule IN ('A', 'B')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS day_types (
                date DATE PRIMARY KEY,
                type VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS events (
                id SERIAL PRIMARY KEY,
                school VARCHAR(10) NOT NULL CHECK (school IN ('wlhs', 'wvhs')),
                date DATE NOT NULL,
                title VARCHAR(255) NOT NULL,
                department VARCHAR(50),
                time TIME,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS materials (
                id SERIAL PRIMARY KEY,
                school VARCHAR(10) NOT NULL CHECK (school IN ('wlhs', 'wvhs')),
                date DATE NOT NULL,
                grade_level INTEGER NOT NULL CHECK (grade_level BETWEEN 9 AND 12),
                title VARCHAR(255) NOT NULL,
                link TEXT NOT NULL,
                description TEXT DEFAULT '',
                password TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes
        await client.query(`CREATE INDEX IF NOT EXISTS idx_events_school_date ON events(school, date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_materials_school_date_grade ON materials(school, date, grade_level)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_events_date ON events(date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_materials_date ON materials(date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_day_schedules_date ON day_schedules(date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_day_types_date ON day_types(date)`);

        console.log('Database schema initialized successfully!');
        client.release();

        return corsResponse({ 
            message: 'Database initialized successfully',
            tables: ['day_schedules', 'day_types', 'events', 'materials'],
            features: ['password-protected materials', 'multi-school support', 'performance indexes'],
            environment: 'production',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Database initialization error:', error);
        
        let errorMessage = error.message;
        let suggestions = [];
        
        if (error.code === 'ENOTFOUND') {
            errorMessage = 'Database host not found. Check your connection string.';
            suggestions.push('Verify DATABASE_URL is correct');
        } else if (error.code === 'ECONNREFUSED') {
            errorMessage = 'Connection refused. Database may not be running.';
            suggestions.push('Check if database is active');
        } else if (error.code === '28P01') {
            errorMessage = 'Authentication failed. Check credentials.';
            suggestions.push('Verify username and password in DATABASE_URL');
        } else if (error.code === '3D000') {
            errorMessage = 'Database does not exist.';
            suggestions.push('Check database name in connection string');
        }

        return corsResponse({ 
            error: errorMessage,
            code: error.code,
            suggestions,
            hasEnvVar: !!env.DATABASE_URL
        }, 500);
    }
}

async function handleGetDaySchedules(env) {
    try {
        const activePool = ensurePoolExists(env);
        const client = await activePool.connect();
        const result = await client.query('SELECT date, schedule FROM day_schedules ORDER BY date');
        client.release();

        const schedules = result.rows.map(row => ({
            date: formatDate(row.date),
            schedule: row.schedule
        }));

        return corsResponse(schedules);
    } catch (error) {
        console.error('Error fetching day schedules:', error);
        return corsResponse({ error: error.message }, 500);
    }
}

async function handlePostDaySchedule(request, env) {
    try {
        const activePool = ensurePoolExists(env);
        const { date, schedule } = await request.json();

        if (!date) {
            return corsResponse({ error: 'Date is required' }, 400);
        }

        const formattedDate = formatDate(date);
        const client = await activePool.connect();

        if (!schedule || schedule === null) {
            await client.query('DELETE FROM day_schedules WHERE date = $1', [formattedDate]);
        } else {
            if (!['A', 'B'].includes(schedule)) {
                client.release();
                return corsResponse({ error: 'Schedule must be A or B' }, 400);
            }

            await client.query(`
                INSERT INTO day_schedules (date, schedule, updated_at) 
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                ON CONFLICT (date) 
                DO UPDATE SET schedule = $2, updated_at = CURRENT_TIMESTAMP
            `, [formattedDate, schedule]);
        }

        client.release();
        return corsResponse({ 
            success: true, 
            date: formattedDate, 
            schedule: schedule 
        });
    } catch (error) {
        console.error('Error updating day schedule:', error);
        return corsResponse({ error: error.message }, 500);
    }
}

async function handleGetDayTypes(env) {
    try {
        const activePool = ensurePoolExists(env);
        const client = await activePool.connect();
        const result = await client.query('SELECT date, type FROM day_types ORDER BY date');
        client.release();

        const types = result.rows.map(row => ({
            date: formatDate(row.date),
            type: row.type
        }));

        return corsResponse(types);
    } catch (error) {
        console.error('Error fetching day types:', error);
        return corsResponse({ error: error.message }, 500);
    }
}

async function handlePostDayType(request, env) {
    try {
        const activePool = ensurePoolExists(env);
        const { date, type } = await request.json();

        if (!date) {
            return corsResponse({ error: 'Date is required' }, 400);
        }

        const formattedDate = formatDate(date);
        const client = await activePool.connect();

        if (!type || type === null) {
            await client.query('DELETE FROM day_types WHERE date = $1', [formattedDate]);
        } else {
            await client.query(`
                INSERT INTO day_types (date, type, updated_at) 
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                ON CONFLICT (date) 
                DO UPDATE SET type = $2, updated_at = CURRENT_TIMESTAMP
            `, [formattedDate, type]);
        }

        client.release();
        return corsResponse({ 
            success: true, 
            date: formattedDate, 
            type: type 
        });
    } catch (error) {
        console.error('Error updating day type:', error);
        return corsResponse({ error: error.message }, 500);
    }
}

async function handleGetEvents(request, env, url) {
    try {
        const activePool = ensurePoolExists(env);
        const school = url.searchParams.get('school');

        if (!school) {
            return corsResponse({ error: 'School parameter is required' }, 400);
        }

        if (!['wlhs', 'wvhs'].includes(school)) {
            return corsResponse({ error: 'School must be wlhs or wvhs' }, 400);
        }

        const client = await activePool.connect();
        const result = await client.query(
            'SELECT id, school, date, title, department, time, description, created_at, updated_at FROM events WHERE school = $1 ORDER BY date, time, id',
            [school]
        );
        client.release();

        const events = result.rows.map(row => ({
            ...row,
            date: formatDate(row.date)
        }));

        return corsResponse(events);
    } catch (error) {
        console.error('Error fetching events:', error);
        return corsResponse({ error: error.message }, 500);
    }
}

async function handlePostEvent(request, env) {
    try {
        const activePool = ensurePoolExists(env);
        const { school, date, title, department, time, description } = await request.json();

        if (!school || !date || !title) {
            return corsResponse({ error: 'School, date, and title are required' }, 400);
        }

        if (!['wlhs', 'wvhs'].includes(school)) {
            return corsResponse({ error: 'School must be wlhs or wvhs' }, 400);
        }

        const formattedDate = formatDate(date);
        const client = await activePool.connect();

        const result = await client.query(`
            INSERT INTO events (school, date, title, department, time, description)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, school, date, title, department, time, description, created_at, updated_at
        `, [school, formattedDate, title, department || null, time || null, description || '']);

        client.release();

        const event = {
            ...result.rows[0],
            date: formatDate(result.rows[0].date)
        };

        return corsResponse(event);
    } catch (error) {
        console.error('Error creating event:', error);
        return corsResponse({ error: error.message }, 500);
    }
}

async function handlePutEvent(request, env, eventId) {
    try {
        const activePool = ensurePoolExists(env);
        const { title, department, time, description } = await request.json();

        if (!title) {
            return corsResponse({ error: 'Title is required' }, 400);
        }

        const client = await activePool.connect();

        const result = await client.query(`
            UPDATE events 
            SET title = $1, department = $2, time = $3, description = $4, updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
            RETURNING id, school, date, title, department, time, description, created_at, updated_at
        `, [title, department || null, time || null, description || '', eventId]);

        client.release();

        if (result.rows.length === 0) {
            return corsResponse({ error: 'Event not found' }, 404);
        }

        const event = {
            ...result.rows[0],
            date: formatDate(result.rows[0].date)
        };

        return corsResponse(event);
    } catch (error) {
        console.error('Error updating event:', error);
        return corsResponse({ error: error.message }, 500);
    }
}

async function handleDeleteEvent(env, eventId) {
    try {
        const activePool = ensurePoolExists(env);
        const client = await activePool.connect();

        const result = await client.query('DELETE FROM events WHERE id = $1 RETURNING id', [eventId]);
        client.release();

        if (result.rows.length === 0) {
            return corsResponse({ error: 'Event not found' }, 404);
        }

        return corsResponse({ success: true, id: parseInt(eventId) });
    } catch (error) {
        console.error('Error deleting event:', error);
        return corsResponse({ error: error.message }, 500);
    }
}

async function handleGetMaterials(request, env, url) {
    try {
        const activePool = ensurePoolExists(env);
        const school = url.searchParams.get('school');

        if (!school) {
            return corsResponse({ error: 'School parameter is required' }, 400);
        }

        if (!['wlhs', 'wvhs'].includes(school)) {
            return corsResponse({ error: 'School must be wlhs or wvhs' }, 400);
        }

        const client = await activePool.connect();

        try {
            const result = await client.query(
                'SELECT id, school, date, grade_level, title, link, description, password, created_at, updated_at FROM materials WHERE school = $1 ORDER BY date, grade_level, id',
                [school]
            );
            
            client.release();

            const materials = result.rows.map(row => ({
                ...row,
                date: formatDate(row.date),
                password: row.password || ''
            }));

            return corsResponse(materials);
        } catch (passwordError) {
            // If password column doesn't exist, try without it
            const result = await client.query(
                'SELECT id, school, date, grade_level, title, link, description, created_at, updated_at FROM materials WHERE school = $1 ORDER BY date, grade_level, id',
                [school]
            );
            
            client.release();

            const materials = result.rows.map(row => ({
                ...row,
                date: formatDate(row.date),
                password: ''
            }));

            return corsResponse(materials);
        }
    } catch (error) {
        console.error('Error fetching materials:', error);
        return corsResponse({ error: error.message }, 500);
    }
}

async function handlePostMaterial(request, env) {
    try {
        const activePool = ensurePoolExists(env);
        const { school, date, grade_level, title, link, description, password } = await request.json();

        if (!school || !date || !grade_level || !title || !link) {
            return corsResponse({ error: 'School, date, grade_level, title, and link are required' }, 400);
        }

        if (!['wlhs', 'wvhs'].includes(school)) {
            return corsResponse({ error: 'School must be wlhs or wvhs' }, 400);
        }

        if (![9, 10, 11, 12].includes(parseInt(grade_level))) {
            return corsResponse({ error: 'Grade level must be 9, 10, 11, or 12' }, 400);
        }

        const formattedDate = formatDate(date);
        const client = await activePool.connect();

        try {
            const result = await client.query(`
                INSERT INTO materials (school, date, grade_level, title, link, description, password)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, school, date, grade_level, title, link, description, password, created_at, updated_at
            `, [school, formattedDate, parseInt(grade_level), title, link, description || '', password || '']);

            client.release();

            const material = {
                ...result.rows[0],
                date: formatDate(result.rows[0].date)
            };

            return corsResponse(material);
        } catch (passwordError) {
            // If password column doesn't exist, create without it
            const result = await client.query(`
                INSERT INTO materials (school, date, grade_level, title, link, description)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, school, date, grade_level, title, link, description, created_at, updated_at
            `, [school, formattedDate, parseInt(grade_level), title, link, description || '']);

            client.release();

            const material = {
                ...result.rows[0],
                date: formatDate(result.rows[0].date),
                password: ''
            };

            return corsResponse(material);
        }
    } catch (error) {
        console.error('Error creating material:', error);
        return corsResponse({ error: error.message }, 500);
    }
}

async function handlePutMaterial(request, env, materialId) {
    try {
        const activePool = ensurePoolExists(env);
        const { title, link, description, password } = await request.json();

        if (!title || !link) {
            return corsResponse({ error: 'Title and link are required' }, 400);
        }

        const client = await activePool.connect();

        try {
            const result = await client.query(`
                UPDATE materials 
                SET title = $1, link = $2, description = $3, password = $4, updated_at = CURRENT_TIMESTAMP
                WHERE id = $5
                RETURNING id, school, date, grade_level, title, link, description, password, created_at, updated_at
            `, [title, link, description || '', password || '', materialId]);

            client.release();

            if (result.rows.length === 0) {
                return corsResponse({ error: 'Material not found' }, 404);
            }

            const material = {
                ...result.rows[0],
                date: formatDate(result.rows[0].date)
            };

            return corsResponse(material);
        } catch (passwordError) {
            // If password column doesn't exist, update without it
            const result = await client.query(`
                UPDATE materials 
                SET title = $1, link = $2, description = $3, updated_at = CURRENT_TIMESTAMP
                WHERE id = $4
                RETURNING id, school, date, grade_level, title, link, description, created_at, updated_at
            `, [title, link, description || '', materialId]);

            client.release();

            if (result.rows.length === 0) {
                return corsResponse({ error: 'Material not found' }, 404);
            }

            const material = {
                ...result.rows[0],
                date: formatDate(result.rows[0].date),
                password: ''
            };

            return corsResponse(material);
        }
    } catch (error) {
        console.error('Error updating material:', error);
        return corsResponse({ error: error.message }, 500);
    }
}

async function handleDeleteMaterial(env, materialId) {
    try {
        const activePool = ensurePoolExists(env);
        const client = await activePool.connect();

        const result = await client.query('DELETE FROM materials WHERE id = $1 RETURNING id', [materialId]);
        client.release();

        if (result.rows.length === 0) {
            return corsResponse({ error: 'Material not found' }, 404);
        }

        return corsResponse({ success: true, id: parseInt(materialId) });
    } catch (error) {
        console.error('Error deleting material:', error);
        return corsResponse({ error: error.message }, 500);
    }
}
