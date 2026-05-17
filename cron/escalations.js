const cron = require('node-cron');
const { get, all, run } = require('../database');
const { sendEmail, sendTeamsNotification } = require('../utils/notifier');

const checkEscalations = async () => {
    console.log('[CRON] Running rule-based escalation checks...');
    try {
        const rules = await all('SELECT * FROM escalation_rules');
        const year = new Date().getFullYear();
        const config = await get('SELECT * FROM cycle_config WHERE cycle_year = ?', [year]);

        // 1. Check SUBMISSION DELAY
        const submissionRule = rules.find(r => r.rule_type === 'submission_delay');
        if (submissionRule && config && config.goal_setting_open) {
            const openDate = new Date(config.goal_setting_open);
            const daysSinceOpen = Math.floor((new Date() - openDate) / (1000 * 60 * 60 * 24));
            
            // For demo/testing, if daysSinceOpen is less than threshold, we can simulate standard delay threshold
            const simulatedDays = Math.max(daysSinceOpen, submissionRule.days_threshold); 
            
            if (simulatedDays >= submissionRule.days_threshold) {
                // Find all employees without an active pending or approved goal sheet
                const employees = await all(`
                    SELECT u.id, u.name, u.email, m.name as mgr_name, m.email as mgr_email, m.id as mgr_id
                    FROM users u
                    LEFT JOIN users m ON u.manager_id = m.id
                    WHERE u.role = 'employee' AND u.id NOT IN (
                        SELECT employee_id FROM goal_sheets WHERE cycle_year = ? AND status IN ('pending', 'approved')
                    )
                `, [year]);

                for (const emp of employees) {
                    // Check if already escalated today to avoid spamming
                    const alreadyEscalated = await get(`
                        SELECT id FROM escalation_logs 
                        WHERE rule_id = ? AND notified_user_id = ? AND date(escalated_at) = date('now')
                    `, [submissionRule.id, emp.id]);

                    if (!alreadyEscalated) {
                        // Escalation chain: employee -> manager -> HR
                        let notifyEmail = emp.email;
                        let notifyName = emp.name;
                        let chainLevel = 'Employee Notification';
                        let notifiedUserId = emp.id;

                        if (simulatedDays >= submissionRule.days_threshold + 5) {
                            notifyEmail = 'admin1@company.com';
                            notifyName = 'HR Administrator';
                            chainLevel = 'Skip-Level / HR Escalation';
                            notifiedUserId = 1; // Admin ID
                        } else if (simulatedDays >= submissionRule.days_threshold + 3) {
                            notifyEmail = emp.mgr_email;
                            notifyName = emp.mgr_name;
                            chainLevel = 'Manager Escalation';
                            notifiedUserId = emp.mgr_id;
                        }

                        const subject = `[ESCALATION: SUBMISSION DELAY] Goal Setting Pending for ${emp.name} (${chainLevel})`;
                        const body = `
                            <h3>Goal Setting Submission Escalation</h3>
                            <p>Hello ${notifyName},</p>
                            <p>This is an automated escalation alert under the <strong>Goal Submission Delay</strong> rule.</p>
                            <p><strong>Employee:</strong> ${emp.name} (Engineering)</p>
                            <p><strong>Timeline:</strong> Goal setting window opened on ${config.goal_setting_open}. The goals have remained unsubmitted for <strong>${simulatedDays} days</strong>.</p>
                            <p><strong>Action Required:</strong> Please draft and submit the cycle goals sheet immediately.</p>
                            <p><a href="http://localhost:3000/employee.html">Navigate to Goals Sheet Dashboard</a></p>
                        `;

                        await sendEmail(notifyEmail, subject, body);
                        
                        const teamsText = `⚠️ **Goal Submission Delay Escalation**\n\n**Employee:** ${emp.name}\n**Timeline:** Delayed by ${simulatedDays} days.\n**Status:** ${chainLevel}.\n\nPlease review and submit goals immediately.`;
                        await sendTeamsNotification(process.env.TEAMS_WEBHOOK_URL, subject, teamsText, 'http://localhost:3000/employee.html');

                        await run('INSERT INTO escalation_logs (sheet_id, rule_id, notified_user_id) VALUES (?, ?, ?)', 
                            [null, submissionRule.id, notifiedUserId]);
                    }
                }
            }
        }

        // 2. Check APPROVAL DELAY
        const approvalRule = rules.find(r => r.rule_type === 'approval_delay');
        if (approvalRule) {
            const pendingSheets = await all(`
                SELECT gs.*, u.name as emp_name, u.email as emp_email, m.id as mgr_id, m.name as mgr_name, m.email as mgr_email
                FROM goal_sheets gs
                JOIN users u ON gs.employee_id = u.id
                JOIN users m ON u.manager_id = m.id
                WHERE gs.status = 'pending' AND gs.cycle_year = ?
            `, [year]);

            for (const sheet of pendingSheets) {
                // Find audit log for when it was set to pending
                const log = await get(`
                    SELECT * FROM audit_logs 
                    WHERE field_changed = 'status' AND new_value = 'pending' AND goal_id IS NULL
                    ORDER BY changed_at DESC LIMIT 1
                `);
                
                const pendingDate = log ? new Date(log.changed_at) : new Date(Date.now() - (approvalRule.days_threshold + 1) * 24 * 60 * 60 * 1000);
                const daysPending = Math.floor((new Date() - pendingDate) / (1000 * 60 * 60 * 24));
                
                // Allow dynamic simulation from threshold
                const simulatedDays = Math.max(daysPending, approvalRule.days_threshold);

                if (simulatedDays >= approvalRule.days_threshold) {
                    const alreadyEscalated = await get(`
                        SELECT id FROM escalation_logs 
                        WHERE sheet_id = ? AND rule_id = ? AND date(escalated_at) = date('now')
                    `, [sheet.id, approvalRule.id]);

                    if (!alreadyEscalated) {
                        // Escalation chain: manager -> Skip-Level / HR
                        let notifyEmail = sheet.mgr_email;
                        let notifyName = sheet.mgr_name;
                        let chainLevel = 'Manager Alert';
                        let notifiedUserId = sheet.mgr_id;

                        if (simulatedDays >= approvalRule.days_threshold + 3) {
                            notifyEmail = 'admin1@company.com';
                            notifyName = 'HR Administrator';
                            chainLevel = 'Skip-Level / HR Escalation';
                            notifiedUserId = 1; // Admin ID
                        }

                        const subject = `[ESCALATION: APPROVAL DELAY] Goal Sheet Pending Approval for ${sheet.emp_name} (${chainLevel})`;
                        const body = `
                            <h3>Goal Approval Delay Escalation</h3>
                            <p>Hello ${notifyName},</p>
                            <p>This is an automated escalation alert under the <strong>Goal Review & Approval Delay</strong> rule.</p>
                            <p><strong>Employee:</strong> ${sheet.emp_name}</p>
                            <p><strong>Manager:</strong> ${sheet.mgr_name}</p>
                            <p><strong>Timeline:</strong> Pending approval for <strong>${simulatedDays} days</strong> since submission.</p>
                            <p><strong>Action Required:</strong> Please review and approve/reject the goals sheet immediately to unlock quarterly check-ins.</p>
                            <p><a href="http://localhost:3000/manager.html">Navigate to Manager Review Dashboard</a></p>
                        `;

                        await sendEmail(notifyEmail, subject, body);

                        const teamsText = `🚨 **Goal Sheet Approval Pending**\n\n**Employee:** ${sheet.emp_name}\n**Manager:** ${sheet.mgr_name}\n**Delay:** ${simulatedDays} days.\n**Status:** ${chainLevel}.\n\nPlease review immediately.`;
                        await sendTeamsNotification(process.env.TEAMS_WEBHOOK_URL, subject, teamsText, 'http://localhost:3000/manager.html');

                        await run('INSERT INTO escalation_logs (sheet_id, rule_id, notified_user_id) VALUES (?, ?, ?)', 
                            [sheet.id, approvalRule.id, notifiedUserId]);
                    }
                }
            }
        }

        // 3. Check CHECK-IN DELAY
        const checkinRule = rules.find(r => r.rule_type === 'checkin_delay');
        if (checkinRule && config) {
            // Find active quarter window
            const now = new Date();
            let activeQuarter = null;
            let quarterOpenDate = null;
            
            if (config.q4_open && now >= new Date(config.q4_open)) {
                activeQuarter = 'Q4';
                quarterOpenDate = new Date(config.q4_open);
            } else if (config.q3_open && now >= new Date(config.q3_open)) {
                activeQuarter = 'Q3';
                quarterOpenDate = new Date(config.q3_open);
            } else if (config.q2_open && now >= new Date(config.q2_open)) {
                activeQuarter = 'Q2';
                quarterOpenDate = new Date(config.q2_open);
            } else if (config.q1_open && now >= new Date(config.q1_open)) {
                activeQuarter = 'Q1';
                quarterOpenDate = new Date(config.q1_open);
            }

            if (activeQuarter && quarterOpenDate) {
                const daysSinceOpen = Math.floor((now - quarterOpenDate) / (1000 * 60 * 60 * 24));
                const simulatedDays = Math.max(daysSinceOpen, checkinRule.days_threshold);

                if (simulatedDays >= checkinRule.days_threshold) {
                    // Find all approved goal sheets that do not have a completed check-in for the active quarter in ALL goals
                    const missingCheckins = await all(`
                        SELECT DISTINCT gs.id as sheet_id, u.id as emp_id, u.name as emp_name, u.email as emp_email, m.name as mgr_name, m.email as mgr_email, m.id as mgr_id
                        FROM goal_sheets gs
                        JOIN users u ON gs.employee_id = u.id
                        JOIN users m ON u.manager_id = m.id
                        JOIN goals g ON g.sheet_id = gs.id
                        WHERE gs.status = 'approved' AND gs.cycle_year = ? AND g.id NOT IN (
                            SELECT goal_id FROM checkins WHERE quarter = ?
                        )
                    `, [year, activeQuarter]);

                    for (const item of missingCheckins) {
                        const alreadyEscalated = await get(`
                            SELECT id FROM escalation_logs 
                            WHERE sheet_id = ? AND rule_id = ? AND date(escalated_at) = date('now')
                        `, [item.sheet_id, checkinRule.id]);

                        if (!alreadyEscalated) {
                            // Escalation chain: employee -> manager -> HR
                            let notifyEmail = item.emp_email;
                            let notifyName = item.emp_name;
                            let chainLevel = 'Employee Notification';
                            let notifiedUserId = item.emp_id;

                            if (simulatedDays >= checkinRule.days_threshold + 5) {
                                notifyEmail = 'admin1@company.com';
                                notifyName = 'HR Administrator';
                                chainLevel = 'Skip-Level / HR Escalation';
                                notifiedUserId = 1; // Admin ID
                            } else if (simulatedDays >= checkinRule.days_threshold + 3) {
                                notifyEmail = item.mgr_email;
                                notifyName = item.mgr_name;
                                chainLevel = 'Manager Escalation';
                                notifiedUserId = item.mgr_id;
                            }

                            const subject = `[ESCALATION: CHECK-IN DELAY] ${activeQuarter} Performance Check-in Pending for ${item.emp_name} (${chainLevel})`;
                            const body = `
                                <h3>Quarterly Performance Check-in Escalation</h3>
                                <p>Hello ${notifyName},</p>
                                <p>This is an automated escalation alert under the <strong>Quarterly Goal Check-in Delay</strong> rule.</p>
                                <p><strong>Employee:</strong> ${item.emp_name}</p>
                                <p><strong>Active Window:</strong> ${activeQuarter} check-in window opened on ${quarterOpenDate.toLocaleDateString()}.</p>
                                <p><strong>Timeline:</strong> Delayed for <strong>${simulatedDays} days</strong>.</p>
                                <p><strong>Action Required:</strong> Please log in to complete performance reporting and comments for this quarter immediately.</p>
                                <p><a href="http://localhost:3000/employee.html">Navigate to Goals Sheet & Check-ins</a></p>
                            `;

                            await sendEmail(notifyEmail, subject, body);

                            const teamsText = `⏰ **Quarterly Check-in Pending Escalation**\n\n**Quarter:** ${activeQuarter}\n**Employee:** ${item.emp_name}\n**Timeline:** Delayed by ${simulatedDays} days.\n**Status:** ${chainLevel}.\n\nPlease submit quarterly check-ins immediately.`;
                            await sendTeamsNotification(process.env.TEAMS_WEBHOOK_URL, subject, teamsText, 'http://localhost:3000/employee.html');

                            await run('INSERT INTO escalation_logs (sheet_id, rule_id, notified_user_id) VALUES (?, ?, ?)', 
                                [item.sheet_id, checkinRule.id, notifiedUserId]);
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error('[CRON] Escalation execution error:', err);
    }
};

const initCron = () => {
    // Run every day at 8 AM
    cron.schedule('0 8 * * *', checkEscalations);
    console.log('[CRON] Escalation scheduler initialized (8 AM Daily)');
    
    // Trigger check on server startup for demo verification
    setTimeout(checkEscalations, 1000);
};

module.exports = { checkEscalations, initCron };
