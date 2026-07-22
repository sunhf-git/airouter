const API_CONFIG = {
  nvidia: {
    baseUrl: "https://integrate.api.nvidia.com",
    authHeader: "Authorization",
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com",
    authHeader: "X-Goog-Api-Key",
  },
  groq: {
    baseUrl: "https://api.groq.com",
    authHeader: "Authorization",
  },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS,PUT,DELETE",
  "Access-Control-Allow-Headers": "Authorization,Content-Type,X-API-Key,X-Goog-Api-Key,X-Nvidia-Api-Key,X-Groq-Api-Key",
  "Access-Control-Max-Age": "86400",
  "Timing-Allow-Origin": "*",
};

export default async function onRequest(context) {
  const { request } = context;
  
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace("/p", "");

  let provider = "";
  let apiPath = "";

  if (path.startsWith("/nvidia/")) {
    provider = "nvidia";
    apiPath = path.replace("/nvidia", "");
  } else if (path.startsWith("/google/")) {
    provider = "google";
    apiPath = path.replace("/google", "");
  } else if (path.startsWith("/groq/")) {
    provider = "groq";
    apiPath = path.replace("/groq", "");
  }

  if (!provider) {
    return new Response(
      JSON.stringify({
        error: "Unknown route",
        message: "Use /p/nvidia/, /p/google/, or /p/groq/ prefix",
        available_endpoints: {
          nvidia: "/p/nvidia/*",
          google: "/p/google/*",
          groq: "/p/groq/*",
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  const config = API_CONFIG[provider];
  let targetUrl = `${config.baseUrl}${apiPath}${url.search}`;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("Host");
  requestHeaders.delete("Origin");
  requestHeaders.delete("Referer");

  if (requestHeaders.get("X-Nvidia-Api-Key") && provider === "nvidia") {
    requestHeaders.set("Authorization", `Bearer ${requestHeaders.get("X-Nvidia-Api-Key")}`);
    requestHeaders.delete("X-Nvidia-Api-Key");
  }

  if (requestHeaders.get("X-Goog-Api-Key") && provider === "google") {
    const apiKey = requestHeaders.get("X-Goog-Api-Key");
    if (!url.searchParams.has("key")) {
      const targetUrlObj = new URL(targetUrl);
      targetUrlObj.searchParams.set("key", apiKey);
      targetUrl = targetUrlObj.toString();
    }
    requestHeaders.delete("X-Goog-Api-Key");
  }

  if (requestHeaders.get("X-Groq-Api-Key") && provider === "groq") {
    requestHeaders.set("Authorization", `Bearer ${requestHeaders.get("X-Groq-Api-Key")}`);
    requestHeaders.delete("X-Groq-Api-Key");
  }

  if (provider === "nvidia" && !requestHeaders.get("Authorization")) {
    return new Response(
      JSON.stringify({ error: "Missing NVIDIA API key. Use Authorization header or X-Nvidia-Api-Key" }),
      { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  if (provider === "google" && !url.searchParams.has("key") && !requestHeaders.get("X-Goog-Api-Key")) {
    return new Response(
      JSON.stringify({ error: "Missing Google API key. Use X-Goog-Api-Key header or ?key= parameter" }),
      { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  if (provider === "groq" && !requestHeaders.get("Authorization")) {
    return new Response(
      JSON.stringify({ error: "Missing Groq API key. Use Authorization header or X-Groq-Api-Key" }),
      { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  const modifiedRequest = new Request(targetUrl, {
    method: request.method,
    headers: requestHeaders,
    body: request.body,
    redirect: "follow",
  });

  try {
    const response = await fetch(modifiedRequest);
    const responseHeaders = new Headers(response.headers);

    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS,PUT,DELETE");
    responseHeaders.set("Access-Control-Allow-Headers", "Authorization,Content-Type,X-API-Key,X-Goog-Api-Key,X-Nvidia-Api-Key,X-Groq-Api-Key");
    responseHeaders.set("Timing-Allow-Origin", "*");

    responseHeaders.delete("Content-Security-Policy");
    responseHeaders.delete("X-Content-Security-Policy");
    responseHeaders.delete("X-Frame-Options");
    responseHeaders.delete("Strict-Transport-Security");
    responseHeaders.delete("Set-Cookie");

    responseHeaders.set("X-Proxy-Provider", provider);
    responseHeaders.set("X-Proxy-Version", "1.0");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Proxy request failed",
        provider: provider,
        details: error.message,
        target: targetUrl,
      }),
      { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
}