const API_CONFIG: Record<string, { baseUrl: string; authHeader: string }> = {
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

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname;

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
        message: "Use /nvidia/, /google/, or /groq/ prefix",
        available_endpoints: {
          nvidia: "/nvidia/*",
          google: "/google/*",
          groq: "/groq/*",
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  const config = API_CONFIG[provider];
  let targetUrl = `${config.baseUrl}${apiPath}${url.search}`;

  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete("Host");
  requestHeaders.delete("Origin");
  requestHeaders.delete("Referer");

  if (requestHeaders.get("X-Nvidia-Api-Key") && provider === "nvidia") {
    requestHeaders.set("Authorization", `Bearer ${requestHeaders.get("X-Nvidia-Api-Key")}`);
    requestHeaders.delete("X-Nvidia-Api-Key");
  }

  if (requestHeaders.get("X-Goog-Api-Key") && provider === "google") {
    const apiKey = requestHeaders.get("X-Goog-Api-Key")!;
    if (!url.searchParams.has("key")) {
      url.searchParams.set("key", apiKey);
      const targetUrlObj = new URL(targetUrl);
      targetUrlObj.searchParams.set("key", apiKey);
      targetUrl = targetUrlObj.toString();
    }
    requestHeaders.delete("X-Goog-Api-Key");
  }

  if (provider === "google") {
    const authHeader = requestHeaders.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ") && !url.searchParams.has("key")) {
      const apiKey = authHeader.slice(7);
      url.searchParams.set("key", apiKey);
      const targetUrlObj = new URL(targetUrl);
      targetUrlObj.searchParams.set("key", apiKey);
      targetUrl = targetUrlObj.toString();
    }
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

  if (provider === "google" && !url.searchParams.has("key")) {
    return new Response(
      JSON.stringify({ error: "Missing Google API key. Use Authorization header, X-Goog-Api-Key header, or ?key= parameter" }),
      { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  if (provider === "groq" && !requestHeaders.get("Authorization")) {
    return new Response(
      JSON.stringify({ error: "Missing Groq API key. Use Authorization header or X-Groq-Api-Key" }),
      { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  const fetchInit: RequestInit = {
    method: req.method,
    headers: requestHeaders,
    redirect: "follow",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    fetchInit.body = await req.arrayBuffer();
  }

  try {
    const response = await fetch(targetUrl, fetchInit);
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
    const err = error as Error;
    return new Response(
      JSON.stringify({
        error: "Proxy request failed",
        provider: provider,
        details: err.message,
        target: targetUrl,
      }),
      { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
}

Deno.serve(handler);