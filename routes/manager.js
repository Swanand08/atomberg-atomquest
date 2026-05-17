const express = require('express');
const router = express.Router();
const { run, get, all } = require('../database');
const { sendEmail, sendTeamsNotification } = require('../utils/notifier');

// GET /api/manager/team - full team with goals and check-in status
router.get('/team', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const year = new Date().getFullYear();
        const employees = await all(
            'SELECT id, name, email, department FROM users WHERE manager_id=? AND role=?',
            [managerId, 'employee']
        );
        const result = await Promise.all(employees.map(async emp => {
            const sheet = await get('SELECT * FROM goal_sheets WHERE employee_id=? AND cycle_year=?', [emp.id, year]);
            let goals = [];
            let checkinSummary = { Q1: false, Q2: false, Q3: false, Q4: false };
            if (sheet) {
                goals = await all('SELECT * FROM goals WHERE sheet_id=?', [sheet.id]);
                if (goals.length > 0) {
                    const goalIds = goals.map(g => g.id);
                    for (const q of ['Q1','Q2','Q3','Q4']) {
                        const c = await get(`SELECT id FROM checkins WHERE goal_id IN (${goalIds.map(()=>'?').join(',')}) AND quarter=? LIMIT 1`, [...goalIds, q]);
                        checkinSummary[q] = !!c;
                    }
                }
            }
            const completedGoals = goals.filter(g => g.goal_status === 'completed').length;
            const overallPct = goals.length > 0 && goals.reduce((s,g)=>s+g.target,0) > 0
                ? Math.round((goals.reduce((s,g)=>s+g.achievement,0) / goals.reduce((s,g)=>s+g.target,0)) * 100)
                : 0;
            return { ...emp, sheet: sheet || null, sheet_status: sheet ? sheet.status : 'not_started', goals, checkins: checkinSummary, completed_goals: completedGoals, completion_percentage: overallPct, overall_pct: overallPct };
        }));
        res.json({ team: result, count: result.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2J. GET /api/manager/team/goals - returns all team member goal sheets + goals + checkins
router.get('/team/goals', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const year = new Date().getFullYear();
        const employees = await all('SELECT id, name, email, department FROM users WHERE manager_id=? AND role=?', [managerId, 'employee']);
        const result = await Promise.all(employees.map(async emp => {
            const sheet = await get('SELECT * FROM goal_sheets WHERE employee_id=? AND cycle_year=?', [emp.id, year]);
            let goalsWithCheckins = [];
            if (sheet) {
                const goals = await all('SELECT * FROM goals WHERE sheet_id=?', [sheet.id]);
                goalsWithCheckins = await Promise.all(goals.map(async g => {
                    const checkins = await all('SELECT * FROM checkins WHERE goal_id=? ORDER BY quarter', [g.id]);
                    return { ...g, checkins };
                }));
            }
            return { ...emp, sheet: sheet || null, sheet_status: sheet ? sheet.status : 'not_started', goals: goalsWithCheckins };
        }));
        res.json({ team: result });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/manager/activity - recent activity feed for manager's team
router.get('/activity', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const employees = await all('SELECT id FROM users WHERE manager_id=? AND role=?', [managerId, 'employee']);
        if (employees.length === 0) return res.json({ activities: [] });
        const empIds = employees.map(e => e.id);

        // Recent check-ins
        const checkins = await all(`
            SELECT c.submitted_at as time, u.name as user_name, g.title as goal_title,
                'checkin' as type, c.quarter, c.achievement, c.status
            FROM checkins c
            JOIN goals g ON c.goal_id=g.id
            JOIN goal_sheets gs ON g.sheet_id=gs.id
            JOIN users u ON gs.employee_id=u.id
            WHERE gs.employee_id IN (${empIds.map(()=>'?').join(',')})
            ORDER BY c.submitted_at DESC LIMIT 10`, empIds);

        // Recent sheet submissions
        const submissions = await all(`
            SELECT gs.approved_at as time, u.name as user_name,
                'submission' as type, gs.status
            FROM goal_sheets gs
            JOIN users u ON gs.employee_id=u.id
            WHERE gs.employee_id IN (${empIds.map(()=>'?').join(',')}) AND gs.status != 'draft'
            ORDER BY gs.approved_at DESC LIMIT 10`, empIds);

        const activities = [...checkins, ...submissions]
            .sort((a,b) => new Date(b.time) - new Date(a.time))
            .slice(0, 15);
        res.json({ activities });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/manager/performance-report - planned vs actual for whole team
router.get('/performance-report', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const year = new Date().getFullYear();
        const employees = await all('SELECT id, name, email, department FROM users WHERE manager_id=? AND role=?', [managerId, 'employee']);
        const report = await Promise.all(employees.map(async emp => {
            const sheet = await get('SELECT * FROM goal_sheets WHERE employee_id=? AND cycle_year=?', [emp.id, year]);
            if (!sheet) return { ...emp, sheet: null, goals: [], overall_score: 0 };
            const goals = await all('SELECT * FROM goals WHERE sheet_id=?', [sheet.id]);
            const goalsWithCheckins = await Promise.all(goals.map(async g => {
                const checkins = await all('SELECT * FROM checkins WHERE goal_id=? ORDER BY quarter', [g.id]);
                let score = 0;
                if (g.uom_type === 'zero') score = g.achievement === 0 ? 100 : 0;
                else if (g.target > 0) score = g.uom_direction === 'max'
                    ? Math.round((g.achievement/g.target)*100)
                    : Math.round((g.target/Math.max(g.achievement,0.01))*100);
                return { ...g, checkins, score: Math.min(score, 150) };
            }));
            const totalWeightage = goals.reduce((s,g)=>s+g.weightage,0);
            const overallScore = totalWeightage > 0
                ? Math.round(goalsWithCheckins.reduce((s,g)=>s+(g.score*g.weightage),0)/totalWeightage)
                : 0;
            return { ...emp, sheet, goals: goalsWithCheckins, overall_score: overallScore };
        }));
        res.json({ report, year, manager_id: managerId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/manager/checkins - planned vs actual checkins view
router.get('/checkins', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const year = new Date().getFullYear();
        const employees = await all('SELECT id, name, email, department FROM users WHERE manager_id=? AND role=?', [managerId, 'employee']);
        const result = await Promise.all(employees.map(async emp => {
            const sheet = await get('SELECT * FROM goal_sheets WHERE employee_id=? AND cycle_year=?', [emp.id, year]);
            if (!sheet) return { ...emp, sheet: null, goals: [], checkins: { Q1: false, Q2: false, Q3: false, Q4: false }, completed_goals: 0, completion_percentage: 0, overall_pct: 0 };
            const goals = await all('SELECT * FROM goals WHERE sheet_id=?', [sheet.id]);
            let checkinSummary = { Q1: false, Q2: false, Q3: false, Q4: false };
            const goalsWithCheckins = await Promise.all(goals.map(async g => {
                const checkins = await all('SELECT * FROM checkins WHERE goal_id=? ORDER BY quarter', [g.id]);
                return { ...g, checkins };
            }));
            if (goals.length > 0) {
                const goalIds = goals.map(g => g.id);
                for (const q of ['Q1','Q2','Q3','Q4']) {
                    const c = await get(`SELECT id FROM checkins WHERE goal_id IN (${goalIds.map(()=>'?').join(',')}) AND quarter=? LIMIT 1`, [...goalIds, q]);
                    checkinSummary[q] = !!c;
                }
            }
            const completedGoals = goals.filter(g => g.goal_status === 'completed').length;
            const overallPct = goals.length > 0 && goals.reduce((s,g)=>s+g.target,0) > 0
                ? Math.round((goals.reduce((s,g)=>s+g.achievement,0) / goals.reduce((s,g)=>s+g.target,0)) * 100)
                : 0;
            return { ...emp, sheet: sheet || null, sheet_status: sheet ? sheet.status : 'not_started', goals: goalsWithCheckins, checkins: checkinSummary, completed_goals: completedGoals, completion_percentage: overallPct, overall_pct: overallPct };
        }));
        res.json({ team: result });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/manager/employee/:id/unlock
router.post('/employee/:id/unlock', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const empId = Number(req.params.id);
        const year = new Date().getFullYear();
        const emp = await get('SELECT id FROM users WHERE id=? AND manager_id=?', [empId, managerId]);
        if (!emp) return res.status(403).json({ error: 'Unauthorized or employee not found' });
        const sheet = await get('SELECT * FROM goal_sheets WHERE employee_id = ? AND cycle_year = ?', [empId, year]);
        if (!sheet) return res.status(404).json({ error: 'Sheet not found for this employee' });
        await run("UPDATE goal_sheets SET is_locked=0, status='draft' WHERE id=?", [sheet.id]);
        await run('INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)',
            [managerId, null, 'manager_unlock', 'is_locked', '1', `0 — Reason: Manager unlock (Employee ${empId})`]);
        res.json({ success: true, message: 'Sheet unlocked. Employee can now edit goals.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// POST /api/manager/approve/:sheetId
router.post('/approve/:sheetId', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const sheetId = Number(req.params.sheetId);
        const sheet = await get('SELECT gs.*, u.manager_id FROM goal_sheets gs JOIN users u ON gs.employee_id=u.id WHERE gs.id=?', [sheetId]);
        if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
        if (sheet.manager_id !== managerId) return res.status(403).json({ error: 'This employee does not report to you' });
        if (sheet.status !== 'pending') return res.status(400).json({ error: `Sheet is "${sheet.status}". Only pending sheets can be approved.` });
        await run("UPDATE goal_sheets SET status='approved', is_locked=1, approved_by=?, approved_at=? WHERE id=?", [managerId, new Date().toISOString(), sheetId]);
        await run('INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)',
            [managerId, null, 'sheet_approved', 'status', 'pending', 'approved']);
            
        // Trigger notification to employee
        const emp = await get('SELECT name, email FROM users WHERE id=?', [sheet.employee_id]);
        if (emp) {
            const subject = `Goal Sheet Approved`;
            const text = `Your goal sheet has been approved by your manager.`;
            const actionUrl = `${process.env.APP_URL || 'http://localhost:3000'}/employee.html`;
            sendEmail(emp.email, subject, `<p>${text}</p><a href="${actionUrl}">View Goal Sheet</a>`);
            sendTeamsNotification(process.env.TEAMS_WEBHOOK_URL, subject, text, actionUrl);
        }
        
        res.json({ success: true, message: 'Goal sheet approved and locked' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/manager/reject/:sheetId
router.post('/reject/:sheetId', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const sheetId = Number(req.params.sheetId);
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ error: 'Please provide a rejection reason' });
        const sheet = await get('SELECT gs.*, u.manager_id FROM goal_sheets gs JOIN users u ON gs.employee_id=u.id WHERE gs.id=?', [sheetId]);
        if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
        if (sheet.manager_id !== managerId) return res.status(403).json({ error: 'This employee does not report to you' });
        if (sheet.status !== 'pending') return res.status(400).json({ error: 'Only pending sheets can be rejected' });
        await run("UPDATE goal_sheets SET status='rejected', reject_reason=? WHERE id=?", [reason, sheetId]);
        await run('INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)',
            [managerId, null, 'sheet_rejected', 'status', 'pending', `rejected - ${reason}`]);
            
        // Trigger notification to employee
        const emp = await get('SELECT name, email FROM users WHERE id=?', [sheet.employee_id]);
        if (emp) {
            const subject = `Goal Sheet Returned for Rework`;
            const text = `Your goal sheet has been returned by your manager. Reason: ${reason}`;
            const actionUrl = `${process.env.APP_URL || 'http://localhost:3000'}/employee.html`;
            sendEmail(emp.email, subject, `<p>${text}</p><a href="${actionUrl}">View Goal Sheet</a>`);
            sendTeamsNotification(process.env.TEAMS_WEBHOOK_URL, subject, text, actionUrl);
        }
        
        res.json({ success: true, message: 'Sheet returned to employee for rework' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2J. POST /api/manager/team/goals/:id/approve
router.post('/team/goals/:id/approve', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const sheetId = Number(req.params.id);
        const sheet = await get('SELECT gs.*, u.manager_id FROM goal_sheets gs JOIN users u ON gs.employee_id=u.id WHERE gs.id=?', [sheetId]);
        if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
        if (sheet.manager_id !== managerId) return res.status(403).json({ error: 'This employee does not report to you' });
        if (sheet.status !== 'pending') return res.status(400).json({ error: `Sheet is "${sheet.status}". Only pending sheets can be approved.` });
        await run("UPDATE goal_sheets SET status='approved', is_locked=1, approved_by=?, approved_at=CURRENT_TIMESTAMP WHERE id=?", [managerId, sheetId]);
        await run('INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)',
            [managerId, null, 'sheet_approved', 'status', 'pending', 'approved']);
            
        const emp = await get('SELECT name, email FROM users WHERE id=?', [sheet.employee_id]);
        if (emp) {
            const subject = `Goal Sheet Approved`;
            const text = `Your goal sheet has been approved by your manager.`;
            const actionUrl = `${process.env.APP_URL || 'http://localhost:3000'}/employee.html`;
            sendEmail(emp.email, subject, `<p>${text}</p><a href="${actionUrl}">View Goal Sheet</a>`);
            sendTeamsNotification(process.env.TEAMS_WEBHOOK_URL, subject, text, actionUrl);
        }
        
        res.json({ success: true, message: 'Goal sheet approved and locked' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2J. POST /api/manager/team/goals/:id/reject
router.post('/team/goals/:id/reject', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const sheetId = Number(req.params.id);
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ error: 'Please provide a rejection reason' });
        const sheet = await get('SELECT gs.*, u.manager_id FROM goal_sheets gs JOIN users u ON gs.employee_id=u.id WHERE gs.id=?', [sheetId]);
        if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
        if (sheet.manager_id !== managerId) return res.status(403).json({ error: 'This employee does not report to you' });
        if (sheet.status !== 'pending') return res.status(400).json({ error: 'Only pending sheets can be rejected' });
        await run("UPDATE goal_sheets SET status='rejected', is_locked=0, reject_reason=? WHERE id=?", [reason, sheetId]);
        await run('INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)',
            [managerId, null, 'sheet_rejected', 'status', 'pending', `rejected - ${reason}`]);
            
        const emp = await get('SELECT name, email FROM users WHERE id=?', [sheet.employee_id]);
        if (emp) {
            const subject = `Goal Sheet Returned for Rework`;
            const text = `Your goal sheet has been returned by your manager. Reason: ${reason}`;
            const actionUrl = `${process.env.APP_URL || 'http://localhost:3000'}/employee.html`;
            sendEmail(emp.email, subject, `<p>${text}</p><a href="${actionUrl}">View Goal Sheet</a>`);
            sendTeamsNotification(process.env.TEAMS_WEBHOOK_URL, subject, text, actionUrl);
        }
        
        res.json({ success: true, message: 'Sheet returned to employee for rework' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/manager/inline-edit/:goalId
router.put('/inline-edit/:goalId', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const goalId = Number(req.params.goalId);
        const { target, weightage } = req.body;
        const goal = await get('SELECT g.*, gs.status, u.manager_id FROM goals g JOIN goal_sheets gs ON g.sheet_id=gs.id JOIN users u ON gs.employee_id=u.id WHERE g.id=?', [goalId]);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });
        if (goal.manager_id !== managerId) return res.status(403).json({ error: 'Not your team member' });
        if (goal.status !== 'pending') return res.status(400).json({ error: 'Can only inline-edit pending sheets' });
        if (target !== undefined && target != goal.target)
            await run('INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)',
                [managerId, goalId, 'manager_edit', 'target', String(goal.target), String(target)]);
        if (weightage !== undefined && weightage != goal.weightage)
            await run('INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)',
                [managerId, goalId, 'manager_edit', 'weightage', String(goal.weightage), String(weightage)]);
        await run('UPDATE goals SET target=COALESCE(?,target), weightage=COALESCE(?,weightage) WHERE id=?',
            [target !== undefined ? Number(target) : null, weightage !== undefined ? Number(weightage) : null, goalId]);
        res.json({ success: true, goal: await get('SELECT * FROM goals WHERE id=?', [goalId]) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/manager/checkin/:checkinId/comment
router.put('/checkin/:checkinId/comment', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const checkinId = Number(req.params.checkinId);
        const { comment } = req.body;
        if (!comment) return res.status(400).json({ error: 'Comment is required' });
        const checkin = await get(`SELECT c.*, u.manager_id FROM checkins c JOIN goals g ON c.goal_id=g.id JOIN goal_sheets gs ON g.sheet_id=gs.id JOIN users u ON gs.employee_id=u.id WHERE c.id=?`, [checkinId]);
        if (!checkin) return res.status(404).json({ error: 'Check-in not found' });
        if (checkin.manager_id !== managerId) return res.status(403).json({ error: 'Not your team member' });
        await run('UPDATE checkins SET manager_comment=? WHERE id=?', [comment, checkinId]);
        res.json({ success: true, message: 'Comment saved' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/manager/assign-goal (from earlier implementation)
router.post('/assign-goal', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const { employee_ids, title, thrust_area, uom_type, uom_direction, target, weightage } = req.body;
        if (!employee_ids || !Array.isArray(employee_ids) || employee_ids.length === 0)
            return res.status(400).json({ error: 'Provide at least one employee_id' });
        const year = new Date().getFullYear();
        const results = [];
        for (const empId of employee_ids) {
            // Verify emp belongs to manager
            const emp = await get('SELECT * FROM users WHERE id=? AND manager_id=?', [empId, managerId]);
            if (!emp) { results.push({ empId, status: 'skipped', reason: 'Not your team member' }); continue; }

            let sheet = await get('SELECT * FROM goal_sheets WHERE employee_id=? AND cycle_year=?', [empId, year]);
            if (!sheet) {
                const r = await run('INSERT INTO goal_sheets (employee_id, cycle_year) VALUES (?,?)', [empId, year]);
                sheet = await get('SELECT * FROM goal_sheets WHERE id=?', [r.lastID]);
            }
            if (sheet.is_locked) { results.push({ empId, status: 'skipped', reason: 'Sheet is locked' }); continue; }
            const count = await get('SELECT COUNT(*) as c FROM goals WHERE sheet_id=?', [sheet.id]);
            if (count.c >= 8) { results.push({ empId, status: 'skipped', reason: 'Max 8 goals reached' }); continue; }
            await run('INSERT INTO goals (sheet_id, title, thrust_area, uom_type, uom_direction, target, weightage, is_shared) VALUES (?,?,?,?,?,?,?,1)',
                [sheet.id, title, thrust_area, uom_type, uom_direction, Number(target), Number(weightage)]);
            results.push({ empId, status: 'added' });
        }
        res.json({ success: true, results });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2J. GET /api/manager/planned-vs-actual endpoint for the performance report
router.get('/planned-vs-actual', async (req, res) => {
    try {
        const managerId = req.session.user.id;
        const year = new Date().getFullYear();
        const employees = await all('SELECT id, name, email, department FROM users WHERE manager_id=? AND role=?', [managerId, 'employee']);
        const report = await Promise.all(employees.map(async emp => {
            const sheet = await get('SELECT * FROM goal_sheets WHERE employee_id=? AND cycle_year=?', [emp.id, year]);
            if (!sheet) return { ...emp, goals: [], overall_score: 0 };
            const goals = await all('SELECT * FROM goals WHERE sheet_id=?', [sheet.id]);
            const goalsWithCheckins = await Promise.all(goals.map(async g => {
                const checkins = await all('SELECT * FROM checkins WHERE goal_id=? ORDER BY quarter', [g.id]);
                let score = 0;
                if (g.uom_type === 'zero') score = g.achievement === 0 ? 100 : 0;
                else if (g.uom_type === 'timeline') score = Math.min(Math.round(g.achievement), 100);
                else if (g.target > 0) score = g.uom_direction === 'max'
                    ? Math.round((g.achievement/g.target)*100)
                    : Math.round((g.target/Math.max(g.achievement,0.01))*100);
                return { ...g, checkins, score: Math.min(score, 150) };
            }));
            const totalWeight = goals.reduce((s,g)=>s+g.weightage,0);
            const overallScore = totalWeight > 0 ? Math.round(goalsWithCheckins.reduce((s,g)=>s+(g.score*g.weightage),0)/totalWeight) : 0;
            return { ...emp, sheet, goals: goalsWithCheckins, overall_score: overallScore };
        }));
        res.json({ report });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

