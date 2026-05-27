require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const actieveGesprekken = {};

console.log("🚀 Review Autopilot (Web Editie) is opgestart voor: SweetNesz...");

const instructiePrompt = `You are a customer service chatbot for SweetNesz, a home bakery specializing in handmade cookies, cakes, and pastries.
Your ONLY goal: collect feedback from customers who just picked up their order.

STRICT RULES (follow exactly):
1. Never say "products" or "items" - use "treats", "pastries", "cakes", or "delicious things"
2. NO EMOJIS under any circumstances
3. Ask ONE question per message only
4. Start with: "How did the treats taste?"
5. After they answer about taste: ask for stars (1-5) as a natural follow-up
6. Once you have their rating: set status to "klaar" (done)
7. If customer continues after "klaar": set status to "support"

SENTIMENT RULES:
- 1-3 stars OR complaints = "negative"
- 4-5 stars OR satisfied feedback = "positive"
- Unclear or missing info = "neutral"

CRITICAL: You MUST respond ONLY in valid JSON format. No markdown, no backticks, no extra text.
ONLY output this structure:
{"reply":"your message here","status":"chatting","sentiment":"neutral"}

Examples of valid responses:
{"reply":"How did the treats taste?","status":"chatting","sentiment":"neutral"}
{"reply":"That's wonderful! Would you give SweetNesz 1 to 5 stars?","status":"chatting","sentiment":"positive"}
{"reply":"I'm sorry to hear that. Would you give SweetNesz 1 to 5 stars?","status":"chatting","sentiment":"negative"}
{"reply":"Thank you so much for your feedback! You gave us 5 stars - we truly appreciate it!","status":"klaar","sentiment":"positive"}`;

const model = genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite",
    systemInstruction: instructiePrompt
});

app.post('/api/chat', async (req, res) => {
    const { sessionId, message } = req.body;
    
    if (!sessionId || !message) {
        return res.status(400).json({ error: "Ongeldige data - sessionId en message verplicht" });
    }

    try {
        if (message === '/start') {
            console.log(`\n✨ [${sessionId}] === NIEUWE SESSIE GESTART ===`);
            actieveGesprekken[sessionId] = {
                chatSessie: model.startChat({ history: [] }),
                linkVerstuurd: false,
                createdAt: new Date().toISOString()
            };
            
            const chatData = actieveGesprekken[sessionId];
            console.log(`[${sessionId}] Chat history initialized`);
            
            const aiResponse = await chatData.chatSessie.sendMessage(
                "Customer opens the chat. Respond as SweetNesz assistant. Ask how the treats tasted. Use strict JSON format.",
                {
                    generationConfig: {
                        responseMimeType: "application/json",
                        temperature: 0.4,
                        maxOutputTokens: 256
                    }
                }
            );
            
            const rawText = aiResponse.response.text();
            console.log(`[${sessionId}] AI Response (raw):`, rawText.substring(0, 200));
            
            const eindTekst = await verwerkAiAntwoord(sessionId, rawText, chatData);
            return res.json({ reply: eindTekst });
        }

        if (!actieveGesprekken[sessionId]) {
            console.log(`⚠️ [${sessionId}] Sessie niet gevonden (verlopen)`);
            return res.json({ 
                reply: "Je sessie is verlopen. Vernieuw de pagina om opnieuw te beginnen." 
            });
        }

        const chatData = actieveGesprekken[sessionId];
        console.log(`\n📩 [${sessionId}] Klant stuurt: "${message.substring(0, 100)}"`);
        
        const aiResponse = await chatData.chatSessie.sendMessage(message, {
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.4,
                maxOutputTokens: 256
            }
        });
        
        const rawText = aiResponse.response.text();
        console.log(`[${sessionId}] AI Response (raw):`, rawText.substring(0, 200));
        
        const eindTekst = await verwerkAiAntwoord(sessionId, rawText, chatData);
        res.json({ reply: eindTekst });

    } catch (error) {
        console.error(`\n❌ [${sessionId}] API FOUT:`, error.message);
        console.error("Stack:", error.stack);
        res.status(500).json({ 
            reply: "Er is een tijdelijke storing bij de AI. Probeer het over een minuutje opnieuw." 
        });
    }
});

