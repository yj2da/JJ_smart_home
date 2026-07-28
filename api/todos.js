/* ==========================================================================
   VERCEL SERVERLESS FUNCTION - SMARTHOME CLOUD DATABASE API (/api/todos)
   Stores Todos, Routines & ESP Device Name in Vercel KV / Upstash Redis
   ========================================================================= */

let localCache = {
  todos: [
    { id: 1, text: '스마트홈 온습도 체크', completed: true },
    { id: 2, text: '수면 코골이 분석 모니터링', completed: false }
  ],
  routines: [
    { id: 'default_1', time: '08:00', actionKey: 'WAKEUP', enabled: true }
  ],
  espName: 'MPY ESP32'
};

export default async function handler(req, res) {
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

  // Resolve Vercel KV / Upstash / REDIS / STORAGE Env Vars
  let kvUrl = process.env.KV_REST_API_URL ||
              process.env.UPSTASH_REDIS_REST_URL ||
              process.env.STORAGE_REST_API_URL ||
              process.env.STORAGE_KV_REST_API_URL ||
              process.env.STORAGE_REDIS_REST_URL ||
              process.env.REDIS_REST_API_URL ||
              process.env.STORAGE_URL;

  let kvToken = process.env.KV_REST_API_TOKEN ||
                process.env.UPSTASH_REDIS_REST_TOKEN ||
                process.env.STORAGE_REST_API_TOKEN ||
                process.env.STORAGE_KV_REST_API_TOKEN ||
                process.env.STORAGE_REDIS_REST_TOKEN ||
                process.env.REDIS_REST_API_TOKEN ||
                process.env.STORAGE_TOKEN;

  if (!kvUrl) {
    if (process.env.REDIS_URL && process.env.REDIS_URL.startsWith('https://')) {
      kvUrl = process.env.REDIS_URL;
    } else if (process.env.STORAGE_URL && process.env.STORAGE_URL.startsWith('https://')) {
      kvUrl = process.env.STORAGE_URL;
    }
  }

  // 1. GET Request: Fetch SmartHome Data (Todos, Routines, ESP Name) from DB
  if (req.method === 'GET') {
    if (kvUrl && kvToken) {
      try {
        const fetchUrl = `${kvUrl.replace(/\/$/, '')}/get/jinjin_smarthome_data`;
        const apiRes = await fetch(fetchUrl, {
          headers: { Authorization: `Bearer ${kvToken}` }
        });
        const data = await apiRes.json();
        
        if (data && data.result !== undefined && data.result !== null) {
          let parsedData = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
          if (parsedData && typeof parsedData === 'object') {
            const todos = Array.isArray(parsedData.todos) ? parsedData.todos : (Array.isArray(parsedData) ? parsedData : localCache.todos);
            const routines = Array.isArray(parsedData.routines) ? parsedData.routines : localCache.routines;
            const espName = parsedData.espName || localCache.espName;

            localCache = { todos, routines, espName };
            return res.status(200).json({ success: true, todos, routines, espName, source: 'Vercel_KV' });
          }
        }
      } catch (err) {
        console.error('Vercel KV GET Error:', err);
      }
    }
    return res.status(200).json({ success: true, ...localCache, source: 'Local_Cache' });
  }

  // 2. POST / PUT Request: Save SmartHome Data to DB
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const { todos, routines, espName } = req.body || {};

      if (Array.isArray(todos)) localCache.todos = todos;
      if (Array.isArray(routines)) localCache.routines = routines;
      if (espName && typeof espName === 'string') localCache.espName = espName;

      if (kvUrl && kvToken) {
        const setUrl = `${kvUrl.replace(/\/$/, '')}/set/jinjin_smarthome_data`;
        const apiRes = await fetch(setUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${kvToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(JSON.stringify(localCache))
        });
        const data = await apiRes.json();

        // Save legacy key for backward compatibility
        if (Array.isArray(todos)) {
          const legacyUrl = `${kvUrl.replace(/\/$/, '')}/set/jinjin_smarthome_todos`;
          fetch(legacyUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(JSON.stringify(todos))
          }).catch(() => {});
        }

        return res.status(200).json({ success: true, ...localCache, source: 'Vercel_KV', kvResult: data });
      }

      return res.status(200).json({ success: true, ...localCache, source: 'Local_Cache' });
    } catch (err) {
      console.error('Vercel KV POST Error:', err);
      return res.status(500).json({ error: err.message || 'Server Error' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
