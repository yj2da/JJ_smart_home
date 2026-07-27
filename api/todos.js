/* ==========================================================================
   VERCEL SERVERLESS FUNCTION - TODO LIST DATABASE API (/api/todos)
   Supports Vercel KV / Upstash Redis REST API
   Environment Variables:
     - KV_REST_API_URL or UPSTASH_REDIS_REST_URL
     - KV_REST_API_TOKEN or UPSTASH_REDIS_REST_TOKEN
   Fallback: In-memory store for local testing
   ========================================================================= */

// In-Memory Fallback Cache for local dev
let localTodoCache = [
  { id: 1, text: '스마트홈 온습도 체크', completed: true },
  { id: 2, text: '수면 코골이 분석 모니터링', completed: false }
];

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  // 1. GET Request: Fetch Todos from DB
  if (req.method === 'GET') {
    if (kvUrl && kvToken) {
      try {
        const fetchUrl = `${kvUrl}/get/jinjin_smarthome_todos`;
        const apiRes = await fetch(fetchUrl, {
          headers: { Authorization: `Bearer ${kvToken}` }
        });
        const data = await apiRes.json();
        
        if (data && data.result) {
          let parsedData = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
          return res.status(200).json({ success: true, todos: parsedData, source: 'Vercel_KV' });
        }
      } catch (err) {
        console.error('Vercel KV GET Error:', err);
      }
    }
    // Fallback to local memory
    return res.status(200).json({ success: true, todos: localTodoCache, source: 'Local_Cache' });
  }

  // 2. POST / PUT Request: Save Todos to DB
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const { todos } = req.body || {};
      if (!Array.isArray(todos)) {
        return res.status(400).json({ error: 'Invalid todos data. Expected array.' });
      }

      localTodoCache = todos;

      if (kvUrl && kvToken) {
        const setUrl = `${kvUrl}/set/jinjin_smarthome_todos`;
        const apiRes = await fetch(setUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${kvToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(JSON.stringify(todos))
        });
        const data = await apiRes.json();
        return res.status(200).json({ success: true, todos, source: 'Vercel_KV', kvResult: data });
      }

      return res.status(200).json({ success: true, todos: localTodoCache, source: 'Local_Cache' });
    } catch (err) {
      console.error('Vercel KV POST Error:', err);
      return res.status(500).json({ error: err.message || 'Server Error' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
