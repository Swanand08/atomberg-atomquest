const { run, initDb } = require('./database');

async function fix() {
    await initDb();
    await run("INSERT OR IGNORE INTO escalation_rules (rule_type, days_threshold, escalate_to) VALUES ('submission_delay', 7, 'manager')");
    await run("INSERT OR IGNORE INTO escalation_rules (rule_type, days_threshold, escalate_to) VALUES ('approval_delay', 5, 'employee_and_manager')");
    await run("INSERT OR IGNORE INTO escalation_rules (rule_type, days_threshold, escalate_to) VALUES ('checkin_delay', 3, 'employee_and_manager')");
    console.log("Rules inserted successfully");
}

fix().catch(console.error);
