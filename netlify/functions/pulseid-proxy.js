// noinspection JSUnusedGlobalSymbols
/* global Buffer */
/**
 * Netlify function handler
 * @param {import('@netlify/functions').HandlerEvent} event
 * @param {import('@netlify/functions').HandlerContext} _context
 * @returns {Promise<import('@netlify/functions').HandlerResponse>}
 */
export async function handler(event, _context) {
    // noinspection JSUnresolvedVariable
    console.log('Proxy called with event:', event.queryStringParameters);
    console.log('');


    const API_KEY = "pulseRockBottomGolf";
    const COMPANY = "PersonalizeYourGear";

    const ORIGIN = "https://rockbottom.pulseidconnect.com"; // host only, no trailing slash

    // Build a fully-qualified upstream URL from either a full URL or an endpoint path,
    // and merge extra query params into it safely.
    function buildUpstreamUrl(urlOrEndpoint, extraQuery) {
        const extra = new URLSearchParams(extraQuery || {}).toString();
        const isAbs = /^https?:\/\//i.test(urlOrEndpoint || "");
        let base;
        if (isAbs) {
            base = urlOrEndpoint;
        } else if (!urlOrEndpoint) {
            base = `${ORIGIN}/api`;
        } else if (urlOrEndpoint.startsWith('/')) {
            base = `${ORIGIN}${urlOrEndpoint}`; // root-relative: /api/... or /API/...
        } else if (/^api\//i.test(urlOrEndpoint)) {
            base = `${ORIGIN}/${urlOrEndpoint}`; // "api/..."
        } else {
            base = `${ORIGIN}/api/${urlOrEndpoint.replace(/^\/+/, '')}`; // bare endpoint -> /api/endpoint
        }
        if (!extra) return base;
        return base + (base.includes('?') ? `&${extra}` : `?${extra}`);
    }

    // noinspection JSUnresolvedVariable
    const methodFromEvent = event.httpMethod || 'GET';
    const qp = event.queryStringParameters || {};
    const { url: absUrl, endpoint, method: methodOverride, ...forwardParams } = qp;
    const method = (methodOverride || methodFromEvent).toUpperCase();

    // Allow either `url=` (absolute) or `endpoint=` (path). One is required.
    const targetSpecifier = absUrl || endpoint;
    if (!targetSpecifier) {
        return {
            statusCode: 400,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, apiKey, company",
                "Content-Type": "application/json",
                "Cache-Control": "no-store"
            },
            body: JSON.stringify({ error: "Missing 'url' or 'endpoint' parameter" }),
        };
    }

    const url = buildUpstreamUrl(targetSpecifier, forwardParams);

    const options = {
        method,
        headers: {
            "apiKey": API_KEY,
            "company": COMPANY,
            "Content-Type": "application/json",
        }
    };

    if (method === "POST" || method === "PUT") {
        options.body = event.body;
    }

    try {
        const response = await fetch(url, options);
        const contentType = (response.headers.get("Content-Type") || "").toLowerCase();

        // Basic response logging
        console.log(`[PulseID] ${method} ${url} -> ${response.status} ${response.statusText}`);
        console.log(`[PulseID] Content-Type: ${contentType || 'n/a'}`);

        // If upstream failed, log and forward the error body
        if (!response.ok) {
            let errorBody;
            try {
                if (contentType.includes("application/json")) {
                    errorBody = await response.json();
                    console.error("[PulseID] Error JSON:", errorBody);
                } else {
                    errorBody = await response.text();
                    console.error("[PulseID] Error Text:", errorBody);
                }
            } catch (parseErr) {
                console.error("[PulseID] Error parsing error body:", parseErr);
                errorBody = `Upstream error ${response.status}: unable to parse body`;
            }

            return {
                statusCode: response.status,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, apiKey, company",
                    "Content-Type": contentType || "text/plain",
                    "Cache-Control": "no-store"
                },
                body: typeof errorBody === "string" ? errorBody : JSON.stringify(errorBody)
            };
        }

        // Handle images (e.g., PNG, JPEG) as base64
        if (contentType.startsWith("image/")) {
            const buffer = await response.arrayBuffer();
            return {
                statusCode: response.status,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, apiKey, company",
                    "Content-Type": contentType,
                    "Cache-Control": "no-store"
                },
                body: Buffer.from(buffer).toString("base64"),
                isBase64Encoded: true
            };
        }

        // If upstream is not JSON, pass through as text (covers text/plain, text/html, etc.)
        if (!contentType || !contentType.includes("application/json")) {
            const text = await response.text();
            return {
                statusCode: response.status,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, apiKey, company",
                    "Content-Type": contentType || "text/plain",
                    "Cache-Control": "no-store"
                },
                body: text
            };
        }

        // Default: JSON
        const data = await response.json();
        return {
            statusCode: response.status,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, apiKey, company",
                "Content-Type": "application/json",
                "Cache-Control": "no-store"
            },
            body: JSON.stringify(data),
        };
    } catch (error) {
        console.error('Error fetching from PulseID API:', error);
        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, apiKey, company",
                "Content-Type": "application/json",
                "Cache-Control": "no-store"
            },
            body: JSON.stringify({ error: error.message }),
        };
    }
}