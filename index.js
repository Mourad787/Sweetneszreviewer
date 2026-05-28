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

const instructiePrompt = `Jij bent de virtuele klantenservice assistent van 'SweetNesz', een patisserie aan huis gespecialiseerd in zelfgemaakte, ambachtelijke koekjes, gebakjes en taarten op bestelling. 
Je neemt via WhatsApp contact op met een klant die zojuist hun bestelling heeft afgehaald. Jouw ENIGE doel is feedback verzamelen, maar wel via een natuurlijk en geïnteresseerd gesprek.

Jouw taken & STRICTE REGELS:
1. GEEN PRODUCT-TAAL: Spreek NOOIT over "producten" of "items". Spreek warm over "lekkernijen", "gebakjes", "taartjes", of een "doosje met lekkers".
2. GEEN EMOJI'S: Gebruik absoluut geen emoji's. Houd de toon professioneel, warm en kort.
3. ÉÉN VRAAG TEGELIJK: Stel NOOIT meerdere vragen in één bericht. Wacht geduldig op het antwoord.
4. DOORVRAGEN (CRUCIAAL!): 
   - Begin met de vraag hoe de lekkernijen hebben gesmaakt.
   - Als de klant een heel kort antwoord geeft (bijv. "goed", "aardbei", "minder"), MOET je doorvragen! Vraag wat ze er precies lekker aan vonden, of wat er miste.
   - Toon empathie! Als de klant niet enthousiast is of een klacht heeft, vraag dan EERST wat er mis ging en toon begrip, voordat je verder gaat met het gesprek.
5. STERREN VRAGEN: 
   - Pas als je het volledige verhaal snapt en de klant is uitgesproken over de ervaring, vraag je als natuurlijk bruggetje hoeveel sterren (1 t/m 5) ze SweetNesz zouden geven.
6. AFRONDEN MET CALL-TO-ACTION: Zodra je de context én de sterren weet, markeer je de status als "klaar". 
   - In je afsluitende 'reply' benoem je hun feedback en de sterren. (Zet ZELF GEEN links in deze tekst).
7. NA DE AFRONDING (SUPPORT) & LINK OPNIEUW STUREN: Als de klant na afronding nog een vraag stelt, markeer je de status als "support".
   - CRUCIAAL: Als de klant vraagt om de link nog een keer te sturen, gebruik dan EXACT het woord "[LINK]" in je tekst.

Regels voor sentiment:
- Klachten of 1 t/m 3 sterren = "negative".
- Tevreden reacties of 4 en 5 sterren = "positive".
- Bij twijfel = "neutral".

UITERMATE BELANGRIJK: JOUW ENIGE OUTPUT MAG STRICT JSON ZIJN. GEEN ANDERE TEKST IS TOEGESTAAN. 
Formaat:
{
  "reply": "Hier komt jouw gepersonaliseerde reactie",
  "status": "chatting",
  "sentiment": "neutral"
}`;

const model = genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite", 
    systemInstruction: instructiePrompt,
    generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4 
    }
});

app.post('/api/chat', async (req, res) => {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) return res.status(400).json({ error: "Ongeldige data" });

    try {
        if (message === '/start') {
            console.log(`[${sessionId}] Nieuwe web-sessie gestart.`);
            actieveGesprekken[sessionId] = {
                chatSessie: model.startChat({ history: [] }),
                linkVerstuurd: false
            };
            
            const chatData = actieveGesprekken[sessionId];
            const aiResponse = await chatData.chatSessie.sendMessage("De klant opent de chat. BEHOUD JE ROL! Reageer als de SweetNesz assistent. Vraag hoe de lekkernijen smaakten en gebruik STRICT HET JSON FORMAAT. Geef GEEN opties, maar voer het gesprek.");
            const eindTekst = await verwerkAiAntwoord(sessionId, aiResponse.response.text(), chatData);
            return res.json({ reply: eindTekst });
        }

        if (!actieveGesprekken[sessionId]) {
            return res.json({ reply: "Je sessie is verlopen. Vernieuw de pagina om opnieuw te beginnen." });
        }

        console.log(`📩 Web-klant [${sessionId}]: "${message}"`);
        const chatData = actieveGesprekken[sessionId];
        const aiResponse = await chatData.chatSessie.sendMessage(message);
        
        const eindTekst = await verwerkAiAntwoord(sessionId, aiResponse.response.text(), chatData);
        res.json({ reply: eindTekst });

    } catch (error) {
        console.error("❌ API Fout opgetreden:", error.message);
        res.status(500).json({ reply: "Er is een tijdelijke storing bij de AI. Probeer het over een minuutje opnieuw." });
    }
});

async function verwerkAiAntwoord(sessionId, aiTekst, chatData) {
    console.log(`\n--- RUWE AI TEKST ---\n${aiTekst}\n---------------------\n`);
    
    let aiData;
    try {
        // Veilige methode voor VS Code: tekst simpel opsplitsen zonder ingewikkelde regex
        let schoneJson = aiTekst.split('```json').join('').split('```').join('').trim();
        aiData = JSON.parse(schoneJson);
    } catch (error) {
        console.log("⚠️ AI was eigenwijs en stuurde geen JSON. Airbag geactiveerd.");
        let ruweTekst = aiTekst.split('```json').join('').split('```').join('').trim();
        aiData = {
            reply: ruweTekst, 
            status: "chatting", 
            sentiment: "neutral"
        };
    }

    console.log(`🤖 AI Status: ${aiData.status} | Sentiment: ${aiData.sentiment}`);
    
    let uiteindelijkeTekst = aiData.reply || "Oeps, er ging iets mis met het bericht.";

    if (uiteindelijkeTekst.includes("[LINK]")) {
        const deJuisteLink = (aiData.sentiment === "negative") ? "https://feedback.nesz/review" : "https://google.nl/review";
        uiteindelijkeTekst = uiteindelijkeTekst.replace("[LINK]", deJuisteLink);
    }

    if (aiData.status === "klaar" && !chatData.linkVerstuurd) {
        let link = (aiData.sentiment === "negative") ? "https://feedback.nesz/review" : "https://google.nl/review";
        uiteindelijkeTekst += "\n\n" + link;
        chatData.linkVerstuurd = true; 
        console.log(`[${sessionId}] Review link verstuurd.`);
    }

    return uiteindelijkeTekst;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Webserver draait op poort ${PORT}`);
});