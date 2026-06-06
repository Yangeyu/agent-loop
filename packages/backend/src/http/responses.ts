export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
}

export function jsonResponse(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: {
      ...corsHeaders,
      ...(init?.headers ?? {}),
    },
  })
}

export function htmlResponse(html: string, init?: ResponseInit) {
  return new Response(html, {
    ...init,
    headers: {
      ...corsHeaders,
      "content-type": "text/html; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  })
}
