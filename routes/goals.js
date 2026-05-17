const express = require('express');
const router = express.Router();
const { run, get, all } = require('../database');
const { sendEmail, sendTeamsNotification } = require('../utils/notifier');

// 2A. Fixed computeScore for Timeline UoM
const computeScore = (goal, achievement) => {
    if (goal.uom_type === 'zero') return achievement === 0 ? 100 : 0;
    if (goal.target === 0) return 0;
    if (goal.uom_type === 'timeline') {
        // achievement is % of deadline met (0-100). 100 = on time or early.
        return Math.min(Math.round(achievement), 100);
    }
    if (goal.uom_direction === 'max') return Math.round((achievement / goal.target) * 100);
    return Math.round((goal.target / Math.max(achievement, 0.01)) * 100);
};

const validateWeightage = async (sheetId, excludeGoalId = null, newWeightage = 0) => {
    let goals = await all('SELECT * FROM goals WHERE sheet_id = ?', [sheetId]);
    if (excludeGoalId) goals = goals.filter(g => g.id !== excludeGoalId);
    const total = goals.reduce((sum, g) => sum + g.weightage, 0) + newWeightage;
    return { total, count: goals.length };
};

// 2D. GET /api/goals/window-status - must be before /:id routes
router.get('/window-status', async (req, res) => {
    try {
        const year = new Date().getFullYear();
        const now = new Date();
        const config = await get('SELECT * FROM cycle_config WHERE cycle_year = ?', [year]);
        if (!config) return res.json({ goalSettingOpen: true, openQuarters: ['Q1','Q2','Q3','Q4'], config: null });
        const openQuarters = [];
        if (now >= new Date(config.q1_open)) openQuarters.push('Q1');
        if (now >= new Date(config.q2_open)) openQuarters.push('Q2');
        if (now >= new Date(config.q3_open)) openQuarters.push('Q3');
        if (now >= new Date(config.q4_open) && now <= new Date(config.q4_close)) openQuarters.push('Q4');
        const goalSettingOpen = now >= new Date(config.goal_setting_open) && now <= new Date(config.goal_setting_close);
        res.json({ goalSettingOpen, openQuarters, config });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/mine', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const year = new Date().getFullYear();
        let sheet = await get('SELECT * FROM goal_sheets WHERE employee_id = ? AND cycle_year = ?', [userId, year]);
        if (!sheet) {
            const r = await run('INSERT INTO goal_sheets (employee_id, cycle_year, status, is_locked) VALUES (?,?,?,?)', [userId, year, 'draft', 0]);
            sheet = await get('SELECT * FROM goal_sheets WHERE id = ?', [r.lastID]);
        }
        const goals = await all('SELECT * FROM goals WHERE sheet_id = ?', [sheet.id]);
        const goalsWithScore = goals.map(g => ({ ...g, score: computeScore(g, g.achievement) }));
        res.json({ sheet, goals: goalsWithScore });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2B. POST / - Add description
router.post('/', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { title, description, thrust_area, uom_type, uom_direction, target, weightage } = req.body;
        const year = new Date().getFullYear();
        let sheet = await get('SELECT * FROM goal_sheets WHERE employee_id = ? AND cycle_year = ?', [userId, year]);
        if (!sheet) {
            const r = await run('INSERT INTO goal_sheets (employee_id, cycle_year) VALUES (?,?)', [userId, year]);
            sheet = await get('SELECT * FROM goal_sheets WHERE id = ?', [r.lastID]);
        }
        if (sheet.is_locked || sheet.status === 'pending' || sheet.status === 'approved')
            return res.status(403).json({ error: 'Goal sheet is locked. Cannot add goals.' });
        if (!title || !thrust_area || !uom_type || !uom_direction || !target || !weightage)
            return res.status(400).json({ error: 'All fields are required' });
        const normUomType = String(uom_type).toLowerCase().replace('percentage', 'percent').replace('numeric', 'numeric');
        if (!['numeric','percent','timeline','zero'].includes(normUomType))
            return res.status(400).json({ error: `Invalid UoM type: ${uom_type}` });
        const { count, total } = await validateWeightage(sheet.id, null, Number(weightage));
        if (count >= 8) return res.status(400).json({ error: 'Maximum 8 goals allowed' });
        if (Number(weightage) < 10) return res.status(400).json({ error: 'Each goal must have at least 10% weightage' });
        if (total > 100) return res.status(400).json({ error: `Total weightage would be ${total}%. Cannot exceed 100%` });
        const result = await run('INSERT INTO goals (sheet_id, title, description, thrust_area, uom_type, uom_direction, target, weightage) VALUES (?,?,?,?,?,?,?,?)',
            [sheet.id, title, description || '', thrust_area, normUomType, uom_direction, Number(target), Number(weightage)]);
        const newGoal = await get('SELECT * FROM goals WHERE id = ?', [result.lastID]);
        res.status(201).json({ success: true, goal: newGoal });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2B. PUT /:id - Add description
router.put('/:id', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const goalId = Number(req.params.id);
        const goal = await get('SELECT g.*, gs.is_locked, gs.status, gs.employee_id FROM goals g JOIN goal_sheets gs ON g.sheet_id = gs.id WHERE g.id = ?', [goalId]);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });
        if (goal.employee_id !== userId) return res.status(403).json({ error: 'Not your goal' });
        if (goal.is_locked) {
            await run('INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)',
                [userId, goalId, 'edit_blocked', 'all', null, JSON.stringify(req.body)]);
            return res.status(403).json({ error: 'Goal is locked. Contact Admin to unlock.' });
        }
        const { title, description, thrust_area, uom_type, uom_direction, target, weightage, achievement, goal_status } = req.body;
        const updated = {
            title: title || goal.title,
            description: description !== undefined ? description : (goal.description || ''),
            thrust_area: thrust_area || goal.thrust_area,
            uom_type: uom_type ? uom_type.toLowerCase() : goal.uom_type,
            uom_direction: uom_direction || goal.uom_direction,
            target: target !== undefined ? Number(target) : goal.target,
            weightage: weightage !== undefined ? Number(weightage) : goal.weightage,
            achievement: achievement !== undefined ? Number(achievement) : goal.achievement,
            goal_status: goal_status || goal.goal_status,
        };
        if (updated.weightage < 10) return res.status(400).json({ error: 'Weightage must be at least 10%' });
        const { total } = await validateWeightage(goal.sheet_id, goalId, updated.weightage);
        if (total > 100) return res.status(400).json({ error: `Total weightage would be ${total}%. Cannot exceed 100%` });
        await run('UPDATE goals SET title=?, description=?, thrust_area=?, uom_type=?, uom_direction=?, target=?, weightage=?, achievement=?, goal_status=? WHERE id=?',
            [updated.title, updated.description, updated.thrust_area, updated.uom_type, updated.uom_direction, updated.target, updated.weightage, updated.achievement, updated.goal_status, goalId]);
        res.json({ success: true, goal: await get('SELECT * FROM goals WHERE id = ?', [goalId]) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const goalId = Number(req.params.id);
        const goal = await get('SELECT g.*, gs.is_locked, gs.employee_id FROM goals g JOIN goal_sheets gs ON g.sheet_id = gs.id WHERE g.id = ?', [goalId]);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });
        if (goal.employee_id !== userId) return res.status(403).json({ error: 'Not your goal' });
        if (goal.is_locked) return res.status(403).json({ error: 'Cannot delete a locked goal' });
        await run('DELETE FROM goals WHERE id = ?', [goalId]);
        res.json({ success: true, message: 'Goal deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/submit', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const year = new Date().getFullYear();
        const sheet = await get('SELECT * FROM goal_sheets WHERE employee_id = ? AND cycle_year = ?', [userId, year]);
        if (!sheet) return res.status(404).json({ error: 'No goal sheet found' });
        if (sheet.status === 'pending') return res.status(400).json({ error: 'Already submitted and awaiting approval' });
        if (sheet.status === 'approved') return res.status(400).json({ error: 'Already approved' });
        const goals = await all('SELECT * FROM goals WHERE sheet_id = ?', [sheet.id]);
        if (goals.length === 0) return res.status(400).json({ error: 'Add at least one goal before submitting' });
        if (goals.length > 8) return res.status(400).json({ error: 'Cannot have more than 8 goals' });
        const underMin = goals.find(g => g.weightage < 10);
        if (underMin) return res.status(400).json({ error: `Goal "${underMin.title}" has weightage below 10%` });
        const total = goals.reduce((sum, g) => sum + g.weightage, 0);
        if (total !== 100) return res.status(400).json({ error: `Total weightage is ${total}%. Must be exactly 100% before submitting.` });
        await run("UPDATE goal_sheets SET status = 'pending' WHERE id = ?", [sheet.id]);
        
        // Trigger notification to manager
        const user = await get('SELECT name, manager_id FROM users WHERE id = ?', [userId]);
        if (user && user.manager_id) {
            const manager = await get('SELECT name, email FROM users WHERE id = ?', [user.manager_id]);
            if (manager) {
                const subject = `Goal Sheet Submitted: ${user.name}`;
                const text = `${user.name} has submitted their goal sheet for your review.`;
                const actionUrl = 'http://localhost:3000/manager.html';
                sendEmail(manager.email, subject, `<p>${text}</p><a href="${actionUrl}">Review Goal Sheet</a>`);
                sendTeamsNotification(process.env.TEAMS_WEBHOOK_URL, subject, text, actionUrl);
            }
        }
        
        res.json({ success: true, message: 'Goal sheet submitted for manager approval' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2C. POST /checkin - with quarter window enforcement
router.post('/checkin', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { goal_id, quarter, achievement, status } = req.body;
        if (!goal_id || !quarter || achievement === undefined || !status)
            return res.status(400).json({ error: 'goal_id, quarter, achievement and status are required' });
        const goal = await get('SELECT g.*, gs.employee_id, gs.status as sheet_status FROM goals g JOIN goal_sheets gs ON g.sheet_id = gs.id WHERE g.id = ?', [goal_id]);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });
        if (goal.employee_id !== userId) return res.status(403).json({ error: 'Not your goal' });
        if (goal.sheet_status !== 'approved') return res.status(400).json({ error: 'Goal sheet must be approved before check-ins' });

        // Check if the requested quarter is currently open
        const now = new Date();
        const config = await get('SELECT * FROM cycle_config WHERE cycle_year = ?', [new Date().getFullYear()]);
        if (config) {
            const windows = {
                'Q1': config.q1_open,
                'Q2': config.q2_open,
                'Q3': config.q3_open,
                'Q4': config.q4_open
            };
            const windowOpen = new Date(windows[quarter]);
            if (now < windowOpen) {
                return res.status(400).json({ error: `${quarter} check-in window does not open until ${windowOpen.toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'})}` });
            }
        }

        const existing = await get('SELECT * FROM checkins WHERE goal_id = ? AND quarter = ?', [goal_id, quarter]);
        if (existing) {
            await run('UPDATE checkins SET achievement=?, status=?, submitted_at=CURRENT_TIMESTAMP WHERE id=?', [Number(achievement), status, existing.id]);
        } else {
            await run('INSERT INTO checkins (goal_id, quarter, achievement, status) VALUES (?,?,?,?)', [goal_id, quarter, Number(achievement), status]);
        }
        await run('UPDATE goals SET achievement=?, goal_status=? WHERE id=?', [Number(achievement), status, goal_id]);
        res.json({ success: true, message: `${quarter} check-in saved` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/score/:goalId', async (req, res) => {
    try {
        const goal = await get('SELECT * FROM goals WHERE id = ?', [req.params.goalId]);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });
        const checkins = await all('SELECT * FROM checkins WHERE goal_id = ? ORDER BY quarter', [goal.id]);
        res.json({ goal, score: computeScore(goal, goal.achievement), checkins });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2B. PUT /:id/edit - add description
router.put('/:id/edit', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const goalId = Number(req.params.id);
        const { title, description, thrust_area, uom_type, uom_direction, target, weightage } = req.body;

        const goal = await get(
            'SELECT g.*, gs.is_locked, gs.status, gs.employee_id FROM goals g JOIN goal_sheets gs ON g.sheet_id = gs.id WHERE g.id = ?',
            [goalId]
        );
        if (!goal) return res.status(404).json({ error: 'Goal not found' });
        if (goal.employee_id !== userId) return res.status(403).json({ error: 'Not your goal' });
        if (goal.is_locked) return res.status(403).json({ error: 'Goal is locked after approval. Contact Admin to unlock.' });

        const normUomType = uom_type ? String(uom_type).toLowerCase().replace('percentage','percent') : goal.uom_type;
        const newWeightage = weightage !== undefined ? Number(weightage) : goal.weightage;

        if (newWeightage < 10) return res.status(400).json({ error: 'Weightage must be at least 10%' });
        const { total } = await validateWeightage(goal.sheet_id, goalId, newWeightage);
        if (total > 100) return res.status(400).json({ error: `Total weightage would be ${total}%. Cannot exceed 100%` });

        await run(
            'UPDATE goals SET title=?, description=?, thrust_area=?, uom_type=?, uom_direction=?, target=?, weightage=? WHERE id=?',
            [title || goal.title, description !== undefined ? description : (goal.description || ''),
             thrust_area || goal.thrust_area, normUomType, uom_direction || goal.uom_direction,
             target !== undefined ? Number(target) : goal.target, newWeightage, goalId]
        );

        const updated = await get('SELECT * FROM goals WHERE id = ?', [goalId]);
        res.json({ success: true, goal: updated });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/goals/checkins/mine - all checkins for logged-in employee
router.get('/checkins/mine', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const year = new Date().getFullYear();
        const sheet = await get('SELECT * FROM goal_sheets WHERE employee_id = ? AND cycle_year = ?', [userId, year]);
        if (!sheet) return res.json({ checkins: [] });
        const goals = await all('SELECT * FROM goals WHERE sheet_id = ?', [sheet.id]);
        const result = await Promise.all(goals.map(async g => {
            const checkins = await all('SELECT * FROM checkins WHERE goal_id = ? ORDER BY quarter', [g.id]);
            return { ...g, checkins };
        }));
        res.json({ goals: result });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
