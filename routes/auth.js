const express = require('express');
const router = express.Router();
const { get, run } = require('../database');

router.post('/login', async (req, res) => {
    try {
        const { email, password, role } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        const user = await get(
            'SELECT id, name, email, role, manager_id, department FROM users WHERE LOWER(email) = ? AND password = ?',
            [email.trim().toLowerCase(), password]
        );
        if (!user) return res.status(401).json({ error: 'Invalid email or password' });
        // Role check: if frontend sends a role, validate it matches
        if (role && role !== user.role) {
            return res.status(401).json({ error: `Incorrect role selected. This account is registered as "${user.role}".` });
        }
        req.session.user = user;
        const redirect = user.role === 'admin' ? '/admin.html' : user.role === 'manager' ? '/manager.html' : '/employee.html';
        return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department }, redirect });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: 'Logout failed' });
        res.clearCookie('connect.sid');
        res.json({ success: true, redirect: '/login.html' });
    });
});

router.get('/me', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ user: req.session.user });
});

router.get('/profile', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    const user = await get('SELECT id, name, email, role, department, manager_id FROM users WHERE id=?', [req.session.user.id]);
    const manager = user.manager_id ? await get('SELECT name, email FROM users WHERE id=?', [user.manager_id]) : null;
    res.json({ user, manager });
});

router.put('/profile', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    const { name, department } = req.body;
    // Employees can only update name and department
    await run('UPDATE users SET name=COALESCE(?,name), department=COALESCE(?,department) WHERE id=?',
        [name||null, department||null, req.session.user.id]);
    // Update session
    if (name) req.session.user.name = name;
    res.json({ success: true, message: 'Profile updated' });
});

module.exports = router;
