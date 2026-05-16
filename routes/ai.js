const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post('/suggest', async (req, res) => {
    try {
        const { thrust_area, context } = req.body;
        
        if (!thrust_area) {
            return res.status(400).json({ error: 'Thrust area is required' });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
        
        // Clean the response if necessary (sometimes Gemini adds markdown)
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        const suggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);

        res.json({ suggestions });
    } catch (err) {
        console.error('AI Error:', err);
        res.status(500).json({ error: 'Failed to generate suggestions. Ensure API key is set.' });
    }
});

module.exports = router;
