const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');

const mockSuggestions = {
    "Strategic Growth": [
        {
            title: "Expand Market Share in Tier-2 Cities",
            target: 15,
            uom: "Percentage",
            direction: "max",
            rationale: "Capturing emerging markets drives sustainable long-term revenue growth."
        },
        {
            title: "Accelerate New Product Line Launch",
            target: 30,
            uom: "Timeline",
            direction: "min",
            rationale: "Reducing time-to-market ensures competitive advantage in smart appliances."
        },
        {
            title: "Increase Key Account Acquisition",
            target: 25,
            uom: "Numeric",
            direction: "max",
            rationale: "Strengthening B2B partnerships secures predictable quarterly cash flow."
        }
    ],
    "Operational Excellence": [
        {
            title: "Optimize Manufacturing Cycle Time",
            target: 12,
            uom: "Percentage",
            direction: "min",
            rationale: "Streamlining production lines reduces overhead and increases daily output."
        },
        {
            title: "Reduce Supply Chain Wastage",
            target: 5,
            uom: "Percentage",
            direction: "min",
            rationale: "Minimizing inventory loss directly improves overall EBITDA margins."
        },
        {
            title: "Achieve Zero Defect Rate in Assembly",
            target: 0,
            uom: "Zero-based",
            direction: "min",
            rationale: "Maintaining flawless quality control eliminates costly product recalls."
        }
    ],
    "Customer Success": [
        {
            title: "Improve Net Promoter Score (NPS)",
            target: 85,
            uom: "Numeric",
            direction: "max",
            rationale: "High customer satisfaction drives brand loyalty and organic referrals."
        },
        {
            title: "Reduce Customer Ticket Resolution Time",
            target: 20,
            uom: "Percentage",
            direction: "min",
            rationale: "Prompt customer support significantly enhances client retention rates."
        },
        {
            title: "Increase Customer Onboarding Efficiency",
            target: 95,
            uom: "Percentage",
            direction: "max",
            rationale: "Smooth onboarding ensures immediate product adoption and user engagement."
        }
    ],
    "Innovation & Tech": [
        {
            title: "Migrate Legacy Infrastructure to Cloud",
            target: 100,
            uom: "Percentage",
            direction: "max",
            rationale: "Modernizing system architecture guarantees 99.9% uptime and scalability."
        },
        {
            title: "Reduce Sprint Bug Leakage Rate",
            target: 10,
            uom: "Percentage",
            direction: "min",
            rationale: "Rigorous automated testing ensures robust, high-quality software releases."
        },
        {
            title: "Implement AI-driven Workflow Automation",
            target: 40,
            uom: "Percentage",
            direction: "max",
            rationale: "Automating repetitive tasks frees up valuable engineering bandwidth for innovation."
        }
    ]
};

const defaultSuggestions = [
    {
        title: "Enhance Cross-functional Team Collaboration",
        target: 90,
        uom: "Percentage",
        direction: "max",
        rationale: "Synergy across departments ensures alignment with core organizational objectives."
    },
    {
        title: "Complete Advanced Professional Certification",
        target: 1,
        uom: "Numeric",
        direction: "max",
        rationale: "Upskilling empowers employees to contribute cutting-edge solutions."
    },
    {
        title: "Optimize Core Deliverable Turnaround Time",
        target: 15,
        uom: "Percentage",
        direction: "min",
        rationale: "Efficient execution maximizes client satisfaction and project profitability."
    }
];

router.post('/suggest', async (req, res) => {
    try {
        const { thrust_area, context } = req.body;
        
        if (!thrust_area) {
            return res.status(400).json({ error: 'Thrust area is required' });
        }

        // Attempt Gemini API call if key looks valid
        const apiKey = process.env.GEMINI_API_KEY || '';
        if (apiKey && apiKey.startsWith('AIzaSy') && !apiKey.includes('dummy')) {
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-pro" });
                const prompt = `
                    You are an expert HR Performance Consultant at Atomberg Technologies.
                    An employee is setting their performance goals for the "Thrust Area": ${thrust_area}.
                    ${context ? `Additional Context: ${context}` : ''}

                    Generate 3 professional, measurable, and SMART goals for this area.
                    Each goal must include:
                    1. Title: A concise objective.
                    2. Target: A numeric or percentage target.
                    3. UOM: Unit of measurement (Numeric, Percentage, Timeline, or Zero-based).
                    4. Direction: 'max' (maximize) or 'min' (minimize).
                    5. Rationale: A one-sentence explanation of why this goal matters.

                    Return the response as a JSON array of objects. Example:
                    [
                      {
                        "title": "Increase productivity",
                        "target": 95,
                        "uom": "Percentage",
                        "direction": "max",
                        "rationale": "High productivity ensures we meet market demand."
                      }
                    ]
                    Return ONLY the raw JSON array.
                `;

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();
                
                const jsonMatch = text.match(/\[[\s\S]*\]/);
                const suggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);

                return res.json({ suggestions });
            } catch (apiErr) {
                console.warn('Gemini API call unavailable/failed. Falling back to local expert system:', apiErr.message);
            }
        }

        // Fallback to local expert system
        let suggestions = mockSuggestions[thrust_area] || defaultSuggestions;
        
        // If context is provided, customize the first suggestion slightly to reflect the context
        if (context) {
            suggestions = JSON.parse(JSON.stringify(suggestions)); // deep clone
            suggestions[0].rationale += ` (Context: ${context})`;
        }

        return res.json({ suggestions });
    } catch (err) {
        console.error('AI Error:', err);
        res.status(500).json({ error: 'Failed to generate suggestions.' });
    }
});

router.post('/score', async (req, res) => {
    try {
        const { title = '', thrust_area = '' } = req.body;
        if (!title) {
            return res.status(400).json({ error: 'Goal title is required' });
        }

        const apiKey = process.env.GEMINI_API_KEY || '';
        if (apiKey && apiKey.startsWith('AIzaSy') && !apiKey.includes('dummy')) {
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-pro" });
                const prompt = `You are an HR expert. Score this performance goal on SMART criteria.
Goal: ${title}. Thrust Area: ${thrust_area}.
Return ONLY a JSON object: { "specific": true, "measurable": true, "achievable": true, "relevant": true, "time_bound": true, "overall_score": 8, "improvement_tip": "one sentence" }`;

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();
                
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                const scoreResult = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);

                return res.json(scoreResult);
            } catch (apiErr) {
                console.warn('Gemini API call unavailable/failed for scoring. Falling back to local keyword analysis:', apiErr.message);
            }
        }

        // Fallback mock score based on keyword analysis
        const specific = title.length > 20;
        const measurable = /\d|%/.test(title);
        const achievable = true;
        const relevant = !!thrust_area;
        const time_bound = title.toLowerCase().includes('by') || title.includes('Q') || title.toLowerCase().includes('month');
        
        const count = [specific, measurable, achievable, relevant, time_bound].filter(Boolean).length;
        const overall_score = count * 2;
        const improvement_tip = "Add a specific numeric target and deadline to make this goal fully SMART.";

        return res.json({
            specific,
            measurable,
            achievable,
            relevant,
            time_bound,
            overall_score,
            improvement_tip
        });
    } catch (err) {
        console.error('AI Score Error:', err);
        res.status(500).json({ error: 'Failed to score goal.' });
    }
});

module.exports = router;
