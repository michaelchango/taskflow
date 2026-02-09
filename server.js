const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SQLite Database Setup
const db = new sqlite3.Database('taskflow.db');

// Initialize tables (run once)
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            priority TEXT DEFAULT 'medium',
            deadline DATE NOT NULL,
            completed INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    `);

    // Insert sample data if tables are empty
    db.get('SELECT COUNT(*) as count FROM projects', (err, row) => {
        if (row.count === 0) {
            const sampleProjects = [
                { id: 'p1', name: 'Personal' },
                { id: 'p2', name: 'Work' },
                { id: 'p3', name: 'Learning' }
            ];
            
            const sampleTasks = [
                { id: 't1', project_id: 'p1', name: 'Buy groceries', description: 'Milk, eggs, bread', priority: 'high', deadline: new Date(Date.now() + 86400000).toISOString().split('T')[0], completed: 0 },
                { id: 't2', project_id: 'p1', name: 'Clean room', description: 'Tidy up the bedroom', priority: 'low', deadline: new Date(Date.now() + 172800000).toISOString().split('T')[0], completed: 0 },
                { id: 't3', project_id: 'p2', name: 'Email report', description: 'Send weekly progress report', priority: 'high', deadline: new Date(Date.now() + 86400000).toISOString().split('T')[0], completed: 0 },
                { id: 't4', project_id: 'p2', name: 'Team meeting', description: 'Prepare agenda', priority: 'medium', deadline: new Date(Date.now() + 259200000).toISOString().split('T')[0], completed: 0 },
                { id: 't5', project_id: 'p3', name: 'Read chapter 5', description: 'JavaScript patterns', priority: 'medium', deadline: new Date(Date.now() + 345600000).toISOString().split('T')[0], completed: 0 },
                { id: 't6', project_id: 'p1', name: 'Call mom', description: 'Wish her happy birthday', priority: 'high', deadline: new Date(Date.now() - 86400000).toISOString().split('T')[0], completed: 1 }
            ];
            
            const projectStmt = db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)');
            const taskStmt = db.prepare('INSERT INTO tasks (id, project_id, name, description, priority, deadline, completed) VALUES (?, ?, ?, ?, ?, ?, ?)');
            
            sampleProjects.forEach(p => {
                projectStmt.run(p.id, p.name);
            });
            
            sampleTasks.forEach(t => {
                taskStmt.run(t.id, t.project_id, t.name, t.description, t.priority, t.deadline, t.completed);
            });
            
            projectStmt.finalize();
            taskStmt.finalize();
            
            console.log('📦 Sample data inserted');
        }
    });
});

// Helper function to wrap db.all in Promise
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Helper function to wrap db.run in Promise
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// ============ PROJECTS API ============

// Get all projects
app.get('/api/projects', async (req, res) => {
    try {
        const projects = await all('SELECT * FROM projects ORDER BY created_at DESC');
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create project
app.post('/api/projects', async (req, res) => {
    try {
        const { id, name } = req.body;
        await run('INSERT INTO projects (id, name) VALUES (?, ?)', [id, name]);
        res.json({ id, name });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete project
app.delete('/api/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await run('DELETE FROM tasks WHERE project_id = ?', [id]);
        await run('DELETE FROM projects WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ TASKS API ============

// Get all tasks
app.get('/api/tasks', async (req, res) => {
    try {
        const { project_id } = req.query;
        let tasks;
        if (project_id) {
            tasks = await all('SELECT * FROM tasks WHERE project_id = ? ORDER BY deadline ASC', [project_id]);
        } else {
            tasks = await all('SELECT * FROM tasks ORDER BY deadline ASC');
        }
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create task
app.post('/api/tasks', async (req, res) => {
    try {
        const { id, project_id, name, description, priority, deadline } = req.body;
        await run(
            'INSERT INTO tasks (id, project_id, name, description, priority, deadline) VALUES (?, ?, ?, ?, ?, ?)',
            [id, project_id, name, description || '', priority, deadline]
        );
        res.json({ id, project_id, name, description, priority, deadline, completed: 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update task
app.put('/api/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, priority, deadline, completed, project_id } = req.body;
        
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
app.patch('/api/tasks/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;
        const task = await all('SELECT completed FROM tasks WHERE id = ?', [id]);
        
        if (task.length > 0) {
            const newStatus = task[0].completed ? 0 : 1;
            await run('UPDATE tasks SET completed = ? WHERE id = ?', [newStatus, id]);
            res.json({ success: true, completed: newStatus });
        } else {
            res.status(404).json({ error: 'Task not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete task
app.delete('/api/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await run('DELETE FROM tasks WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export data as JSON
app.get('/api/export', async (req, res) => {
    try {
        const projects = await all('SELECT * FROM projects');
        const tasks = await all('SELECT * FROM tasks');
        
        const data = {
            projects,
            tasks,
            exportedAt: new Date().toISOString()
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="taskflow-backup-${new Date().toISOString().split('T')[0]}.json"`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Import data from JSON
app.post('/api/import', async (req, res) => {
    try {
        const { projects, tasks } = req.body;
        
        if (!Array.isArray(projects) || !Array.isArray(tasks)) {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        
        // Clear existing data
        await run('DELETE FROM tasks');
        await run('DELETE FROM projects');
        
        // Import projects
        for (const p of projects) {
            await run('INSERT INTO projects (id, name) VALUES (?, ?)', [p.id, p.name]);
        }
        
        // Import tasks
        for (const t of tasks) {
            await run(
                'INSERT INTO tasks (id, project_id, name, description, priority, deadline, completed) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [t.id, t.project_id, t.name, t.description, t.priority, t.deadline, t.completed]
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 TaskFlow server running at http://localhost:${PORT}`);
    console.log(`📁 Database: taskflow.db`);
});
