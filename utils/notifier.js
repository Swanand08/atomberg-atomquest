const nodemailer = require('nodemailer');
const axios = require('axios');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: process.env.SMTP_PORT || 587,
    auth: {
        user: process.env.SMTP_USER || 'demo_user',
        pass: process.env.SMTP_PASS || 'demo_pass'
    }
});

const sendEmail = async (to, subject, html) => {
    try {
        const { run } = require('../database');
        await run('INSERT INTO notification_logs (recipient, type, subject, body, action_url) VALUES (?, ?, ?, ?, ?)', 
            [to, 'Email', subject, html, null]);

        if (!process.env.SMTP_USER || process.env.SMTP_USER === 'demo_user') {
            console.log(`[MOCK EMAIL] To: ${to} | Subject: ${subject}`);
            return;
        }
        await transporter.sendMail({
            from: '"AtomQuest Goals" <noreply@atomquest.com>',
            to,
            subject,
            html
        });
        console.log(`Email sent to ${to}`);
    } catch (error) {
        console.error('Email error:', error);
    }
};

const sendTeamsNotification = async (webhookUrl, title, text, actionUrl) => {
    try {
        const { run } = require('../database');
        await run('INSERT INTO notification_logs (recipient, type, subject, body, action_url) VALUES (?, ?, ?, ?, ?)', 
            [webhookUrl || 'Teams Workspace Webhook', 'Teams', title, text, actionUrl]);

        if (!webhookUrl || webhookUrl === 'your_teams_webhook_url') {
            console.log(`[MOCK TEAMS] Title: ${title} | Text: ${text} | Link: ${actionUrl}`);
            return;
        }
        
        const cardPayload = {
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            "themeColor": "0076D7",
            "summary": title,
            "sections": [{
                "activityTitle": title,
                "text": text,
                "markdown": true
            }],
            "potentialAction": [{
                "@type": "OpenUri",
                "name": "View Details",
                "targets": [{
                    "os": "default",
                    "uri": actionUrl
                }]
            }]
        };

        await axios.post(webhookUrl, cardPayload);
        console.log('Teams notification sent');
    } catch (error) {
        console.error('Teams notification error:', error);
    }
};

module.exports = {
    sendEmail,
    sendTeamsNotification
};
