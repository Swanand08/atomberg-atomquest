const express = require('express');
const router = express.Router();
const { run, get, all } = require('../database');

// GET /api/admin/employees - all employees with full status
router.get('/employees', async (req, res) => {
    try {
        const year = new Date().getFullYear();
        const employees = await all(
            `SELECT u.id, u.name, u.email, u.department, m.name as manager_name, m.id as manager_id
             FROM users u LEFT JOIN users m ON u.manager_id = m.id
             WHERE u.role = 'employee' ORDER BY u.department, u.name`
        );
        const result = await Promise.all(employees.map(async emp => {
            const sheet = await get('SELECT * FROM goal_sheets WHERE employee_id = ? AND cycle_year = ?', [emp.id, year]);
            let checkinStatus = { Q1: false, Q2: false, Q3: false, Q4: false };
            let goalCount = 0;
            let completedGoals = 0;

            if (sheet) {
                const goals = await all('SELECT * FROM goals WHERE sheet_id = ?', [sheet.id]);
                goalCount = goals.length;
                completedGoals = goals.filter(g => g.goal_status === 'completed').length;

                if (goals.length > 0) {
                    const goalIds = goals.map(g => g.id);
                    for (const q of ['Q1','Q2','Q3','Q4']) {
                        const c = await get(
                            `SELECT id FROM checkins WHERE goal_id IN (${goalIds.map(() => '?').join(',')}) AND quarter = ? LIMIT 1`,
                            [...goalIds, q]
                        );
                        checkinStatus[q] = !!c;
                    }
                }
            }
            return {
                ...emp,
                sheet_status: sheet ? sheet.status : 'not_started',
                is_locked: sheet ? !!sheet.is_locked : false,
                sheet_id: sheet ? sheet.id : null,
                reject_reason: sheet ? sheet.reject_reason : null,
                goal_count: goalCount,
                completed_goals: completedGoals,
                completion_pct: goalCount > 0 ? Math.round((completedGoals / goalCount) * 100) : 0,
                checkins: checkinStatus
            };
        }));
        res.json({ employees: result });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/stats - summary stats for dashboard
router.get('/stats', async (req, res) => {
    try {
        const year = new Date().getFullYear();
        const totalEmployees = await get("SELECT COUNT(*) as c FROM users WHERE role='employee'");
        const submittedSheets = await get("SELECT COUNT(*) as c FROM goal_sheets WHERE cycle_year=? AND status IN ('pending','approved','rejected')", [year]);
        const approvedSheets = await get("SELECT COUNT(*) as c FROM goal_sheets WHERE cycle_year=? AND status='approved'", [year]);
        const pendingSheets = await get("SELECT COUNT(*) as c FROM goal_sheets WHERE cycle_year=? AND status='pending'", [year]);
        const totalGoals = await get("SELECT COUNT(*) as c FROM goals g JOIN goal_sheets gs ON g.sheet_id=gs.id WHERE gs.cycle_year=?", [year]);
        const completedGoals = await get("SELECT COUNT(*) as c FROM goals g JOIN goal_sheets gs ON g.sheet_id=gs.id WHERE gs.cycle_year=? AND g.goal_status='completed'", [year]);
        const totalCheckins = await get("SELECT COUNT(*) as c FROM checkins c JOIN goals g ON c.goal_id=g.id JOIN goal_sheets gs ON g.sheet_id=gs.id WHERE gs.cycle_year=?", [year]);
        res.json({
            total_employees: totalEmployees.c,
            submitted: submittedSheets.c,
            approved: approvedSheets.c,
            pending: pendingSheets.c,
            total_goals: totalGoals.c,
            completed_goals: completedGoals.c,
            goal_completion_pct: totalGoals.c > 0 ? Math.round((completedGoals.c / totalGoals.c) * 100) : 0,
            total_checkins: totalCheckins.c
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/analytics - data for Chart.js dashboards
router.get('/analytics', async (req, res) => {
    try {
        const year = new Date().getFullYear();
        
        // Goals by Status
        const statusDistribution = await all(`
            SELECT g.goal_status, COUNT(*) as count 
            FROM goals g 
            JOIN goal_sheets gs ON g.sheet_id = gs.id 
            WHERE gs.cycle_year = ? 
            GROUP BY g.goal_status`, [year]);
            
        // Goals by Thrust Area
        const thrustAreaDistribution = await all(`
            SELECT g.thrust_area, COUNT(*) as count 
            FROM goals g 
            JOIN goal_sheets gs ON g.sheet_id = gs.id 
            WHERE gs.cycle_year = ? 
            GROUP BY g.thrust_area`, [year]);
            
        // Average Achievement by Department
        const deptPerformance = await all(`
            SELECT u.department, AVG(g.achievement) as avg_achievement
            FROM goals g
            JOIN goal_sheets gs ON g.sheet_id = gs.id
            JOIN users u ON gs.employee_id = u.id
            WHERE gs.cycle_year = ?
            GROUP BY u.department`, [year]);

        res.json({
            status_distribution: statusDistribution,
            thrust_area_distribution: thrustAreaDistribution,
            department_performance: deptPerformance
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/unlock/:sheetId
router.post('/unlock/:sheetId', async (req, res) => {
    try {
        const adminId = req.session.user.id;
        const sheetId = Number(req.params.sheetId);
        const { reason } = req.body;
        const sheet = await get('SELECT * FROM goal_sheets WHERE id = ?', [sheetId]);
        if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
        await run("UPDATE goal_sheets SET is_locked=0, status='draft' WHERE id=?", [sheetId]);
        await run('INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)',
            [adminId, null, 'admin_unlock', 'is_locked', '1', `0 — Reason: ${reason || 'Admin override'}`]);
        res.json({ success: true, message: 'Sheet unlocked. Employee can now edit goals.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/shared-goal - 2H: include shared_from_employee_id
router.post('/shared-goal', async (req, res) => {
    try {
        const { employee_ids, title, thrust_area, uom_type, uom_direction, target, weightage, source_employee_id } = req.body;
        if (!employee_ids || !Array.isArray(employee_ids) || employee_ids.length === 0)
            return res.status(400).json({ error: 'Provide at least one employee_id' });
        const year = new Date().getFullYear();
        const results = [];
        for (const empId of employee_ids) {
            let sheet = await get('SELECT * FROM goal_sheets WHERE employee_id=? AND cycle_year=?', [empId, year]);
            if (!sheet) {
                const r = await run('INSERT INTO goal_sheets (employee_id, cycle_year) VALUES (?,?)', [empId, year]);
                sheet = await get('SELECT * FROM goal_sheets WHERE id=?', [r.lastID]);
            }
            if (sheet.is_locked) { results.push({ empId, status: 'skipped', reason: 'Sheet is locked' }); continue; }
            const count = await get('SELECT COUNT(*) as c FROM goals WHERE sheet_id=?', [sheet.id]);
            if (count.c >= 8) { results.push({ empId, status: 'skipped', reason: 'Max 8 goals reached' }); continue; }
            await run('INSERT INTO goals (sheet_id, title, thrust_area, uom_type, uom_direction, target, weightage, is_shared, shared_from_employee_id) VALUES (?,?,?,?,?,?,?,1,?)',
                [sheet.id, title, thrust_area, uom_type, uom_direction, Number(target), Number(weightage), source_employee_id || null]);
            results.push({ empId, status: 'added' });
        }
        res.json({ success: true, results });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2I. POST /api/admin/sync-shared-goals
router.post('/sync-shared-goals', async (req, res) => {
    try {
        const { source_goal_id } = req.body;
        const sourceGoal = await get('SELECT * FROM goals WHERE id=?', [source_goal_id]);
        if (!sourceGoal) return res.status(404).json({ error: 'Source goal not found' });
        // Find all shared copies (same title, thrust_area, is_shared=1, different sheet)
        const copies = await all('SELECT * FROM goals WHERE title=? AND thrust_area=? AND is_shared=1 AND id!=?',
            [sourceGoal.title, sourceGoal.thrust_area, source_goal_id]);
        for (const copy of copies) {
            await run('UPDATE goals SET achievement=?, goal_status=? WHERE id=?',
                [sourceGoal.achievement, sourceGoal.goal_status, copy.id]);
        }
        res.json({ success: true, synced: copies.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/export - properly formatted CSV
router.get('/export', async (req, res) => {
    try {
        const year = req.query.year || new Date().getFullYear();
        const data = await all(`
            SELECT u.name as employee_name, u.email, u.department, m.name as manager_name,
                gs.status as sheet_status, g.title as goal_title, g.thrust_area, g.uom_type,
                g.uom_direction, g.target, g.weightage, g.achievement, g.goal_status,
                CASE
                    WHEN g.uom_type='zero' THEN CASE WHEN g.achievement=0 THEN 100 ELSE 0 END
                    WHEN g.uom_direction='max' AND g.target>0 THEN ROUND((g.achievement/g.target)*100,1)
                    WHEN g.uom_direction='min' AND g.achievement>0 THEN ROUND((g.target/g.achievement)*100,1)
                    ELSE 0 END as score_pct,
                c1.achievement as q1_actual, c1.status as q1_status,
                c2.achievement as q2_actual, c2.status as q2_status,
                c3.achievement as q3_actual, c3.status as q3_status,
                c4.achievement as q4_actual, c4.status as q4_status
            FROM users u
            JOIN goal_sheets gs ON u.id=gs.employee_id AND gs.cycle_year=?
            JOIN goals g ON g.sheet_id=gs.id
            LEFT JOIN users m ON u.manager_id=m.id
            LEFT JOIN checkins c1 ON c1.goal_id=g.id AND c1.quarter='Q1'
            LEFT JOIN checkins c2 ON c2.goal_id=g.id AND c2.quarter='Q2'
            LEFT JOIN checkins c3 ON c3.goal_id=g.id AND c3.quarter='Q3'
            LEFT JOIN checkins c4 ON c4.goal_id=g.id AND c4.quarter='Q4'
            WHERE u.role='employee' ORDER BY u.department, u.name, g.id`, [year]);

        const BOM = '\uFEFF';
        const headers = [
            'Employee Name','Email','Department','Manager','Sheet Status',
            'Goal Title','Thrust Area','UoM Type','Direction','Target','Weightage %',
            'Final Achievement','Goal Status','Score %',
            'Q1 Actual','Q1 Status','Q2 Actual','Q2 Status',
            'Q3 Actual','Q3 Status','Q4 Actual','Q4 Status'
        ];
        const esc = v => (v === null || v === undefined) ? '' : `"${String(v).replace(/"/g,'""')}"`;
        const rows = data.map(r => [
            r.employee_name, r.email, r.department, r.manager_name, r.sheet_status,
            r.goal_title, r.thrust_area, r.uom_type, r.uom_direction, r.target, r.weightage,
            r.achievement, r.goal_status, r.score_pct,
            r.q1_actual ?? '', r.q1_status ?? '', r.q2_actual ?? '', r.q2_status ?? '',
            r.q3_actual ?? '', r.q3_status ?? '', r.q4_actual ?? '', r.q4_status ?? ''
        ].map(esc).join(','));

        const csv = BOM + [headers.join(','), ...rows].join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="AtomQuest_Goals_Report_${year}.csv"`);
        res.send(csv);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2F. GET /api/admin/audit-logs - fixed: user_name instead of changed_by_name
router.get('/audit-logs', async (req, res) => {
    try {
        const logs = await all(`
            SELECT al.id, al.action, al.field_changed, al.old_value, al.new_value, al.changed_at,
                u.name as user_name, u.email as changed_by_email, u.role as changed_by_role,
                COALESCE(g.title, 'N/A') as goal_title
            FROM audit_logs al
            JOIN users u ON al.changed_by = u.id
            LEFT JOIN goals g ON al.goal_id = g.id
            ORDER BY al.changed_at DESC LIMIT 500`);
        res.json({ logs, total: logs.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/performance-report - full performance data for all employees
router.get('/performance-report', async (req, res) => {
    try {
        const year = req.query.year || new Date().getFullYear();
        const employees = await all(`SELECT u.id, u.name, u.email, u.department, m.name as manager_name
            FROM users u LEFT JOIN users m ON u.manager_id=m.id WHERE u.role='employee'`);
        const report = await Promise.all(employees.map(async emp => {
            const sheet = await get('SELECT * FROM goal_sheets WHERE employee_id=? AND cycle_year=?', [emp.id, year]);
            if (!sheet) return { ...emp, sheet: null, goals: [], overall_score: 0 };
            const goals = await all('SELECT * FROM goals WHERE sheet_id=?', [sheet.id]);
            const goalsWithData = await Promise.all(goals.map(async g => {
                const checkins = await all('SELECT * FROM checkins WHERE goal_id=? ORDER BY quarter', [g.id]);
                let score = 0;
                if (g.uom_type === 'zero') score = g.achievement === 0 ? 100 : 0;
                else if (g.uom_type === 'timeline') score = Math.min(Math.round(g.achievement), 100);
                else if (g.target > 0) score = g.uom_direction === 'max' ? Math.round((g.achievement/g.target)*100) : Math.round((g.target/Math.max(g.achievement,0.01))*100);
                return { ...g, checkins, score };
            }));
            const totalWeightage = goals.reduce((s,g) => s+g.weightage, 0);
            const overallScore = totalWeightage > 0
                ? Math.round(goalsWithData.reduce((s,g) => s + (g.score * g.weightage), 0) / totalWeightage)
                : 0;
            return { ...emp, sheet, goals: goalsWithData, overall_score: overallScore };
        }));
        res.json({ report, year });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/trigger-escalations - manually run the escalation cron check
router.post('/trigger-escalations', async (req, res) => {
    try {
        const { checkEscalations } = require('../cron/escalations');
        await checkEscalations();
        res.json({ success: true, message: 'Escalation check triggered successfully. Logs have been updated.' });
    } catch (err) {
        console.error('Manual trigger error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/users - list all users
router.get('/users', async (req, res) => {
    try {
        const users = await all(`SELECT u.id, u.name, u.email, u.role, u.department, m.name as manager_name FROM users u LEFT JOIN users m ON u.manager_id=m.id ORDER BY u.role, u.name`);
        res.json({ users });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/users/:id
router.get('/users/:id', async (req, res) => {
    try {
        const user = await get('SELECT id, name, email, role, department, manager_id FROM users WHERE id=?', [req.params.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ user });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/admin/users/:id - edit user profile
router.put('/users/:id', async (req, res) => {
    try {
        const { name, email, department, manager_id, role } = req.body;
        const user = await get('SELECT * FROM users WHERE id=?', [req.params.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        await run('UPDATE users SET name=COALESCE(?,name), email=COALESCE(?,email), department=COALESCE(?,department), manager_id=COALESCE(?,manager_id), role=COALESCE(?,role) WHERE id=?',
            [name||null, email||null, department||null, manager_id||null, role||null, req.params.id]);
        await run('INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)',
            [req.session.user.id, null, 'user_profile_edit', 'profile', JSON.stringify({name:user.name,email:user.email}), JSON.stringify({name,email})]);
        res.json({ success: true, message: 'User profile updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2E. GET /api/admin/cycle-config
router.get('/cycle-config', async (req, res) => {
    try {
        const year = new Date().getFullYear();
        const config = await get('SELECT * FROM cycle_config WHERE cycle_year = ?', [year]);
        res.json({ config });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2E. PUT /api/admin/cycle-config
router.put('/cycle-config', async (req, res) => {
    try {
        const { cycle_year, goal_setting_open, goal_setting_close, q1_open, q2_open, q3_open, q4_open, q4_close } = req.body;
        const year = cycle_year || new Date().getFullYear();
        await run(`INSERT INTO cycle_config (cycle_year, goal_setting_open, goal_setting_close, q1_open, q2_open, q3_open, q4_open, q4_close)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(cycle_year) DO UPDATE SET
            goal_setting_open=excluded.goal_setting_open, goal_setting_close=excluded.goal_setting_close,
            q1_open=excluded.q1_open, q2_open=excluded.q2_open, q3_open=excluded.q3_open,
            q4_open=excluded.q4_open, q4_close=excluded.q4_close`,
            [year, goal_setting_open, goal_setting_close, q1_open, q2_open, q3_open, q4_open, q4_close]);
        await run('INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)',
            [req.session.user.id, null, 'cycle_config_update', 'cycle_config', null, JSON.stringify(req.body)]);
        res.json({ success: true, message: 'Cycle configuration updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2G. GET /api/admin/employee/:id/details
router.get('/employee/:id/details', async (req, res) => {
    try {
        const year = new Date().getFullYear();
        const user = await get('SELECT u.id, u.name, u.email, u.department, m.name as manager_name FROM users u LEFT JOIN users m ON u.manager_id=m.id WHERE u.id=?', [req.params.id]);
        if (!user) return res.status(404).json({ error: 'Employee not found' });
        const sheet = await get('SELECT * FROM goal_sheets WHERE employee_id=? AND cycle_year=?', [req.params.id, year]);
        let goals = [];
        let checkins = [];
        if (sheet) {
            goals = await all('SELECT * FROM goals WHERE sheet_id=?', [sheet.id]);
            const goalIds = goals.map(g => g.id);
            if (goalIds.length > 0) {
                checkins = await all(`SELECT * FROM checkins WHERE goal_id IN (${goalIds.map(()=>'?').join(',')}) ORDER BY quarter`, goalIds);
            }
            // Attach checkins to goals
            goals = goals.map(g => ({
                ...g,
                checkins: checkins.filter(c => c.goal_id === g.id)
            }));
        }
        res.json({ employee: user, sheet, goals, checkins });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/escalation-rules - retrieve all escalation rules
router.get('/escalation-rules', async (req, res) => {
    try {
        const rules = await all('SELECT * FROM escalation_rules');
        res.json({ rules });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/admin/escalation-rules - edit escalation rules thresholds
router.put('/escalation-rules', async (req, res) => {
    try {
        const { rules } = req.body;
        if (!rules || !Array.isArray(rules)) return res.status(400).json({ error: 'Rules array is required' });
        for (const rule of rules) {
            await run('UPDATE escalation_rules SET days_threshold = ? WHERE id = ?', [rule.days_threshold, rule.id]);
        }
        await run('INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)',
            [req.session.user.id, null, 'escalation_rules_update', 'escalation_rules', null, JSON.stringify(rules)]);
        res.json({ success: true, message: 'Escalation rules updated successfully.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/escalation-logs - retrieve all history of escalations
router.get('/escalation-logs', async (req, res) => {
    try {
        const logs = await all(`
            SELECT el.*, er.rule_type, er.days_threshold, u.name as notified_name, u.email as notified_email, u.role as notified_role,
                   gs.employee_id, emp.name as emp_name, emp.department as emp_dept
            FROM escalation_logs el
            JOIN escalation_rules er ON el.rule_id = er.id
            JOIN users u ON el.notified_user_id = u.id
            LEFT JOIN goal_sheets gs ON el.sheet_id = gs.id
            LEFT JOIN users emp ON gs.employee_id = emp.id
            ORDER BY el.escalated_at DESC
        `);
        res.json({ logs });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/escalations/trigger - manually trigger rule checks and generate mock alerts
router.post('/escalations/trigger', async (req, res) => {
    try {
        const { checkEscalations } = require('../cron/escalations');
        await checkEscalations();
        res.json({ success: true, message: 'Escalation rules check ran successfully and logs generated.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/notification-logs - view simulated emails/Teams logs
router.get('/notification-logs', async (req, res) => {
    try {
        const logs = await all('SELECT * FROM notification_logs ORDER BY created_at DESC');
        res.json({ logs });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/notification-logs/clear - clear logs
router.post('/notification-logs/clear', async (req, res) => {
    try {
        await run('DELETE FROM notification_logs');
        res.json({ success: true, message: 'Notification simulation logs cleared.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
