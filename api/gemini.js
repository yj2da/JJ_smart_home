/* ==========================================================================
   VERCEL SERVERLESS FUNCTION - GEMINI API PROXY
   Environment Variable: GEMINI_API_KEY (Set in Vercel Dashboard)
   ========================================================================== */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyDi9Ew17PZ9D4Hi2MHzHJJrwwMGMuOMi0A';
  const { prompt } = req.body || {};

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const payload = {
      contents: [
        {
          parts: [
            {
              text: `당신은 JINJIN Smart Home 전용 친절한 AI 스마트 도우미입니다.
사용자의 질문: "${prompt}"
한국어로 친절하고 상냥하고 자연스럽게 2~3문장으로 간결하고 명확하게 답변해 주세요.`
            }
          ]
        }
      ]
    };

    const primaryUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const backupUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;
    const thirdUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`;

    let apiRes = await fetch(primaryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!apiRes.ok) {
      console.warn("Primary Gemini model failed, trying backup url...");
      apiRes = await fetch(backupUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!apiRes.ok) {
      console.warn("Backup Gemini model failed, trying third url...");
      apiRes = await fetch(thirdUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const data = await apiRes.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Serverless Gemini API Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
