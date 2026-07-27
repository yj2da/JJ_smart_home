/* ==========================================================================
   VERCEL SERVERLESS FUNCTION - OPENWEATHERMAP API PROXY
   Environment Variable: OPENWEATHER_API_KEY (Set in Vercel Dashboard)
   Default Location: Busan (부산)
   ========================================================================== */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Read OpenWeatherMap Key from Vercel Environment Variable OPENWEATHER_API_KEY
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const city = req.query.city || 'Busan';

  if (!apiKey) {
    return res.status(500).json({ error: 'OPENWEATHER_API_KEY environment variable is not set' });
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=kr`;
    const apiRes = await fetch(url);
    const data = await apiRes.json();

    if (apiRes.ok && data.cod === 200) {
      return res.status(200).json(data);
    } else {
      return res.status(apiRes.status || 400).json(data);
    }
  } catch (error) {
    console.error('Serverless OpenWeather API Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
