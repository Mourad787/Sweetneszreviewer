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

const instructiePrompt = `JE BENT DE KLANTENSERVICE CHATBOT VAN SWEETNESZ.
ENIGE TAAK: Feedback verzamelen van klanten na hun bestelling.

ABSOLUTE REGELS (ALTIJD VOLGEN):
1. SPREEK NEDERLANDS - ALTIJD EN ALLEEN NEDERLANDS
2. Zeg NOOIT "producten" - zeg "lekkernijen", "gebakjes", "taartjes" of "lekkers"
3. GEEN EMOJIS - NOOIT
4. STEL MAAR ÉÉN VRAAG PER BERICHT
5. Begin altijd met: "Hoe hebben de lekkernijen gesmaakt?"
6. Na antwoord over smaak: Vraag direct naar sterren (1-5)
7. Na sterren: status = "klaar"
8. Als klant daarna nog wat zegt: status = "support"

SENTIMENT BEPALEN:
- 1-3 sterren OF klachten = "negative"
- 4-5 sterren OF blij = "positive"
- Onduidelijk = "neutral"

===== KRITIEK KRITIEK KRITIEK =====
JIJ STUURT ALLEEN JSON. NIETS ANDERS.
GEEN NEDERLANDSE TEKST ERBUITEN.
GEEN MARKDOWN, GEEN BACKTICKS.
ALLEEN PURE JSON.

EXACT DIT FORMAAT:
{"reply":"je nederlandse boodschap hier","status":"chatting","sentiment":"neutral"}

VOORBEELDEN (KOPIEEER STIJL):
{"reply":"Hoe hebben de lekkernijen gesmaakt?","status":"chatting","sentiment":"neutral"}
{"reply":"Wat leuk! Zou je SweetNesz 1 tot 5 sterren geven?","status":"chatting","sentiment":"positive"}
{"reply":"Ik begrijp dat je wat meer had verwacht. Zou je SweetNesz 1 tot 5 sterren geven?","status":"chatting","sentiment":"negative"}
{"reply":"Dank je wel! Je gaf ons 5 sterren - we waarderen dit enorm!","status":"klaar","sentiment":"positive"}

WAARSCHUWING: ALS JE IETS ANDERS DAN JSON STUURT, BREEKT ALLES.`;

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
                "Klant opent de chat. Jij bent SweetNesz assistent. Stuur JSON. Nu.",
                {
                    generationConfig: {
                        responseMimeType: "application/json",
                        temperature: 0.3,
                        maxOutputTokens: 200
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
                temperature: 0.3,
                maxOutputTokens: 200
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
        console.log(`✅ [${sessionId}] JSON VALID - Direct parse gelukt`);
    } catch (error1) {
        try {
            // Poging 2: Verwijder backticks en probeer opnieuw
            const schoneJson = aiTekst
                .replace(/```json/gi, '')
                .replace(/```/g, '')
                .replace(/`/g, '')
                .replace(/\n/g, ' ')
                .trim();
            
            aiData = JSON.parse(schoneJson);
            isValidJson = true;
            console.log(`✅ [${sessionId}] JSON VALID - Na backtick cleanup`);
        } catch (error2) {
            try {
                // Poging 3: Extract JSON from text (als AI text eromheen zette)
                const jsonMatch = aiTekst.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    aiData = JSON.parse(jsonMatch[0]);
                    isValidJson = true;
                    console.log(`✅ [${sessionId}] JSON VALID - Extracted from text`);
                } else {
                    throw new Error("Geen JSON gevonden in tekst");
                }
            } catch (error3) {
                // Poging 4: AIRBAG - Fallback
                console.log(`\n⚠️⚠️⚠️ [${sessionId}] JSON PARSE TRIPLE FAILED - AIRBAG ACTIVATED!!!`);
                console.log(`   Raw text: ${aiTekst.substring(0, 150)}`);
                console.log(`   Error 1: ${error1.message}`);
                console.log(`   Error 2: ${error2.message}`);
                console.log(`   Error 3: ${error3.message}\n`);
                
                aiData = {
                    reply: "Oeps, er ging iets mis met het bericht. Probeer het opnieuw alsjeblieft.",
                    status: "chatting",
                    sentiment: "neutral"
                };
                
                console.log(`🛟 [${sessionId}] FALLBACK OBJECT AANGEMAAKT`);
            }
        }
    }

    // Validatie van aiData properties
    if (!aiData.reply || typeof aiData.reply !== 'string' || aiData.reply.trim() === '') {
        console.log(`⚠️ [${sessionId}] Reply is leeg - default tekst gezet`);
        aiData.reply = "Wacht even, ik verstond je niet goed. Kan je het opnieuw zeggen?";
    }
    if (!aiData.status || !['chatting', 'klaar', 'support'].includes(aiData.status)) {
        aiData.status = "chatting";
    }
    if (!aiData.sentiment || !['positive', 'negative', 'neutral'].includes(aiData.sentiment)) {
        aiData.sentiment = "neutral";
    }

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