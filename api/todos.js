/* ==========================================================================
   VERCEL SERVERLESS FUNCTION - SMARTHOME CLOUD DATABASE API (/api/todos)
   Stores Todos, Routines & ESP Device Name in Vercel KV / Upstash Redis
   Supports Device-Specific DB per ESP Device Name
   ========================================================================= */

let localCacheStore = {};

function getESPDefaultData(espName) {
  const key = String(espName).replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!localCacheStore[key]) {
    localCacheStore[key] = {
      todos: [
        { id: 101, text: `${espName} 스마트홈 연동 완료`, completed: true },
        { id: 102, text: '수면 패턴 코골이 분석 모니터링', completed: false }
      ],
      routines: [
        { id: `rt_${key}_1`, time: '08:00', actionKey: 'WAKEUP', enabled: true }
      ],
      espName: espName
    };
  }
  return localCacheStore[key];
}

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

  // Extract ESP Device Name from query params or body
  const rawEspName = req.query.espName || req.body?.espName || 'MPY ESP32';
  const cleanEspName = String(rawEspName).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dbKey = `jinjin_smarthome_data_${cleanEspName}`;

  const defaultStore = getESPDefaultData(rawEspName);

  // 1. GET Request: Fetch SmartHome Data by ESP Name
  if (req.method === 'GET') {
    if (kvUrl && kvToken) {
      try {
        const fetchUrl = `${kvUrl.replace(/\/$/, '')}/get/${dbKey}`;
        const apiRes = await fetch(fetchUrl, {
          headers: { Authorization: `Bearer ${kvToken}` }
        });
        const data = await apiRes.json();
        
        if (data && data.result !== undefined && data.result !== null) {
          let parsedData = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
          if (parsedData && typeof parsedData === 'object') {
            const todos = Array.isArray(parsedData.todos) ? parsedData.todos : defaultStore.todos;
            const routines = Array.isArray(parsedData.routines) ? parsedData.routines : defaultStore.routines;
            const espName = parsedData.espName || rawEspName;

            return res.status(200).json({ success: true, todos, routines, espName, source: 'Vercel_KV', dbKey });
          }
        }
      } catch (err) {
        console.error('Vercel KV GET Error:', err);
      }
    }
    return res.status(200).json({ success: true, ...defaultStore, espName: rawEspName, source: 'ESP_Memory_Store', dbKey });
  }

  // 2. POST / PUT Request: Save SmartHome Data by ESP Name
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const { todos, routines, espName } = req.body || {};
      const targetEspName = espName || rawEspName;
      const targetDbKey = `jinjin_smarthome_data_${String(targetEspName).replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      const saveData = {
        todos: Array.isArray(todos) ? todos : defaultStore.todos,
        routines: Array.isArray(routines) ? routines : defaultStore.routines,
        espName: targetEspName,
        updatedAt: new Date().toISOString()
      };

      // Update in-memory ESP store
      const targetKey = String(targetEspName).replace(/[^a-zA-Z0-9_-]/g, '_');
      localCacheStore[targetKey] = saveData;

      if (kvUrl && kvToken) {
        const setUrl = `${kvUrl.replace(/\/$/, '')}/set/${targetDbKey}`;
        const apiRes = await fetch(setUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${kvToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(JSON.stringify(saveData))
        });
        const data = await apiRes.json();

        return res.status(200).json({ success: true, ...saveData, source: 'Vercel_KV', kvResult: data, dbKey: targetDbKey });
      }

      return res.status(200).json({ success: true, ...saveData, source: 'ESP_Memory_Store' });
    } catch (err) {
      console.error('Vercel KV POST Error:', err);
      return res.status(500).json({ error: err.message || 'Server Error' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
