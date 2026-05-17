const express = require('express');
const router = express.Router();
const { get, run } = require('../database');
const msal = require('@azure/msal-node');
const bcrypt = require('bcrypt');

const msalConfig = {
    auth: {
        clientId: process.env.AZURE_CLIENT_ID || 'dummy_client_id',
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || 'dummy_tenant_id'}`,
        clientSecret: process.env.AZURE_CLIENT_SECRET || 'dummy_client_secret',
    }
};
const msalCca = new msal.ConfidentialClientApplication(msalConfig);

router.get('/entra/login', (req, res) => {
    if (!process.env.AZURE_CLIENT_ID || process.env.AZURE_CLIENT_ID === 'your_azure_client_id' || process.env.AZURE_CLIENT_ID === 'dummy_client_id') {
        console.log('Mocking Entra ID SSO login...');
        return res.redirect('/sso-mock.html');
    }
    const authCodeUrlParameters = {
        scopes: ["user.read"],
        redirectUri: process.env.AZURE_REDIRECT_URI,
    };
    msalCca.getAuthCodeUrl(authCodeUrlParameters).then((response) => res.redirect(response)).catch(console.error);
});

router.get('/entra/callback', async (req, res) => {
    try {
        let email = '', name = '';
        const isMock = req.query.mock === 'true' || !process.env.AZURE_CLIENT_ID || process.env.AZURE_CLIENT_ID === 'your_azure_client_id' || process.env.AZURE_CLIENT_ID === 'dummy_client_id';
        
        if (isMock) {
            email = req.query.email || 'emp1@company.com';
            name = req.query.name || 'Employee One (SSO)';
        } else {
            const tokenRequest = { code: req.query.code, scopes: ["user.read"], redirectUri: process.env.AZURE_REDIRECT_URI };
            const response = await msalCca.acquireTokenByCode(tokenRequest);
            email = response.account.username;
            name = response.account.name;
        }

        let user = await get('SELECT id, name, email, role, manager_id, department FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
        
        // Simulating Graph Org Hierarchy & Group Mapping Sync
        if (req.query.sync === 'true' || isMock) {
            let role = 'employee';
            let dept = 'Engineering';
            let managerId = 2; // Default to Manager One (ID: 2)

            if (email.startsWith('manager1')) {
                role = 'manager';
                dept = 'Engineering';
                managerId = 1; // Admins (ID: 1)
            } else if (email.startsWith('manager2')) {
                role = 'manager';
                dept = 'Sales';
                managerId = 1;
            } else if (email.startsWith('admin')) {
                role = 'admin';
                dept = 'HR';
                managerId = null;
            } else if (email.startsWith('emp3') || email.startsWith('emp4')) {
                role = 'employee';
                dept = 'Sales';
                managerId = 3; // Manager Two (ID: 3)
            }

            if (!user) {
                await run("INSERT INTO users (name, email, password, role, manager_id, department) VALUES (?,?,?,?,?,?)", 
                    [name, email, bcrypt.hashSync('sso_user', 10), role, managerId, dept]);
                user = await get('SELECT id, name, email, role, manager_id, department FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
            } else {
                // Dynamic Directory Update: Ensure their database role and manager is perfectly synced with Azure AD group attributes
                await run("UPDATE users SET name = ?, role = ?, manager_id = ?, department = ? WHERE id = ?",
                    [name, role, managerId, dept, user.id]);
                user = await get('SELECT id, name, email, role, manager_id, department FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
            }
            
            // Insert directory sync trace in audit logs
            await run('INSERT INTO audit_logs (changed_by, goal_id, action, field_changed, old_value, new_value) VALUES (?,?,?,?,?,?)',
                [user.id, null, 'entra_directory_sync', 'sso_directory_sync', user.role, `Synced as ${role} under Manager ID ${managerId}`]);
        } else if (!user) {
            // Standard user creation fallback
            await run("INSERT INTO users (name, email, password, role, department) VALUES (?,?,?,?,?)", [name, email, bcrypt.hashSync('sso_user', 10), 'employee', 'General']);
            user = await get('SELECT id, name, email, role, manager_id, department FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
        }
        
        req.session.user = user;
        req.session.save((err) => {
            if (err) console.error('Session save error:', err);
            const redirect = user.role === 'admin' ? '/admin.html' : user.role === 'manager' ? '/manager.html' : '/employee.html';
            res.redirect(redirect);
        });
    } catch (error) {
        console.error('SSO error:', error);
        res.status(500).send('SSO Authentication Failed');
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password, role } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        const user = await get('SELECT * FROM users WHERE LOWER(email) = ?', [email.trim().toLowerCase()]);
        if (!user) return res.status(401).json({ error: 'Invalid email or password' });
        let isValid = false;
        if (user.password.startsWith('$2b$') || user.password.startsWith('$2a$')) {
            isValid = bcrypt.compareSync(password, user.password);
        } else {
            isValid = (password === user.password);
        }
        if (!isValid) return res.status(401).json({ error: 'Invalid email or password' });
        // Role check: if frontend sends a role, validate it matches
        if (role && role !== user.role) {
            return res.status(401).json({ error: `Incorrect role selected. This account is registered as "${user.role}".` });
        }
        req.session.user = user;
        req.session.save((err) => {
            if (err) console.error('Session save error:', err);
            const redirect = user.role === 'admin' ? '/admin.html' : user.role === 'manager' ? '/manager.html' : '/employee.html';
            return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department }, redirect });
        });
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