async function verwerkAiAntwoord(sessionId, aiTekst, chatData) {
    console.log(`\n--- RUWE AI TEKST [${sessionId}] ---`);
    console.log(aiTekst);
    console.log("---------------------\n");
    
    let aiData;
    let isValidJson = false;

    try {
        // Poging 1: Direct JSON parse
        aiData = JSON.parse(aiTekst);
        isValidJson = true;
        console.log(`✅ [${sessionId}] JSON valid en parsed`);
    } catch (error1) {
        try {
            // Poging 2: Verwijder backticks en probeer opnieuw
            const schoneJson = aiTekst
                .replace(/```json/gi, '')
                .replace(/```/g, '')
                .replace(/`/g, '')
                .trim();
            
            aiData = JSON.parse(schoneJson);
            isValidJson = true;
            console.log(`✅ [${sessionId}] JSON geparced (na backtick-cleanup)`);
        } catch (error2) {
            // Poging 3: AIRBAG - Fallback naar default object
            console.log(`⚠️ [${sessionId}] JSON parse FAILED - Airbag activated!`);
            console.log(`  Error 1: ${error1.message}`);
            console.log(`  Error 2: ${error2.message}`);
            
            aiData = {
                reply: aiTekst
                    .replace(/```json/gi, '')
                    .replace(/```/g, '')
                    .replace(/`/g, '')
                    .trim(),
                status: "chatting",
                sentiment: "neutral"
            };
            
            console.log(`🛟 [${sessionId}] Fallback geactiveerd - status/sentiment set to neutral/chatting`);
        }
    }

    // Validatie van aiData properties
    if (!aiData.reply || typeof aiData.reply !== 'string') {
        aiData.reply = "Oeps, er ging iets mis met het bericht.";
    }
    if (!aiData.status) aiData.status = "chatting";
    if (!aiData.sentiment) aiData.sentiment = "neutral";

    console.log(`🤖 [${sessionId}] Status: ${aiData.status} | Sentiment: ${aiData.sentiment} | IsValidJSON: ${isValidJson}`);
    
    let uiteindelijkeTekst = aiData.reply;

    // Vervang [LINK] placeholder als aanwezig
    if (uiteindelijkeTekst.includes("[LINK]")) {
        const deJuisteLink = (aiData.sentiment === "negative") 
            ? "[https://feedback.sweetnesz.com/review](https://feedback.sweetnesz.com/review)" 
            : "[https://g.page/SweetNesz/review](https://g.page/SweetNesz/review)";
        uiteindelijkeTekst = uiteindelijkeTekst.replace("[LINK]", deJuisteLink);
        console.log(`🔗 [${sessionId}] [LINK] placeholder vervangen`);
    }

    // Append review link als status "klaar" en link nog niet verstuurd
    if (aiData.status === "klaar" && !chatData.linkVerstuurd) {
        const reviewLink = (aiData.sentiment === "negative") 
            ? "\n\n[https://feedback.sweetnesz.com/review](https://feedback.sweetnesz.com/review)" 
            : "\n\n[https://g.page/SweetNesz/review](https://g.page/SweetNesz/review)";
        
        uiteindelijkeTekst += reviewLink;
        chatData.linkVerstuurd = true;
        
        console.log(`✅ [${sessionId}] === CONVERSATION COMPLETED ===`);
        console.log(`   Final Status: ${aiData.status}`);
        console.log(`   Sentiment: ${aiData.sentiment}`);
        console.log(`   Review link appended`);
    }

    return uiteindelijkeTekst;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Review Autopilot webserver draait op poort ${PORT}`);
    console.log(`📍 Gemini Model: gemini-3.1-flash-lite`);
    console.log(`🔧 Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`${'='.repeat(60)}\n`);
});

// Cleanup: Verwijder stale sessions na 1 uur inactiviteit
setInterval(() => {
    const now = Date.now();
    const MAX_SESSION_AGE = 60 * 60 * 1000; // 1 hour
    
    let clearedCount = 0;
    for (const [sessionId, chatData] of Object.entries(actieveGesprekken)) {
        const sessionAge = now - new Date(chatData.createdAt).getTime();
        if (sessionAge > MAX_SESSION_AGE) {
            delete actieveGesprekken[sessionId];
            clearedCount++;
        }
    }
    
    if (clearedCount > 0) {
        console.log(`🧹 Cleanup: ${clearedCount} stale session(s) verwijderd`);
    }
}, 5 * 60 * 1000); // Check elke 5 minuten