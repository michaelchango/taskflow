const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session storage (in-memory for simplicity, use Redis for production)
const sessions = new Map();

// SQLite Database Setup
const db = new sqlite3.Database('taskflow.db');

// Initialize tables
db.serialize(() => {
    // Users table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            nickname TEXT NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Projects table (now with user_id)
    db.run(`
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Tasks table (now with user_id)
    db.run(`
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            priority TEXT DEFAULT 'medium',
            deadline DATE NOT NULL,
            completed INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    `);
});

// Helper functions
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Simple session middleware
function requireAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.userId = sessions.get(token);
    next();
}

// ============ AUTH API ============

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, nickname, password } = req.body;
        
        if (!username || !nickname || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }

        const id = 'u' + Date.now();
        const hashedPassword = password; // In production, use bcrypt

        await run(
            'INSERT INTO users (id, username, nickname, password) VALUES (?, ?, ?, ?)',
            [id, username, nickname, hashedPassword]
        );

        res.json({ id, username, nickname });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint')) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        res.status(500).json({ error: error.message });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await get('SELECT * FROM users WHERE username = ?', [username]);
        
        if (!user || user.password !== password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, user.id);

        res.json({
            token,
            user: { id: user.id, username: user.username, nickname: user.nickname }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Logout
app.post('/api/auth/logout', requireAuth, (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    sessions.delete(token);
    res.json({ success: true });
});

// Get current user
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const user = await get('SELECT id, username, nickname FROM users WHERE id = ?', [req.userId]);
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update profile
app.put('/api/auth/profile', requireAuth, async (req, res) => {
    try {
        const { nickname, password } = req.body;
        
        if (nickname) {
            await run('UPDATE users SET nickname = ? WHERE id = ?', [nickname, req.userId]);
        }
        if (password) {
            await run('UPDATE users SET password = ? WHERE id = ?', [password, req.userId]);
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ PROJECTS API ============

// Get all projects (user's only)
app.get('/api/projects', requireAuth, async (req, res) => {
    try {
        const projects = await all('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC', [req.userId]);
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create project
app.post('/api/projects', requireAuth, async (req, res) => {
    try {
        const { name } = req.body;
        const id = 'p' + Date.now();
        
        await run(
            'INSERT INTO projects (id, user_id, name) VALUES (?, ?, ?)',
            [id, req.userId, name]
        );

        res.json({ id, name });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete project
app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    try {
        // Verify project belongs to user
        const project = await get('SELECT * FROM projects WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await run('DELETE FROM tasks WHERE project_id = ?', [req.params.id]);
        await run('DELETE FROM projects WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update project
app.put('/api/projects/:id', requireAuth, async (req, res) => {
    try {
        const { name } = req.body;
        
        // Verify project belongs to user
        const project = await get('SELECT * FROM projects WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await run('UPDATE projects SET name = ? WHERE id = ?', [name, req.params.id]);
        res.json({ id: req.params.id, name });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ TASKS API ============

// Get all tasks (user's only)
app.get('/api/tasks', requireAuth, async (req, res) => {
    try {
        const { project_id } = req.query;
        let tasks;
        
        if (project_id) {
            tasks = await all(
                'SELECT * FROM tasks WHERE user_id = ? AND project_id = ? ORDER BY deadline ASC',
                [req.userId, project_id]
            );
        } else {
            tasks = await all(
                'SELECT * FROM tasks WHERE user_id = ? ORDER BY deadline ASC',
                [req.userId]
            );
        }
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create task
app.post('/api/tasks', requireAuth, async (req, res) => {
    try {
        const { id, project_id, name, description, priority, deadline } = req.body;
        
        // Verify project belongs to user
        const project = await get('SELECT * FROM projects WHERE id = ? AND user_id = ?', [project_id, req.userId]);
        if (!project) {
            return res.status(400).json({ error: 'Invalid project' });
        }

        await run(
            'INSERT INTO tasks (id, user_id, project_id, name, description, priority, deadline) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, req.userId, project_id, name, description || '', priority, deadline]
        );

        res.json({ id, project_id, name, description, priority, deadline, completed: 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update task
app.put('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, priority, deadline, completed, project_id } = req.body;

        // Verify task belongs to user
        const task = await get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [id, req.userId]);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        await run(
            'UPDATE tasks SET name = ?, description = ?, priority = ?, deadline = ?, completed = ?, project_id = ? WHERE id = ?',
            [name, description, priority, deadline, completed ? 1 : 0, project_id, id]
        );

        res.json({ id, project_id, name, description, priority, deadline, completed: completed ? 1 : 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Toggle task completion
app.patch('/api/tasks/:id/toggle', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // Verify task belongs to user
        const task = await get('SELECT completed FROM tasks WHERE id = ? AND user_id = ?', [id, req.userId]);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const newStatus = task.completed ? 0 : 1;
        await run('UPDATE tasks SET completed = ? WHERE id = ?', [newStatus, id]);
        res.json({ success: true, completed: newStatus });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete task
app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // Verify task belongs to user
        const task = await get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [id, req.userId]);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        await run('DELETE FROM tasks WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export data
app.get('/api/export', requireAuth, async (req, res) => {
    try {
        const projects = await all('SELECT * FROM projects WHERE user_id = ?', [req.userId]);
        const tasks = await all('SELECT * FROM tasks WHERE user_id = ?', [req.userId]);
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="taskflow-backup.json"`);
        res.json({ projects, tasks });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 TaskFlow server running at http://localhost:${PORT}`);
    console.log(`📁 Database: taskflow.db`);
});
