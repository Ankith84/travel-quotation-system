// Vercel Serverless Function for AI-powered DMC processing
const pdfParse = require('pdf-parse');
const { OpenAI } = require('openai');
const mammoth = require('mammoth');
const formidable = require('formidable');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse form data
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB
    });

    const [fields, files] = await form.parse(req);
    const file = files.dmcFile?.[0];

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('Processing file:', file.originalFilename);

    let extractedText = '';

    // Extract text based on file type
    if (file.mimetype === 'application/pdf') {
      const buffer = require('fs').readFileSync(file.filepath);
      const pdfData = await pdfParse(buffer);
      extractedText = pdfData.text;
    } else if (file.mimetype.includes('word') || file.originalFilename?.endsWith('.docx')) {
      const buffer = require('fs').readFileSync(file.filepath);
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
    } else if (file.mimetype === 'text/plain') {
      extractedText = require('fs').readFileSync(file.filepath, 'utf8');
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    if (!extractedText || extractedText.trim().length < 50) {
      return res.status(400).json({ error: 'Could not extract sufficient text from file' });
    }

    console.log('Extracted text length:', extractedText.length);

    // Process with AI
    const parsedData = await parseWithAI(extractedText);

    // Add metadata
    parsedData.fileName = file.originalFilename;
    parsedData.processedAt = new Date().toISOString();
    parsedData.extractedTextPreview = extractedText.substring(0, 500);

    console.log('AI processing complete');

    res.json({
      success: true,
      data: parsedData
    });

  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ 
      error: 'Failed to process file',
      details: error.message 
    });
  }
}

// AI parsing function
async function parseWithAI(extractedText) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a travel quotation parser. Extract information from DMC quotations and return ONLY valid JSON in this exact format:
          {
            "destination": "string",
            "duration": "X Days Y Nights",
            "pax": "X Adults",
            "baseCost": number,
            "hotels": [{"name": "string", "location": "string", "nights": number, "roomType": "string"}],
            "inclusions": ["string1", "string2"],
            "exclusions": ["string1", "string2"],
            "itinerary": [{"day": number, "title": "string", "activities": ["string1", "string2"]}]
          }
          
          Extract only what's clearly mentioned. If information is not found, use empty arrays or "Not specified" for strings, 0 for numbers.`
        },
        {
          role: "user",
          content: `Extract travel quotation details from this text:\n\n${extractedText}`
        }
      ],
      temperature: 0.1,
      max_tokens: 1500
    });

    const aiResponse = completion.choices[0].message.content;
    
    try {
      return JSON.parse(aiResponse);
    } catch (parseError) {
      console.log('AI response was not valid JSON, falling back to manual parsing');
      return manualParse(extractedText);
    }
  } catch (error) {
    console.error('AI parsing failed:', error.message);
    return manualParse(extractedText);
  }
}

// Fallback manual parsing
function manualParse(text) {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  
  const parsedData = {
    destination: "Not specified",
    duration: "Not specified",
    pax: "Not specified",
    baseCost: 0,
    hotels: [],
    inclusions: [],
    exclusions: [],
    itinerary: []
  };

  let currentSection = '';
  let currentDay = 0;

  lines.forEach(line => {
    const lowerLine = line.toLowerCase();
    const trimmedLine = line.trim();

    // Extract destination
    if (!parsedData.destination || parsedData.destination === "Not specified") {
      const destMatch = trimmedLine.match(/(?:destination|tour.*?to|package.*?for)[:s-]+([^,\n\r]+)/i);
      if (destMatch && destMatch[1]) {
        parsedData.destination = destMatch[1].trim();
      }
    }

    // Extract duration
    if (!parsedData.duration || parsedData.duration === "Not specified") {
      const durationMatch = trimmedLine.match(/(\d+)\s*(?:days?)\s*[\/&-]\s*(\d+)\s*(?:nights?)/i);
      if (durationMatch) {
        parsedData.duration = `${durationMatch[1]} Days ${durationMatch[2]} Nights`;
      }
    }

    // Extract pax
    if (!parsedData.pax || parsedData.pax === "Not specified") {
      const paxMatch = trimmedLine.match(/(\d+)\s*(?:adults?|pax|persons?)/i);
      if (paxMatch) {
        parsedData.pax = `${paxMatch[1]} Adults`;
      }
    }

    // Extract cost
    const costMatch = trimmedLine.match(/(?:total|cost|price|amount)[:s]*(?:rs\.?|₹|inr)?\s*(\d{1,2}(?:,\d{2,3})*)/i);
    if (costMatch) {
      const cost = parseInt(costMatch[1].replace(/,/g, ''));
      if (cost > 1000 && cost > parsedData.baseCost) {
        parsedData.baseCost = cost;
      }
    }

    // Extract hotels
    const hotelMatch = trimmedLine.match(/hotel[:s]+([^,\n\r]+)/i);
    if (hotelMatch && hotelMatch[1]) {
      const hotelName = hotelMatch[1].trim();
      if (!parsedData.hotels.find(h => h.name === hotelName)) {
        parsedData.hotels.push({
          name: hotelName,
          location: parsedData.destination,
          nights: 2,
          roomType: "Standard Room"
        });
      }
    }

    // Detect sections
    if (lowerLine.includes('inclusion')) currentSection = 'inclusions';
    else if (lowerLine.includes('exclusion')) currentSection = 'exclusions';
    else if (lowerLine.includes('itinerary')) currentSection = 'itinerary';

    // Add content to sections
    if (currentSection === 'inclusions' && (trimmedLine.startsWith('-') || trimmedLine.length > 10)) {
      const content = trimmedLine.replace(/^[-•*]\s*/, '').trim();
      if (content && !parsedData.inclusions.includes(content)) {
        parsedData.inclusions.push(content);
      }
    }

    if (currentSection === 'exclusions' && (trimmedLine.startsWith('-') || trimmedLine.length > 10)) {
      const content = trimmedLine.replace(/^[-•*]\s*/, '').trim();
      if (content && !parsedData.exclusions.includes(content)) {
        parsedData.exclusions.push(content);
      }
    }

    if (currentSection === 'itinerary') {
      const dayMatch = trimmedLine.match(/day\s*(\d+)[:s-]*(.+)/i);
      if (dayMatch) {
        currentDay = parseInt(dayMatch[1]);
        parsedData.itinerary.push({
          day: currentDay,
          title: dayMatch[2].trim() || `Day ${currentDay}`,
          activities: []
        });
      } else if (currentDay > 0 && trimmedLine.length > 5) {
        const lastItinerary = parsedData.itinerary[parsedData.itinerary.length - 1];
        if (lastItinerary) {
          const activity = trimmedLine.replace(/^[-•*]\s*/, '').trim();
          if (activity) lastItinerary.activities.push(activity);
        }
      }
    }
  });

  return parsedData;
}
