const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'atomquest.db');
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
        description TEXT,
        thrust_area TEXT NOT NULL,
        uom_type TEXT NOT NULL,
        uom_direction TEXT NOT NULL,
        target REAL NOT NULL,
        weightage INTEGER NOT NULL,
        achievement REAL DEFAULT 0,
        goal_status TEXT DEFAULT 'not_started',
        is_shared INTEGER DEFAULT 0,
        shared_from_employee_id INTEGER,
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

    await run(`CREATE TABLE IF NOT EXISTS cycle_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cycle_year INTEGER NOT NULL UNIQUE,
        goal_setting_open TEXT NOT NULL,
        goal_setting_close TEXT NOT NULL,
        q1_open TEXT NOT NULL,
        q2_open TEXT NOT NULL,
        q3_open TEXT NOT NULL,
        q4_open TEXT NOT NULL,
        q4_close TEXT NOT NULL
    )`);

    await run(`CREATE TABLE IF NOT EXISTS escalation_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_type TEXT NOT NULL,
        days_threshold INTEGER NOT NULL,
        escalate_to TEXT NOT NULL
    )`);

    await run(`CREATE TABLE IF NOT EXISTS escalation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sheet_id INTEGER,
        rule_id INTEGER,
        notified_user_id INTEGER,
        escalated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(sheet_id) REFERENCES goal_sheets(id),
        FOREIGN KEY(rule_id) REFERENCES escalation_rules(id)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS notification_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient TEXT NOT NULL,
        type TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        action_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    const userCount = await get('SELECT COUNT(*) as count FROM users');
    if (userCount.count === 0) {
        console.log('Seeding database with demo data...');
        // NOTE: Passwords are stored in plain text for hackathon demo purposes only.
        // Production implementation would use bcrypt hashing.

        // 1. Insert Admin
        await run("INSERT INTO users (name, email, password, role, department) VALUES (?,?,?,?,?)",
            ['HR Admin', 'admin1@company.com', 'admin123', 'admin', 'HR']);

        // 2. Insert Managers
        await run("INSERT INTO users (name, email, password, role, department) VALUES (?,?,?,?,?)",
            ['Manager One', 'manager1@company.com', 'mgr123', 'manager', 'Engineering']);
        await run("INSERT INTO users (name, email, password, role, department) VALUES (?,?,?,?,?)",
            ['Manager Two', 'manager2@company.com', 'mgr123', 'manager', 'Sales']);

        // 3. Insert Employees (manager1 id=2 for Engineering, manager2 id=3 for Sales)
        await run("INSERT INTO users (name, email, password, role, manager_id, department) VALUES (?,?,?,?,?,?)",
            ['Employee One', 'emp1@company.com', 'emp123', 'employee', 2, 'Engineering']);
        await run("INSERT INTO users (name, email, password, role, manager_id, department) VALUES (?,?,?,?,?,?)",
            ['Employee Two', 'emp2@company.com', 'emp123', 'employee', 2, 'Engineering']);
        await run("INSERT INTO users (name, email, password, role, manager_id, department) VALUES (?,?,?,?,?,?)",
            ['Employee Three', 'emp3@company.com', 'emp123', 'employee', 3, 'Sales']);
        await run("INSERT INTO users (name, email, password, role, manager_id, department) VALUES (?,?,?,?,?,?)",
            ['Employee Four', 'emp4@company.com', 'emp123', 'employee', 3, 'Sales']);

        // 4. Approved goal sheet for emp1 (id=4)
        await run("INSERT INTO goal_sheets (employee_id, cycle_year, status, is_locked, approved_by, approved_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)",
            [4, new Date().getFullYear(), 'approved', 1, 2]);

        // 5. Insert 3 approved goals for emp1 (sheet_id=1), total weightage=100
        const emp1Goals = [
            [1, 'Implement New CI/CD Pipeline', 'Automate deployments to reduce release cycle from 2 weeks to 2 days.', 'Technical Excellence', 'percent', 'max', 100, 40, 80, 'on_track'],
            [1, 'Customer Satisfaction Score > 90%', 'Improve NPS by proactive quarterly reviews and support escalation reduction.', 'Customer Success', 'numeric', 'max', 9.5, 30, 8.5, 'on_track'],
            [1, 'Cloud Architect Certification', 'Complete AWS Solutions Architect Professional certification by Q3.', 'Professional Development', 'percent', 'max', 100, 30, 100, 'completed'],
        ];
        for (const g of emp1Goals) {
            await run("INSERT INTO goals (sheet_id, title, description, thrust_area, uom_type, uom_direction, target, weightage, achievement, goal_status) VALUES (?,?,?,?,?,?,?,?,?,?)", g);
        }

        // 6. Insert Q1 check-in for emp1 goal 1 (goal_id=1)
        await run("INSERT INTO checkins (goal_id, quarter, achievement, status, manager_comment) VALUES (?,?,?,?,?)",
            [1, 'Q1', 30, 'on_track', 'Good start. Pipeline foundation is in place.']);

        // 7. Pending sheet for emp2 (id=5)
        await run("INSERT INTO goal_sheets (employee_id, cycle_year, status, is_locked) VALUES (?,?,?,?)",
            [5, new Date().getFullYear(), 'pending', 0]);

        // 8. Insert 2 goals for emp2 (sheet_id=2), total weightage = 60 (pending, not 100 yet)
        await run("INSERT INTO goals (sheet_id, title, description, thrust_area, uom_type, uom_direction, target, weightage, achievement, goal_status) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [2, 'Increase Sales Pipeline', 'Expand qualified sales pipeline by 40% in Engineering vertical.', 'Strategic Growth', 'percent', 'max', 40, 50, 0, 'not_started']);
        await run("INSERT INTO goals (sheet_id, title, description, thrust_area, uom_type, uom_direction, target, weightage, achievement, goal_status) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [2, 'Reduce Support Tickets', 'Reduce average support tickets per week by 25% through better documentation.', 'Operational Excellence', 'numeric', 'min', 20, 50, 0, 'not_started']);

        // 9. Seed 3 audit log entries
        await run("INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)",
            [2, 1, 'sheet_approved', 'status', 'pending', 'approved']);
        await run("INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)",
            [4, 1, 'checkin_submitted', 'Q1_achievement', '0', '30']);
        await run("INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)",
            [1, null, 'policy_update', 'remote_work_allowance', '2 days', '3 days']);

        // 10. Seed cycle config for current year
        const cycleYear = new Date().getFullYear();
        await run(`INSERT OR IGNORE INTO cycle_config (cycle_year, goal_setting_open, goal_setting_close, q1_open, q2_open, q3_open, q4_open, q4_close) VALUES (?,?,?,?,?,?,?,?)`,
            [cycleYear, `${cycleYear}-05-01`, `${cycleYear}-06-30`, `${cycleYear}-07-01`, `${cycleYear}-10-01`, `${cycleYear+1}-01-01`, `${cycleYear+1}-03-01`, `${cycleYear+1}-04-30`]);

        // 11. Seed escalation rules
        await run(`INSERT OR IGNORE INTO escalation_rules (rule_type, days_threshold, escalate_to) VALUES (?,?,?)`, ['submission_delay', 7, 'manager']);
        await run(`INSERT OR IGNORE INTO escalation_rules (rule_type, days_threshold, escalate_to) VALUES (?,?,?)`, ['approval_delay', 5, 'employee_and_manager']);
        await run(`INSERT OR IGNORE INTO escalation_rules (rule_type, days_threshold, escalate_to) VALUES (?,?,?)`, ['checkin_delay', 3, 'employee_and_manager']);

        console.log('Database seeded successfully.');
    }

    console.log('Database initialised successfully');
};

module.exports = { db, run, get, all, initDb };
