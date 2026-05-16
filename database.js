const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'atomquest.db');
const db = new sqlite3.Database(dbPath);

const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
    });
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

const initDb = async () => {
    await run('PRAGMA foreign_keys = ON');

    await run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('employee','manager','admin')),
        manager_id INTEGER,
        department TEXT,
        FOREIGN KEY(manager_id) REFERENCES users(id)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS goal_sheets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        cycle_year INTEGER NOT NULL,
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','rejected')),
        is_locked INTEGER DEFAULT 0,
        approved_by INTEGER,
        approved_at DATETIME,
        reject_reason TEXT,
        FOREIGN KEY(employee_id) REFERENCES users(id),
        FOREIGN KEY(approved_by) REFERENCES users(id)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sheet_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        thrust_area TEXT NOT NULL,
        uom_type TEXT NOT NULL,
        uom_direction TEXT NOT NULL,
        target REAL NOT NULL,
        weightage INTEGER NOT NULL,
        achievement REAL DEFAULT 0,
        goal_status TEXT DEFAULT 'not_started',
        is_shared INTEGER DEFAULT 0,
        FOREIGN KEY(sheet_id) REFERENCES goal_sheets(id)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id INTEGER NOT NULL,
        quarter TEXT NOT NULL,
        achievement REAL NOT NULL,
        status TEXT NOT NULL,
        manager_comment TEXT,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(goal_id) REFERENCES goals(id)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        changed_by INTEGER NOT NULL,
        goal_id INTEGER,
        action TEXT NOT NULL,
        field_changed TEXT,
        old_value TEXT,
        new_value TEXT,
        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(changed_by) REFERENCES users(id)
    )`);

    const userCount = await get('SELECT COUNT(*) as count FROM users');
    if (userCount.count === 0) {
        console.log('Seeding database with demo data...');
        // 1. Insert Admin, Manager, and Employee
        await run("INSERT INTO users (name, email, password, role, department) VALUES (?,?,?,?,?)", ['HR Admin', 'admin@company.com', 'admin123', 'admin', 'HR']);
        await run("INSERT INTO users (name, email, password, role, department) VALUES (?,?,?,?,?)", ['Manager Name', 'manager@company.com', 'password', 'manager', 'Engineering']);
        await run("INSERT INTO users (name, email, password, role, manager_id, department) VALUES (?,?,?,?,?,?)", ['Employee Name', 'employee@company.com', 'password', 'employee', 2, 'Engineering']);

        // 2. Insert Goal Sheet for employee (id=3), approved by manager (id=2)
        await run("INSERT INTO goal_sheets (employee_id, cycle_year, status, is_locked, approved_by, approved_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)", [3, new Date().getFullYear(), 'approved', 1, 2]);

        // 3. Insert 5 Goals totaling 100% weightage
        const goals = [
            [1, 'Implement New CI/CD Pipeline', 'Technical Excellence', 'percent', 'max', 100, 25, 65, 'on_track'],
            [1, 'Customer Satisfaction Score > 90%', 'Customer Success', 'numeric', 'max', 9.5, 15, 0, 'not_started'],
            [1, 'Internal Security Audit', 'Operational Growth', 'percent', 'max', 100, 20, 100, 'completed'],
            [1, 'Cloud Architect Certification', 'Professional Development', 'percent', 'max', 100, 20, 80, 'on_track'],
            [1, 'Mentorship Program Lead', 'Core Values', 'numeric', 'max', 16, 20, 12, 'on_track']
        ];
        
        for (const g of goals) {
            await run("INSERT INTO goals (sheet_id, title, thrust_area, uom_type, uom_direction, target, weightage, achievement, goal_status) VALUES (?,?,?,?,?,?,?,?,?)", g);
        }

        // 4. Insert 2 Check-ins for the first goal (id=1)
        await run("INSERT INTO checkins (goal_id, quarter, achievement, status, manager_comment) VALUES (?,?,?,?,?)", [1, 'Q1', 25, 'on_track', 'Good progress on initial setup.']);
        await run("INSERT INTO checkins (goal_id, quarter, achievement, status, manager_comment) VALUES (?,?,?,?,?)", [1, 'Q2', 65, 'on_track', 'Pipeline is mostly operational.']);

        // 5. Insert Audit Log
        await run("INSERT INTO audit_logs (changed_by, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?)", [1, 'policy_update', 'remote_work_allowance', '2 days', '3 days']);

        console.log('Database seeded successfully.');
    }

    console.log('Database initialised successfully');
};

module.exports = { db, run, get, all, initDb };
