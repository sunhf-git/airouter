const express = require('express');
const cors = require('cors');
const { fetch } = require('undici');

const app = express();
const PORT = process.env.PORT || 3000;

const API_CONFIG = {
  nvidia: {
    baseUrl: 'https://integrate.api.nvidia.com',
    authHeader: 'Authorization',
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    authHeader: 'X-Goog-Api-Key',
  },
  groq: {
    baseUrl: 'https://api.groq.com',
    authHeader: 'Authorization',
  },
};

app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-API-Key', 'X-Goog-Api-Key', 'X-Nvidia-Api-Key', 'X-Groq-Api-Key'],
}));

app.use(express.raw({ type: '*/*', limit: '100mb' }));

async function proxyHandler(req, res, provider) {
  const config = API_CONFIG[provider];
  const apiPath = req.originalUrl.replace(`/${provider}`, '');
  
  let targetUrl = `${config.baseUrl}${apiPath}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, value);
  }
  
  headers.delete('host');
  headers.delete('origin');
  headers.delete('referer');

  if (headers.get('x-nvidia-api-key') && provider === 'nvidia') {
    headers.set('authorization', `Bearer ${headers.get('x-nvidia-api-key')}`);
    headers.delete('x-nvidia-api-key');
  }

  if (headers.get('x-groq-api-key') && provider === 'groq') {
    headers.set('authorization', `Bearer ${headers.get('x-groq-api-key')}`);
    headers.delete('x-groq-api-key');
  }

  if (provider === 'nvidia' && !headers.get('authorization')) {
    return res.status(401).json({ error: 'Missing NVIDIA API key. Use Authorization header or X-Nvidia-Api-Key' });
  }

  if (provider === 'groq' && !headers.get('authorization')) {
    return res.status(401).json({ error: 'Missing Groq API key. Use Authorization header or X-Groq-Api-Key' });
  }

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: req.body,
      redirect: 'follow',
    });

    const responseHeaders = {};
    for (const [key, value] of response.headers) {
      if (!['content-security-policy', 'x-content-security-policy', 'x-frame-options', 'strict-transport-security', 'set-cookie'].includes(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    }

    responseHeaders['access-control-allow-origin'] = '*';
    responseHeaders['x-proxy-provider'] = provider;
    responseHeaders['x-proxy-version'] = '1.0';

    res.status(response.status);
    for (const [key, value] of Object.entries(responseHeaders)) {
      res.setHeader(key, value);
    }

    const stream = response.body;
    stream.pipe(res);
  } catch (error) {
    res.status(502).json({
      error: 'Proxy request failed',
      provider: provider,
      details: error.message,
      target: targetUrl,
    });
  }
}

app.all('/nvidia/*', (req, res) => proxyHandler(req, res, 'nvidia'));
app.all('/google/*', (req, res) => proxyHandler(req, res, 'google'));
app.all('/groq/*', (req, res) => proxyHandler(req, res, 'groq'));

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'OpenAI Router Proxy',
    available_endpoints: {
      nvidia: '/nvidia/*',
      google: '/google/*',
      groq: '/groq/*',
    },
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
