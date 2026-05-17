require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const { initDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Invalid JSON in request body. Please check your request format.' });
    }
    next(err);
});

app.use((req, res, next) => {
    // Ensure Content-Type is set for all API responses
    if (req.path.startsWith('/api')) {
        res.setHeader('Content-Type', 'application/json');
    }
    next();
});
app.use(session({
    secret: 'atomquest-secret-2025',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 8 }
}));

app.use(express.static(path.join(__dirname, 'public')));

const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authenticated. Please log in.' });
    next();
};

const requireRole = (...roles) => (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role))
        return res.status(403).json({ error: 'Access denied.' });
    next();
};

const authRoutes = require('./routes/auth');
const goalRoutes = require('./routes/goals');
const managerRoutes = require('./routes/manager');
const adminRoutes = require('./routes/admin');
const aiRoutes = require('./routes/ai');

app.use('/api/auth', authRoutes);
app.use('/api/goals', requireAuth, goalRoutes);
app.use('/api/manager', requireAuth, requireRole('manager', 'admin'), managerRoutes);
app.use('/api/admin', requireAuth, requireRole('admin'), adminRoutes);
app.use('/api/ai', requireAuth, aiRoutes);

app.get('/', (req, res) => {
    if (!req.session.user) return res.redirect('/login.html');
    const role = req.session.user.role;
    if (role === 'admin') return res.redirect('/admin.html');
    if (role === 'manager') return res.redirect('/manager.html');
    return res.redirect('/employee.html');
});

app.get(['/employee.html', '/manager.html', '/admin.html'], (req, res, next) => {
    if (!req.session.user) return res.redirect('/login.html');
    next();
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
});

initDb().then(() => {
    const { initCron } = require('./cron/escalations');
    initCron();
    
    const server = app.listen(PORT, () => {
        console.log(`\n✅ AtomQuest Portal running at http://localhost:${PORT}`);
        console.log(`  Admin:         admin1@company.com    / admin123`);
        console.log(`  Manager:       manager1@company.com  / mgr123`);
        console.log(`  Employee:      emp1@company.com      / emp123`);
        console.log(`  Employee(Clean): emp2@company.com    / emp123\n`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ Port ${PORT} is already in use. Run this command to fix it:`);
            console.error(`   Windows: netstat -ano | findstr :${PORT}  then  taskkill /PID <PID> /F`);
            console.error(`   Mac/Linux: lsof -ti:${PORT} | xargs kill -9`);
            process.exit(1);
        }
    });
}).catch(err => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
});
